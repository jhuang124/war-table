// "Place your own" (manual placement) with 1 human + 3 AIs, from the title through real clicks: two
// passes of the same Place pattern (pick, stepper, Place N, Undo, a double-click for the rest, Done),
// AI setup turns as one short beat each, no hand-off cover, then round 1. Budget: ≤ 1 min in total
// (SPEC §10), measured here with instant human clicks, so the rest is the AIs' share.
import { ART, check, clearStorage, clickBtn, clickT, dblT, finish, open, place, rendered, state, ui } from './lib';
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
    check(u.line === `Place ${n} armies · click a territory` && u.step === 'Setup', `[${u.step}] ${u.line}`, results);
    check(u.primary === null && u.buttons.length === 0, `nothing picked: no buttons (${u.buttons.join(' / ')})`, results);
    check((await page.locator('[data-testid="handoff"]').count()) === 0, 'no hand-off cover during setup', results);
  }
  const own = TERRITORY_IDS.filter((t) => s.territories[t].owner === 0);
  await clickT(page, own[0]);
  u = await ui(page);
  if (passes === 0) check(u.primary === `Place ${n}` && u.count?.value === n, `picked: stepper ${u.count?.value} · ${u.primary}`, results);
  await page.waitForTimeout(420);
  await place(page, own[0], 2);
  await clickBtn(page, 'btn-undo');
  u = await ui(page);
  check(u.count?.value === n && !u.buttons.includes('Undo'), `placed 2, Undo took them back: stepper ${u.count?.value} · ${u.buttons.join(' / ')}`, results);
  await place(page, own[0], 1);
  const eng = (await state(page))!;
  check(eng.territories[own[0]].armies === s.territories[own[0]].armies, 'staging does not touch the engine', results);
  await dblT(page, own[1]);
  await page.waitForTimeout(100);
  u = await ui(page);
  check(u.line === `All ${n} placed` && u.primary === 'Done', `${u.line} · primary ${u.primary}`, results);
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
