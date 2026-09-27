// The brass section, timpani and drums: every musical cue. All in D so cues sit together with the
// ambient bed (D dorian). Voicing is horn-like (dark, round attack with a small pitch scoop), not trumpet.

import { Tape, between, cents, clamp, envelope, jitter, midiHz, noiseSource } from '../dsp';
import type { Rand, SoundFn } from '../types';
import { cardSlap, cardSlide } from './paper';

// MIDI note numbers used below
const D2 = 38,
  A2 = 45,
  D3 = 50,
  F3 = 53,
  Fs3 = 54,
  A3 = 57,
  D4 = 62,
  F4 = 65,
  Fs4 = 66,
  A4 = 69,
  D5 = 74;

export interface BrassNote {
  midi: number;
  /** Seconds after the cue's start (scaled by rate). */
  at: number;
  /** Seconds from attack to release start. */
  dur: number;
  vel?: number;
  bright?: number;
  pan?: number;
  attack?: number;
  release?: number;
}

/** One horn note. Returns its end time relative to `t`. */
export function brassNote(ctx: BaseAudioContext, dest: AudioNode, t: number, n: BrassNote, rate: number, rand: Rand): number {
  // timing jitter may push the first note of a cue below 0: never start before the cue itself
  const T = t + Math.max(0, n.at) / rate;
  const vel = n.vel ?? 0.8;
  const bright = n.bright ?? 1;
  const f = midiHz(n.midi) * rate * cents(between(rand, -3, 3));
  const attack = (n.attack ?? 0.032 + 0.02 * (1 - vel)) / rate;
  const release = (n.release ?? 0.18) / rate;
  const hold = Math.max(0.01, n.dur / rate - attack);
  const total = attack + hold + release;
  const stopAt = T + total + 0.02;

  const out = ctx.createGain();
  const amp = ctx.createGain();
  envelope(amp.gain, T, { peak: vel * 0.2, attack, hold, release, sustain: 0.8, decayTau: 0.14 / rate });

  // Filter envelope: the "blat" of a brass attack, then settle darker. Cutoff tracks pitch.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.3;
  const base = clamp(f * 1.2, 160, 900);
  const peak = clamp(f * 9 * bright * (0.6 + 0.4 * vel), 600, 3800);
  const sus = clamp(f * 5 * bright * (0.7 + 0.3 * vel), 450, 2800);
  lp.frequency.value = base;
  lp.frequency.setValueAtTime(base, T);
  lp.frequency.linearRampToValueAtTime(peak, T + attack * 1.4);
  lp.frequency.setTargetAtTime(sus, T + attack * 1.4, 0.1 / rate);
  lp.frequency.setTargetAtTime(base, T + attack + hold, 0.06 / rate);
  const tame = ctx.createBiquadFilter();
  tame.type = 'lowpass';
  tame.frequency.value = 3800;
  tame.Q.value = 0.5;
  // the bell's formant: what makes a saw read as brass rather than a pad
  const formant = ctx.createBiquadFilter();
  formant.type = 'peaking';
  formant.frequency.value = 1150;
  formant.Q.value = 0.9;
  formant.gain.value = 5 * bright;

  const scoop = cents(-(28 + 20 * (1 - vel)));
  const sources: OscillatorNode[] = [];
  const pitched: OscillatorNode[] = [];
  for (const dc of [-7, 0, 6]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = dc + between(rand, -2, 2);
    o.frequency.setValueAtTime(f * scoop, T);
    o.frequency.setTargetAtTime(f, T, 0.022 / rate);
    o.connect(lp);
    sources.push(o);
    pitched.push(o);
  }
  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(f * scoop, T);
  body.frequency.setTargetAtTime(f, T, 0.022 / rate);
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.6;
  body.connect(bodyGain).connect(lp);
  sources.push(body);
  pitched.push(body);

  if (n.dur / rate > 0.45) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1 * jitter(rand, 0.06);
    const depth = ctx.createGain();
    depth.gain.value = 0;
    depth.gain.setValueAtTime(0, T + 0.25 / rate);
    depth.gain.linearRampToValueAtTime(f * 0.0035, T + 0.6 / rate);
    lfo.connect(depth);
    for (const o of pitched) depth.connect(o.frequency);
    sources.push(lfo);
  }

  lp.connect(formant).connect(tame).connect(amp).connect(out);

  // breath "chiff" at the tongued attack
  const chiff = noiseSource(ctx, 'white', T, 0.08, rand);
  const chf = ctx.createBiquadFilter();
  chf.type = 'bandpass';
  chf.frequency.value = clamp(f * 3, 600, 2800);
  chf.Q.value = 1.8;
  const chg = ctx.createGain();
  envelope(chg.gain, T, { peak: vel * 0.05, attack: 0.006, hold: 0.004, release: 0.06 });
  chiff.connect(chf).connect(chg).connect(out);

  if (n.pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(n.pan, -1, 1);
    out.connect(p).connect(dest);
  } else out.connect(dest);

  for (const o of sources) {
    o.start(T);
    o.stop(stopAt);
  }
  return stopAt - t;
}

