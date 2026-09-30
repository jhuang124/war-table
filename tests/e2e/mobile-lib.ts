// Mobile helpers (docs/MOBILE.md §8): Playwright device emulation (hasTouch / isMobile) on Chromium with
// the GPU flags, CDP safe-area insets (notch / Dynamic Island / home indicator), taps through
// page.touchscreen, long-press and pinch through CDP Input.dispatchTouchEvent, and the "never scrolls,
// never zooms" probe. Flows import from here and from ./lib.

import { devices, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { BASE, Q, launchBrowser, prepareContext } from './lib';

export type DeviceName = 'iphone' | 'iphone-land' | 'iphone-pwa' | 'iphone-pwa-land' | 'pixel' | 'pixel-land' | 'ipad' | 'ipad-land';

/** Emulated device + the safe-area insets its real screen has (Safari, not standalone). */
export const DEVICES: Record<DeviceName, { desc: (typeof devices)[string]; safe: { top: number; right: number; bottom: number; left: number } }> = {
  // In Safari (not installed) the browser bars cover the notch and the home indicator.
  iphone: { desc: devices['iPhone 15 Pro'], safe: { top: 0, right: 0, bottom: 0, left: 0 } },
  'iphone-land': { desc: devices['iPhone 15 Pro landscape'], safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  // Installed (Add to Home Screen, display: standalone / fullscreen): the whole screen, notch and all.
  'iphone-pwa': { desc: { ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 852 } }, safe: { top: 59, right: 0, bottom: 34, left: 0 } },
  'iphone-pwa-land': { desc: { ...devices['iPhone 15 Pro landscape'], viewport: { width: 852, height: 393 } }, safe: { top: 0, right: 59, bottom: 21, left: 59 } },
  pixel: { desc: devices['Pixel 7'], safe: { top: 24, right: 0, bottom: 0, left: 0 } },
  'pixel-land': { desc: devices['Pixel 7 landscape'], safe: { top: 0, right: 0, bottom: 0, left: 24 } },
  ipad: { desc: devices['iPad Pro 11'], safe: { top: 24, right: 0, bottom: 20, left: 0 } },
  'ipad-land': { desc: devices['iPad Pro 11 landscape'], safe: { top: 24, right: 0, bottom: 20, left: 0 } },
};

export interface MCtx {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  errors: string[];
  device: DeviceName;
}

export async function openDevice(device: DeviceName, opts: { query?: string; safe?: boolean; browser?: Browser } = {}): Promise<MCtx> {
  const browser = opts.browser ?? (await launchBrowser());
  const d = DEVICES[device];
  // Chromium stands in for Mobile Safari: keep the device's viewport, DPR, touch and mobile flags.
  const { defaultBrowserType: _ignored, ...desc } = d.desc as typeof d.desc & { defaultBrowserType?: string };
  const context = await browser.newContext({ ...desc });
  await prepareContext(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  if (opts.safe !== false) await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: d.safe } as never).catch(() => undefined);
  await page.goto(BASE + (opts.query ?? Q));
  await page.waitForFunction(() => !!(window as unknown as { __risk?: unknown }).__risk);
  return { browser, context, page, cdp, errors, device };
}

/** Tap the centre of a test id (a real touch through page.touchscreen). */
export async function tapId(page: Page, testid: string): Promise<void> {
  const loc = page.locator(`[data-testid="${testid}"]`).first();
  await loc.waitFor({ state: 'visible', timeout: 5000 });
  // A control below the fold of a scrolling list (never the document) is scrolled to first.
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
  // Like a real thumb: tap once it has stopped moving (a sheet may still be rising).
  await loc
    .evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          let last = '';
          let same = 0;
          const t0 = performance.now();
          const tick = () => {
            const r = el.getBoundingClientRect();
            const k = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
            same = k === last ? same + 1 : 0;
            last = k;
            if (same >= 2 || performance.now() - t0 > 1500) resolve();
            else requestAnimationFrame(tick);
          };
          tick();
        }),
    )
    .catch(() => undefined);
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${testid}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Tap a territory's army piece. */
export async function tapT(page: Page, t: string): Promise<void> {
  const pos = await page.evaluate((id) => window.__risk.screenPos(id as never), t);
  if (!pos) throw new Error(`no screen position for ${t}`);
  await page.touchscreen.tap(pos.x, pos.y);
}

