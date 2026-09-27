// Sound Lab (audio.html): one button per sound, music + volume, game-beat scenarios, and the offline
// analysis the team uses instead of ears. Also exposes window.__audioLab for the verify script.

import '@fontsource/cinzel/600.css';
import '@fontsource-variable/inter';
import { analyze, encodeWav, fft, type SoundStats } from './analyze';
import { LIMITS, summarize, type SoundReport } from './checks';
import { createAudio } from './engine';
import { LIMITER_MAKEUP_COMP, MAX_VOICES } from './mixer';
import { OFFLINE_SR, buildSweep, renderBankPair, renderDiceRoll, renderLimiterProbe, renderMusic, renderSfx, renderStress, type RenderOptions } from './offline';
import { SFX } from './sounds';
import { SFX_NAMES, TIER_TARGET_LUFS, type PlayOptions, type SfxName, type SfxVariant } from './types';

const engine = createAudio({ volume: 0.8 });

// ---------------------------------------------------------------------------
// Rendering + analysis API (used by the page and by src/audio/verify.ts)
// ---------------------------------------------------------------------------

const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
const SEEDS = [1, 2, 3, 4, 5, 6];

async function analyzeSound(name: SfxName, seeds = SEEDS, o: RenderOptions = {}): Promise<SoundReport> {
  const runs: { stats: SoundStats; reportedDur: number }[] = [];
  for (const seed of seeds) {
    const r = await renderSfx(name, { ...o, seed });
    runs.push({ stats: analyze(channelsOf(r.buffer), r.buffer.sampleRate), reportedDur: r.reportedDur });
  }
  return summarize(name, runs);
}

async function analyzeAll(seeds = SEEDS): Promise<SoundReport[]> {
  const out: SoundReport[] = [];
  for (const n of SFX_NAMES) out.push(await analyzeSound(n, seeds));
  return out;
}

/** A single measurement for a specific option set (variants, durations, rates). */
async function measure(name: SfxName, o: RenderOptions = {}): Promise<SoundStats & { reportedDur: number }> {
  const r = await renderSfx(name, o);
  return { ...analyze(channelsOf(r.buffer), r.buffer.sampleRate), reportedDur: r.reportedDur };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Trim trailing near-silence (keeps 30 ms) so exported WAVs don't carry a second of nothing. */
function trimmed(b: AudioBuffer): Float32Array[] {
  const ch = channelsOf(b);
  let last = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) > 1e-4) last = Math.max(last, i);
  const end = Math.min(ch[0].length, last + Math.round(0.03 * b.sampleRate));
  return ch.map((c) => c.slice(0, end));
}

async function wavBase64(name: SfxName, o: RenderOptions = {}): Promise<string> {
  const r = await renderSfx(name, o);
  return toBase64(encodeWav(trimmed(r.buffer), r.buffer.sampleRate));
}

async function composites() {
  const roll = await renderDiceRoll(1);
  const rollStats = analyze(channelsOf(roll), roll.sampleRate);
  const stress = await renderStress(4);
  const stressStats = analyze(channelsOf(stress.buffer), stress.buffer.sampleRate);
  const quiet = await renderLimiterProbe(0.1);
  const loud = await renderLimiterProbe(2.0);
  const music = await renderMusic(60, 3);
  const musicCh = channelsOf(music);
  const musicStats = analyze(musicCh, music.sampleRate);
  // gap check: RMS of every 2 s window after the 6 s fade-in
  const sr = music.sampleRate;
  let minWindowDb = Infinity;
  for (let s = 6 * sr; s + 2 * sr <= musicCh[0].length; s += sr) {
    let e = 0;
    for (const c of musicCh) for (let i = s; i < s + 2 * sr; i++) e += c[i] * c[i];
    const db = 10 * Math.log10(e / (2 * sr * musicCh.length) + 1e-20);
    minWindowDb = Math.min(minWindowDb, db);
  }
  return {
    diceRoll: { ...rollStats, target: TIER_TARGET_LUFS.board },
    stress: { ...stressStats, played: stress.played, dropped: stress.dropped, stolen: stress.stolen, maxConcurrent: stress.maxConcurrent, requested: stress.requested, maxVoices: MAX_VOICES },
    limiter: {
      makeupComp: LIMITER_MAKEUP_COMP,
      quietGainDb: 20 * Math.log10(quiet.outRms / quiet.inRms),
      loudOutPeak: loud.outPeak,
    },
    music: { ...musicStats, minWindowDb },
  };
}