/** Timpani: pitched membrane (modes 1, 1.5, 1.98, 2.44) with a felt mallet and a small pitch settle. */
export function timpaniTape(sr: number, midi: number, vel: number, rand: Rand, t80 = 1.4): Tape {
  const f = midiHz(midi) * jitter(rand, 0.004);
  const tape = new Tape(sr, t80 + 0.12);
  const tau = t80 / 9.2;
  tape.modeGlide(0.002, f * 1.05, f, 0.05, tau, vel, 0.002);
  tape.modeGlide(0.002, f * 1.5 * 1.04, f * 1.5, 0.05, tau * 0.6, vel * 0.45, 0.002);
  tape.modeGlide(0.002, f * 1.98 * 1.03, f * 1.98, 0.05, tau * 0.45, vel * 0.28, 0.002);
  tape.mode(0.002, f * 2.44, tau * 0.3, vel * 0.14, 0.002);
  tape.burst(0.002, { amp: vel * 0.3, attack: 0.001, tau: 0.01, filter: [{ type: 'lowpass', f: 1200 }] }, rand);
  return tape.dcBlock().endFade(0.05);
}

function timpani(ctx: BaseAudioContext, dest: AudioNode, t: number, at: number, midi: number, vel: number, rate: number, rand: Rand, t80 = 1.4): number {
  const tape = timpaniTape(ctx.sampleRate, midi, vel, rand, t80);
  return at / rate + tape.play(ctx, dest, t + at / rate, rate);
}

/** Frame drum with a felt beater. `low` is the deeper war drum used by the music bed. */
export function frameDrumTape(sr: number, vel: number, rand: Rand, low = false, pitch?: number): Tape {
  const tape = new Tape(sr, low ? 1.3 : 0.5);
  const f = (pitch ?? (low ? 72 : 118)) * jitter(rand, 0.03);
  tape.modeGlide(0.002, f * 1.35, f, 0.035, low ? 0.14 : 0.055, vel, 0.0015);
  tape.mode(0.002, f * 1.59, low ? 0.08 : 0.03, vel * 0.35, 0.0015);
  tape.mode(0.002, f * 2.14, low ? 0.05 : 0.02, vel * 0.2, 0.0015);
  tape.burst(0.002, { amp: vel * 0.4, attack: 0.0008, tau: 0.01, filter: [{ type: 'lowpass', f: 700 }] }, rand);
  if (low) tape.saturate(1.6);
  return tape.dcBlock().endFade(0.03);
}

/** Soft suspended-cymbal swell that peaks at `swell` then rings off. Kept dark and quiet. */
function shimmer(ctx: BaseAudioContext, dest: AudioNode, t: number, at: number, swell: number, decay: number, amp: number, rate: number, rand: Rand): number {
  const sr = ctx.sampleRate;
  const tape = new Tape(sr, swell + decay * 5 + 0.05);
  const d = tape.data;
  for (let i = 0; i < d.length; i++) {
    const u = i / sr;
    const env = u < swell ? Math.pow(u / swell, 2.2) : Math.exp(-(u - swell) / decay);
    d[i] = (rand() * 2 - 1) * env * amp;
  }
  tape.filter('highpass', 2600, 0.7).filter('lowpass', 7000, 0.7).filter('peaking', 4200, 1, -3).endFade(0.04);
  return at / rate + tape.play(ctx, dest, t + at / rate, rate);
}

