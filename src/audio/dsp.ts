// Small DSP toolkit shared by every sound.
//
// Two ways of making sound live here:
//  - `Tape`: synthesize a short mono buffer in JS (modal synthesis = sums of damped sines, filtered
//    noise bursts, per-sample filter sweeps). Used for anything that is an impact: wood, dice, drums,
//    cannon, paper. Cheap (a few ms of JS per play) and exactly reproducible offline.
//  - Node-graph helpers (envelopes on AudioParams, oscillators) for sustained tones (brass, music).

import type { Rand } from './types';

export const TAU = Math.PI * 2;

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1 ± amt, uniform. */
export const jitter = (rand: Rand, amt: number): number => 1 + (rand() * 2 - 1) * amt;
export const between = (rand: Rand, a: number, b: number): number => a + (b - a) * rand();
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const cents = (c: number): number => Math.pow(2, c / 1200);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------
// Per-context caches
// ---------------------------------------------------------------------------

const caches = new WeakMap<BaseAudioContext, Map<string, unknown>>();

export function cached<T>(ctx: BaseAudioContext, key: string, make: () => T): T {
  let m = caches.get(ctx);
  if (!m) {
    m = new Map();
    caches.set(ctx, m);
  }
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}

// ---------------------------------------------------------------------------
// Noise buffers (seeded, zero-mean, RMS-normalised, seamless loop)
// ---------------------------------------------------------------------------

export type NoiseKind = 'white' | 'pink' | 'brown';

export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  return cached(ctx, 'noise:' + kind, () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.05);
    const n = Math.floor(sr * 3) + fade;
    const raw = new Float32Array(n);
    const r = mulberry32(kind === 'white' ? 11 : kind === 'pink' ? 23 : 37);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      last = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (kind === 'white') raw[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        raw[i] = b0 + b1 + b2 + w * 0.1848;
      } else {
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last;
      }
    }
    // Crossfade the tail into the head so looping never clicks.
    const len = n - fade;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = raw[i];
    for (let i = 0; i < fade; i++) {
      const a = i / fade;
      out[i] = raw[i] * a + raw[len + i] * (1 - a);
    }
    normalize(out, 0.3);
    const buf = ctx.createBuffer(1, len, sr);
    buf.copyToChannel(out, 0);
    return buf;
  });
}

/** Remove DC and scale to the target RMS. */
function normalize(x: Float32Array, rms: number): void {
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length;
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    x[i] -= mean;
    e += x[i] * x[i];
  }
  const s = rms / Math.sqrt(e / x.length || 1);
  for (let i = 0; i < x.length; i++) x[i] *= s;
}

/** A noise source playing [t, t+dur), starting at a random point in the buffer. */
export function noiseSource(ctx: BaseAudioContext, kind: NoiseKind, t: number, dur: number, rand: Rand): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, kind);
  src.loop = true;
  const room = src.buffer.duration - dur - 0.05;
  src.start(t, room > 0 ? rand() * room : 0);
  src.stop(t + dur + 0.01);
  return src;
}

// ---------------------------------------------------------------------------
// JS filters
// ---------------------------------------------------------------------------

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';