async function bankCheck() {
  const out: { name: SfxName; directLk: number; bankedLk: number; dLk: number; dPeak: number; channels: number }[] = [];
  for (const name of SFX_NAMES) {
    const { direct, banked, bankChannels } = await renderBankPair(name);
    const a = analyze(channelsOf(direct), direct.sampleRate);
    const b = analyze(channelsOf(banked), banked.sampleRate);
    out.push({ name, directLk: a.lk200, bankedLk: b.lk200, dLk: b.lk200 - a.lk200, dPeak: b.peakDb - a.peakDb, channels: bankChannels });
  }
  return out;
}

/** Live: wait for the bank to warm, then time play() for every sound (muted). */
async function liveCost(timeoutMs = 30000) {
  const t0 = performance.now();
  while (engine.stats().banked < 20 && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 100));
  const warmMs = performance.now() - t0;
  engine.setMuted(true);
  const cost: Record<string, { median: number; max: number }> = {};
  for (const n of SFX_NAMES) {
    const ts: number[] = [];
    for (let i = 0; i < 7; i++) {
      engine.stopAll();
      await new Promise((r) => setTimeout(r, 30));
      const a = performance.now();
      engine.play(n);
      ts.push(performance.now() - a);
    }
    ts.sort((x, y) => x - y);
    cost[n] = { median: ts[3], max: ts[6] };
  }
  engine.stopAll();
  engine.setMuted(false);
  return { banked: engine.stats().banked, warmMs, cost };
}

async function variants() {
  const cases: [SfxName, RenderOptions, string][] = [
    ['turnStart', { variant: 'bright' }, 'turnStart bright'],
    ['conquer', { variant: 'somber' }, 'conquer somber'],
    ['continent', { variant: 'somber' }, 'continent somber'],
    ['diceShake', { duration: 0.08 }, 'diceShake 80 ms'],
    ['diceShake', { duration: 0.6 }, 'diceShake 600 ms'],
    ['march', { duration: 0.22 }, 'march 220 ms'],
    ['march', { duration: 0.9 }, 'march 900 ms'],
    ['whoosh', { duration: 0.3 }, 'whoosh 300 ms'],
    ['whoosh', { duration: 0.9 }, 'whoosh 900 ms'],
    ['diceLand', { rate: 1.4 }, 'diceLand rate 1.4'],
    ['cardTrade', { rate: 0.75 }, 'cardTrade rate 0.75'],
  ];
  const out = [];
  for (const [name, o, label] of cases) out.push({ label, name, ...o, ...(await measure(name, { ...o, seed: 1 })) });
  return out;
}

// ---------------------------------------------------------------------------
// Drawing: waveform + log-frequency spectrogram
// ---------------------------------------------------------------------------