/** Press and hold one finger (CDP touch), `ms` long, then lift. Returns what `during` saw mid-hold. */
export async function longPress<T>(ctx: MCtx, x: number, y: number, ms = 650, during?: () => Promise<T>): Promise<T | undefined> {
  const pt = [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
  await ctx.page.waitForTimeout(ms);
  const seen = during ? await during() : undefined;
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return seen;
}

/** Two-finger pinch around (cx, cy): the fingers go from `from` px apart to `to` px apart. */
export async function pinch(ctx: MCtx, cx: number, cy: number, from: number, to: number, steps = 8): Promise<void> {
  const at = (d: number) => [
    { x: cx - d / 2, y: cy, id: 1 },
    { x: cx + d / 2, y: cy, id: 2 },
  ];
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from) });
  for (let i = 1; i <= steps; i++) {
    await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from + ((to - from) * i) / steps) });
    await ctx.page.waitForTimeout(16);
  }
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** One-finger drag (pan). */
export async function drag(ctx: MCtx, x0: number, y0: number, x1: number, y1: number, steps = 10): Promise<void> {
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, id: 1 }] });
    await ctx.page.waitForTimeout(16);
  }
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Wait until nothing under `selector` is animating (a sheet has finished rising). */
export async function settleAnims(page: Page, selector: string): Promise<void> {
  await page
    .waitForFunction((q) => [...document.querySelectorAll(q)].every((el) => el.getAnimations({ subtree: true }).every((a) => a.playState !== 'running')), selector, { timeout: 2000 })
    .catch(() => undefined);
}

/** Drag a sheet down by its grab handle (touch), far enough to dismiss it. */
export async function dragSheetDown(ctx: MCtx, testid: string, dy = 260): Promise<void> {
  // Let the sheet finish rising first (its box moves while it slides in).
  await ctx.page.waitForFunction((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return !!el && el.getAnimations().every((a) => a.playState !== 'running');
  }, testid, { timeout: 2000 }).catch(() => undefined);
  const box = await ctx.page.locator(`[data-testid="${testid}"]`).first().boundingBox();
  if (!box) throw new Error(`no sheet ${testid}`);
  const x = box.x + box.width / 2;
  const y = box.y + 14;
  await drag(ctx, x, y, x, y + dy, 12);
}

/** The document never scrolls or zooms: scroll offsets are 0 and the visual viewport is 1:1. */
export async function pageStill(page: Page): Promise<{ ok: boolean; detail: string }> {
  return page.evaluate(() => {
    const se = document.scrollingElement!;
    const vv = window.visualViewport;
    const d = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      top: se.scrollTop,
      docH: se.scrollHeight,
      winH: window.innerHeight,
      docW: se.scrollWidth,
      winW: window.innerWidth,
      scale: vv ? vv.scale : 1,
    };
    const ok = d.scrollX === 0 && d.scrollY === 0 && d.top === 0 && d.docH <= d.winH + 1 && d.docW <= d.winW + 1 && Math.abs(d.scale - 1) < 0.01;
    return { ok, detail: JSON.stringify(d) };
  });
}

/** Every visible control inside the HUD / sheets is at least `min` px in both directions. */
export async function smallTargets(page: Page, scope = '.ui-root', min = 44): Promise<string[]> {
  return page.evaluate(
    ([q, m]) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(`${q} button, ${q} [role="button"], ${q} [role="slider"], ${q} input`)) {
        if (el.offsetParent === null || el.closest('.hidden, .off')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        // A target's hit area may be padded past its box by ::after (hit slop); read it off the element.
        const slop = Number(el.dataset.slop ?? 0);
        if (r.width + slop < m || r.height + slop < m) out.push(`${el.dataset.testid ?? el.className.split(' ')[0]} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return out;
    },
    [scope, min] as const,
  );
}

/** Wait for the HUD to be laid out (fonts, first measure) and one idle frame. */
export async function settle(page: Page, ms = 250): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
}
