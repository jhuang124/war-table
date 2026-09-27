// Dice: rattling in a leather-lined wooden cup, then each die landing on the felt.
// Timing follows UX §8.2: the shake is short (150 ms at 1×) and `diceLand` is one die's first touch
// plus its micro-bounce; the caller plays one per die, 40 ms apart, panned attacker −0.3 / defender +0.3.

import { Tape, between, biquad, jitter } from '../dsp';
import type { SoundFn } from '../types';

/**
 * Shaking strokes filling `duration` (default 0.15 s). Dice collide with each other (bright) and the
 * cup wall (woody), bunching toward each stroke's end where they slam the wall. Pitch never changes
 * with duration.
 */
export const diceShake: SoundFn = (ctx, dest, t, { rate, rand, duration }) => {
  const sr = ctx.sampleRate;
  const D = duration ?? 0.15;
  const strokes = Math.max(1, Math.round(D / 0.16));
  const sd = D / strokes;
  const tape = new Tape(sr, D + 0.09);
  for (let s = 0; s < strokes; s++) {
    const at0 = 0.004 + s * sd;
    const amp = strokes === 1 ? 1 : s === 0 ? 0.75 : s === strokes - 1 ? 0.9 : 1;
    const span = sd * 0.86;
    const n = Math.round(between(rand, 9, 13) * Math.min(1.2, Math.max(0.5, sd / 0.16)));
    for (let i = 0; i < n; i++) {
      // the first collision lands right at the start of the stroke (instant response)
      const x = i === 0 ? 0.3 : rand();
      const at = i === 0 ? at0 : at0 + span * Math.pow(x, 0.6);
      const a = amp * between(rand, 0.25, 1) * (0.45 + 0.55 * x);
      if (rand() < 0.55) {
        const f = between(rand, 2100, 3600);
        tape.mode(at, f, 0.0024, a * 0.5, 0.0003);
        tape.mode(at, f * 1.62, 0.0014, a * 0.22, 0.0003);
      } else {
        const f = between(rand, 700, 1250);
        tape.mode(at, f, 0.006, a * 0.6, 0.0005);
        tape.mode(at, f * 2.2, 0.003, a * 0.25, 0.0005);
      }
    }
    const slam = at0 + span + between(rand, -0.004, 0.003);
    for (let k = 0; k < 3; k++) {
      const at = slam + between(rand, 0, 0.01);
      tape.mode(at, between(rand, 650, 950), 0.008, amp * 0.7, 0.0006);
      tape.burst(at, { amp: amp * 0.25, attack: 0.0005, tau: 0.004, filter: [{ type: 'lowpass', f: 1500 }] }, rand);
    }
  }
  // the cup is hollow: add its body resonance
  const body = new Float32Array(tape.data);
  biquad(body, sr, 'bandpass', 820 * jitter(rand, 0.05), 3);
  for (let i = 0; i < body.length; i++) tape.data[i] += body[i] * 1.6;
  tape.filter('lowpass', 5000, 0.7).dcBlock().normalizeWindow(0.25).endFade(0.03);
  return tape.play(ctx, dest, t, rate);
};

/** One die: first touch on the felt, a micro-bounce or two, sometimes a tip onto its face. */
export const diceLand: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const sr = ctx.sampleRate;
  const tape = new Tape(sr, 0.24);
  const f = between(rand, 1700, 2600);
  const impact = (at: number, a: number) => {
    // felt thud + the board beneath
    tape.burst(at, { amp: a * 0.5, attack: 0.0006, tau: 0.0045, filter: [{ type: 'lowpass', f: 900 }] }, rand);
    tape.mode(at, 205 * jitter(rand, 0.06), 0.012, a * 0.45, 0.0008);
    // the die itself, heavily damped by the felt
    tape.mode(at, f * jitter(rand, 0.04), 0.0022, a * 0.34, 0.0003);
    tape.mode(at, f * 1.73, 0.0014, a * 0.14, 0.0003);
  };
  let at = 0.003;
  let a = 1;
  let gap = between(rand, 0.034, 0.048);
  for (let b = 0; b < 3; b++) {
    impact(at, a);
    at += gap;
    gap *= 0.6;
    a *= 0.42;
  }
  if (rand() < 0.6) impact(at + between(rand, 0.01, 0.02), 0.12);
  tape.filter('lowpass', 4500, 0.7).dcBlock().endFade(0.03);
  return tape.play(ctx, dest, t, rate);
};
