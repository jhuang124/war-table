// Audio verification (node + Playwright): `npx tsx src/audio/verify.ts`
//
// Opens audio.html, then:
//  1. live engine: play() before unlock is a no-op; a real click unlocks; every sound plays; spam is
//     voice-limited; music toggles; no console errors.
//  2. offline: renders every sound (6 seeds) in an OfflineAudioContext inside the page and checks
//     NaN / silence / peak ≤ −1 dBFS / loudness on target / DC / clicks / tails / spectrum.
//  3. composites: a 5-die roll, a blitz storm through the limiter, limiter transparency, 60 s of music.
//  4. writes artifacts/audio/{report.json, spectrograms.png, music.png, lab.png, wav/*.wav}.
// Exit code 1 on any failure. Uses an existing server on :5283 or starts its own.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.AUDIO_PORT ?? 5283);
const URL = `http://127.0.0.1:${PORT}/audio.html`;
const OUT = join(ROOT, 'artifacts/audio');
const WAV = join(OUT, 'wav');
const TMP = join(ROOT, 'artifacts/tmp/audio');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function up(): Promise<boolean> {
  try {
    const r = await fetch(URL);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await up()) return null;
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await up()) return child;
  }
  throw new Error(`dev server did not come up on ${PORT}`);
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : String(x));

