// Paper and air: card slides, card slaps, and the whoosh for camera moves / banners.

import { Tape, biquad, clamp, jitter, svf } from '../dsp';
import type { Rand, SoundFn } from '../types';

/** Noise with paper-fibre grain: white noise amplitude-modulated by slow random roughness. */
function paperNoise(n: number, rand: Rand, sr: number): Float32Array {
  const out = new Float32Array(n);
  let g = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 140) / sr);
  for (let i = 0; i < n; i++) {
    g += a * (rand() * 2 - 1 - g);
    out[i] = (rand() * 2 - 1) * (0.6 + 2.2 * Math.abs(g));
  }
  return out;
}

/** A card sliding `dur` seconds from `t0`, swept band-pass (friction brightens as it speeds up). */
export function cardSlide(tape: Tape, t0: number, dur: number, amp: number, rand: Rand, fLo = 1500, fHi = 3500): void {
  const sr = tape.sr;
  const n = Math.round(dur * sr);
  const x = paperNoise(n, rand, sr);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 1.4);
    x[i] *= env;
  }
  svf(x, sr, 'bp', (i) => fLo + (fHi - fLo) * clamp(i / n, 0, 1), 0.9);
  biquad(x, sr, 'lowpass', 4200, 0.7);
  biquad(x, sr, 'peaking', 3500, 1, -4);
  const start = Math.max(0, Math.round(t0 * sr));
  for (let i = 0; i < n && start + i < tape.data.length; i++) tape.data[start + i] += x[i] * amp;
}

/** A card landing flat on the table. */
export function cardSlap(tape: Tape, t0: number, amp: number, rand: Rand): void {
  tape.burst(t0, { amp: amp * 0.5, attack: 0.0005, tau: 0.0042, filter: [{ type: 'bandpass', f: 1500 * jitter(rand, 0.08), q: 0.7 }] }, rand);
  tape.burst(t0, { amp: amp * 0.3, attack: 0.0006, tau: 0.006, filter: [{ type: 'lowpass', f: 600 }] }, rand);
  tape.mode(t0, 270 * jitter(rand, 0.06), 0.012, amp * 0.32, 0.0008);
}

export const cardDraw: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 0.3);
  const dur = 0.16 * jitter(rand, 0.1);
  cardSlide(tape, 0.003, dur, 0.9, rand, 1100 * jitter(rand, 0.08), 2500 * jitter(rand, 0.08));
  cardSlap(tape, 0.003 + dur * 0.92, 0.85, rand);
  tape.dcBlock().endFade(0.02);
  return tape.play(ctx, dest, t, rate);
};

/**
 * Soft air movement for camera moves: a band-passed noise swell that sweeps up then settles, drifting
 * across the stereo field. Lasts `duration` (default 0.6 s; match the camera move, 0.5–0.9 s).
 */
export const whoosh: SoundFn = (ctx, dest, t, { rate, rand, duration }) => {
  const sr = ctx.sampleRate;
  const dur = (duration ?? 0.6) * jitter(rand, 0.04);
  const tape = new Tape(sr, dur + 0.03);
  const n = Math.round(dur * sr);
  const peakAt = 0.42;
  const x = new Float32Array(tape.data.length);
  const lo = 380 * jitter(rand, 0.1);
  const hi = 1250 * jitter(rand, 0.1);
  const env = (u: number) =>
    u < peakAt ? Math.pow(Math.sin((Math.PI * u) / (2 * peakAt)), 2) : Math.pow(Math.cos((Math.PI * (u - peakAt)) / (2 * (1 - peakAt))), 2);
  for (let i = 0; i < n; i++) x[i] = (rand() * 2 - 1) * env(i / n);
  const body = new Float32Array(x);
  svf(
    x,
    sr,
    'bp',
    (i) => {
      const u = clamp(i / n, 0, 1);
      return u < peakAt ? lo + (hi - lo) * (u / peakAt) : hi - (hi - 560) * ((u - peakAt) / (1 - peakAt));
    },
    1.1,
  );
  biquad(x, sr, 'lowpass', 3500, 0.7);
  biquad(body, sr, 'lowpass', 380, 0.7);
  for (let i = 0; i < x.length; i++) tape.data[i] = x[i] + body[i] * 0.6;
  tape.dcBlock().endFade(0.02);

  const src = ctx.createBufferSource();
  src.buffer = tape.toBuffer(ctx);
  src.playbackRate.value = rate;
  let head: AudioNode = src;
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    const dir = rand() < 0.5 ? -1 : 1;
    const len = tape.seconds / rate;
    p.pan.setValueAtTime(-0.35 * dir, t);
    p.pan.linearRampToValueAtTime(0.35 * dir, t + len);
    src.connect(p);
    head = p;
  }
  head.connect(dest);
  src.start(t);
  return tape.seconds / rate;
};
