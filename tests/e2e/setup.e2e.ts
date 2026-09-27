// "Place your own" (manual placement) with 1 human + 3 AIs, from the title through real clicks:
// two passes of staged placement (click, right-click takes one back, pill All, Confirm placement),
// AI setup turns as one short beat each, no hand-off cover, then round 1. Budget: ≤ 1 min in total
// (SPEC §10), measured here with instant human clicks, so the rest is the AIs' share.
import { ART, check, clearStorage, clickBtn, clickT, finish, open, rendered, state, ui } from './lib';
import { TERRITORY_IDS } from '../../src/engine';

const results: string[] = [];
const { browser, page, errors } = await open();
await clearStorage(page);
await page.reload();
await page.waitForFunction(() => window.__risk?.ui().screen === 'title');
await clickBtn(page, 'title-new');
await page.locator('[data-testid="seat-name-0"]').fill('John');
await page.locator('[data-testid="seat-name-0"]').press('Enter');
await clickBtn(page, 'setup-placeOwn');
await page.waitForFunction(() => document.querySelector('[data-testid="ng-summary"]')?.textContent?.includes('your own'), null, { timeout: 2000 }).catch(() => undefined);
const summary = await page.locator('[data-testid="ng-summary"]').textContent();
check(summary === 'Territories dealt at random · you place your own armies · first to 30 territories wins', `summary: ${summary}`, results);
const t0 = Date.now();
await clickBtn(page, 'ng-start');

let passes = 0;
let aiSetupMs = 0;
let lastHumanDone = Date.now();
for (let guard = 0; guard < 10; guard++) {
  await page.waitForFunction(
    () => {
      const s = window.__risk.getState();
      return !!s && window.__risk.isIdle() && (s.phase.kind !== 'setup-place' || s.currentPlayer === 0);
    },
    null,
    { timeout: 60_000, polling: 50 },
  );
  aiSetupMs += Date.now() - lastHumanDone;
  const s = (await state(page))!;
  if (s.phase.kind !== 'setup-place') break;
  await rendered(page);
  const n = s.phase.toPlace;
  let u = await ui(page);
  if (passes === 0) {
    check(u.actionBarText === `Place ${n} armies · ${n} left`, `line 1: ${u.actionBarText}`, results);
    check(u.primary === null && u.buttons.some((b) => b.label === 'Confirm placement' && !b.enabled && b.why === `Place ${n} more`), 'Confirm placement is disabled with “Place N more”', results);
    check((await page.locator('[data-testid="handoff"]').count()) === 0, 'no hand-off cover during setup', results);
  }
  const own = TERRITORY_IDS.filter((t) => s.territories[t].owner === 0);
  await clickT(page, own[0]);
  await clickT(page, own[0]);
  await clickT(page, own[0], { button: 'right' });
  u = await ui(page);
  check(u.actionBarText === `Place ${n} armies · ${n - 1} left`, `staged 2, took 1 back: ${u.actionBarText}`, results);
  const eng = (await state(page))!;
  check(eng.territories[own[0]].armies === s.territories[own[0]].armies, 'staging does not touch the engine', results);
  await clickT(page, own[1]);
  await page.locator('[data-testid="pill-all"]').click();
  u = await ui(page);
  check(u.actionBarText === `All ${n} placed · Confirm placement` && u.primary === 'Confirm placement', `${u.actionBarText} · primary ${u.primary}`, results);
  if (passes === 0) await page.screenshot({ path: `${ART}/setup-staged.png` });
  await page.keyboard.press('Enter');
  lastHumanDone = Date.now();
  passes++;
}
const s = (await state(page))!;
const total = Date.now() - t0;
check(s.phase.kind === 'reinforce' && s.round === 1, `setup done → round 1 ${s.phase.kind} (${passes} human passes)`, results);
check(passes === 2, 'two passes of manual placement (setupBatch auto)', results);
check(total <= 60_000, `manual setup, 1 human + 3 AI: ${Math.round(total / 1000)} s total, AI share ${Math.round(aiSetupMs / 1000)} s (≤ 1 min)`, results);
await browser.close();
finish(results, errors);
