// Shared Playwright helpers for the e2e flows. `npm run test:e2e` starts a dev server on :5290 and runs
// every flow against the REAL board (src/render) and REAL HUD (src/ui). Run one flow by hand with:
//   npx vite --port 5290 --strictPort --host 127.0.0.1 &   npx tsx tests/e2e/<flow>.e2e.ts
// RISK_URL overrides the server; RISK_QUERY adds URL flags (e.g. '?stub&debughud' for the stand-ins).
// Clicks go through real pointer events at __risk.screenPos(t).

import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';

export const BASE = process.env.RISK_URL ?? 'http://127.0.0.1:5290/';
/** URL flags for every flow; '' = the real renderer + real UI. */
export const Q = process.env.RISK_QUERY ?? '';
export const ART = 'artifacts/e2e';
mkdirSync(ART, { recursive: true });

export interface Ctx {
  browser: Browser;
  page: Page;
  errors: string[];
}

export async function open(query = Q, viewport = { width: 1440, height: 900 }, deviceScaleFactor = 1): Promise<Ctx> {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  // tsx (esbuild keepNames) wraps named functions inside page.evaluate callbacks in __name(); give the
  // page a no-op so callbacks can use local helper functions.
  await page.addInitScript('window.__name = (f) => f');
  await page.goto(BASE + query);
  await page.waitForFunction(() => !!(window as unknown as { __risk?: unknown }).__risk);
  return { browser, page, errors };
}

export async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
}

/** Real pointer click at a territory's badge anchor. */
export async function clickT(page: Page, t: string, opts: { button?: 'left' | 'right'; modifiers?: ('Shift' | 'Alt')[] } = {}): Promise<void> {
  const pos = await page.evaluate((id) => window.__risk.screenPos(id as never), t);
  if (!pos) throw new Error(`no screen position for ${t}`);
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.click(pos.x, pos.y, { button: opts.button ?? 'left' });
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
}

export async function clickBtn(page: Page, testid: string): Promise<void> {
  await page.locator(`[data-testid="${testid}"]`).first().click();
}

export async function idle(page: Page, ms = 20000): Promise<void> {
  await page.evaluate((t) => window.__risk.waitIdle(t), ms);
}

export async function ui(page: Page) {
  return page.evaluate(() => window.__risk.ui());
}

export async function state(page: Page) {
  return page.evaluate(() => window.__risk.getState());
}

export function check(cond: unknown, msg: string, results: string[]): void {
  const line = `${cond ? 'PASS' : 'FAIL'} ${msg}`;
  results.push(line);
  console.log(line);
}

export function finish(results: string[], errors: string[]): never {
  const fails = results.filter((r) => r.startsWith('FAIL'));
  if (errors.length) console.log('Console errors:\n  ' + errors.join('\n  '));
  console.log(`\n${results.length - fails.length}/${results.length} passed, ${errors.length} console errors`);
  process.exit(fails.length || errors.length ? 1 : 0);
}

export const ONE_HUMAN = [
  { name: 'John', color: 'crimson', kind: 'human' },
  { name: 'Cobalt', color: 'cobalt', kind: 'ai', difficulty: 'normal' },
  { name: 'Amber', color: 'amber', kind: 'ai', difficulty: 'normal' },
  { name: 'Rose', color: 'rose', kind: 'ai', difficulty: 'normal' },
];

export const TWO_HUMANS = [
  { name: 'John', color: 'crimson', kind: 'human' },
  { name: 'Sam', color: 'cobalt', kind: 'human' },
];

// ---------------------------------------------------------------------------
// Scenarios: build a GameState in Node, save it, reload, press Continue (the real resume path).
// ---------------------------------------------------------------------------

import { TERRITORY_IDS, createGame, type GameState, type Phase, type TerritoryId } from '../../src/engine';

export function scenario(
  own: Partial<Record<TerritoryId, [number, number]>>,
  phase: Phase,
  opts: { players?: typeof ONE_HUMAN; fill?: (t: TerritoryId, i: number) => [number, number]; mutate?: (s: GameState) => void } = {},
): GameState {
  const { state } = createGame({
    players: (opts.players ?? ONE_HUMAN) as never,
    setupMode: 'random',
    initialPlacement: 'auto',
    setupBatch: 5,
    cardBonus: 'progressive',
    fortifyRule: 'connected',
    dominationPercent: 70,
    turnLimit: null,
    seed: 1234,
  });
  const n = state.players.length;
  TERRITORY_IDS.forEach((t, i) => {
    state.territories[t] = opts.fill ? { owner: opts.fill(t, i)[0], armies: opts.fill(t, i)[1] } : { owner: 1 + (i % (n - 1)), armies: 1 };
  });
  for (const [t, v] of Object.entries(own)) state.territories[t as TerritoryId] = { owner: v![0], armies: v![1] };
  state.currentPlayer = 0;
  state.firstPlayer = 0;
  state.phase = phase;
  state.round = 2;
  state.turn = 5;
  state.conqueredThisTurn = false;
  for (const p of state.players) {
    p.cards = [];
    p.setupArmies = 0;
  }
  opts.mutate?.(state);
  return state;
}

export async function loadScenario(page: Page, s: GameState, opts: { waitIdle?: boolean; settings?: Record<string, unknown> } = {}): Promise<void> {
  await page.evaluate(
    ([st, settings]) => {
      localStorage.clear();
      localStorage.setItem('risk3d.save.v1', JSON.stringify({ v: 1, savedAt: Date.now(), state: st }));
      if (settings) localStorage.setItem('risk3d.settings.v1', JSON.stringify(settings));
    },
    [s as unknown as Record<string, unknown>, opts.settings ?? null] as const,
  );
  await page.reload();
  await page.waitForFunction(() => !!window.__risk);
  await page.locator('[data-testid="title-continue"]').click();
  await page.waitForFunction(() => window.__risk.ui().screen === 'game' && !!window.__risk.getState());
  const loaded = await page.evaluate(() => window.__risk.getState()?.id);
  if (loaded !== s.id) console.log(`   (scenario ${s.id} did not load; the page has ${loaded})`);
  if (opts.waitIdle === false) return;
  await idle(page);
  await rendered(page);
  await page.evaluate(() => window.__risk.resetMetrics());
}

/** Wait until the HUD has painted the game screen (the first frames after a reload can lag). */
export async function rendered(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hud = document.querySelector('[data-hud="debug"]');
    if (!hud) return !!document.querySelector('#ui *:not(#boot-splash)');
    return !!document.querySelector('[data-testid="actionbar"]');
  });
  // The real board eases from the attract orbit to the home view on Continue/Start; board events wait
  // for that move, so let it land before a flow starts timing things.
  await page.waitForFunction(() => !window.__risk.stats().cameraMoving, null, { timeout: 5000 }).catch(() => undefined);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
