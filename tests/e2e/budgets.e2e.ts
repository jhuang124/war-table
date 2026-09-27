// Click budgets with real pointer events, counted by __risk.metrics() (DOM click events):
//   all reinforcements on one tile = 2 (click + Place, or a double-click) · attack + conquer from nothing
//   = 2 (+0 occupy when chaining) · skip fortify = 1 · a typical full turn (place, 3 conquests, end) ≤ 12.
// Also: rapid stepper presses and a 2-way split never drop input.
import { check, clickBtn, clickT, dblT, finish, idle, loadScenario, open, place, rendered, scenario, state, ui } from './lib';
import type { Phase } from '../../src/engine';

const results: string[] = [];
const reinforce = (remaining: number): Phase => ({ kind: 'reinforce', remaining, mustTrade: false, placed: {}, midTurn: false });

// --- A typical full turn --------------------------------------------------------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, reinforce(8)));
  const clicks = async () => (await page.evaluate(() => window.__risk.metrics())).turns;
  // Place: tile + Place 8 = 2.
  await clickT(page, 'ural');
  let u = await ui(page);
  check(u.line === 'Place on Ural' && u.primary === 'Place 8' && u.count?.value === 8, `picked: "${u.line}" · ${u.primary} · stepper ${u.count?.value}`, results);
  await clickBtn(page, 'btn-place');
  let s = await state(page);
  check(s!.territories.ural.armies === 11 && (s!.phase as { remaining: number }).remaining === 0, 'all on one tile in 2 clicks (Ural 11, 0 left)', results);
  u = await ui(page);
  check(u.line === 'All placed · attack next' && u.primary === 'Attack →', `all placed: "${u.line}" · ${u.primary}`, results);
  // Conquest 1: target-first click (implicit exit from Place) + Blitz = 2.
  await clickT(page, 'siberia');
  u = await ui(page);
  check(u.primary === 'Blitz' && u.battle?.header.startsWith('URAL 11 vs') === true && /^Attack Siberia from Ural · \d+%$/.test(u.line), `armed from nothing: "${u.line}" · tray ${u.battle?.header}`, results);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  s = await state(page);
  check(s!.phase.kind === 'occupy' && s!.territories.siberia.owner === 0, 'Siberia taken, occupy step up', results);
  u = await ui(page);
  check(u.line === 'Move armies into Siberia' && /^Move \d+$/.test(u.primary ?? ''), `occupy: "${u.line}" · ${u.primary}`, results);
  // Conquest 2: a board click confirms the default occupy and chains (0 extra) + Blitz.
  await clickT(page, 'yakutsk');
  await idle(page);
  u = await ui(page);
  check(/^Attack Yakutsk from Siberia/.test(u.line), `chained: ${u.line}`, results);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  // Conquest 3.
  await clickT(page, 'kamchatka');
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  s = await state(page);
  check(s!.territories.kamchatka.owner === 0, 'three conquests', results);
  if (s!.phase.kind === 'occupy') await clickBtn(page, 'btn-move');
  await idle(page);
  u = await ui(page);
  check(u.primary === 'End turn' && u.buttons.includes('Fortify →'), `nothing armed: ${u.buttons.join(' / ')}`, results);
  await clickBtn(page, 'btn-endTurn');
  await page.waitForFunction(() => window.__risk.metrics().turns.length > 0);
  const t = (await clicks())[0];
  check(t.kind === 'human' && t.clicks <= 12, `typical turn = ${t.clicks} clicks (budget ≤ 12), rejected ${t.rejected}, forced wait ${t.forcedWaitMs} ms`, results);
  check(t.clicks === 10, 'exactly 2 + 2 + 2 + 2 + Move + End turn = 10', results);
  check(t.forcedWaitMs === 0, 'forced wait 0 on your own turn', results);
  await page.screenshot({ path: 'artifacts/e2e/budget-turn-end.png' });
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

// --- A 2-way split, a double-click, and skip fortify = 1 from the fortify step --------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 2], afghanistan: [0, 1] }, reinforce(9)));
  await place(page, 'ural', 6);
  await dblT(page, 'ukraine');
  await page.waitForTimeout(150);
  const s = await state(page);
  check(s!.territories.ural.armies === 9 && s!.territories.ukraine.armies === 5, `6/3 split: Ural ${s!.territories.ural.armies}, Ukraine ${s!.territories.ukraine.armies} (stepper to 6 + Place, then a double-click)`, results);
  await clickBtn(page, 'btn-attack');
  await clickBtn(page, 'btn-fortify');
  await idle(page);
  const u = await ui(page);
  check(u.primary === 'End turn' && u.line === 'Move armies once, or end your turn', `fortify: "${u.line}" · ${u.primary}`, results);
  await page.evaluate(() => window.__risk.resetMetrics());
  await clickBtn(page, 'btn-endTurn');
  await page.waitForFunction(() => window.__risk.metrics().turns.length > 0);
  const t = (await page.evaluate(() => window.__risk.metrics())).turns[0];
  check(t.clicks === 1, `skip fortify = ${t.clicks} click`, results);
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

// --- 10 quick stepper presses = exactly −10; nothing dropped -----------------------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, reinforce(12)));
  await rendered(page);
  await clickT(page, 'ural');
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    await clickBtn(page, 'count-dec');
    await page.waitForTimeout(60);
  }
  const ms = Date.now() - t0;
  let u = await ui(page);
  check(u.count?.value === 2 && u.primary === 'Place 2', `10 presses in ${ms} ms → stepper ${u.count?.value} · ${u.primary}`, results);
  await clickBtn(page, 'btn-place');
  await dblT(page, 'ukraine');
  await idle(page);
  const s = await state(page);
  const m = await page.evaluate(() => window.__risk.metrics());
  u = await ui(page);
  check(s!.territories.ural.armies === 5 && s!.territories.ukraine.armies === 11, `Ural ${s!.territories.ural.armies} (+2), Ukraine ${s!.territories.ukraine.armies} (+10)`, results);
  check(m.inputDropped === 0, `inputDropped ${m.inputDropped}`, results);
  check(u.line === 'All placed · attack next', `the line matches: ${u.line}`, results);
  await page.screenshot({ path: 'artifacts/e2e/rapid-stepper.png' });
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

finish(results, []);