const RAMP = ['#07090c', '#12262b', '#1f4a4a', '#6d5a2e', '#c2a062', '#f3ead8'].map((h) => parseInt(h.slice(1), 16));
function rampColor(v: number, out: Uint8ClampedArray, o: number): void {
  const x = Math.max(0, Math.min(0.9999, v)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  out[o] = ((a >> 16) & 255) * (1 - f) + ((b >> 16) & 255) * f;
  out[o + 1] = ((a >> 8) & 255) * (1 - f) + ((b >> 8) & 255) * f;
  out[o + 2] = (a & 255) * (1 - f) + (b & 255) * f;
  out[o + 3] = 255;
}

function drawSound(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mono: Float32Array, sr: number, seconds: number, title: string, lines: string[]): void {
  g.fillStyle = '#080a0d';
  g.fillRect(x, y, w, h);
  const n = Math.min(mono.length, Math.round(seconds * sr));
  const waveH = Math.round(h * 0.28);
  const specY = y + waveH + 2;
  const specH = h - waveH - 2 - 30;
  // waveform (min/max per column), dBFS grid lines at ±0.5 (−6 dB)
  g.strokeStyle = 'rgba(243,234,216,0.12)';
  g.beginPath();
  g.moveTo(x, y + waveH / 2);
  g.lineTo(x + w, y + waveH / 2);
  g.stroke();
  g.fillStyle = 'rgba(243,234,216,0.8)';
  for (let c = 0; c < w; c++) {
    const s0 = Math.floor((c / w) * n);
    const s1 = Math.max(s0 + 1, Math.floor(((c + 1) / w) * n));
    let lo = 0,
      hi = 0;
    for (let i = s0; i < s1; i++) {
      if (mono[i] < lo) lo = mono[i];
      if (mono[i] > hi) hi = mono[i];
    }
    const yy = y + waveH / 2 - hi * (waveH / 2);
    g.fillRect(x + c, yy, 1, Math.max(1, (hi - lo) * (waveH / 2)));
  }
  // spectrogram 40 Hz .. 12 kHz, log axis, −100..−20 dB
  const N = 1024;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const img = g.createImageData(w, specH);
  for (let c = 0; c < w; c++) {
    const center = Math.floor((c / w) * n);
    for (let i = 0; i < N; i++) {
      const k = center - N / 2 + i;
      re[i] = k >= 0 && k < mono.length ? mono[k] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let r = 0; r < specH; r++) {
      const f = 40 * Math.pow(12000 / 40, 1 - r / (specH - 1));
      const k = Math.min(N / 2 - 1, Math.max(1, Math.round((f * N) / sr)));
      const p = (re[k] * re[k] + im[k] * im[k]) / (N * N / 4);
      const dbv = 10 * Math.log10(p + 1e-20);
      rampColor((dbv + 100) / 80, img.data, (r * w + c) * 4);
    }
  }
  g.putImageData(img, x, specY);
  // frequency guides: 100 Hz, 1 kHz, 5 kHz
  g.font = '10px Inter Variable, sans-serif';
  for (const f of [100, 1000, 5000]) {
    const r = (1 - Math.log(f / 40) / Math.log(12000 / 40)) * (specH - 1);
    g.fillStyle = 'rgba(243,234,216,0.25)';
    g.fillRect(x, specY + r, 6, 1);
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 8, specY + r + 3);
  }
  g.fillStyle = '#c2a062';
  g.font = '600 12px Inter Variable, sans-serif';
  g.fillText(title, x + 6, y + h - 17);
  g.fillStyle = 'rgba(243,234,216,0.7)';
  g.font = '10.5px Inter Variable, sans-serif';
  g.fillText(lines.join('  ·  '), x + 6, y + h - 4);
}

function monoOf(b: AudioBuffer): Float32Array {
  const ch = channelsOf(b);
  const m = new Float32Array(ch[0].length);
  for (const c of ch) for (let i = 0; i < m.length; i++) m[i] += c[i] / ch.length;
  return m;
}

/** Draw every sound (seed 1) into a grid canvas. Used for the screenshot review. */
async function drawAll(canvas: HTMLCanvasElement, extra: { label: string; name: SfxName; o: RenderOptions }[] = []): Promise<void> {
  const items: { label: string; name: SfxName; o: RenderOptions }[] = [...SFX_NAMES.map((n) => ({ label: n, name: n, o: {} })), ...extra];
  const cols = 4;
  const cw = 290,
    ch = 200,
    gap = 8;
  const rows = Math.ceil(items.length / cols);
  canvas.width = cols * cw + (cols - 1) * gap;
  canvas.height = rows * ch + (rows - 1) * gap;
  canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#0c0f13';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = await renderSfx(it.name, { ...it.o, seed: 1 });
    const s = analyze(channelsOf(r.buffer), r.buffer.sampleRate);
    const secs = Math.min(r.buffer.duration, Math.max(0.25, s.durationSec + 0.05));
    drawSound(g, (i % cols) * (cw + gap), Math.floor(i / cols) * (ch + gap), cw, ch, monoOf(r.buffer), r.buffer.sampleRate, secs, it.label, [
      `${s.lk200.toFixed(1)} LUFS`,
      `pk ${s.peakDb.toFixed(1)}`,
      `${(s.durationSec * 1000).toFixed(0)} ms`,
      `c ${(s.centroidHz / 1000).toFixed(2)}k`,
    ]);
  }
}

