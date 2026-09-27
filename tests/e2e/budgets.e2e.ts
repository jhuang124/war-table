// SPEC §10 click budgets with real pointer events, counted by __risk.metrics() (DOM click events).
//   all reinforcements on one tile = 2 · a 2-way split ≤ 5 · attack + conquer from nothing = 2 (+0 occupy
//   when chaining) · skip fortify = 1 · a typical full turn (reinforce, 3 conquests, end) ≤ 12.
// Also: 10 clicks in 1.5 s on one tile = +10 (with modelled animation durations, so drops overlap).
import { check, clickBtn, clickT, finish, idle, loadScenario, open, rendered, scenario, state, ui } from './lib';
import type { Phase } from '../../src/engine';

const results: string[] = [];
const reinforce = (remaining: number): Phase => ({ kind: 'reinforce', remaining, mustTrade: false, placed: {}, midTurn: false });

// --- A typical full turn --------------------------------------------------------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, reinforce(8)));
  const clicks = async () => (await page.evaluate(() => window.__risk.metrics())).turns;
  // Reinforce: tile + All = 2.
  await clickT(page, 'ural');
  await page.locator('[data-testid="pill-all"]').click();
  let s = await state(page);
  check(s!.territories.ural.armies === 11 && (s!.phase as { remaining: number }).remaining === 0, 'all on one tile in 2 clicks (Ural 11, 0 left)', results);
  // Conquest 1: target-first click (implicit exit from reinforce) + Blitz = 2.
  await clickT(page, 'siberia');
  let u = await ui(page);
  check(u.primary === 'Blitz' && u.battle?.header.startsWith('JOHN URAL 11 vs'), `armed from nothing: "${u.actionBarText}" · ${u.battle?.odds}`, results);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  s = await state(page);
  check(s!.phase.kind === 'occupy' && s!.territories.siberia.owner === 0, 'Siberia taken, occupy step up', results);
  u = await ui(page);
  check(/^You took Siberia · move armies in$/.test(u.actionBarText), `occupy line: ${u.actionBarText}`, results);
  // Conquest 2: a board click confirms the default occupy and chains (0 extra) + Blitz.
  await clickT(page, 'yakutsk');
  await idle(page); // the default occupy marches in (400 ms), then the click arms the next attack
  u = await ui(page);
  check(/^Attack Yakutsk from Siberia/.test(u.actionBarText), `chained: ${u.actionBarText}`, results);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  // Conquest 3.
  await clickT(page, 'kamchatka');
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  s = await state(page);
  check(s!.territories.kamchatka.owner === 0, 'three conquests', results);
  // Finish: confirm the last occupy (Move) and End turn (skip fortify = 1).
  if (s!.phase.kind === 'occupy') await clickBtn(page, 'btn-move');
  await idle(page);
  u = await ui(page);
  check(u.buttons.some((b) => b.label === 'End turn · draw a card'), 'End turn · draw a card is on offer', results);
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

// --- 2-way split ≤ 5, and skip fortify = 1 from the fortify step -------------------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 2], afghanistan: [0, 1] }, reinforce(9)));
  await clickT(page, 'ural');
  await page.locator('[data-testid="pill-plus5"]').click();
  for (let i = 0; i < 3; i++) await clickT(page, 'ukraine');
  const s = await state(page);
  check(s!.territories.ural.armies === 9 && s!.territories.ukraine.armies === 5, '6/3 split in 5 clicks (tile, +5, tile ×3)', results);
  await clickBtn(page, 'btn-beginAttack');
  await clickBtn(page, 'btn-fortifyNext');
  await idle(page);
  const u = await ui(page);
  check(u.primary === 'End turn · no card', `fortify primary: ${u.primary}`, results);
  await page.evaluate(() => window.__risk.resetMetrics());
  await clickBtn(page, 'btn-endTurn');
  await page.waitForFunction(() => window.__risk.metrics().turns.length > 0);
  const t = (await page.evaluate(() => window.__risk.metrics())).turns[0];
  check(t.clicks === 1, `skip fortify = ${t.clicks} click`, results);
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

// --- 10 clicks in 1.5 s = exactly +10 (modelled drop animations overlap) -----------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3] }, reinforce(12)));
  await rendered(page);
  const pos = await page.evaluate(() => window.__risk.screenPos('ural'));
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    await page.mouse.click(pos!.x, pos!.y);
    await page.waitForTimeout(140);
  }
  const ms = Date.now() - t0;
  const s = await state(page);
  const m = await page.evaluate(() => window.__risk.metrics());
  const u = await ui(page);
  check(s!.territories.ural.armies === 13, `10 clicks in ${ms} ms → Ural ${s!.territories.ural.armies} (+10)`, results);
  check(m.inputDropped === 0, `inputDropped ${m.inputDropped}`, results);
  check(u.actionBarText === 'Place 2 more', `line 1 matches: ${u.actionBarText}`, results);
  await page.screenshot({ path: 'artifacts/e2e/rapid-10.png' });
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

finish(results, []);
