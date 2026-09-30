// PWA (docs/MOBILE.md §2, §8 "Lighthouse-style"): builds the game into artifacts/pwa/dist, serves it
// under /war-table/ (the GitHub Pages subpath) and checks, on an emulated Pixel 7:
//   the manifest is valid (name, display, start_url/scope relative, 192 + 512 + maskable icons that load
//   at their stated sizes), apple-touch-icon + theme colour + viewport-fit meta are present;
//   the service worker registers, activates and controls the page;
//   offline, a reload still boots the game to the title (and a new game starts);
//   back online, a changed index.html is picked up on the next reload (network-first: never stuck).
// Needs no dev server (the runner's is ignored).
import { chromium, devices } from 'playwright';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { check, finish } from './lib';

const results: string[] = [];
const OUT = 'artifacts/pwa/dist';
const b = spawnSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], { encoding: 'utf8' });
check(b.status === 0, `production build into ${OUT}`, results);
if (b.status !== 0) {
  console.log(b.stdout, b.stderr);
  finish(results, []);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
let indexMarker = '';
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith('/war-table/')) {
    res.writeHead(404).end('not here');
    return;
  }
  const raw = decodeURIComponent(url.pathname.slice('/war-table/'.length));
  const rel = !raw || raw.endsWith('/') ? `${raw}index.html` : normalize(raw);
  const file = join(OUT, rel);
  if (!file.startsWith(OUT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  let body: Buffer | string = readFileSync(file);
  if (rel === 'index.html' && indexMarker) body = body.toString().replace('<title>War Table</title>', `<title>War Table ${indexMarker}</title>`);
  // Like GitHub Pages: short HTTP caching on everything.
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' });
  res.end(body);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;
const ROOT = `http://127.0.0.1:${port}/war-table/`;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const { defaultBrowserType: _d, ...pixel } = devices['Pixel 7'] as (typeof devices)[string] & { defaultBrowserType?: string };
const context = await browser.newContext({ ...pixel });
const page = await context.newPage();
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(ROOT);
await page.waitForFunction(() => window.__risk?.ui().screen === 'title', null, { timeout: 20000 });

// Manifest + head
const head = await page.evaluate(async () => {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const m = link ? await (await fetch(link.href)).json() : null;
  const icons: { src: string; sizes: string; purpose?: string; w: number; h: number }[] = [];
  for (const ic of m?.icons ?? []) {
    const url = new URL(ic.src, link!.href).href;
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => undefined);
    icons.push({ ...ic, w: img.naturalWidth, h: img.naturalHeight });
  }
  const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  let appleSize = 0;
  if (apple) {
    const img = new Image();
    img.src = apple.href;
    await img.decode().catch(() => undefined);
    appleSize = img.naturalWidth;
  }
  return {
    href: link?.getAttribute('href'),
    m,
    icons,
    appleSize,
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
    theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
    capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content') ?? '',
    status: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? '',
  };
});
const m = head.m;
check(!!m && head.href === './manifest.webmanifest', `manifest linked relatively (${head.href})`, results);
check(m?.name === 'War Table' && m?.short_name === 'War Table', `name / short_name: ${m?.name} / ${m?.short_name}`, results);
check(m?.display === 'fullscreen' && (m?.display_override ?? []).includes('standalone'), `display fullscreen, standalone fallback`, results);
check(m?.start_url === './' && m?.scope === './' && m?.orientation === 'any', `start_url ${m?.start_url}, scope ${m?.scope}, orientation ${m?.orientation}`, results);
check(/^#/.test(m?.background_color ?? '') && /^#/.test(m?.theme_color ?? ''), `dark theme / background colours ${m?.theme_color} ${m?.background_color}`, results);
const png = head.icons.filter((i) => i.sizes !== 'any');
const ok = (s: string, p: string) => png.some((i) => i.sizes === s && (i.purpose ?? 'any') === p && i.w === Number(s.split('x')[0]) && i.h === Number(s.split('x')[1]));
check(ok('192x192', 'any') && ok('512x512', 'any') && ok('512x512', 'maskable'), `icons load at their sizes: ${png.map((i) => `${i.sizes}/${i.purpose}=${i.w}`).join(', ')}`, results);
check(head.appleSize === 180, `apple-touch-icon 180 (${head.appleSize})`, results);
check(/viewport-fit=cover/.test(head.viewport) && /user-scalable=no/.test(head.viewport), `viewport: ${head.viewport}`, results);
check(!!head.theme && head.capable === 'yes' && head.status === 'black-translucent', `theme-color ${head.theme}, apple capable ${head.capable}, status bar ${head.status}`, results);

// Service worker
const sw = await page.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 15000))]);
  return reg ? { scope: reg.scope, active: reg.active?.state ?? null, script: reg.active?.scriptURL ?? '' } : null;
});
check(!!sw && sw.active === 'activated' && sw.scope === ROOT && sw.script === ROOT + 'sw.js', `service worker active at ${sw?.scope} (${sw?.active})`, results);
// Wait for the precache to fill, and for the page to be controlled.
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const c = await caches.open(keys.find((k) => k.startsWith('war-table-'))!);
  return { keys, n: (await c.keys()).length };
});
check(cached.keys.some((k) => /^war-table-[0-9a-f]{12}$/.test(k)) && cached.n >= 15, `versioned cache ${cached.keys.join(',')} holds ${cached.n} files`, results);

// Offline reload
await context.setOffline(true);
await page.reload();
const offlineBoot = await page
  .waitForFunction(() => window.__risk?.ui().screen === 'title', null, { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check(offlineBoot, 'offline: a reload boots the game to the title', results);
if (offlineBoot) {
  await page.evaluate(() => window.__risk.newGame());
  const started = await page
    .waitForFunction(() => window.__risk.ui().screen === 'game' && !!document.querySelector('canvas'), null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(started, 'offline: a new game starts on the 3D board', results);
}

// Back online: a new index.html is used on the next reload (updates are never blocked by the cache).
await context.setOffline(false);
indexMarker = 'v2';
await page.reload();
await page.waitForFunction(() => !!window.__risk, null, { timeout: 20000 });
const title = await page.title();
check(title === 'War Table v2', `online: the updated index.html wins at once (title "${title}")`, results);

await browser.close();
server.close();
finish(results, errors);