async function drawMusic(canvas: HTMLCanvasElement, seconds = 60): Promise<void> {
  const b = await renderMusic(seconds, 3);
  const s = analyze(channelsOf(b), b.sampleRate);
  canvas.width = 1180;
  canvas.height = 260;
  canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  const g = canvas.getContext('2d')!;
  drawSound(g, 0, 0, canvas.width, canvas.height, monoOf(b), b.sampleRate, seconds, `music bed · ${seconds} s`, [
    `M ${s.lufsM.toFixed(1)} LUFS`,
    `pk ${s.peakDb.toFixed(1)} dBFS`,
    `centroid ${s.centroidHz.toFixed(0)} Hz`,
  ]);
}

// ---------------------------------------------------------------------------
// Scenarios: real game beats, timed from docs/UX.md §8.2
// ---------------------------------------------------------------------------

const scenarios: Record<string, () => void> = {
  'Single roll (3v2)': () => {
    engine.play('diceShake', { duration: 0.15 });
    [-0.3, -0.3, -0.3, 0.3, 0.3].forEach((pan, i) => engine.play('diceLand', { pan, delay: 0.6 + i * 0.04 }));
    engine.play('hit', { pan: 0.3, delay: 1.0 });
  },
  'Blitz (6 rolls)': () => {
    engine.play('diceShake', { duration: 0.1 });
    const gaps = [0.7, 0.6, 0.45, 0.34, 0.25, 0.7];
    let t = 0;
    gaps.forEach((g, k) => {
      t += g;
      engine.play('diceLand', { delay: t - 0.1, rate: Math.min(1.4, 1 + 0.08 * k) });
      engine.play('hit', { delay: t, pan: k % 2 ? 0.3 : -0.3 });
    });
    engine.play('conquer', { delay: t + 0.35 });
    engine.play('march', { delay: t + 0.5, duration: 0.5 });
  },
  'Conquest + continent': () => {
    engine.play('hit', { pan: 0.3 });
    engine.play('conquer', { delay: 0.35 });
    engine.play('march', { delay: 0.5, duration: 0.5 });
    engine.play('continent', { delay: 1.25 });
  },
  'Reinforce ×8 (rising)': () => {
    for (let i = 0; i < 8; i++) engine.play('place', { delay: 0.2 + i * 0.16, rate: Math.min(1.15, 1 + 0.03 * i), pan: (i % 3) * 0.2 - 0.2 });
  },
  'AI drop wave (20)': () => {
    for (let i = 0; i < 20; i++) engine.play('place', { delay: i * 0.05, volume: 0.6, pan: Math.sin(i) * 0.5 });
  },
  'Elimination beat': () => {
    engine.stopAll();
    engine.play('eliminated', { delay: 0.15 });
  },
  'Stress: 60 dice now': () => {
    for (let i = 0; i < 60; i++) engine.play('diceLand');
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

function build(): void {
  const app = document.getElementById('app')!;
  app.append(el('h1', {}, 'War Table · Sound Lab'));
  app.append(
    el('p', { class: 'sub' }, 'Every sound is synthesized in WebAudio (no files). Click to hear one. Analyze renders each sound offline and measures loudness, peaks and spectrum.'),
  );

  // controls
  const controls = el('div', { class: 'panel controls' });
  const slider = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, on: (v: number) => void) => {
    const l = el('label');
    l.append(label);
    const i = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    const o = el('output', {}, fmt(value));
    i.addEventListener('input', () => {
      const v = Number(i.value);
      o.textContent = fmt(v);
      on(v);
    });
    l.append(i, o);
    controls.append(l);
    return i;
  };
  const opts: PlayOptions & { useDuration: boolean } = { useDuration: false };
  slider('Volume', 0, 1, 0.01, 0.8, (v) => v.toFixed(2), (v) => engine.setVolume(v));
  slider('Rate', 0.5, 2, 0.01, 1, (v) => v.toFixed(2), (v) => (opts.rate = v));
  slider('Pan', -1, 1, 0.05, 0, (v) => v.toFixed(2), (v) => (opts.pan = v));
  slider('Duration', 0.06, 1.5, 0.01, 0.5, (v) => `${(v * 1000).toFixed(0)} ms`, (v) => {
    opts.duration = v;
    opts.useDuration = true;
  });
  const vl = el('label');
  vl.append('Variant');
  const vs = el('select');
  for (const v of ['', 'bright', 'somber']) vs.append(el('option', { value: v }, v || 'default'));
  vs.addEventListener('change', () => (opts.variant = (vs.value || undefined) as SfxVariant | undefined));
  vl.append(vs);
  controls.append(vl);
  const mute = el('button', {}, 'Mute');
  let muted = false;
  mute.addEventListener('click', () => {
    muted = !muted;
    engine.setMuted(muted);
    mute.classList.toggle('on', muted);
  });
  const music = el('button', { id: 'music' }, 'Music: off');
  let musicOn = false;
  music.addEventListener('click', () => {
    musicOn = !musicOn;
    engine.setMusic(musicOn);
    music.textContent = `Music: ${musicOn ? 'on' : 'off'}`;
    music.classList.toggle('on', musicOn);
  });
  controls.append(mute, music);
  app.append(controls);

  // sounds
  const cards = new Map<SfxName, HTMLElement>();
  const groups = ['UI', 'Board', 'Battle', 'Cards', 'Stingers'] as const;
  for (const grp of groups) {
    app.append(el('h2', {}, grp));
    const grid = el('div', { class: 'grid' });
    for (const name of SFX_NAMES.filter((n) => SFX[n].group === grp)) {
      const meta = SFX[name];
      const b = el('button', { class: 'sfx', 'data-sfx': name });
      b.append(el('b', {}, meta.label));
      b.append(el('small', {}, `${name} · ${meta.tier} ${TIER_TARGET_LUFS[meta.tier]} LUFS${meta.duration ? ' · follows duration' : ''}`));
      const m = el('small', { class: 'm' }, '');
      b.append(m);
      cards.set(name, m);
      b.addEventListener('click', () => {
        const o: PlayOptions = { rate: opts.rate, pan: opts.pan, variant: opts.variant };
        if (opts.useDuration) o.duration = opts.duration;
        engine.play(name, o);
        void showOne(name, o);
      });
      grid.append(b);
    }
    app.append(grid);
  }

  app.append(el('h2', {}, 'Game beats (timed from UX §8.2)'));
  const row = el('div', { class: 'row' });
  for (const [label, fn] of Object.entries(scenarios)) {
    const b = el('button', {}, label);
    b.addEventListener('click', fn);
    row.append(b);
  }
  app.append(row);

  app.append(el('h2', {}, 'Selected sound (offline render)'));
  const one = el('canvas', { id: 'one', width: '1180', height: '240' });
  one.style.aspectRatio = '1180 / 240';
  app.append(one);

  app.append(el('h2', {}, 'Analysis'));
  const bar = el('div', { class: 'row' });
  const analyzeBtn = el('button', { class: 'primary', id: 'analyze' }, 'Analyze all');
  bar.append(analyzeBtn);
  app.append(bar);
  const status = el('div', { id: 'status' });
  app.append(status);
  const table = el('div', { class: 'panel', id: 'table' });
  table.style.display = 'none';
  app.append(table);
  const all = el('canvas', { id: 'all' });
  app.append(all);

  analyzeBtn.addEventListener('click', async () => {
    status.textContent = 'Rendering every sound offline (6 seeds each)…';
    const reports = await analyzeAll();
    renderTable(table, reports);
    for (const r of reports) cards.get(r.name)!.textContent = `${r.median.lk200.toFixed(1)} LUFS · pk ${r.peakMaxDb.toFixed(1)} · ${(r.median.durationSec * 1000).toFixed(0)} ms`;
    await drawAll(all);
    const bad = reports.filter((r) => r.failures.length);
    status.textContent = bad.length ? `${bad.length} sound(s) need attention.` : 'All sounds pass.';
  });

  setInterval(() => {
    const s = engine.stats();
    const live = document.getElementById('live');
    if (live) live.textContent = `context: ${s.state} · voices ${s.voices} · played ${s.played} · dropped ${s.dropped} · stolen ${s.stolen} · music ${s.music ? 'on' : 'off'}`;
  }, 250);
  const live = el('div', { id: 'live', class: 'sub' });
  app.insertBefore(live, controls.nextSibling);

  async function showOne(name: SfxName, o: PlayOptions) {
    const r = await renderSfx(name, { seed: (Math.random() * 1e6) | 0, rate: o.rate, duration: o.duration, variant: o.variant });
    const s = analyze(channelsOf(r.buffer), r.buffer.sampleRate);
    const g = one.getContext('2d')!;
    drawSound(g, 0, 0, one.width, one.height, monoOf(r.buffer), r.buffer.sampleRate, Math.max(0.3, s.durationSec + 0.05), `${name}${o.variant ? ' · ' + o.variant : ''}`, [
      `${s.lk200.toFixed(1)} LUFS (200 ms)`,
      `peak ${s.peakDb.toFixed(1)} dBFS`,
      `${(s.durationSec * 1000).toFixed(0)} ms`,
      `onset ${s.onsetMs.toFixed(1)} ms`,
      `centroid ${s.centroidHz.toFixed(0)} Hz`,
      `laptop band ${(s.laptopShare * 100).toFixed(0)}%`,
    ]);
  }
}

function renderTable(host: HTMLElement, reports: SoundReport[]): void {
  host.style.display = '';
  const cols = ['sound', 'tier', 'target', 'LK200', 'range', 'peak', 'dur ms', 'onset', 'centroid', 'laptop %', '>8k %', 'trim', 'suggest', 'issues'];
  const t = el('table');
  const tr = el('tr');
  for (const c of cols) tr.append(el('th', {}, c));
  t.append(tr);
  for (const r of reports) {
    const m = r.median;
    const row = el('tr');
    const cells = [
      r.name,
      r.tier,
      String(r.target),
      m.lk200.toFixed(1),
      `${r.lk200Min.toFixed(1)}…${r.lk200Max.toFixed(1)}`,
      r.peakMaxDb.toFixed(1),
      (m.durationSec * 1000).toFixed(0),
      m.onsetMs.toFixed(1),
      m.centroidHz.toFixed(0),
      (m.laptopShare * 100).toFixed(0),
      (m.hfShare * 100).toFixed(2),
      r.trimDb.toFixed(1),
      r.suggestedTrimDb.toFixed(1),
      r.failures.join('; ') || 'ok',
    ];
    cells.forEach((c, i) => {
      const td = el('td', {}, c);
      if (i === cells.length - 1 && r.failures.length) td.className = 'bad';
      row.append(td);
    });
    t.append(row);
  }
  host.replaceChildren(t);
}

build();

declare global {
  interface Window {
    __audioLab: unknown;
  }
}

window.__audioLab = {
  engine,
  names: SFX_NAMES,
  limits: LIMITS,
  sampleRate: OFFLINE_SR,
  meta: Object.fromEntries(SFX_NAMES.map((n) => [n, { tier: SFX[n].tier, trimDb: SFX[n].trimDb, maxDur: SFX[n].maxDur, maxVoices: SFX[n].maxVoices, minGapMs: SFX[n].minGapMs, group: SFX[n].group, duration: SFX[n].duration }])),
  analyzeSound,
  analyzeAll,
  measure,
  composites,
  variants,
  bankCheck,
  liveCost,
  buildSweep,
  wavBase64,
  scenarios: Object.keys(scenarios),
  runScenario: (k: string) => scenarios[k]?.(),
  drawAll: (extra?: { label: string; name: SfxName; o: RenderOptions }[]) => drawAll(document.getElementById('all') as HTMLCanvasElement, extra),
  drawMusic: (s?: number) => drawMusic(document.getElementById('all') as HTMLCanvasElement, s),
  musicWav: async (seconds = 40) => {
    const b = await renderMusic(seconds, 3);
    return toBase64(encodeWav(channelsOf(b), b.sampleRate));
  },
  rollWav: async () => {
    const b = await renderDiceRoll(1);
    return toBase64(encodeWav(trimmed(b), b.sampleRate));
  },
};
