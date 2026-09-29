// Offline renders (OfflineAudioContext) through the same Mixer the game uses. Browser-only.

import { mulberry32 } from './dsp';
import { MAX_VOICES, Mixer } from './mixer';
import { SFX } from './sounds';
import type { SfxName, SfxVariant } from './types';

export const OFFLINE_SR = 48000;
/** Room tail allowance after a sound's own duration. */
const TAIL = 1.4;

export interface RenderOptions {
  seed?: number;
  rate?: number;
  duration?: number;
  variant?: SfxVariant;
  volume?: number;
  /** Include the master limiter + soft clip (default false: measure the sound on its own). */
  limiter?: boolean;
  sampleRate?: number;
}

export interface RenderResult {
  buffer: AudioBuffer;
  /** What the SoundFn reported (seconds). */
  reportedDur: number;
}

export function renderLength(name: SfxName, o: RenderOptions = {}): number {
  const meta = SFX[name];
  const rate = o.rate ?? 1;
  let dur = meta.maxDur;
  if (meta.duration && o.duration !== undefined) dur += Math.max(0, o.duration - meta.duration[2]);
  return dur / rate + TAIL;
}

export async function renderSfx(name: SfxName, o: RenderOptions = {}): Promise<RenderResult> {
  const sr = o.sampleRate ?? OFFLINE_SR;
  const len = Math.ceil(renderLength(name, o) * sr);
  const ctx = new OfflineAudioContext(2, len, sr);
  const mixer = new Mixer(ctx, ctx.destination, { limiter: o.limiter ?? false, live: false });
  const ok = mixer.trigger(name, 0, { rand: mulberry32(o.seed ?? 1), rate: o.rate, duration: o.duration, variant: o.variant, volume: o.volume });
  if (!ok) throw new Error(`${name} failed to build (seed ${o.seed ?? 1})`);
  const reportedDur = mixer.lastDuration;
  const buffer = await ctx.startRendering();
  return { buffer, reportedDur };
}

/**
 * Bank consistency: a banked playback must equal a direct synthesis of the same seed (same channel
 * layout, same level). Mono sounds must stay mono in the bank, or the panner would play them 3 dB hot.
 */
export async function renderBankPair(name: SfxName): Promise<{ direct: AudioBuffer; banked: AudioBuffer; bankChannels: number }> {
  const sr = OFFLINE_SR;
  const len = Math.ceil(renderLength(name) * sr);
  const a = new OfflineAudioContext(2, len, sr);
  new Mixer(a, a.destination, { limiter: false, bank: false }).trigger(name, 0, { rand: mulberry32(1) });
  const b = new OfflineAudioContext(2, len, sr);
  const mb = new Mixer(b, b.destination, { limiter: false, bank: true, bankRand: mulberry32(1), rateJitter: false });
  const d = SFX[name].duration?.[2];
  const [stored] = await mb.bank!.prepare(name, undefined, d, 1);
  if (!mb.trigger(name, 0, { rand: mulberry32(1) })) throw new Error(`bank trigger failed for ${name}`);
  return { direct: await a.startRendering(), banked: await b.startRendering(), bankChannels: stored.numberOfChannels };
}

/**
 * Robustness sweep: build every sound (and variant, rate and duration extreme) with many random
 * seeds at t = 0. Any exception inside a SoundFn (e.g. a note jittered to a negative time) shows up
 * as a failed trigger.
 */
