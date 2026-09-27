// All-AI autoplay to victory: zero console errors, the strip's line never empty, ≤ 1 banner at any
// sample, never a turn banner (no seat is played by a human), and the victory screen appears.
// Usage: npx tsx tests/e2e/autoplay.e2e.ts [query] [aiSpeed]   (default '?stub&debughud' 'fast')
import { Q, check, clearStorage, finish, open } from './lib';

const query = process.argv[2] ?? Q;
const speed = (process.argv[3] ?? 'fast') as 'watch' | 'fast' | 'instant';
const results: string[] = [];
const { browser, page, errors } = await open(query);
await clearStorage(page);
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await page.evaluate(
  (sp) => {
    window.__risk.setSpeed(1, sp);
    window.__risk.autoplay(true);
    window.__risk.newGame({
      players: [
        { name: 'John', color: 'crimson', kind: 'human' },
        { name: 'Sam', color: 'cobalt', kind: 'human' },
        { name: 'Amber', color: 'amber', kind: 'ai', difficulty: 'normal' },
        { name: 'Rose', color: 'rose', kind: 'ai', difficulty: 'hard' },
      ],
      dominationPercent: 70,
      turnLimit: null,
      seed: 2026,
    });
  },
  speed,
);
// Sample inside the page every 50 ms so nothing is missed between round trips. (A string, because
// tsx's keepNames helpers don't exist in the page.)
type Res = { samples: number; empty: number; maxBanners: number; maxToasts: number; screen: string; ms: number; emptyAt: string[] };
const res = (await page.evaluate(`new Promise((resolve) => {
  const t0 = performance.now();
  let samples = 0, empty = 0, maxBanners = 0, maxToasts = 0;
  const emptyAt = [];
  function tick() {
    const u = window.__risk.ui();
    if (u.screen === 'game') {
      samples++;
      if (!u.line) { empty++; if (emptyAt.length < 5) emptyAt.push(JSON.stringify(window.__risk.getState() && window.__risk.getState().phase)); }
      maxBanners = Math.max(maxBanners, u.banners.length);
      if (u.banners.some((b) => / TURN( · |$)/.test(b))) maxToasts++;
    }
    if (u.screen === 'victory' || performance.now() - t0 > 420000) {
      resolve({ samples, empty, maxBanners, maxToasts, screen: u.screen, ms: Math.round(performance.now() - t0), emptyAt });
      return;
    }
    setTimeout(tick, 50);
  }
  tick();
})`)) as Res;
const st = await page.evaluate(() => window.__risk.getState());
console.log(res, 'round', st?.round);
check(res.screen === 'victory', `reached victory in ${Math.round(res.ms / 1000)} s (round ${st?.round})`, results);
check(res.samples > 100, `${res.samples} samples`, results);
check(res.empty === 0, `the line is never empty (${res.empty} empty) ${res.emptyAt.join(' ')}`, results);
check(res.maxBanners <= 1, `≤ 1 banner at a time (max ${res.maxBanners})`, results);
check(res.maxToasts === 0, `no turn banners for AI-driven seats (${res.maxToasts} samples)`, results);
await page.waitForTimeout(1800);
const vic = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="victory"]');
  const text = el ? (el.textContent ?? '') : document.getElementById('ui')?.innerText ?? '';
  const m = text.match(/[A-Z' ]+RULES THE WORLD/);
  return m ? m[0] : text.slice(0, 200);
});
check(/RULES THE WORLD/.test(vic), `victory screen: ${vic.trim()}`, results);
await page.screenshot({ path: `artifacts/e2e/autoplay-victory${query.includes('debughud') ? '' : '-ui'}.png` });
await browser.close();
finish(results, errors);
