// Battle: a distant cannon for each hit. Low and round, never a gunshot.
// Laptop speakers roll off below ~150 Hz, so the boom is gently saturated (its harmonics carry the
// pitch — "missing fundamental") and the blast body sits in the 150–600 Hz band.

import { Tape, between, jitter } from '../dsp';
import type { SoundFn } from '../types';

export const hit: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const sr = ctx.sampleRate;
  const tape = new Tape(sr, 1.1);
  const t0 = 0.003;
  const p = jitter(rand, 0.06);

  // the boom: a pitch-dropping sine, driven hard so its harmonics carry it on small speakers
  const boom = new Tape(sr, 1.0);
  boom.modeGlide(t0, 130 * p, 58 * p, 0.06, 0.1 * jitter(rand, 0.1), 1, 0.004);
  boom.saturate(3).filter('lowpass', 900, 0.7);
  tape.mix(boom, 0, 0.65);
  // the report's punch, 150–260 Hz: what a laptop actually plays
  tape.modeGlide(t0, 260 * p, 150 * p, 0.03, 0.05, 0.8, 0.003);
  // blast body (mid) and the air push
  tape.burst(t0, { amp: 0.9, attack: 0.004, tau: 0.07, color: 'brown', filter: [{ type: 'bandpass', f: 320, q: 0.7 }] }, rand);
  tape.burst(t0, { amp: 0.28, attack: 0.002, tau: 0.025, filter: [{ type: 'lowpass', f: 1000 }] }, rand);
  // a small crack: distance has eaten the highs
  tape.burst(t0, { amp: 0.12, attack: 0.0008, tau: 0.008, filter: [{ type: 'bandpass', f: 1250, q: 0.7 }] }, rand);
  // rolling rumble
  tape.burst(t0 + 0.03, { amp: 0.3, attack: 0.07, tau: 0.15, color: 'brown', filter: [{ type: 'bandpass', f: 200, q: 0.6 }] }, rand);

  // echo off the far hills (distance keeps the mids, loses the lows and highs)
  const echo = tape.clone().filter('bandpass', 380, 0.7);
  tape.mix(echo, between(rand, 0.17, 0.21), 0.3);
  tape.mix(echo, between(rand, 0.38, 0.44), 0.1);

  tape.dcBlock().endFade(0.1);
  return tape.play(ctx, dest, t, rate);
};