/** Warm sustained chord (triangle + soft octave) under the victory brass. */
function warmPad(ctx: BaseAudioContext, dest: AudioNode, t: number, at: number, midis: number[], attack: number, hold: number, release: number, level: number, rate: number, rand: Rand): number {
  const T = t + at / rate;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  lp.connect(dest);
  let end = 0;
  for (const m of midis) {
    const g = ctx.createGain();
    const total = envelope(g.gain, T, { peak: level, attack: attack / rate, hold: hold / rate, release: release / rate });
    g.connect(lp);
    const f = midiHz(m) * rate * cents(between(rand, -4, 4));
    const a = ctx.createOscillator();
    a.type = 'triangle';
    a.frequency.value = f;
    const b = ctx.createOscillator();
    b.frequency.value = f * 2;
    const bg = ctx.createGain();
    bg.gain.value = 0.2;
    a.connect(g);
    b.connect(bg).connect(g);
    for (const o of [a, b]) {
      o.start(T);
      o.stop(T + total + 0.02);
    }
    end = Math.max(end, at / rate + total + 0.02);
  }
  return end;
}

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

const jit = (rand: Rand) => between(rand, -0.004, 0.004);

/**
 * Territory taken: a two-note horn call, "da-DAA" (A3 → D4 over a D power fifth).
 * `somber`: the call falls instead (D4 → A3 over D minor), for a territory taken from you.
 */
export const conquer: SoundFn = (ctx, dest, t, { rate, rand, variant }) => {
  const ends: number[] = [];
  const B = (n: BrassNote) => ends.push(brassNote(ctx, dest, t, n, rate, rand));
  const at = 0.13 + jit(rand);
  if (variant === 'somber') {
    B({ midi: D4, at: 0, dur: 0.1, vel: 0.66, release: 0.08, bright: 0.7 });
    B({ midi: A3, at, dur: 0.36, vel: 0.8, pan: 0.08, bright: 0.65 });
    B({ midi: F3, at: at + 0.004, dur: 0.36, vel: 0.45, pan: -0.15, bright: 0.6 });
    B({ midi: D3, at: at + 0.008, dur: 0.36, vel: 0.5, pan: -0.05, bright: 0.6 });
    ends.push(timpani(ctx, dest, t, at, A2, 0.22, rate, rand, 1.0));
    return Math.max(...ends);
  }
  B({ midi: A3, at: 0, dur: 0.1, vel: 0.72, release: 0.08 });
  B({ midi: D4, at, dur: 0.36, vel: 0.9, pan: 0.08 });
  B({ midi: A3, at: at + 0.004, dur: 0.36, vel: 0.5, pan: -0.15 });
  B({ midi: D3, at: at + 0.008, dur: 0.36, vel: 0.55, pan: -0.05, bright: 0.8 });
  ends.push(timpani(ctx, dest, t, at, D3, 0.2, rate, rand, 0.9));
  return Math.max(...ends);
};

/**
 * Continent held: a rising D-major arpeggio into a full chord, timpani and a cymbal swell.
 * `somber`: a falling D-minor arpeggio into a dark chord, for a continent broken or lost ("HELD!" too).
 */
export const continent: SoundFn = (ctx, dest, t, { rate, rand, variant }) => {
  const ends: number[] = [];
  const B = (n: BrassNote) => ends.push(brassNote(ctx, dest, t, n, rate, rand));
  const somber = variant === 'somber';
  const arp = somber ? [A4, F4, D4] : [D4, Fs4, A4];
  const chord = somber ? [D3, A3, D4, F4, A3 - 12] : [D3, A3, D4, Fs4, A4];
  const br = somber ? 0.62 : 1;
  arp.forEach((m, i) => B({ midi: m, at: i * 0.1 + (i ? jit(rand) : 0), dur: 0.09, vel: 0.7 + i * 0.025, release: 0.08, bright: br }));
  const c = 0.31 + jit(rand);
  const vels = [0.55, 0.5, 0.8, 0.62, 0.72];
  const pans = [-0.2, 0.15, 0, 0.2, -0.1];
  chord.forEach((m, i) => B({ midi: m, at: c + i * 0.0015, dur: 0.72, vel: vels[i], pan: pans[i], bright: (i === 0 ? 0.8 : 1) * br }));
  ends.push(timpani(ctx, dest, t, 0, D3, 0.12, rate, rand, 0.8));
  ends.push(timpani(ctx, dest, t, c, somber ? D2 + 7 : A2, 0.32, rate, rand, 1.6));
  if (!somber) ends.push(shimmer(ctx, dest, t, 0.04, c - 0.04, 0.45, 0.05, rate, rand));
  return Math.max(...ends);
};