export async function buildSweep(seeds = 20): Promise<string[]> {
  const bad: string[] = [];
  const cases: { name: SfxName; variant?: SfxVariant; duration?: number; rate?: number }[] = [];
  for (const name of Object.keys(SFX) as SfxName[]) {
    if (SFX[name].silent) continue;
    cases.push({ name }, { name, rate: 0.5 }, { name, rate: 2 });
    const d = SFX[name].duration;
    if (d) cases.push({ name, duration: d[0] }, { name, duration: d[1] });
  }
  for (const name of ['turnStart', 'conquer', 'continent'] as SfxName[]) cases.push({ name, variant: 'bright' }, { name, variant: 'somber' });
  const origWarn = console.warn;
  let msg = '';
  console.warn = (...a: unknown[]) => (msg = a.map(String).join(' '));
  try {
    for (const c of cases) {
      for (let s = 0; s < seeds; s++) {
        // one short context per build, rendered to completion so its buffers can be collected
        const ctx = new OfflineAudioContext(2, 128, OFFLINE_SR);
        const m = new Mixer(ctx, ctx.destination, { limiter: false, bank: false });
        msg = '';
        if (!m.trigger(c.name, 0, { rand: mulberry32(1000 + s), rate: c.rate, duration: c.duration, variant: c.variant })) bad.push(`${JSON.stringify(c)} seed ${1000 + s}: ${msg}`);
        await ctx.startRendering();
      }
    }
  } finally {
    console.warn = origWarn;
  }
  return bad;
}

/** A full single roll: 3 attacker dice (pan −0.3) + 2 defender dice (+0.3), 40 ms apart (UX §8.2). */
export async function renderDiceRoll(seed = 1): Promise<AudioBuffer> {
  const sr = OFFLINE_SR;
  const ctx = new OfflineAudioContext(2, Math.ceil(2 * sr), sr);
  const mixer = new Mixer(ctx, ctx.destination, { limiter: false });
  const rand = mulberry32(seed);
  const pans = [-0.3, -0.3, -0.3, 0.3, 0.3];
  pans.forEach((pan, i) => mixer.trigger('diceLand', 0.01 + i * 0.04, { pan, rand }));
  return ctx.startRendering();
}

export interface StressResult {
  buffer: AudioBuffer;
  played: number;
  dropped: number;
  stolen: number;
  maxConcurrent: number;
  requested: number;
}

/**
 * Worst case: a blitz storm far denser than the game ever produces (every 25 ms: die, hit, place,
 * shake, card) plus every stinger at once, through the full limiter chain.
 */
export async function renderStress(seconds = 4): Promise<StressResult> {
  const sr = OFFLINE_SR;
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + 7.5) * sr), sr);
  const mixer = new Mixer(ctx, ctx.destination, { limiter: true });
  const rand = mulberry32(7);
  let requested = 0;
  let maxConcurrent = 0;
  const spam: SfxName[] = ['diceLand', 'hit', 'place', 'diceShake', 'cardDraw', 'uiClick', 'march'];
  for (let t = 0.01; t < seconds; t += 0.025) {
    for (const name of spam) {
      requested++;
      mixer.trigger(name, t, { rand, pan: rand() * 2 - 1, volume: 1.5 });
    }
    maxConcurrent = Math.max(maxConcurrent, mixer.voiceCountAt(t));
  }
  for (const name of ['conquer', 'continent', 'eliminated', 'victory', 'turnStart', 'cardTrade'] as SfxName[]) {
    requested++;
    mixer.trigger(name, 0.5, { rand, volume: 1.5 });
  }
  maxConcurrent = Math.max(maxConcurrent, mixer.voiceCountAt(0.5));
  if (maxConcurrent > MAX_VOICES) throw new Error(`voice cap exceeded: ${maxConcurrent}`);
  const buffer = await ctx.startRendering();
  return { buffer, played: mixer.played, dropped: mixer.dropped, stolen: mixer.stolen, maxConcurrent, requested };
}

/** Limiter transparency: a −20 dBFS sine through the master chain must come out at −20 dBFS. */
export async function renderLimiterProbe(amplitude: number): Promise<{ inPeak: number; outPeak: number; outRms: number; inRms: number }> {
  const sr = OFFLINE_SR;
  const ctx = new OfflineAudioContext(2, sr, sr);
  const mixer = new Mixer(ctx, ctx.destination, { limiter: true });
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const g = ctx.createGain();
  g.gain.value = amplitude;
  osc.connect(g).connect(mixer.sfxBus);
  osc.start(0);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0,
    e = 0,
    n = 0;
  for (let i = Math.floor(sr * 0.5); i < d.length; i++) {
    peak = Math.max(peak, Math.abs(d[i]));
    e += d[i] * d[i];
    n++;
  }
  return { inPeak: amplitude, outPeak: peak, outRms: Math.sqrt(e / n), inRms: amplitude / Math.SQRT2 };
}

