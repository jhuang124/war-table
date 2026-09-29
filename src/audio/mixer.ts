// The mixer: voice management + room reverb + master chain. Works on any BaseAudioContext, so the
// exact same routing renders live and inside an OfflineAudioContext for measurement.
//
//  voice ─┬─ panner ──────────────────────────► sfxBus (volume²) ─ HP 30 Hz ─ shelf ─┐
//         └─ send(wet) ─ room convolver ─ return ► sfxBus                            │
//  music ─ duck ─ musicVol ────────────────────────────────────────────────────────── ┤
//                                                                                    ▼
//                                     preMaster ─ limiter ─ makeup-comp ─ soft clip ─ mute ─ out

import { SoundBank } from './bank';
import { cached, clamp, dbToGain, mulberry32, roomImpulse, softClipCurve } from './dsp';
import { createMusicHall, musicHallImpulse, startMusic, type MusicHall, type MusicHandle } from './music';
import { SFX } from './sounds';
import { strokeLoop } from './sounds/brush';
import type { Rand, SfxName, SfxVariant, StrokeHandle } from './types';

export const MAX_VOICES = 20;
/** Scheduling lookahead for live plays (keeps envelopes from starting in the past). */
export const LOOKAHEAD = 0.006;
/** Silence rule: at most one cue starts per this many seconds (textures like the dice are exempt). */
export const CUE_GAP = 0.07;
/** Music duck recovery time constant: back to ~95% in 2–3 s. */
const DUCK_RECOVER_TAU = 0.8;
/** Default verdict beat (INK: 250 ms of silence between the dice settling and the verdict). */
export const HUSH_DEFAULT = 0.25;

// Limiter: hard knee so the WebAudio auto-makeup gain is exactly predictable and can be undone.
const LIM_THRESHOLD = -3;
const LIM_RATIO = 20;
/** Spec'd DynamicsCompressor makeup = (1/fullRangeGain)^0.6; this undoes it. */
export const LIMITER_MAKEUP_COMP = dbToGain(0.6 * (LIM_THRESHOLD + -LIM_THRESHOLD / LIM_RATIO));