/** A player is out: a low timpani stroke and a falling minor horn line (F → D → A over D minor). */
export const eliminated: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const ends: number[] = [];
  const B = (n: BrassNote) => ends.push(brassNote(ctx, dest, t, n, rate, rand));
  ends.push(timpani(ctx, dest, t, 0, D2, 0.36, rate, rand, 2.2));
  ends.push(timpani(ctx, dest, t, 0.004, A2, 0.3, rate, rand, 1.6));
  B({ midi: F4, at: 0.06, dur: 0.26, vel: 0.7, bright: 0.72 });
  B({ midi: D4, at: 0.36 + jit(rand), dur: 0.26, vel: 0.68, bright: 0.72 });
  const e = 0.66 + jit(rand);
  B({ midi: A3, at: e, dur: 0.95, vel: 0.72, bright: 0.7, release: 0.45 });
  B({ midi: F3, at: e + 0.005, dur: 0.95, vel: 0.48, bright: 0.65, pan: 0.2, release: 0.45 });
  B({ midi: D3, at: e + 0.002, dur: 0.95, vel: 0.5, bright: 0.65, pan: -0.2, release: 0.45 });
  return Math.max(...ends);
};

/** The win: triplet pickup, a run up the D-major triad, a held chord over a timpani roll, and a final "ta-DA". */
export const victory: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const ends: number[] = [];
  const B = (midi: number, at: number, dur: number, vel: number, x: Partial<BrassNote> = {}) =>
    ends.push(brassNote(ctx, dest, t, { midi, at: at + jit(rand), dur, vel, ...x }, rate, rand));
  const Tm = (midi: number, at: number, vel: number, t80 = 1.4) => ends.push(timpani(ctx, dest, t, at, midi, vel, rate, rand, t80));

  // pickup triplet
  B(A3, 0.0, 0.1, 0.7, { release: 0.07 });
  B(A3, 0.16, 0.1, 0.72, { release: 0.07 });
  B(A3, 0.32, 0.1, 0.75, { release: 0.07 });
  Tm(D3, 0, 0.16, 0.8);
  // first arrival
  B(D4, 0.48, 0.42, 0.9);
  B(A3, 0.48, 0.42, 0.55, { pan: -0.2 });
  B(D3, 0.48, 0.42, 0.55, { pan: 0.15, bright: 0.8 });
  Tm(D3, 0.48, 0.22, 1.0);
  // run-up
  B(A3, 0.95, 0.13, 0.75, { release: 0.07 });
  B(D4, 1.12, 0.13, 0.8, { release: 0.07 });
  B(Fs4, 1.29, 0.28, 0.85);
  // the big chord
  const F = 1.62;
  const FD = 1.85;
  B(A4, F, FD, 0.95, { release: 0.5 });
  B(Fs4, F, FD, 0.7, { pan: 0.25, release: 0.5 });
  B(D4, F, FD, 0.75, { pan: -0.2, release: 0.5 });
  B(A3, F, FD, 0.6, { pan: 0.1, release: 0.5 });
  B(D3, F, FD, 0.6, { pan: -0.1, bright: 0.8, release: 0.5 });
  B(D5, F + 0.02, FD, 0.4, { pan: 0.3, bright: 0.8, release: 0.5 });
  Tm(A2, F, 0.36, 2.0);
  ends.push(shimmer(ctx, dest, t, 1.1, F - 1.1, 0.7, 0.05, rate, rand));
  ends.push(warmPad(ctx, dest, t, F, [D2, A2, D3, Fs3, A3], 0.6, 2.4, 1.6, 0.035, rate, rand));
  // timpani roll, crescendo into the last stroke
  const rollN = 16;
  for (let k = 0; k < rollN; k++) Tm(D3, 2.62 + k * 0.055, 0.05 + 0.14 * (k / rollN), 0.6);
  // "ta-DA"
  const L = 3.5;
  B(D5, L, 0.6, 0.6, { pan: 0.3, release: 0.9, bright: 0.85 });
  B(A4, L, 0.6, 0.85, { pan: -0.1, release: 0.9 });
  B(Fs4, L, 0.6, 0.65, { pan: 0.2, release: 0.9 });
  B(D4, L, 0.6, 0.8, { release: 0.9 });
  B(A3, L, 0.6, 0.55, { pan: -0.25, release: 0.9 });
  B(D3, L, 0.6, 0.6, { bright: 0.8, release: 0.9 });
  Tm(A2, L, 0.4, 1.6);
  Tm(D3, L + 0.004, 0.2, 1.2);
  ends.push(shimmer(ctx, dest, t, 2.6, L - 2.6, 0.6, 0.04, rate, rand));
  return Math.max(...ends);
};

