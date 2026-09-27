// Wooden pieces on a felt-topped board over a walnut table, plus the small UI ticks.
// Modal synthesis: a struck object = a few damped sines at its resonant frequencies + a contact transient.

import { Tape, between, jitter } from '../dsp';
import type { Rand, SoundFn } from '../types';

/** Resonance ratios of a small hardwood block (free bar modes, slightly detuned by the carving). */
const PIECE_RATIOS = [1, 2.57, 4.09, 6.2];
const PIECE_TAUS = [0.018, 0.009, 0.005, 0.0028];
const PIECE_AMPS = [1, 0.45, 0.28, 0.14];

export interface ClackOpts {
  /** Fundamental of the piece, Hz. */
  f0: number;
  /** 0..1: how much of the upper modes / contact tick come through. */
  bright: number;
  /** 0..1: how much board-and-table body thump. */
  body: number;
  amp: number;
}

/** One wooden piece meeting the board. */
export function clack(tape: Tape, t0: number, rand: Rand, o: ClackOpts): void {
  // contact tick (hard wood on hard wood, a little felt)
  tape.burst(
    t0,
    {
      amp: 0.32 * o.amp * o.bright,
      attack: 0.0003,
      tau: 0.0011,
      filter: [
        { type: 'highpass', f: 1600 },
        { type: 'lowpass', f: 6000 },
      ],
    },
    rand,
  );
  for (let k = 0; k < PIECE_RATIOS.length; k++) {
    const a = o.amp * PIECE_AMPS[k] * (k ? 0.35 + 0.65 * o.bright : 1) * jitter(rand, 0.15);
    tape.mode(t0, o.f0 * PIECE_RATIOS[k] * jitter(rand, 0.015), PIECE_TAUS[k] * jitter(rand, 0.1), a);
  }
  if (o.body > 0) {
    // the board slab and the table under it
    tape.mode(t0 + 0.0004, 172 * jitter(rand, 0.05), 0.022, o.amp * o.body * 0.9, 0.0012);
    tape.mode(t0 + 0.0004, 305 * jitter(rand, 0.05), 0.012, o.amp * o.body * 0.42, 0.001);
    tape.burst(t0, { amp: o.amp * o.body * 0.45, attack: 0.0008, tau: 0.006, filter: [{ type: 'lowpass', f: 700 }] }, rand);
  }
}

export const place: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 0.3);
  const f0 = 980 * jitter(rand, 0.06);
  clack(tape, 0.002, rand, { f0, bright: 1, body: 1, amp: 1 });
  // the piece rocks once on its base as it settles
  clack(tape, 0.002 + between(rand, 0.016, 0.03), rand, { f0: f0 * 1.03, bright: 0.55, body: 0.3, amp: 0.2 });
  tape.dcBlock().endFade(0.02);
  return tape.play(ctx, dest, t, rate);
};

/** Taking a piece back: a fingertip brush, then two light rising ticks (the reverse of a placement). */
export const unplace: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 0.22);
  tape.burst(0.001, { amp: 0.12, attack: 0.012, tau: 0.008, filter: [{ type: 'bandpass', f: 2400 * jitter(rand, 0.1), q: 1.1 }] }, rand);
  const f0 = 1300 * jitter(rand, 0.05);
  clack(tape, 0.02, rand, { f0, bright: 0.7, body: 0.15, amp: 0.75 });
  clack(tape, 0.02 + between(rand, 0.036, 0.05), rand, { f0: f0 * 1.14, bright: 0.45, body: 0, amp: 0.34 });
  tape.dcBlock().endFade(0.02);
  return tape.play(ctx, dest, t, rate);
};

/**
 * Pieces lift off, hop along the route, and land `duration` seconds later (default 0.5 s = the
 * conquest march; occupy 0.4 s; fortify 0.22 s per hop, max 0.9 s). tk · tk-tk-tk · TOCK.
 */
export const march: SoundFn = (ctx, dest, t, { rate, rand, duration }) => {
  const D = duration ?? 0.5;
  const tape = new Tape(ctx.sampleRate, D + 0.16);
  // lift-off: a light tick as the pieces leave the source tile
  clack(tape, 0.003, rand, { f0: 1250 * jitter(rand, 0.05), bright: 0.5, body: 0.1, amp: 0.3 });
  // a soft slide under the hops
  tape.burst(0.03, { amp: 0.045, attack: D * 0.25, hold: D * 0.2, tau: D * 0.12, filter: [{ type: 'bandpass', f: 1300, q: 0.9 }] }, rand);
  const hops = Math.max(2, Math.min(6, Math.round(D / 0.11)));
  const land = 0.003 + D;
  for (let i = 0; i < hops; i++) {
    const at = 0.003 + (D * (i + 1)) / (hops + 1) + between(rand, -0.009, 0.009);
    clack(tape, at, rand, { f0: 1150 * jitter(rand, 0.07), bright: between(rand, 0.3, 0.6), body: 0.25, amp: (0.22 + (0.12 * i) / hops) * jitter(rand, 0.25) });
  }
  const f0 = 960 * jitter(rand, 0.05);
  clack(tape, land, rand, { f0, bright: 0.9, body: 1, amp: 0.85 });
  clack(tape, land + between(rand, 0.018, 0.028), rand, { f0: f0 * 1.03, bright: 0.5, body: 0.3, amp: 0.16 });
  tape.dcBlock().endFade(0.02);
  return tape.play(ctx, dest, t, rate);
};

/** Button press: a small, dry wooden toggle. */
export const uiClick: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 0.1);
  const f = 1850 * jitter(rand, 0.03);
  tape.burst(0.001, { amp: 0.2, attack: 0.0003, tau: 0.0008, filter: [{ type: 'bandpass', f: 2800, q: 0.8 }] }, rand);
  tape.mode(0.001, f, 0.0045, 0.75);
  tape.mode(0.001, f * 2.31, 0.0022, 0.25);
  tape.mode(0.001, 620 * jitter(rand, 0.03), 0.009, 0.55, 0.001);
  tape.dcBlock().endFade(0.015);
  return tape.play(ctx, dest, t, rate);
};

/** Hover: a fingertip on felt. Barely there. */
export const uiHover: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 0.06);
  tape.mode(0.001, 1450 * jitter(rand, 0.04), 0.0035, 0.6, 0.0012);
  tape.mode(0.001, 2500 * jitter(rand, 0.04), 0.0018, 0.18, 0.001);
  tape.burst(0.001, { amp: 0.12, attack: 0.0015, tau: 0.002, filter: [{ type: 'lowpass', f: 2400 }] }, rand);
  tape.dcBlock().endFade(0.012);
  return tape.play(ctx, dest, t, rate);
};

/** "Not allowed": two muffled knocks on the table's edge, the second lower. Gentle, never a buzzer. */
export const uiError: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const tape = new Tape(ctx.sampleRate, 0.4);
  const knock = (t0: number, f: number, amp: number) => {
    tape.mode(t0, f, 0.03, amp, 0.0015);
    tape.mode(t0, f * 1.93, 0.014, amp * 0.35, 0.0015);
    tape.mode(t0, f * 3.05, 0.007, amp * 0.15, 0.0015);
    tape.burst(t0, { amp: amp * 0.35, attack: 0.001, tau: 0.008, filter: [{ type: 'lowpass', f: 900 }] }, rand);
  };
  const p = jitter(rand, 0.02);
  knock(0.002, 262 * p, 1);
  knock(0.002 + 0.105 + between(rand, -0.004, 0.004), 208 * p, 0.85);
  tape.dcBlock().endFade(0.02);
  return tape.play(ctx, dest, t, rate);
};
