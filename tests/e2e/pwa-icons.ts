// App icons for the PWA (docs/MOBILE.md §2; a tool, not in test:e2e): renders public/icons/icon.svg
// (the title's ensō, seed 2026, in gold on the indigo paper; no text, no font) to PNG with Playwright.
//   icon-192.png, icon-512.png            purpose "any": rounded square, transparent corners
//   icon-maskable-192.png, -512.png       purpose "maskable": full bleed (the art sits in the safe circle)
//   apple-touch-icon.png (180)            full bleed (iOS rounds it)
//   favicon-64.png
// Usage: npx tsx tests/e2e/pwa-icons.ts
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('public/icons');
const svg = readFileSync(`${DIR}/icon.svg`, 'utf8');

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
const shot = async (file: string, size: number, rounded: boolean) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; background: transparent; }
    .ic { width: ${size}px; height: ${size}px; overflow: hidden; ${rounded ? `border-radius: ${Math.round(size * 0.22)}px;` : ''} }
    .ic svg { width: 100%; height: 100%; display: block; }
  </style></head><body><div class="ic">${svg}</div></body></html>`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${DIR}/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
};
await page.goto('file://' + DIR + '/');
await shot('icon-192.png', 192, true);
await shot('icon-512.png', 512, true);
await shot('icon-maskable-192.png', 192, false);
await shot('icon-maskable-512.png', 512, false);
await shot('apple-touch-icon.png', 180, false);
await shot('favicon-64.png', 64, true);
await browser.close();