/**
 * Your move: two soft frame-drum taps under a low horn fifth. Calm; it plays every human turn.
 * `bright`: after one or more AI turns, the horn opens up and adds the octave, so the room looks up.
 */
export const turnStart: SoundFn = (ctx, dest, t, { rate, rand, variant }) => {
  const ends: number[] = [];
  const sr = ctx.sampleRate;
  const bright = variant === 'bright';
  const drum = new Tape(sr, 0.7);
  drum.mix(frameDrumTape(sr, bright ? 0.78 : 0.7, rand, false, 152), 0);
  drum.mix(frameDrumTape(sr, bright ? 0.55 : 0.48, rand, false, 152), 0.15 + jit(rand));
  ends.push(drum.play(ctx, dest, t, rate));
  const b = bright ? 1.1 : 0.8;
  ends.push(brassNote(ctx, dest, t, { midi: A3, at: 0.05, dur: 0.5, vel: 0.55, attack: 0.07, bright: b, release: 0.25, pan: -0.12 }, rate, rand));
  ends.push(brassNote(ctx, dest, t, { midi: D4, at: 0.056, dur: 0.5, vel: 0.52, attack: 0.07, bright: b, release: 0.25, pan: 0.12 }, rate, rand));
  if (bright) ends.push(brassNote(ctx, dest, t, { midi: A4, at: 0.062, dur: 0.5, vel: 0.45, attack: 0.06, bright: 1, release: 0.25 }, rate, rand));
  return Math.max(...ends);
};

/** Cards cashed in: three cards fanned onto the table, then a short brass "hup" (the armies arrive). */
export const cardTrade: SoundFn = (ctx, dest, t, { rate, rand }) => {
  const ends: number[] = [];
  const tape = new Tape(ctx.sampleRate, 0.4);
  for (let k = 0; k < 3; k++) {
    const at = Math.max(0.001, 0.003 + k * 0.075 + jit(rand));
    cardSlide(tape, at, 0.05, 0.5, rand, 1300, 2600);
    cardSlap(tape, at + 0.045, 0.8 - k * 0.08, rand);
  }
  tape.dcBlock().endFade(0.02);
  ends.push(tape.play(ctx, dest, t, rate));
  const h = 0.27 + jit(rand);
  ends.push(brassNote(ctx, dest, t, { midi: D4, at: h, dur: 0.26, vel: 0.6, bright: 0.9 }, rate, rand));
  ends.push(brassNote(ctx, dest, t, { midi: A3, at: h + 0.004, dur: 0.26, vel: 0.5, bright: 0.9, pan: -0.15 }, rate, rand));
  ends.push(brassNote(ctx, dest, t, { midi: Fs4, at: h + 0.007, dur: 0.26, vel: 0.48, bright: 0.9, pan: 0.15 }, rate, rand));
  return Math.max(...ends);
};