async function main() {
  mkdirSync(WAV, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const failures: string[] = [];
  const consoleProblems: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!(window as Any).__audioLab);
    await page.waitForTimeout(500);

    // ---------------------------------------------------------------- live
    const before = await page.evaluate(() => {
      const lab = (window as Any).__audioLab;
      let threw = false;
      try {
        for (const n of lab.names) lab.engine.play(n);
        lab.engine.play('nope' as Any);
        lab.engine.setMusic(false);
        lab.engine.setVolume(NaN);
      } catch {
        threw = true;
      }
      return { threw, stats: lab.engine.stats() };
    });
    if (before.threw) failures.push('live: play() before unlock threw');
    if (before.stats.state !== 'locked') failures.push(`live: expected locked before gesture, got ${before.stats.state}`);
    if (before.stats.played !== 0) failures.push('live: sounds played before unlock');

    // Watch for long main-thread tasks while the bank warms up (they'd be dropped frames on the title).
    // The task containing the unlock click is excluded: Chrome spends ~120 ms opening the audio device
    // for the page's first AudioContext (measured on a blank page too); our own unlock() is ~14 ms.
    // (a string, so the bundler's __name helpers never leak into the page)
    await page.evaluate(`(() => {
      const w = window;
      w.__longTasks = [];
      window.addEventListener('pointerdown', () => { if (w.__clickAt === undefined) w.__clickAt = performance.now(); }, { capture: true });
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__longTasks.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] });
      } catch (e) {}
      // keep frames flowing like the real game (idle callbacks are scheduled between frames)
      w.__rafLoop = () => requestAnimationFrame(w.__rafLoop);
      w.__rafLoop();
    })()`);
    await page.mouse.click(20, 20); // a real, trusted gesture
    const unlockAt = Date.now();
    await page.waitForFunction(() => (window as Any).__audioLab.engine.stats().state === 'running', null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => (window as Any).__audioLab.engine.stats().banked >= 20, null, { timeout: 30000, polling: 50 }).catch(() => {});
    const warm: Any = await page.evaluate(() => {
      const w = window as Any;
      const all: [number, number][] = w.__longTasks;
      const click = w.__clickAt ?? 0;
      const unlockTask = all.filter(([s, d]) => s <= click + 5 && s + d >= click - 5);
      const other = all.filter((t) => !unlockTask.includes(t));
      return { unlockTaskMs: unlockTask.map(([, d]) => Math.round(d)), otherLongTasksMs: other.map(([, d]) => Math.round(d)) };
    });
    warm.ms = Date.now() - unlockAt;
    if (warm.otherLongTasksMs.length) failures.push(`bank warm-up blocked the main thread: long tasks ${warm.otherLongTasksMs.join(', ')} ms`);

    const live = await page.evaluate(async () => {
      const lab = (window as Any).__audioLab;
      const e = lab.engine;
      const state = e.stats().state;
      for (const n of lab.names) e.play(n, { volume: 0.2 });
      await new Promise((r) => setTimeout(r, 50));
      const afterAll = e.stats();
      const d0 = afterAll.dropped;
      for (let i = 0; i < 60; i++) e.play('diceLand');
      for (let i = 0; i < 30; i++) e.play('hit');
      const spam = e.stats();
      e.stopAll();
      e.setMusic(true);
      await new Promise((r) => setTimeout(r, 400));
      const musicOn = e.stats().music;
      e.setMusic(false);
      await new Promise((r) => setTimeout(r, 100));
      const musicOff = e.stats().music;
      lab.runScenario('Blitz (6 rolls)');
      await new Promise((r) => setTimeout(r, 300));
      const blitz = e.stats();
      e.stopAll();
      // skipAnimations path: scheduled (delayed) sounds are cancelled by stopAll
      await new Promise((r) => setTimeout(r, 120));
      e.play('victory', { delay: 1.5 });
      e.play('hit', { delay: 0.8 });
      const scheduled = e.stats().voices;
      e.stopAll();
      const afterStop = e.stats().voices;
      // rapid music toggling never leaves two beds or a stuck state
      for (let i = 0; i < 12; i++) e.setMusic(i % 2 === 0);
      const musicAfterToggle = e.stats().music; // last call was setMusic(false)
      e.setMusic(true);
      await new Promise((r) => setTimeout(r, 200));
      const musicFinal = e.stats().music;
      e.setMusic(false);
      // volume / mute edge values
      e.setVolume(-1);
      e.setVolume(5);
      e.setVolume(0.8);
      e.setMuted(true);
      e.setMuted(false);
      e.play('uiClick', { volume: 99, pan: -99, rate: 0, delay: -3, duration: 1e9 });
      return { state, afterAll, spam, droppedBySpam: spam.dropped - d0, musicOn, musicOff, blitz, scheduled, afterStop, musicAfterToggle, musicFinal };
    });
    if (live.state !== 'running') failures.push(`live: context not running after a click (${live.state})`);
    if (live.afterAll.played < 17) failures.push(`live: only ${live.afterAll.played}/17 sounds played after unlock`);
    if ((live.spam.voicesByName.diceLand ?? 0) > 6) failures.push(`live: ${live.spam.voicesByName.diceLand} diceLand voices (cap 6)`);
    if ((live.spam.voicesByName.hit ?? 0) > 3) failures.push(`live: ${live.spam.voicesByName.hit} hit voices (cap 3)`);
    if (live.spam.voices > 20) failures.push(`live: ${live.spam.voices} voices (global cap 20)`);
    if (live.droppedBySpam < 80) failures.push(`live: spam of 90 same-frame plays only dropped ${live.droppedBySpam}`);
    if (live.scheduled < 2) failures.push(`live: delayed plays not scheduled (${live.scheduled} voices)`);
    if (live.afterStop !== 0) failures.push(`live: stopAll left ${live.afterStop} voices`);
    if (live.musicAfterToggle) failures.push('live: music on after toggling ending in off');
    if (!live.musicFinal) failures.push('live: music did not restart after toggling');
    if (!live.musicOn) failures.push('live: music did not start');
    if (live.musicOff) failures.push('live: music did not stop');

    // ------------------------------------------------------------- offline
    const reports: Any[] = await page.evaluate(() => (window as Any).__audioLab.analyzeAll());
    for (const r of reports) for (const f of r.failures) failures.push(`${r.name}: ${f}`);

    const comp: Any = await page.evaluate(() => (window as Any).__audioLab.composites());
    const roll = comp.diceRoll;
    if (roll.peakDb > -1) failures.push(`dice roll (5 dice): peak ${f1(roll.peakDb)} dBFS`);
    if (Math.abs(roll.lk200 - roll.target) > 2) failures.push(`dice roll (5 dice): ${f1(roll.lk200)} LUFS vs board ${roll.target} ±2`);
    const st = comp.stress;
    if (st.nan) failures.push('stress: NaN');
    if (st.peakDb > -0.3) failures.push(`stress: peak ${f1(st.peakDb)} dBFS through limiter`);
    if (st.maxConcurrent > st.maxVoices) failures.push(`stress: ${st.maxConcurrent} concurrent voices`);
    if (Math.abs(comp.limiter.quietGainDb) > 0.3) failures.push(`limiter not transparent at −20 dBFS: ${comp.limiter.quietGainDb.toFixed(2)} dB`);
    if (comp.limiter.loudOutPeak > 0.95) failures.push(`limiter ceiling: +6 dBFS sine came out at ${comp.limiter.loudOutPeak.toFixed(3)}`);
    const mu = comp.music;
    if (mu.nan) failures.push('music: NaN');
    if (mu.peakDb > -6) failures.push(`music: peak ${f1(mu.peakDb)} dBFS (bed should be quiet)`);
    if (mu.lufsM < -40 || mu.lufsM > -28) failures.push(`music: momentary max ${f1(mu.lufsM)} LUFS outside −40…−28`);
    if (mu.minWindowDb < -55) failures.push(`music: a 2 s gap at ${f1(mu.minWindowDb)} dBFS`);
    if (mu.dc > 0.002) failures.push(`music: DC ${mu.dc}`);
    if (mu.hfShare > 0.02) failures.push(`music: ${(mu.hfShare * 100).toFixed(1)}% above 8 kHz`);

    const vars: Any[] = await page.evaluate(() => (window as Any).__audioLab.variants());
    const meta: Any = await page.evaluate(() => (window as Any).__audioLab.meta);
    const base = Object.fromEntries(reports.map((r) => [r.name, r]));
    for (const v of vars) {
      const m = meta[v.name];
      const allowed = (m.maxDur + (m.duration && v.duration !== undefined ? Math.max(0, v.duration - m.duration[2]) : 0)) / (v.rate ?? 1);
      if (v.reportedDur > allowed + 1e-6) failures.push(`${v.label}: reported ${v.reportedDur.toFixed(3)} s > allowed ${allowed.toFixed(3)} s`);
      if (v.nan) failures.push(`${v.label}: NaN`);
      if (v.peakDb > -1) failures.push(`${v.label}: peak ${f1(v.peakDb)} dBFS`);
      if (!(v.peakDb > -60)) failures.push(`${v.label}: silent`);
      if (v.endDb > -70) failures.push(`${v.label}: tail cut off`);
      if (v.variant && Math.abs(v.lk200 - base[v.name].median.lk200) > 2.5) failures.push(`${v.label}: ${f1(v.lk200)} LUFS, base ${f1(base[v.name].median.lk200)}`);
      if (v.duration !== undefined && v.name !== 'whoosh') {
        // the sound's own length (before the room tail) must track the requested motion length
        if (v.reportedDur < v.duration || v.reportedDur > v.duration + 0.25) failures.push(`${v.label}: reported ${v.reportedDur.toFixed(3)} s`);
      }
    }

    const sweep: string[] = await page.evaluate(() => (window as Any).__audioLab.buildSweep(20));
    for (const b of sweep.slice(0, 10)) failures.push(`build: ${b}`);
    if (sweep.length > 10) failures.push(`build: …and ${sweep.length - 10} more`);
    const bank: Any[] = await page.evaluate(() => (window as Any).__audioLab.bankCheck());
    for (const b of bank) if (!(Math.abs(b.dLk) < 0.15) || !(Math.abs(b.dPeak) < 0.15)) failures.push(`bank: ${b.name} banked differs from direct by ${b.dLk.toFixed(2)} dB loudness / ${b.dPeak.toFixed(2)} dB peak`);
    const cost: Any = await page.evaluate(() => (window as Any).__audioLab.liveCost());
    if (cost.banked < 20) failures.push(`bank: only ${cost.banked}/20 keys warmed after ${Math.round(cost.warmMs)} ms`);
    for (const [n, c] of Object.entries(cost.cost) as [string, Any][]) if (c.median > 1) failures.push(`cpu: play('${n}') costs ${c.median.toFixed(2)} ms median after warm-up`);

    // ----------------------------------------------------------- artifacts
    await page.evaluate(() => (window as Any).__audioLab.drawAll([
      { label: 'turnStart · bright', name: 'turnStart', o: { variant: 'bright' } },
      { label: 'conquer · somber', name: 'conquer', o: { variant: 'somber' } },
      { label: 'continent · somber', name: 'continent', o: { variant: 'somber' } },
    ]));
    await page.locator('#all').screenshot({ path: join(OUT, 'spectrograms.png') });
    await page.evaluate(() => (window as Any).__audioLab.drawMusic(60));
    await page.locator('#all').screenshot({ path: join(OUT, 'music.png') });
    await page.click('#analyze');
    await page.waitForFunction(() => /pass|attention/.test(document.getElementById('status')!.textContent ?? ''), null, { timeout: 120000 });
    await page.screenshot({ path: join(OUT, 'lab.png'), fullPage: true });

    const names: string[] = await page.evaluate(() => (window as Any).__audioLab.names);
    for (const n of names) {
      const b64: string = await page.evaluate((name) => (window as Any).__audioLab.wavBase64(name, { seed: 1 }), n);
      writeFileSync(join(WAV, `${n}.wav`), Buffer.from(b64, 'base64'));
    }
    for (const [n, o, file] of [
      ['turnStart', { variant: 'bright', seed: 1 }, 'turnStart-bright'],
      ['conquer', { variant: 'somber', seed: 1 }, 'conquer-somber'],
      ['continent', { variant: 'somber', seed: 1 }, 'continent-somber'],
    ] as [string, Any, string][]) {
      const b64: string = await page.evaluate(([name, opts]) => (window as Any).__audioLab.wavBase64(name, opts), [n, o] as const);
      writeFileSync(join(WAV, `${file}.wav`), Buffer.from(b64, 'base64'));
    }
    writeFileSync(join(WAV, 'dice-roll-5.wav'), Buffer.from(await page.evaluate(() => (window as Any).__audioLab.rollWav()), 'base64'));
    writeFileSync(join(TMP, 'music-30s.wav'), Buffer.from(await page.evaluate(() => (window as Any).__audioLab.musicWav(30)), 'base64'));

    const relevant = consoleProblems.filter((m) => !/Download the React DevTools|\[vite\]/.test(m));
    for (const m of relevant) failures.push(`console ${m}`);

    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), live, warm, reports, composites: comp, variants: vars, bank, cost, sweep, failures }, null, 2));

    // --------------------------------------------------------------- print
    const pad = (s: string, n: number) => s.padEnd(n);
    const lpad = (s: string, n: number) => s.padStart(n);
    console.log(
      pad('sound', 11) + pad('tier', 8) + lpad('target', 7) + lpad('LK200', 7) + lpad('range', 12) + lpad('LUFS-M', 7) + lpad('RMS', 7) + lpad('peak', 7) + lpad('dur', 6) + lpad('onset', 6) + lpad('cent', 6) + lpad('lap%', 5) + lpad('>8k%', 6) + lpad('dc', 9) + lpad('trim', 6) + lpad('sugg', 6),
    );
    for (const r of reports) {
      const m = r.median;
      console.log(
        pad(r.name, 11) + pad(r.tier, 8) + lpad(String(r.target), 7) + lpad(f1(m.lk200), 7) + lpad(`${f1(r.lk200Min)}…${f1(r.lk200Max)}`, 12) + lpad(f1(m.lufsM), 7) + lpad(f1(m.rmsDb), 7) + lpad(f1(r.peakMaxDb), 7) + lpad(String(Math.round(m.durationSec * 1000)), 6) + lpad(f1(m.onsetMs), 6) + lpad(String(Math.round(m.centroidHz)), 6) + lpad(String(Math.round(m.laptopShare * 100)), 5) + lpad((m.hfShare * 100).toFixed(2), 6) + lpad(m.dc.toExponential(1), 9) + lpad(f1(r.trimDb), 6) + lpad(f1(r.suggestedTrimDb), 6),
      );
    }
    console.log(`\n5-die roll: ${f1(roll.lk200)} LUFS, peak ${f1(roll.peakDb)} dBFS`);
    console.log(`stress: requested ${st.requested}, played ${st.played}, dropped ${st.dropped}, stolen ${st.stolen}, max concurrent ${st.maxConcurrent}, peak ${f1(st.peakDb)} dBFS`);
    console.log(`limiter: −20 dBFS sine gain ${comp.limiter.quietGainDb.toFixed(3)} dB · +6 dBFS sine peak ${comp.limiter.loudOutPeak.toFixed(3)}`);
    console.log(`music 60 s: M ${f1(mu.lufsM)} LUFS, peak ${f1(mu.peakDb)} dBFS, min 2 s window ${f1(mu.minWindowDb)} dBFS, centroid ${Math.round(mu.centroidHz)} Hz`);
    console.log('variants:');
    for (const v of vars) console.log(`  ${pad(v.label, 22)} ${f1(v.lk200)} LUFS  peak ${f1(v.peakDb)}  reported ${v.reportedDur.toFixed(3)} s  sound ${Math.round(v.durationSec * 1000)} ms`);
    console.log(`build sweep: ${sweep.length ? sweep.length + ' failures' : 'every sound × variant × rate/duration extreme × 20 seeds built cleanly'}`);
    console.log(`bank: max |Δ loudness| ${Math.max(...bank.map((b) => Math.abs(b.dLk))).toFixed(3)} dB · mono keys ${bank.filter((b) => b.channels === 1).map((b) => b.name).join(', ')}`);
    console.log(`warm-up after unlock: ${Math.round(warm.ms)} ms · unlock-click task ${warm.unlockTaskMs.join(', ') || '<50'} ms (browser audio-device init) · other long tasks: ${warm.otherLongTasksMs.length ? warm.otherLongTasksMs.join(', ') + ' ms' : 'none'}`);
    console.log(`bank keys ${cost.banked} · play() cost median/max (ms): ${Object.entries(cost.cost).map(([n, c]: [string, Any]) => `${n} ${c.median.toFixed(2)}/${c.max.toFixed(2)}`).join(', ')}`);
    console.log(`live: ${JSON.stringify({ state: live.state, played: live.afterAll.played, spamVoices: live.spam.voicesByName, droppedBySpam: live.droppedBySpam, music: [live.musicOn, live.musicOff] })}`);
    console.log(failures.length ? `\nFAIL (${failures.length})\n  ${failures.join('\n  ')}` : '\nPASS — all audio checks');
  } finally {
    await browser.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid);
      } catch {
        /* already gone */
      }
    }
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