/** RBJ-cookbook biquad, in place. `bandpass` has 0 dB peak gain. */
export function biquad(x: Float32Array, sr: number, type: BiquadKind, f: number, q = 0.707, gainDb = 0, from = 0, to = x.length): void {
  const w0 = (TAU * clamp(f, 10, sr * 0.45)) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  let alpha = sw / (2 * q);
  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = 0,
    a2 = 0;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf':
    case 'highshelf': {
      alpha = (sw / 2) * Math.sqrt(2); // shelf slope S = 1
      const sq = 2 * Math.sqrt(A) * alpha;
      if (type === 'lowshelf') {
        b0 = A * (A + 1 - (A - 1) * cw + sq);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - sq);
        a0 = A + 1 + (A - 1) * cw + sq;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - sq;
      } else {
        b0 = A * (A + 1 + (A - 1) * cw + sq);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - sq);
        a0 = A + 1 - (A - 1) * cw + sq;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - sq;
      }
      break;
    }
  }
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = from; i < to; i++) {
    const x0 = x[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}

/**
 * Topology-preserving state-variable filter with a per-sample cutoff (for sweeps). In place.
 * `cutoff(i)` returns Hz for sample i; evaluated every 16 samples.
 */
export function svf(x: Float32Array, sr: number, mode: 'lp' | 'bp' | 'hp', cutoff: (i: number) => number, q: number): void {
  const k = 1 / q;
  let ic1 = 0,
    ic2 = 0;
  let a1 = 0,
    a2 = 0,
    a3 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) {
      const g = Math.tan((Math.PI * clamp(cutoff(i), 20, sr * 0.45)) / sr);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v0 = x[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    x[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 * k : v0 - k * v1 - v2;
  }
}

// ---------------------------------------------------------------------------
// Tape: a mono JS-rendered buffer
// ---------------------------------------------------------------------------

export interface BurstOpts {
  amp: number;
  /** Raised-cosine attack, seconds. */
  attack?: number;
  /** Exponential decay time constant, seconds. */
  tau: number;
  /** Optional hold at full level before the decay, seconds. */
  hold?: number;
  filter?: { type: BiquadKind; f: number; q?: number; gainDb?: number }[];
  /** Colour of the raw noise before filtering. */
  color?: 'white' | 'brown';
}

export class Tape {
  readonly sr: number;
  readonly data: Float32Array;

  constructor(sr: number, seconds: number) {
    this.sr = sr;
    this.data = new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
  }

  get seconds(): number {
    return this.data.length / this.sr;
  }

  /**
   * Damped sinusoid ("mode" of a struck object): amp·e^(−t/tau)·sin(2πft), with a raised-cosine
   * attack so it never clicks. Rendered until −80 dB.
   */
  mode(t0: number, f: number, tau: number, amp: number, attack = 0.0006): void {
    const sr = this.sr;
    const d = this.data;
    if (f >= sr * 0.45 || amp === 0) return;
    const start = Math.max(0, Math.round(t0 * sr));
    const n = Math.min(d.length - start, Math.ceil(tau * sr * 9.3));
    if (n <= 0) return;
    const w = (TAU * f) / sr;
    const c2 = 2 * Math.cos(w);
    // Recurrence oscillator: s[i] = 2cos(w)s[i-1] - s[i-2], s[0] = 0, s[1] = sin(w)
    let s1 = 0;
    let s2 = -Math.sin(w);
    const dec = Math.exp(-1 / (tau * sr));
    const na = Math.max(1, Math.round(attack * sr));
    let env = amp;
    for (let i = 0; i < n; i++) {
      const s0 = c2 * s1 - s2;
      s2 = s1;
      s1 = s0;
      const a = i < na ? 0.5 - 0.5 * Math.cos((Math.PI * i) / na) : 1;
      d[start + i] += env * a * s2; // s2 now holds s[i]
      env *= dec;
    }
  }

  /**
   * Damped sinusoid whose pitch glides from f0 to f1 with time constant glideTau (drums, cannon).
   * Math.sin only while gliding; once within 0.1% of f1 it hands off (phase-continuous) to the
   * recurrence oscillator, which is ~10x cheaper.
   */
  modeGlide(t0: number, f0: number, f1: number, glideTau: number, tau: number, amp: number, attack = 0.001): void {
    const sr = this.sr;
    const d = this.data;
    const start = Math.max(0, Math.round(t0 * sr));
    const n = Math.min(d.length - start, Math.ceil(tau * sr * 9.3));
    const dec = Math.exp(-1 / (tau * sr));
    const gdec = Math.exp(-1 / (glideTau * sr));
    const na = Math.max(1, Math.round(attack * sr));
    const handoff = Math.max(na, Math.ceil(glideTau * sr * 7));
    let env = amp;
    let g = 1;
    let ph = 0;
    let i = 0;
    for (; i < n && i < handoff; i++) {
      const f = f1 + (f0 - f1) * g;
      g *= gdec;
      const a = i < na ? 0.5 - 0.5 * Math.cos((Math.PI * i) / na) : 1;
      d[start + i] += env * a * Math.sin(ph);
      ph += (TAU * f) / sr;
      env *= dec;
    }
    if (i >= n) return;
    const w = (TAU * f1) / sr;
    const c2 = 2 * Math.cos(w);
    let s1 = Math.sin(ph - w);
    let s2 = Math.sin(ph - 2 * w);
    for (; i < n; i++) {
      const s0 = c2 * s1 - s2;
      s2 = s1;
      s1 = s0;
      d[start + i] += env * s0;
      env *= dec;
    }
  }

  /** Filtered noise burst with attack / hold / exponential decay. */
  burst(t0: number, o: BurstOpts, rand: Rand): void {
    const sr = this.sr;
    const start = Math.max(0, Math.round(t0 * sr));
    const attack = o.attack ?? 0.0008;
    const hold = o.hold ?? 0;
    const n = Math.min(this.data.length - start, Math.ceil((attack + hold + o.tau * 9.3) * sr) + 256);
    if (n <= 0) return;
    const tmp = new Float32Array(n);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = rand() * 2 - 1;
      if (o.color === 'brown') {
        last = (last + 0.04 * w) / 1.04;
        tmp[i] = last * 6;
      } else tmp[i] = w;
    }
    if (o.filter) for (const f of o.filter) biquad(tmp, sr, f.type, f.f, f.q ?? 0.707, f.gainDb ?? 0);
    const na = Math.max(1, Math.round(attack * sr));
    const nh = Math.round(hold * sr);
    const dec = Math.exp(-1 / (o.tau * sr));
    let env = o.amp;
    const d = this.data;
    for (let i = 0; i < n; i++) {
      let a: number;
      if (i < na) a = 0.5 - 0.5 * Math.cos((Math.PI * i) / na);
      else {
        a = 1;
        if (i >= na + nh) env *= dec;
      }
      d[start + i] += tmp[i] * env * a;
    }
  }

  clone(): Tape {
    const t = new Tape(this.sr, this.seconds);
    t.data.set(this.data);
    return t;
  }

  /** Mix another tape in at t0 with gain. */
  mix(other: Tape, t0: number, gain = 1): void {
    const start = Math.max(0, Math.round(t0 * this.sr));
    const n = Math.min(other.data.length, this.data.length - start);
    for (let i = 0; i < n; i++) this.data[start + i] += other.data[i] * gain;
  }

  filter(type: BiquadKind, f: number, q = 0.707, gainDb = 0): this {
    biquad(this.data, this.sr, type, f, q, gainDb);
    return this;
  }

  /** tanh saturation with unity small-signal gain (y ≈ x for small x, |y| < 1/drive). */
  saturate(drive: number): this {
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * drive) / drive;
    return this;
  }

  /**
   * Scale so the loudest `windowSec` window has RMS `target`. Keeps random variations of a texture
   * (dice rattles) at one loudness no matter how the collisions happened to fall.
   */
  normalizeWindow(target: number, windowSec = 0.05): this {
    const d = this.data;
    const W = Math.max(1, Math.round(windowSec * this.sr));
    let acc = 0;
    let best = 0;
    for (let i = 0; i < d.length; i++) {
      acc += d[i] * d[i];
      if (i >= W) acc -= d[i - W] * d[i - W];
      if (acc > best) best = acc;
    }
    const rms = Math.sqrt(best / W);
    if (rms > 0) {
      const g = target / rms;
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
    return this;
  }

  /** Short cosine fade over the last `sec` seconds so the buffer always ends at exactly zero. */
  endFade(sec = 0.01): this {
    const d = this.data;
    const n = Math.min(d.length, Math.round(sec * this.sr));
    for (let i = 0; i < n; i++) d[d.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    return this;
  }

  /** Remove DC (sub-20 Hz) with a gentle high-pass. */
  dcBlock(): this {
    return this.filter('highpass', 20, 0.6);
  }

  toBuffer(ctx: BaseAudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, this.data.length, this.sr);
    buf.copyToChannel(this.data as Float32Array<ArrayBuffer>, 0);
    return buf;
  }

  /** Play at t through dest with tape-style rate. Returns duration in context seconds. */
  play(ctx: BaseAudioContext, dest: AudioNode, t: number, rate = 1): number {
    const src = ctx.createBufferSource();
    src.buffer = this.toBuffer(ctx);
    src.playbackRate.value = rate;
    src.connect(dest);
    src.start(t);
    return this.seconds / rate;
  }
}

// ---------------------------------------------------------------------------
// Node-graph envelope helpers
// ---------------------------------------------------------------------------

/**
 * Attack (raised cosine) → optional decay to `sustain`·peak → hold → release (exponential-ish to 0).
 * Written as one setValueCurveAtTime so it is click-free and identical offline/live.
 * Total length = attack + hold + release.
 */
export function envelope(
  param: AudioParam,
  t: number,
  o: { peak: number; attack: number; hold: number; release: number; sustain?: number; decayTau?: number },
): number {
  const total = o.attack + o.hold + o.release;
  const n = clamp(Math.ceil(total * 400), 16, 4000);
  const curve = new Float32Array(n);
  const sus = o.sustain ?? 1;
  const dTau = o.decayTau ?? 0.12;
  let relStart = 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * total;
    let v: number;
    if (x < o.attack) v = 0.5 - 0.5 * Math.cos((Math.PI * x) / o.attack);
    else if (x < o.attack + o.hold) {
      const h = x - o.attack;
      v = sus + (1 - sus) * Math.exp(-h / dTau);
      relStart = v;
    } else {
      const r = (x - o.attack - o.hold) / o.release;
      // exponential shape to −60 dB, then a cosine taper so the last point is exactly 0
      v = relStart * Math.exp(-6.9 * r) * (0.5 + 0.5 * Math.cos(Math.PI * r));
    }
    curve[i] = v * o.peak;
  }
  curve[0] = 0;
  curve[n - 1] = 0;
  // Intrinsic value 0 holds until the curve starts (a gain node defaults to 1, which would leak).
  param.value = 0;
  param.setValueCurveAtTime(curve, t, total);
  return total;
}

