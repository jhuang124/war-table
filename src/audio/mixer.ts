// The mixer: voice management + room reverb + master chain. Works on any BaseAudioContext, so the
// exact same routing renders live and inside an OfflineAudioContext for measurement.
//
//  voice ─┬─ panner ──────────────────────────► sfxBus (volume²) ─ HP 30 Hz ─ shelf ─┐
//         └─ send(wet) ─ room convolver ─ return ► sfxBus                            │
//  music ─ duck ─ musicVol ────────────────────────────────────────────────────────── ┤
//                                                                                    ▼
//                                     preMaster ─ limiter ─ makeup-comp ─ soft clip ─ mute ─ out

import { SoundBank } from './bank';
import { clamp, dbToGain, roomImpulse, softClipCurve } from './dsp';
import { startMusic, type MusicHandle } from './music';
import { SFX } from './sounds';
import type { Rand, SfxName, SfxVariant } from './types';

export const MAX_VOICES = 20;
/** Scheduling lookahead for live plays (keeps envelopes from starting in the past). */
export const LOOKAHEAD = 0.006;

// Limiter: hard knee so the WebAudio auto-makeup gain is exactly predictable and can be undone.
const LIM_THRESHOLD = -3;
const LIM_RATIO = 20;
/** Spec'd DynamicsCompressor makeup = (1/fullRangeGain)^0.6; this undoes it. */
export const LIMITER_MAKEUP_COMP = dbToGain(0.6 * (LIM_THRESHOLD + -LIM_THRESHOLD / LIM_RATIO));

export interface MixerOptions {
  /** Master limiter + soft clip (live: on; per-sound analysis: off, to prove sounds are clean alone). */
  limiter?: boolean;
  /** Live contexts schedule node cleanup with timers; offline ones don't need it. */
  live?: boolean;
  /** Pre-rendered variation bank (default: on when live). */
  bank?: boolean;
  /** Rand for bank renders and variation picks (tests pass a seeded one). */
  bankRand?: Rand;
  /** ±2% playback-rate jitter on banked, non-musical sounds (default true). */
  rateJitter?: boolean;
}

export interface TriggerOptions {
  volume?: number;
  pan?: number;
  rate?: number;
  duration?: number;
  variant?: SfxVariant;
  rand?: Rand;
}

interface Voice {
  name: SfxName;
  start: number;
  end: number;
  priority: number;
  gain: GainNode;
  nodes: AudioNode[];
  timer?: ReturnType<typeof setTimeout>;
}