export async function renderMusic(seconds = 60, seed = 3, sampleRate = OFFLINE_SR): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const mixer = new Mixer(ctx, ctx.destination, { limiter: false });
  mixer.startMusic(0, { seed, renderUntil: seconds });
  return ctx.startRendering();
}

/**
 * The live brush stroke, scripted: press, a quick sure drag (speed rising to 1 and easing), release.
 * `commit` = it armed an attack; otherwise it dries out.
 */
export async function renderStroke(commit = true): Promise<AudioBuffer> {
  const sr = OFFLINE_SR;
  const ctx = new OfflineAudioContext(2, Math.ceil(2.2 * sr), sr);
  const mixer = new Mixer(ctx, ctx.destination, { limiter: false });
  const h = mixer.stroke({ at: 0.05 }) as ReturnType<Mixer['stroke']> & { moveAt: (v: number, at: number, p?: number) => void; endAt: (c: boolean, at: number) => void };
  for (let k = 0; k <= 45; k++) {
    const t = 0.05 + k * 0.016;
    const u = k / 45;
    h.moveAt(Math.sin(Math.PI * Math.min(1, u * 1.15)) * 1.0 + 0.05, t, -0.3 + 0.6 * u);
  }
  h.endAt(commit, 0.05 + 46 * 0.016);
  return ctx.startRendering();
}

/**
 * SOUL's moment, rendered through the live mix (limiter on): the score underneath; Sam's brush stroke
 * from Ural toward Siberia; Roll; the wooden cup; bone dice click into the tray; the verdict beat;
 * a breath of smoke as John's figure falls; the snap and the flood as Sam's colour soaks across;
 * the march; then the board settles back into the score. Timings follow the dice tray (single roll).
 */
export async function renderMoment(seed = 6, seconds = 18): Promise<{ buffer: AudioBuffer; marks: { t: number; what: string }[] }> {
  const sr = OFFLINE_SR;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const mixer = new Mixer(ctx, ctx.destination, { limiter: true });
  const rand = mulberry32(seed);
  mixer.startMusic(0, { seed: 11, renderUntil: seconds, fadeIn: 3 });
  const marks: { t: number; what: string }[] = [];
  const play = (name: SfxName, t: number, o: Parameters<Mixer['trigger']>[2] = {}) => {
    mixer.trigger(name, t, { rand, ...o });
    marks.push({ t, what: name + (o.variant ? ` · ${o.variant}` : '') });
  };
  // the stroke
  const S = 6;
  const h = mixer.stroke({ at: S }) as ReturnType<Mixer['stroke']> & { moveAt: (v: number, at: number, p?: number) => void; endAt: (c: boolean, at: number) => void };
  for (let k = 0; k <= 40; k++) {
    const u = k / 40;
    h.moveAt(0.1 + 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.1)), S + k * 0.016, -0.2 + 0.4 * u);
  }
  h.endAt(true, S + 0.66);
  marks.push({ t: S, what: 'stroke (drag Ural → Siberia)' });
  // Roll
  const R = S + 1.3;
  play('uiClick', R);
  play('diceShake', R + 0.02, { duration: 0.15 });
  // tumble 450 ms, dice touch down 40 ms apart
  const land = R + 0.02 + 0.15 + 0.29;
  [-0.3, -0.3, -0.3, 0.3, 0.3].forEach((pan, i) => play('diceLand', land + i * 0.04, { pan }));
  const settle = land + 0.16 + 0.1;
  mixer.hush(settle, 0.25);
  marks.push({ t: settle, what: 'verdict beat (hush 250 ms)' });
  const verdict = settle + 0.25;
  play('hit', verdict, { pan: 0.3 });
  const fall = verdict + 0.34;
  play('conquer', fall, { variant: 'somber', pan: 0.2 });
  play('march', fall + 0.15, { duration: 0.5, pan: 0.1 });
  return { buffer: await ctx.startRendering(), marks };
}
