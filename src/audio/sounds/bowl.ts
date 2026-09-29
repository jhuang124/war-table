// Bowl: a struck rin (a small standing bell-bowl), at three pitches in D with the score.
//  continent  A4, a medium mallet · `somber` = the same bowl, hand-damped after a moment (broken)
//  eliminated D3, low, with a hard stick onset (the sting)
//  victory    D5, high, struck twice, the second softer
// Modal synthesis: the rin's inharmonic partials, each split into a slowly beating doublet (the
// bowl is never perfectly round, which is what makes it "breathe"), ~4 s tails.

import { Tape, between, jitter, midiHz } from '../dsp';
import type { Rand, SoundFn } from '../types';

const RATIOS = [1, 2.73, 5.18, 8.46, 12.3];
const AMPS = [1, 0.52, 0.26, 0.11, 0.05];
/** T60 of each partial as a fraction of the fundamental's. */
const T60S = [1, 0.7, 0.42, 0.24, 0.13];
/** Doublet beat rates, Hz. */
const BEATS = [0.6, 1.5, 2.4, 3.2, 4.1];

export interface BowlOpts {
  midi: number;
  /** Fundamental T60, seconds. */
  t60: number;
  amp: number;
  /** 0 = soft felt mallet .. 1 = hard wooden stick (brighter partials, a click on contact). */
  hard: number;
  /** Extra weight on the second partial (big bowls sing there; helps small speakers). */
  second?: number;
  /** Hand-damp the bowl this many seconds after the strike. */
  damp?: number;
}

export function strikeBowl(tape: Tape, t0: number, rand: Rand, o: BowlOpts): void {
  const sr = tape.sr;
  const f0 = midiHz(o.midi) * jitter(rand, 0.003);
  const attack = 0.0018 - 0.0014 * o.hard;
  const s0 = Math.max(0, Math.round(t0 * sr));
  // render into a scratch tape so a damp only touches this strike
  const b = new Tape(sr, tape.seconds - s0 / sr);
  for (let k = 0; k < RATIOS.length; k++) {
    const f = f0 * RATIOS[k] * jitter(rand, 0.004);
    if (f > 6000) continue;
    const tau = (o.t60 * T60S[k]) / 6.91;
    const bright = k === 0 ? 1 : 0.55 + 0.9 * o.hard;
    const a = o.amp * AMPS[k] * bright * (k === 1 ? (o.second ?? 1) : 1);
    const beat = BEATS[k] * between(rand, 0.8, 1.2);
    b.mode(0, f - beat / 2, tau, a * 0.6, attack);
    b.mode(0, f + beat / 2, tau * 0.94, a * 0.4, attack);
  }
  // the mallet
  b.burst(0, { amp: o.amp * (0.04 + 0.16 * o.hard), attack: 0.0004, tau: 0.0018 + 0.002 * (1 - o.hard), filter: [{ type: 'lowpass', f: 1200 + 2600 * o.hard }] }, rand);
  if (o.hard > 0.5) b.mode(0, 1850 * jitter(rand, 0.04), 0.0028, o.amp * 0.22 * o.hard, 0.0002);
  if (o.damp !== undefined) {
    const d0 = Math.round(o.damp * sr);
    const dk = Math.exp(-1 / (0.09 * sr));
    let g = 1;
    for (let i = d0; i < b.data.length; i++) {
      g *= dk;
      b.data[i] *= g;
    }
  }
  tape.mix(b, t0);
}

export const continent: SoundFn = (ctx, dest, t, { rate, rand, variant }) => {
  const somber = variant === 'somber';
  const tape = new Tape(ctx.sampleRate, 4.6);
  strikeBowl(tape, 0.002, rand, { midi: 69, t60: 4.0, amp: 0.155, hard: 0.3, damp: somber ? 0.75 : undefined });
  tape.dcBlock().endFade(0.4);
  return tape.play(ctx, dest, t, rate);
};

export const eliminated: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 5.0);
  strikeBowl(tape, 0.002, rand, { midi: 50, t60: 4.4, amp: 0.148, hard: 1, second: 1.7 });
  tape.dcBlock().endFade(0.4);
  return tape.play(ctx, dest, t, rate);
};

export const victory: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 6.6);
  strikeBowl(tape, 0.002, rand, { midi: 74, t60: 4.4, amp: 0.188, hard: 0.45 });
  strikeBowl(tape, 1.8 + between(rand, -0.02, 0.02), rand, { midi: 74, t60: 4.2, amp: 0.1, hard: 0.2 });
  tape.dcBlock().endFade(0.4);
  return tape.play(ctx, dest, t, rate);
};

/** Lighter, distant bowl for the score (node graph: no JS synthesis on the main thread). */
export function scoreBowl(ctx: BaseAudioContext, dest: AudioNode, t: number, midi: number, vel: number, rand: Rand, track: (s: AudioScheduledSourceNode) => void): number {
  const f0 = midiHz(midi) * jitter(rand, 0.002);
  const t60 = 4.5;
  let end = 0;
  for (let k = 0; k < 3; k++) {
    const f = f0 * RATIOS[k];
    const tau = (t60 * T60S[k]) / 6.91;
    const a = vel * AMPS[k] * (k ? 0.6 : 1);
    const beat = BEATS[k] * between(rand, 0.8, 1.2);
    for (const [df, share] of [[-beat / 2, 0.6], [beat / 2, 0.4]] as [number, number][]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f + df;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * share, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, tau);
      osc.connect(g).connect(dest);
      const stop = t + 0.004 + tau * 7.5;
      osc.start(t);
      osc.stop(stop);
      track(osc);
      end = Math.max(end, stop - t);
    }
  }
  return end;
}
