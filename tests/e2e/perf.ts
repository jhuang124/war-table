// Frame-time probe (not part of test:e2e): 1440×900, Metal flags, a blitz-heavy stretch on the real
// board — John blitzes up to seven times, then three AI turns attack him with full dice. Reports fps and
// frame-time percentiles from rAF deltas in the page, plus the renderer's own stats.
// Usage: npx tsx tests/e2e/perf.ts [WxH]   (server on RISK_URL)
import { clickBtn, clickT, idle, loadScenario, open, scenario, state } from './lib';
import { attackTargets, TERRITORY_IDS } from '../../src/engine';

const [W, H] = (process.argv[2] ?? '1440x900').split('x').map(Number);
const DPR = Number(process.env.DPR ?? 1);
const { browser, page, errors } = await open(undefined, { width: W, height: H }, DPR);
const PLAYERS = [
  { name: 'John', color: 'crimson', kind: 'human' },
  { name: 'Cobalt', color: 'cobalt', kind: 'ai', difficulty: 'hard' },
  { name: 'Amber', color: 'amber', kind: 'ai', difficulty: 'hard' },
  { name: 'Rose', color: 'rose', kind: 'ai', difficulty: 'hard' },
] as never;
// John owns Asia with thin garrisons; the AIs around him are stacked, so their turns are blitzes on him.
const asia = ['ural', 'siberia', 'yakutsk', 'kamchatka', 'irkutsk', 'mongolia', 'japan', 'china', 'afghanistan', 'india', 'middle_east', 'siam'];
const s0 = scenario(Object.fromEntries(asia.map((t) => [t, [0, 3]])) as never, { kind: 'attack' }, {
  players: PLAYERS,
  fill: (_t, i) => [1 + (i % 3), 9],
  mutate: (s) => {
    s.territories.ural = { owner: 0, armies: 40 };
    s.territories.china = { owner: 0, armies: 30 };
  },
});
await loadScenario(page, s0);
await page.evaluate(`(() => {
  window.__ft = []; let last = performance.now(); let on = true;
  const f = (t) => { window.__ft.push(t - last); last = t; if (on) requestAnimationFrame(f); };
  requestAnimationFrame(f);
  window.__ftStop = () => { on = false; };
})()`);
const t0 = Date.now();
// Five human blitzes.
for (let k = 0; k < 14; k++) {
  const s = (await state(page))!;
  if (s.phase.kind === 'occupy') {
    await clickBtn(page, 'btn-move');
    await idle(page);
    continue;
  }
  const from = TERRITORY_IDS.filter((t) => s.territories[t].owner === 0 && s.territories[t].armies > 3 && attackTargets(s, t).length > 0).sort(
    (a, b) => s.territories[b].armies - s.territories[a].armies,
  )[0];
  if (!from) break;
  const to = attackTargets(s, from)[0];
  if (!to) break;
  await clickT(page, to);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
}
if ((await state(page))!.phase.kind === 'occupy') {
  await clickBtn(page, 'btn-move');
  await idle(page);
}
await clickBtn(page, 'btn-endTurn');
await page.waitForFunction(
  () => {
    const s = window.__risk.getState();
    return !!s && s.currentPlayer === 0 && window.__risk.isIdle();
  },
  null,
  { timeout: 120_000, polling: 100 },
);
await page.evaluate('window.__ftStop()');
const ft = ((await page.evaluate('window.__ft')) as number[]).slice(2);
const sorted = [...ft].sort((a, b) => a - b);
const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const mean = ft.reduce((a, b) => a + b, 0) / ft.length;
const stats = await page.evaluate(() => window.__risk.stats());
const m = await page.evaluate(() => window.__risk.metrics());
const rolls = m.rolls.filter((r) => r.style === 'full');
console.log(`viewport ${W}x${H} @${DPR}x · ${Math.round((Date.now() - t0) / 1000)} s · ${ft.length} frames · ${rolls.length} full-dice engagements (${rolls.filter((r) => r.blitz).length} blitzes)`);
console.log(`fps ${(1000 / mean).toFixed(1)} · frame ms p50 ${q(0.5).toFixed(1)} · p95 ${q(0.95).toFixed(1)} · p99 ${q(0.99).toFixed(1)} · max ${sorted[sorted.length - 1].toFixed(1)} · frames > 20 ms: ${ft.filter((x) => x > 20).length} · > 33 ms: ${ft.filter((x) => x > 33).length}`);
console.log(`renderer: fps ${stats.fps} · p95 ${stats.frameMsP95} ms · ${stats.drawCalls} draw calls · ${(stats.triangles / 1000).toFixed(0)}k triangles`);
console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