export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly sfxBus: GainNode;
  readonly musicBus: GainNode;
  readonly musicDuck: GainNode;
  readonly musicVol: GainNode;
  readonly muteGain: GainNode;
  readonly room: ConvolverNode;
  private readonly live: boolean;
  private readonly rateJitter: boolean;
  readonly bank: SoundBank | null;
  private voices: Voice[] = [];
  private lastAt: Partial<Record<SfxName, number>> = {};
  private duckUntil = 0;
  private music: MusicHandle | null = null;
  played = 0;
  dropped = 0;
  stolen = 0;
  /** Duration (s) the last successful trigger reported. */
  lastDuration = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode = ctx.destination, opts: MixerOptions = {}) {
    this.ctx = ctx;
    this.live = opts.live ?? false;
    this.rateJitter = opts.rateJitter ?? true;
    this.bank = opts.bank ?? this.live ? new SoundBank(ctx, { rand: opts.bankRand, background: this.live }) : null;
    const limiter = opts.limiter ?? true;

    this.sfxBus = ctx.createGain();
    this.room = ctx.createConvolver();
    this.room.normalize = false;
    this.room.buffer = roomImpulse(ctx);
    const roomReturn = ctx.createGain();
    roomReturn.gain.value = 1;
    this.room.connect(roomReturn).connect(this.sfxBus);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 30;
    hp.Q.value = 0.6;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 7500;
    shelf.gain.value = -2.5;

    this.musicBus = ctx.createGain();
    this.musicDuck = ctx.createGain();
    this.musicVol = ctx.createGain();
    this.musicVol.gain.value = 0.7 * 0.7;
    this.musicBus.connect(this.musicDuck).connect(this.musicVol);

    const pre = ctx.createGain();
    this.sfxBus.connect(hp).connect(shelf).connect(pre);
    this.musicVol.connect(pre);

    this.muteGain = ctx.createGain();
    let tail: AudioNode = pre;
    if (limiter) {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = LIM_THRESHOLD;
      lim.knee.value = 0;
      lim.ratio.value = LIM_RATIO;
      lim.attack.value = 0.001;
      lim.release.value = 0.12;
      const comp = ctx.createGain();
      comp.gain.value = LIMITER_MAKEUP_COMP;
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve(0.75, 0.944);
      clip.oversample = 'none';
      tail = tail.connect(lim).connect(comp).connect(clip);
    }
    tail.connect(this.muteGain).connect(out);
  }

  // -------------------------------------------------------------------------

  trigger(name: SfxName, when: number, o: TriggerOptions = {}): boolean {
    const meta = SFX[name];
    if (!meta) return false;
    this.prune(when);

    const last = this.lastAt[name];
    if (last !== undefined && when >= last && (when - last) * 1000 < meta.minGapMs) {
      this.dropped++;
      return false;
    }
    const mine = this.voices.filter((v) => v.name === name);
    if (mine.length >= meta.maxVoices) this.steal(mine[0], when);
    const others = Math.min(mine.length, meta.maxVoices - 1);
    if (this.voices.length >= MAX_VOICES) {
      let victim: Voice | null = null;
      for (const v of this.voices) if (!victim || v.priority < victim.priority) victim = v;
      if (victim && victim.priority <= meta.priority) this.steal(victim, when);
      else {
        this.dropped++;
        return false;
      }
    }

    const ctx = this.ctx;
    const rate = clamp(o.rate ?? 1, 0.5, 2);
    const volume = clamp(o.volume ?? 1, 0, 2);
    const density = meta.densityDb ? Math.min(meta.densityMaxDb ?? 6, others * meta.densityDb) : 0;
    const duration = meta.duration ? clamp(o.duration ?? meta.duration[2], meta.duration[0], meta.duration[1]) : undefined;
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(meta.trimDb - density) * volume;
    const nodes: AudioNode[] = [gain];
    let head: AudioNode = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan ?? 0, -1, 1);
      gain.connect(p);
      head = p;
      nodes.push(p);
    }
    head.connect(this.sfxBus);
    if (meta.wet > 0) {
      const send = ctx.createGain();
      send.gain.value = meta.wet;
      gain.connect(send).connect(this.room);
      nodes.push(send);
    }

    let dur: number;
    const rand = o.rand ?? Math.random;
    try {
      const dq = SoundBank.quantize(duration);
      const banked = this.bank?.take(name, o.variant, dq) ?? null;
      if (banked) {
        const src = ctx.createBufferSource();
        src.buffer = banked;
        const r = rate * (meta.musical || !this.rateJitter ? 1 : 1 + (rand() * 2 - 1) * 0.02);
        src.playbackRate.value = r;
        src.connect(gain);
        src.start(when);
        dur = banked.duration / r;
      } else {
        dur = meta.fn(ctx, gain, when, { rate, rand, duration: dq, variant: o.variant });
        this.bank?.request(name, o.variant, dq);
      }
    } catch (err) {
      for (const n of nodes) n.disconnect();
      console.warn(`[audio] ${name} failed`, err);
      return false;
    }
    if (!Number.isFinite(dur) || dur <= 0) dur = meta.maxDur / rate;

    const v: Voice = { name, start: when, end: when + dur, priority: meta.priority, gain, nodes };
    if (this.live) {
      const ms = (v.end - ctx.currentTime) * 1000 + 250;
      v.timer = setTimeout(() => this.release(v), Math.max(50, ms));
    }
    this.voices.push(v);
    this.lastAt[name] = when;
    this.lastDuration = dur;
    this.played++;
    if (meta.duckDb) this.duck(when, dur, meta.duckDb);
    return true;
  }

  /** Fade out everything playing or scheduled (e.g. on skipAnimations). */
  stopAll(at = this.ctx.currentTime): void {
    for (const v of [...this.voices]) this.steal(v, at, false);
    this.lastAt = {};
  }

  voiceCount(): number {
    return this.voiceCountAt(this.ctx.currentTime);
  }

  /** Voices still sounding (or scheduled) at context time t. */
  voiceCountAt(t: number): number {
    this.prune(t);
    return this.voices.length;
  }

  voicesByName(): Partial<Record<SfxName, number>> {
    this.prune(this.ctx.currentTime);
    const out: Partial<Record<SfxName, number>> = {};
    for (const v of this.voices) out[v.name] = (out[v.name] ?? 0) + 1;
    return out;
  }

  setVolume(v: number, at = this.ctx.currentTime): void {
    const g = clamp(v, 0, 1);
    this.sfxBus.gain.setTargetAtTime(g * g, at, 0.03);
  }

  setMusicVolume(v: number, at = this.ctx.currentTime): void {
    const g = clamp(v, 0, 1);
    this.musicVol.gain.setTargetAtTime(g * g, at, 0.1);
  }

  setMuted(m: boolean, at = this.ctx.currentTime): void {
    this.muteGain.gain.setTargetAtTime(m ? 0 : 1, at, 0.02);
  }

  // Music ------------------------------------------------------------------

  startMusic(at = this.ctx.currentTime, opts: { seed?: number; renderUntil?: number } = {}): void {
    if (this.music) return;
    this.music = startMusic(this.ctx, this.musicBus, at, {
      seed: opts.seed ?? ((Math.random() * 1e9) | 0),
      live: this.live,
      renderUntil: opts.renderUntil,
    });
  }

  stopMusic(at = this.ctx.currentTime): void {
    this.music?.stop(at);
    this.music = null;
  }

  get musicOn(): boolean {
    return this.music !== null;
  }

  // -------------------------------------------------------------------------

  private duck(when: number, dur: number, db: number): void {
    const g = this.musicDuck.gain;
    const end = Math.max(when + dur * 0.8, this.duckUntil);
    this.duckUntil = end;
    g.cancelScheduledValues(when);
    g.setTargetAtTime(dbToGain(-Math.abs(db)), when, 0.05);
    g.setTargetAtTime(1, end, 0.6);
  }

  private prune(now: number): void {
    if (!this.voices.length) return;
    const keep: Voice[] = [];
    for (const v of this.voices) {
      if (v.end > now) keep.push(v);
      else if (!this.live) this.disconnect(v);
    }
    this.voices = keep;
  }

  private steal(v: Voice, when: number, count = true): void {
    const at = Math.max(when, this.ctx.currentTime);
    const g = v.gain.gain;
    const cur = g.value;
    g.cancelScheduledValues(0);
    if (at <= v.start) g.setValueAtTime(0, at);
    else {
      g.setValueAtTime(cur, at);
      g.linearRampToValueAtTime(0, at + 0.03);
    }
    v.end = Math.min(v.end, at + 0.03);
    this.voices = this.voices.filter((x) => x !== v);
    if (count) this.stolen++;
    if (this.live) {
      if (v.timer) clearTimeout(v.timer);
      const ms = (at + 0.06 - this.ctx.currentTime) * 1000;
      v.timer = setTimeout(() => this.disconnect(v), Math.max(40, ms));
    }
  }

  private release(v: Voice): void {
    this.voices = this.voices.filter((x) => x !== v);
    this.disconnect(v);
  }

  private disconnect(v: Voice): void {
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }
}