/** Waveshaper curve: identity below `knee`, tanh into `ceiling`. Odd length so 0 maps to 0. */
export function softClipCurve(knee: number, ceiling: number, n = 4097): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

/** Procedural small-room impulse: early reflections off the table + a warm, darkening diffuse tail. */
export function roomImpulse(ctx: BaseAudioContext, rt60 = 0.8, seconds = 1.2): AudioBuffer {
  return cached(ctx, `room:${rt60}:${seconds}`, () => {
    const sr = ctx.sampleRate;
    const n = Math.ceil(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    const pre = 0.012;
    const taps = [0.0043, 0.0071, 0.0112, 0.0167, 0.0231, 0.0304];
    for (let ch = 0; ch < 2; ch++) {
      const d = new Float32Array(n);
      const r = mulberry32(101 + ch * 7);
      // early reflections (slightly different per ear)
      for (let k = 0; k < taps.length; k++) {
        const at = Math.round((taps[k] * (1 + (ch ? 0.07 : -0.05)) + (ch ? 0.0006 : 0)) * sr);
        d[at] += (r() < 0.5 ? -1 : 1) * (0.55 - k * 0.07);
      }
      // diffuse tail: decaying noise through a one-pole low-pass that closes over time
      let y = 0;
      const p0 = Math.round(pre * sr);
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr;
        const cutoff = 6500 * Math.exp(-t * 2.2) + 900;
        const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
        y += a * (r() * 2 - 1 - y);
        const fadeIn = Math.min(1, t / 0.006);
        d[i] += y * Math.exp((-6.91 * t) / rt60) * fadeIn * 0.9;
      }
      // taper the end
      const tail = Math.round(0.05 * sr);
      for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
      // unit energy, so `wet` reads as a true send level
      let e = 0;
      for (let i = 0; i < n; i++) e += d[i] * d[i];
      const s = 1 / Math.sqrt(e || 1);
      for (let i = 0; i < n; i++) d[i] *= s;
      buf.copyToChannel(d, ch);
    }
    return buf;
  });
}
