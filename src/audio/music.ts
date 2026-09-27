// Ambient bed: a quiet, slowly evolving pad in D dorian over a low drone, with an occasional distant
// war drum and a rare high glint. Default off. One scheduler serves both live playback (lookahead
// timer) and offline rendering (schedule the whole window up front), so it can be measured.

import { between, cents, envelope, midiHz, mulberry32, roomImpulse } from './dsp';
import { frameDrumTape } from './sounds/brass';
import type { Rand } from './types';

/** Overall bed level (linear). Calibrated so the bed sits ~12 dB under board SFX. */
export const MUSIC_LEVEL = 0.33;
const SEG = 14; // seconds per chord
const FADE_IN = 5;

// D dorian: Dm(add9) · Bbmaj7 · C(add9) · Am7/C — voiced low and close.
const PROGRESSION: number[][] = [
  [50, 57, 64, 65], // D3 A3 E4 F4
  [46, 53, 57, 62], // Bb2 F3 A3 D4
  [48, 55, 62, 64], // C3 G3 D4 E4
  [45, 52, 55, 60], // A2 E3 G3 C4
];
const GLINTS = [74, 76, 81, 69]; // D5 E5 A5 A4

export interface MusicHandle {
  stop(at: number): void;
}

export interface MusicOptions {
  seed: number;
  /** Live: keep scheduling with a timer. Offline: schedule [at, renderUntil] immediately. */
  live: boolean;
  renderUntil?: number;
}

export function startMusic(ctx: BaseAudioContext, dest: AudioNode, at: number, o: MusicOptions): MusicHandle {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(MUSIC_LEVEL, at + FADE_IN);
  out.connect(dest);

  const bus = ctx.createGain();
  const hall = ctx.createConvolver();
  hall.normalize = false;
  hall.buffer = roomImpulse(ctx, 2.6, 3.2);
  const hallSend = ctx.createGain();
  hallSend.gain.value = 0.55;
  bus.connect(out);
  bus.connect(hallSend).connect(hall).connect(out);

  const sources = new Set<AudioScheduledSourceNode>();
  const track = (s: AudioScheduledSourceNode) => {
    sources.add(s);
    s.onended = () => sources.delete(s);
    return s;
  };

  // --- drone: D2 + A2, breathing slowly -----------------------------------
  const droneLp = ctx.createBiquadFilter();
  droneLp.type = 'lowpass';
  droneLp.frequency.value = 380;
  droneLp.Q.value = 0.7;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.025;
  droneLp.connect(droneGain).connect(bus);
  const cutLfo = track(ctx.createOscillator());
  (cutLfo as OscillatorNode).frequency.value = 0.031;
  const cutDepth = ctx.createGain();
  cutDepth.gain.value = 140;
  (cutLfo as OscillatorNode).connect(cutDepth).connect(droneLp.frequency);
  const ampLfo = track(ctx.createOscillator());
  (ampLfo as OscillatorNode).frequency.value = 0.07;
  const ampDepth = ctx.createGain();
  ampDepth.gain.value = 0.008;
  (ampLfo as OscillatorNode).connect(ampDepth).connect(droneGain.gain);
  for (const [m, type, g] of [
    [38, 'triangle', 1],
    [45, 'triangle', 0.7],
    [38, 'sawtooth', 0.18],
    [50, 'sine', 0.25],
  ] as [number, OscillatorType, number][]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = midiHz(m);
    osc.detune.value = type === 'sawtooth' ? 5 : 0;
    const og = ctx.createGain();
    og.gain.value = g;
    osc.connect(og).connect(droneLp);
    track(osc);
  }
  for (const s of sources) s.start(at);

  // --- segments ----------------------------------------------------------
  let next = 0;
  const scheduleSegment = (k: number) => {
    const r = mulberry32((o.seed ^ (k * 2654435761)) >>> 0);
    const s = at + k * SEG;
    const chord = PROGRESSION[k % PROGRESSION.length];
    pad(s, chord, r);
    // occasional low drum, far away
    if (k > 0 && r() < 0.6) {
      const dt = s + SEG * between(r, 0.25, 0.7);
      drum(dt, 0.9, r);
      if (r() < 0.5) drum(dt + 0.62, 0.55, r);
    }
    if (r() < 0.35) glint(s + SEG * between(r, 0.2, 0.6), GLINTS[Math.floor(r() * GLINTS.length)], r);
  };

  const pad = (s: number, chord: number[], r: Rand) => {
    const attack = 5,
      hold = SEG - attack,
      release = 6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    const cut = 720 + r() * 300;
    lp.frequency.setValueAtTime(cut * 0.7, s);
    lp.frequency.linearRampToValueAtTime(cut, s + attack + 2);
    lp.frequency.linearRampToValueAtTime(cut * 0.8, s + SEG + release);
    lp.connect(bus);
    chord.forEach((m, i) => {
      const g = ctx.createGain();
      const total = envelope(g.gain, s + i * 0.35, { peak: 0.034, attack, hold, release });
      let head: AudioNode = g;
      if (typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = [-0.35, 0.25, -0.15, 0.35][i % 4];
        g.connect(p);
        head = p;
      }
      head.connect(lp);
      const f = midiHz(m);
      for (const [type, dc, lvl] of [
        ['sawtooth', -9, 0.5],
        ['sawtooth', 8, 0.5],
        ['triangle', 0, 0.9],
      ] as [OscillatorType, number, number][]) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f * cents(between(r, -2, 2));
        osc.detune.value = dc;
        const og = ctx.createGain();
        og.gain.value = lvl;
        osc.connect(og).connect(g);
        track(osc);
        osc.start(s + i * 0.35);
        osc.stop(s + i * 0.35 + total + 0.05);
      }
    });
  };

  const drum = (t: number, vel: number, r: Rand) => {
    const tape = frameDrumTape(ctx.sampleRate, vel, r, true);
    const src = ctx.createBufferSource();
    src.buffer = tape.toBuffer(ctx);
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(g).connect(bus);
    track(src);
    src.start(t);
  };

  const glint = (t: number, m: number, r: Rand) => {
    const g = ctx.createGain();
    const total = envelope(g.gain, t, { peak: 0.012, attack: 2.5, hold: 1.5, release: 4 });
    g.connect(bus);
    const osc = ctx.createOscillator();
    osc.frequency.value = midiHz(m) * cents(between(r, -3, 3));
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.4 + r() * 0.3;
    const tg = ctx.createGain();
    tg.gain.value = 0.004;
    trem.connect(tg).connect(g.gain);
    osc.connect(g);
    for (const x of [osc, trem]) {
      track(x);
      x.start(t);
      x.stop(t + total + 0.05);
    }
  };

  const scheduleUntil = (tEnd: number) => {
    while (at + next * SEG < tEnd) {
      scheduleSegment(next);
      next++;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  if (o.live) {
    scheduleUntil(ctx.currentTime + 4);
    timer = setInterval(() => scheduleUntil(ctx.currentTime + 4), 500);
  } else scheduleUntil(o.renderUntil ?? at + 60);

  let stopped = false;
  return {
    stop(t: number) {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      const g = out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 1.5);
      const end = t + 1.6;
      for (const s of sources) {
        try {
          s.stop(end);
        } catch {
          /* not started yet or already stopped */
        }
      }
      if (o.live) setTimeout(() => out.disconnect(), (end - ctx.currentTime) * 1000 + 3500);
    },
  };
}