/** Live stroke level: at full speed it sits around the ui tier (a whisper under the board). */
export const STROKE_TRIM_DB = -9.5;

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
  private duckDepth = 0;
  private music: MusicHandle | null = null;
  private hall: MusicHall | null = null;
  private hallReady: Promise<void> | null = null;
  /** Recent cue starts (context time, priority), for the ≤ 1 cue per 70 ms rule. */
  private cues: { t: number; p: number; v: Voice }[] = [];
  private hushFrom = -1;
  private hushUntil = -1;
  private liveStroke: { handle: StrokeHandle; kill: (at: number) => void } | null = null;
  /** Plays suppressed by the silence rules (hush, cue spacing, silent sounds). */
  hushed = 0;
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
    if (meta.silent) {
      this.hushed++;
      return false;
    }
    // the verdict beat: nothing new starts inside it
    if (when >= this.hushFrom && when < this.hushUntil) {
      this.hushed++;
      return false;
    }
    // A sound retriggered inside its own minimum gap is a repeat, not a new cue: drop it first, so a
    // burst of one sound thins to one instead of queueing up behind itself.
    const prev = this.lastAt[name];
    if (prev !== undefined && when >= prev && (when - prev) * 1000 < meta.minGapMs) {
      this.dropped++;
      return false;
    }
    // ≤ 1 cue per 70 ms. The more important cue wins: a new one replaces a lesser one that is
    // (about to be) sounding; an equal important one waits its turn (≤ a few frames, never audibly
    // late); routine sounds that collide simply drop (that is what thins dense bursts).
    if (!meta.texture) {
      for (let k = 0; k < 4; k++) {
        const clash = this.cues.find((c) => Math.abs(when - c.t) < CUE_GAP - 1e-6);
        if (!clash) break;
        if (meta.priority > clash.p) {
          this.steal(clash.v, when);
          this.cues = this.cues.filter((c) => c !== clash);
          continue;
        }
        if (meta.priority < 3 || k === 3) {
          this.hushed++;
          return false;
        }
        when = clash.t + CUE_GAP;
      }
      if (when >= this.hushFrom && when < this.hushUntil) {
        this.hushed++;
        return false;
      }
    }
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
    if (!meta.texture) {
      this.cues.push({ t: when, p: meta.priority, v });
      if (this.cues.length > 12) this.cues.shift();
    }
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
    this.cues = [];
    this.hushUntil = -1;
    this.liveStroke?.kill(at);
    this.liveStroke = null;
  }

  /** The verdict beat: nothing new starts in [at, at+sec), and the score dips under it. */
  hush(at: number, sec = HUSH_DEFAULT): void {
    const s = clamp(sec, 0, 2);
    this.hushFrom = at;
    this.hushUntil = at + s;
    this.duck(at, s, 5);
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

  startMusic(at = this.ctx.currentTime, opts: { seed?: number; renderUntil?: number; fadeIn?: number } = {}): void {
    if (this.music) return;
    const seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    const begin = (t: number) =>
      startMusic(this.ctx, this.musicBus, t, { seed, live: this.live, renderUntil: opts.renderUntil, fadeIn: opts.fadeIn, hall: this.hall ?? undefined });
    if (!this.live) {
      this.hall ??= createMusicHall(this.ctx, this.musicBus);
      this.music = begin(at);
      return;
    }
    if (this.hall) {
      this.music = begin(at);
      return;
    }
    // Live, first start: the hall (a 4 s impulse plus the convolver's setup, ~40 ms together) is
    // built across two idle slices so it never lands as one long task. The score fades in over
    // seconds, so starting ~100 ms later is inaudible.
    let cancelled = false;
    const pending: MusicHandle = {
      seed,
      stop: () => {
        cancelled = true;
      },
    };
    this.music = pending;
    void this.buildHall().then(() => {
      if (cancelled || this.music !== pending) return;
      this.music = begin(Math.max(at, this.ctx.currentTime + 0.05));
    });
  }

  private buildHall(): Promise<void> {
    if (this.hallReady) return this.hallReady;
    const w = typeof window !== 'undefined' ? (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) : null;
    const idle = (cb: () => void) => (w?.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 250 }) : setTimeout(cb, 16));
    this.hallReady = new Promise<void>((resolve) => {
      idle(() => {
        musicHallImpulse(this.ctx);
        idle(() => {
          this.hall = createMusicHall(this.ctx, this.musicBus);
          resolve();
        });
      });
    });
    return this.hallReady;
  }

  stopMusic(at = this.ctx.currentTime, fade = 1.5): void {
    this.music?.stop(at, fade);
    this.music = null;
  }

  /** Crossfade to a newly seeded score (a new game), ~3 s. */
  reseedMusic(seed: number, at = this.ctx.currentTime): void {
    if (!this.music || this.music.seed === seed) return;
    this.music.stop(at, 3);
    this.music = null;
    this.startMusic(at + 0.5, { seed, fadeIn: 5 });
  }

  get musicSeed(): number | null {
    return this.music?.seed ?? null;
  }

  get musicOn(): boolean {
    return this.music !== null;
  }

  // -------------------------------------------------------------------------

  /** Dip the score while a cue sounds; a smaller cue never lifts a deeper duck. Recovers over 2–3 s. */
  private duck(when: number, dur: number, db: number): void {
    const g = this.musicDuck.gain;
    const active = when < this.duckUntil;
    const depth = active ? Math.max(this.duckDepth, Math.abs(db)) : Math.abs(db);
    const end = Math.max(when + Math.min(dur * 0.8, 3), this.duckUntil);
    this.duckUntil = end;
    this.duckDepth = depth;
    g.cancelScheduledValues(when);
    g.setTargetAtTime(dbToGain(-depth), when, 0.06);
    g.setTargetAtTime(1, end, DUCK_RECOVER_TAU);
  }

  // Live stroke ---------------------------------------------------------------

  /**
   * A brush stroke the pointer drives (drag-to-attack). A looping bristle texture whose band and level
   * follow the pointer's speed. `at` lets offline renders script it; live callers omit it.
   */
  stroke(o: { pan?: number; at?: number } = {}): StrokeHandle {
    const ctx = this.ctx;
    const t0 = o.at ?? ctx.currentTime;
    this.liveStroke?.kill(t0);
    const src = ctx.createBufferSource();
    src.buffer = cached(ctx, 'strokeLoop', () => strokeLoop(ctx, mulberry32(77)));
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.value = 600;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3600;
    const g = ctx.createGain();
    g.gain.value = 0;
    const out = ctx.createGain();
    out.gain.value = dbToGain(STROKE_TRIM_DB);
    const nodes: AudioNode[] = [src, bp, lp, g, out];
    src.connect(bp).connect(lp).connect(g).connect(out);
    let head: AudioNode = out;
    let pan: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      pan.pan.value = clamp(o.pan ?? 0, -1, 1);
      out.connect(pan);
      head = pan;
      nodes.push(pan);
    }
    head.connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.1;
    out.connect(send).connect(this.room);
    nodes.push(send);
    src.start(t0, Math.random() * 1.5);

    let done = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const maxAt = t0 + 8;
    const kill = (at: number, fade = 0.2) => {
      if (done) return;
      done = true;
      if (idle) clearTimeout(idle);
      const t = Math.max(at, ctx.currentTime);
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, fade / 4);
      src.stop(t + fade + 0.05);
      if (this.live) setTimeout(() => nodes.forEach((n) => n.disconnect()), (t + fade + 0.2 - ctx.currentTime) * 1000);
      if (this.liveStroke?.handle === handle) this.liveStroke = null;
    };
    const handle: StrokeHandle & { moveAt?: (speed: number, at: number, p?: number) => void; endAt?: (commit: boolean, at: number) => void } = {
      move: (speed, p) => handle.moveAt!(speed, ctx.currentTime, p),
      end: (commit) => handle.endAt!(commit, ctx.currentTime),
    };
    handle.moveAt = (speed: number, at: number, p?: number) => {
      if (done || !Number.isFinite(speed)) return;
      if (at >= maxAt) return kill(at);
      const v = clamp(speed, 0, 1.5);
      // resting = silent; a quick stroke = a soft, bright sweep
      const level = v < 0.02 ? 0 : Math.pow(Math.min(1, v), 0.7);
      g.gain.setTargetAtTime(level, at, 0.05);
      bp.frequency.setTargetAtTime(480 + 1100 * Math.min(1, v), at, 0.08);
      if (pan && p !== undefined && Number.isFinite(p)) pan.pan.setTargetAtTime(clamp(p, -1, 1), at, 0.1);
      if (this.live) {
        if (idle) clearTimeout(idle);
        // a stuck pointer never leaves a hiss behind
        idle = setTimeout(() => g.gain.setTargetAtTime(0, ctx.currentTime, 0.1), 400);
      }
    };
    handle.endAt = (commit: boolean, at: number) => {
      if (done) return;
      if (commit) {
        // the stroke settles into the arrow: a last short press, then it lifts
        g.gain.cancelScheduledValues(at);
        g.gain.setTargetAtTime(0.6, at, 0.02);
        bp.frequency.setTargetAtTime(700, at, 0.04);
        kill(at + 0.08, 0.28);
      } else kill(at, 0.2);
    };
    this.liveStroke = { handle, kill };
    return handle;
  }

  private prune(now: number): void {
    if (!this.voices.length) return;
    // Offline renders schedule a whole scene up front, so a voice that "ended" before a later
    // trigger's start time has not even played yet: only forget it, never disconnect it (live
    // voices are disconnected by their own timers).
    this.voices = this.voices.filter((v) => v.end > now);
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
