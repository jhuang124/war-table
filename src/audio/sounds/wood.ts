// Wood: the dice cup. Bone dice shaken in a small lacquered wooden cup: low, dry and hollow. The
// dice clicking against each other stay under the cup's knock, so the shake reads as wood, not glass.
// Timing: the shake fills `duration` (default 150 ms at 1×); its pitch never changes with length.

import { Tape, between, biquad, jitter } from '../dsp';
import type { SoundFn } from '../types';

export const diceShake: SoundFn = (ctx, dest, t, { rate, rand, duration }) => {
  const sr = ctx.sampleRate;
  const D = duration ?? 0.15;
  const strokes = Math.max(1, Math.round(D / 0.16));
  const sd = D / strokes;
  const tape = new Tape(sr, D + 0.09);
  const cup = 560 * jitter(rand, 0.05);
  for (let s = 0; s < strokes; s++) {
    const at0 = 0.004 + s * sd;
    const amp = strokes === 1 ? 1 : s === 0 ? 0.75 : s === strokes - 1 ? 0.9 : 1;
    const span = sd * 0.86;
    const n = Math.round(between(rand, 7, 10) * Math.min(1.2, Math.max(0.5, sd / 0.16)));
    for (let i = 0; i < n; i++) {
      // the first collision lands right at the start of the stroke (instant response)
      const x = i === 0 ? 0.3 : rand();
      const at = i === 0 ? at0 : at0 + span * Math.pow(x, 0.6);
      const a = amp * between(rand, 0.3, 1) * (0.45 + 0.55 * x);
      if (rand() < 0.3) {
        // die against die: small, bony, damped
        const f = between(rand, 1900, 2700);
        tape.mode(at, f, 0.0016, a * 0.28, 0.0003);
      } else {
        // die against the lacquered wall
        const f = cup * between(rand, 0.85, 1.35);
        tape.mode(at, f, 0.007, a * 0.65, 0.0006);
        tape.mode(at, f * 2.4, 0.0028, a * 0.2, 0.0005);
        tape.burst(at, { amp: a * 0.12, attack: 0.0005, tau: 0.0025, filter: [{ type: 'lowpass', f: 1400 }] }, rand);
      }
    }
    // the dice slam the far wall together at the end of the stroke
    const slam = at0 + span + between(rand, -0.004, 0.003);
    for (let k = 0; k < 3; k++) {
      const at = slam + between(rand, 0, 0.01);
      tape.mode(at, cup * between(rand, 0.9, 1.2), 0.009, amp * 0.7, 0.0007);
      tape.burst(at, { amp: amp * 0.2, attack: 0.0006, tau: 0.004, filter: [{ type: 'lowpass', f: 1200 }] }, rand);
    }
  }
  // the cup is hollow: its body rings under everything
  const body = new Float32Array(tape.data);
  biquad(body, sr, 'bandpass', cup * 0.92, 3.5);
  for (let i = 0; i < body.length; i++) tape.data[i] += body[i] * 1.5;
  tape.filter('lowpass', 3600, 0.7).dcBlock().normalizeWindow(0.25).endFade(0.03);
  return tape.play(ctx, dest, t, rate);
};
