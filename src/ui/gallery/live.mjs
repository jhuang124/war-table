// Drive the real app (renderer + controller + this UI) and screenshot the UI at key beats.
//   node src/ui/gallery/live.mjs [--port 5282] [--size 1440x900] [--text tv]
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = args.port ?? 5282;
const [W, H] = String(args.size ?? '1440x900').split('x').map(Number);
const out = `artifacts/ui/live-${W}x${H}${args.text ? '-' + args.text : ''}`;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  const ui = await page.evaluate(() => window.__risk.ui());
  console.log(`${name}: [${ui.screen}] "${ui.actionBarText}" | "${ui.actionBarSub}" | primary=${ui.primary} | battle=${ui.battle ? ui.battle.header + ' ' + (ui.battle.odds ?? '') : '-'} | banners=${ui.banners.join('/')} recap=${ui.recap.join('/')}`);
};
const idle = (ms = 15000) => page.evaluate((t) => window.__risk.waitIdle(t), ms).catch(() => {});

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => !!window.__risk, null, { timeout: 30000 });
await page.waitForTimeout(2500);
if (args.text) await page.evaluate((t) => window.__risk.intent?.({ type: 'setting', patch: { textSize: t } }), args.text);
await shot('01-title');

await page.evaluate(() =>
  window.__risk.newGame({
    players: [
      { name: 'John', color: 'crimson', kind: 'human' },
      { name: 'Sam', color: 'cobalt', kind: 'ai', difficulty: 'normal' },
      { name: 'Amber', color: 'amber', kind: 'ai', difficulty: 'normal' },
      { name: 'Rose', color: 'rose', kind: 'ai', difficulty: 'normal' },
    ],
    seed: 7,
    setupMode: 'random',
    initialPlacement: 'auto',
  }),
);
await page.waitForTimeout(400);
await shot('02-start');
// Let AI turns play until it's John's reinforce.
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => { const s = window.__risk.getState(); return s ? { p: s.currentPlayer, ph: s.phase.kind } : null; });
  if (st && st.p === 0 && st.ph === 'reinforce') break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(300);
await shot('03-turn-banner');
await idle();
await page.waitForTimeout(1600);
await shot('04-reinforce');

const click = async (t, button = 'left') => {
  const p = await page.evaluate((id) => window.__risk.screenPos(id), t);
  if (!p) return false;
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  return true;
};
// Pick an own border territory with an enemy neighbor.
const pick = await page.evaluate(() => {
  const s = window.__risk.getState();
  const mine = Object.entries(s.territories).filter(([, v]) => v.owner === 0).map(([k]) => k);
  return mine;
});
await click(pick[0]);
await page.waitForTimeout(400);
await shot('05-placed-one-pills');
const all = await page.$('.pills .pill:nth-child(2)');
if (all) await all.click();
await page.waitForTimeout(500);
await shot('06-all-placed');

// Hover a tile for the tooltip
const enemy = await page.evaluate(() => {
  const s = window.__risk.getState();
  const e = Object.entries(s.territories).find(([k, v]) => v.owner !== 0 && window.__risk.explain(k).ok);
  return e ? e[0] : null;
});
if (enemy) {
  const p = await page.evaluate((id) => window.__risk.screenPos(id), enemy);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(700);
  await shot('07-tooltip');
  await click(enemy);
  await page.waitForTimeout(600);
  await shot('08-armed');
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  await shot('09-blitz-mid');
  await idle();
  await page.waitForTimeout(400);
  await shot('10-after-blitz');
}
await page.evaluate(() => window.__risk.dispatch && null);
await page.mouse.move(W / 2, 40);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('11-esc');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// Log drawer
const logBtn = await page.$('.rail-btn:nth-of-type(1)');
await page.click('.rail > .rail-btn');
await page.waitForTimeout(400);
await shot('12-log');
await page.click('.rail > .rail-btn');
// End turn via E and watch AIs
await page.keyboard.press('e');
await page.waitForTimeout(300);
await page.keyboard.press('e');
await page.waitForTimeout(1500);
await shot('13-ai-turn');
await page.waitForTimeout(2500);
await shot('14-ai-turn-later');

// Autoplay to victory
await page.evaluate(() => { window.__risk.setSpeed(0, 'instant'); window.__risk.autoplay(true); });
for (let i = 0; i < 240; i++) {
  const sc = await page.evaluate(() => window.__risk.ui().screen);
  if (sc === 'victory') break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(800);
await shot('15-victory-intro');
await page.waitForTimeout(3500);
await shot('16-victory');
console.log(`errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
await b.close();
