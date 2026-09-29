// Screenshot every gallery fixture. Usage:
//   node src/ui/gallery/shoot.mjs [--port 5282] [--size 1440x900] [--text tv] [--only id,id] [--bg mood] [--out artifacts/ui/r1]
// Also reports console errors and a few layout checks (strip rect, min font size, clipped lines, words).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []),
);
const port = args.port ?? 5282;
const [W, H] = String(args.size ?? '1440x900').split('x').map(Number);
const text = args.text ?? null;
const out = args.out ?? `artifacts/ui/${W}x${H}${text ? '-' + text : ''}`;
fs.mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/ui-gallery.html`;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${base}?state=place`);
await page.waitForFunction(() => window.__gallery?.ready);
let ids = await page.evaluate(() => window.__gallery.ids);
if (args.only) ids = String(args.only).split(',');

const report = [];
for (const id of ids) {
  const url = `${base}?state=${id}${text ? `&text=${text}` : ''}${args.bg ? `&bg=${args.bg}` : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__gallery?.ready);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(id.startsWith('victory-full') ? 2600 : id === 'victory' ? 900 : 650);
  const file = path.join(out, `${id}.png`);
  const clip = args.clip ? (() => { const [x, y, w, h] = String(args.clip).split(',').map(Number); return { x, y, width: w, height: h }; })() : undefined;
  await page.screenshot({ path: file, clip });
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.strip');
    const r = bar && getComputedStyle(document.querySelector('.hud')).visibility !== 'hidden' ? bar.getBoundingClientRect() : null;
    // smallest visible font size among text-bearing elements in the UI
    let min = 999;
    let minEl = '';
    for (const el of document.querySelectorAll('.ui-root *')) {
      if (!(el instanceof HTMLElement)) continue;
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.getClientRects().length === 0) continue;
      let p = el;
      let hidden = false;
      while (p) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') { hidden = true; break; }
        p = p.parentElement;
      }
      if (hidden) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < min) { min = fs; minEl = `${el.className || el.tagName}: ${el.textContent.trim().slice(0, 30)}`; }
    }
    // the line overflowing its box (ellipsis)
    const clipped = [...document.querySelectorAll('.strip .ln-text:not(.ln-ghost)')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'none')
      .map((e) => e.textContent.slice(0, 50));
    // words on screen in the strips and the tray header
    const words = ['.topstrip', '.strip', '.battle:not(.hidden)']
      .map((q) => document.querySelector(q))
      .filter((e) => e && e.offsetParent !== null)
      .map((e) => e.innerText)
      .join(' ')
      .split(/\s+/)
      .filter((w) => /[A-Za-z0-9]/.test(w)).length;
    return { bar: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') : null, minFont: min, minEl, clipped, words };
  });
  report.push({ id, ...m });
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ size: `${W}x${H}`, text, errors, report }, null, 2));
const bars = new Set(report.filter((r) => r.bar).map((r) => r.bar));
console.log(`shots: ${report.length} → ${out}`);
console.log(`strip rects: ${[...bars].join(' | ')}`);
console.log(`words: ${report.map((r) => `${r.id} ${r.words}`).join(' · ')}`);
console.log(`min font: ${Math.min(...report.map((r) => r.minFont))}px`);
for (const r of report) if (r.minFont < (text === 'tv' ? 20 : 13) || r.clipped.length) console.log(`  ${r.id}: min ${r.minFont}px (${r.minEl}) clipped: ${r.clipped.join(' / ')}`);
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  ' + e);
await browser.close();
