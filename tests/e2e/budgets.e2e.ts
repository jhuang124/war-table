// Click budgets with real pointer events, counted by __risk.metrics() (DOM click events). Round 2
// (docs/ROUND2.md §A–B) made board clicks select only and the Turn Track the only phase control, so:
//   all reinforcements on one tile = 2 (click + Place) · leaving Place = 1 (the Attack segment; a board
//   click no longer leaves Place) · attack + conquer from nothing = 2 (+1 Move when there's an occupy
//   step; a board click no longer confirms it) · skip fortify = 1 · End turn from Attack = 1 (skips
//   Fortify) · a typical full turn (place, 3 conquests with occupy, end) = 13 (was 10 / ≤ 12: +1 for the
//   Attack segment, +2 for the Move buttons that replaced the chaining board clicks).
// Also: a 2-way split ≤ 5, rapid stepper presses and a 2-way split never drop input.
import { check, clickBtn, clickT, finish, idle, loadScenario, open, place, rendered, scenario, seg, setCount, state, ui } from './lib';
import type { Phase } from '../../src/engine';

const results: string[] = [];
const reinforce = (remaining: number): Phase => ({ kind: 'reinforce', remaining, mustTrade: false, placed: {}, midTurn: false });

// --- A typical full turn --------------------------------------------------------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, reinforce(8)));
  const clicks = async () => (await page.evaluate(() => window.__risk.metrics())).turns;
  let occupies = 0;
  // Place: tile + Place 8 = 2.
  await clickT(page, 'ural');
  let u = await ui(page);
  check(u.line === 'Place on Ural' && u.primary === 'Place 8' && u.count?.value === 8, `picked: "${u.line}" · ${u.primary} · count ${u.count?.control} ${u.count?.value}`, results);
  await clickBtn(page, 'btn-place');
  let s = await state(page);
  check(s!.territories.ural.armies === 11 && (s!.phase as { remaining: number }).remaining === 0, 'all on one tile in 2 clicks (Ural 11, 0 left)', results);
  u = await ui(page);
  check(u.line === 'All placed · Attack is next' && u.primary === null && u.brass.join() === 'Attack', `all placed: "${u.line}" · brass [${u.brass.join(', ')}]`, results);
  // A board click no longer leaves Place: refused, still Place.
  await clickT(page, 'siberia');
  await page.waitForTimeout(60);
  u = await ui(page);
  check(u.line === 'All armies placed · click Attack to go on' && (await state(page))!.phase.kind === 'reinforce', `enemy click in Place with 0 left is refused: "${u.line}"`, results);
  // Leave Place with the track (1), then conquest 1: target-first click + Blitz = 2.
  await seg(page, 'attack');
  await idle(page);
  await clickT(page, 'siberia');
  u = await ui(page);
  check(u.primary === 'Blitz' && u.battle?.header.startsWith('URAL 11 vs') === true && /^Ural → Siberia · \d+%( · .+)?$/.test(u.line), `armed from nothing: "${u.line}" · tray ${u.battle?.header}`, results);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  s = await state(page);
  check(s!.phase.kind === 'occupy' && s!.territories.siberia.owner === 0, 'Siberia taken, occupy step up', results);
  u = await ui(page);
  check(u.line === 'Move into Siberia' && /^Move \d+$/.test(u.primary ?? '') && u.trackDisabled, `occupy: "${u.line}" · ${u.primary} · track disabled`, results);
  // A board click during occupy is refused (it no longer confirms the move).
  await clickT(page, 'yakutsk');
  await page.waitForTimeout(60);
  u = await ui(page);
  s = await state(page);
  check(s!.phase.kind === 'occupy' && u.line === 'Finish moving armies into Siberia first', `board click in occupy refused: "${u.line}"`, results);
  // Move (1): the conquered tile is the source if it can keep attacking.
  await clickBtn(page, 'btn-move');
  occupies++;
  await idle(page);
  u = await ui(page);
  check(u.line === 'Attack from Siberia · click an enemy', `after Move, Siberia is the source: ${u.line}`, results);
  // Conquest 2: target + Blitz (+ Move).
  await clickT(page, 'yakutsk');
  u = await ui(page);
  check(/^Siberia → Yakutsk/.test(u.line), `chained: ${u.line}`, results);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  if ((await state(page))!.phase.kind === 'occupy') {
    await clickBtn(page, 'btn-move');
    occupies++;
    await idle(page);
  }
  // Conquest 3.
  await clickT(page, 'kamchatka');
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  s = await state(page);
  check(s!.territories.kamchatka.owner === 0, 'three conquests', results);
  if (s!.phase.kind === 'occupy') {
    await clickBtn(page, 'btn-move');
    occupies++;
  }
  await idle(page);
  u = await ui(page);
  check(u.step === 'Attack' && u.track.includes('eligible:endTurn') && u.track.includes('eligible:fortify'), `attack step, track ${u.track.join(' ')}`, results);
  // End turn from Attack: 1 click, skips Fortify.
  await seg(page, 'endTurn');
  await page.waitForFunction(() => window.__risk.metrics().turns.length > 0);
  const t = (await clicks())[0];
  const want = 2 + 1 + 3 * 2 + occupies + 1;
  // The two refused probe clicks above are counted (and rejected); the turn's own budget excludes them.
  const own = t.clicks - t.rejected;
  check(t.kind === 'human' && own <= 13 && t.rejected === 2, `typical turn = ${own} clicks (budget ≤ 13) + ${t.rejected} refused probes, forced wait ${t.forcedWaitMs} ms`, results);
  check(own === want, `exactly 2 + Attack + 3 × 2 + ${occupies} Move + End turn = ${want} (${own})`, results);
  check(t.forcedWaitMs === 0, 'forced wait 0 on your own turn', results);
  await page.screenshot({ path: 'artifacts/e2e/budget-turn-end.png' });
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

// --- A 2-way split ≤ 5; from Place, the Fortify segment goes straight there; skip fortify = 1 --------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 2], afghanistan: [0, 1] }, reinforce(9)));
  await place(page, 'ural', 6);
  await place(page, 'ukraine');
  await page.waitForTimeout(150);
  const s = await state(page);
  check(s!.territories.ural.armies === 9 && s!.territories.ukraine.armies === 5, `6/3 split: Ural ${s!.territories.ural.armies}, Ukraine ${s!.territories.ukraine.armies} (count to 6 + Place, then Ukraine + Place)`, results);
  let u = await ui(page);
  check(u.brass.join() === 'Attack' && u.track.join(' ') === 'current:place eligible:attack eligible:fortify eligible:endTurn', `all placed: track ${u.track.join(' ')}`, results);
  // Fortify from Place: one click chains Place → Attack → Fortify.
  await seg(page, 'fortify');
  await idle(page);
  u = await ui(page);
  check((await state(page))!.phase.kind === 'fortify' && u.line === 'Move armies once, or end your turn' && u.brass.join() === 'End turn', `fortify: "${u.line}" · brass [${u.brass.join(', ')}]`, results);
  await page.evaluate(() => window.__risk.resetMetrics());
  await seg(page, 'endTurn');
  await page.waitForFunction(() => window.__risk.metrics().turns.length > 0);
  const t = (await page.evaluate(() => window.__risk.metrics())).turns[0];
  check(t.clicks === 1, `skip fortify = ${t.clicks} click`, results);
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

// --- The 2-way split's own click count, counted on a fresh turn ----------------------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 2] }, reinforce(5)));
  // 5 options → stepper: pick + one − + Place 4, then pick + Place (all that's left) = 5.
  await clickT(page, 'ural');
  await setCount(page, 4);
  await clickBtn(page, 'btn-place');
  await clickT(page, 'ukraine');
  await clickBtn(page, 'btn-place');
  await page.waitForTimeout(150);
  const s = await state(page);
  await seg(page, 'endTurn');
  await page.waitForFunction(() => window.__risk.metrics().turns.length > 0);
  const t = (await page.evaluate(() => window.__risk.metrics())).turns[0];
  check(s!.territories.ural.armies === 7 && s!.territories.ukraine.armies === 3, `4/1 split: Ural ${s!.territories.ural.armies}, Ukraine ${s!.territories.ukraine.armies}`, results);
  check(t.clicks - 1 <= 5, `2-way split = ${t.clicks - 1} clicks (budget ≤ 5; + End turn)`, results);
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

// --- 10 quick stepper presses land exactly; nothing dropped ---------------------------------------------
{
  const { browser, page, errors } = await open();
  // 6 options → the − N + stepper (> 6 would be a slider).
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, reinforce(6)));
  await rendered(page);
  await clickT(page, 'ural');
  let u = await ui(page);
  check(u.count?.control === 'stepper' && u.count.value === 6, `6 to place: ${u.count?.control} ${u.count?.value}`, results);
  const presses = ['dec', 'dec', 'dec', 'dec', 'dec', 'inc', 'inc', 'inc', 'dec', 'dec'];
  const t0 = Date.now();
  for (const p of presses) {
    await clickBtn(page, `count-${p}`);
    await page.waitForTimeout(60);
  }
  const ms = Date.now() - t0;
  u = await ui(page);
  check(u.count?.value === 2 && u.primary === 'Place 2', `10 presses (−5 +3 −2) in ${ms} ms → stepper ${u.count?.value} · ${u.primary}`, results);
  await clickBtn(page, 'btn-place');
  await place(page, 'ukraine');
  await idle(page);
  const s = await state(page);
  const m = await page.evaluate(() => window.__risk.metrics());
  u = await ui(page);
  check(s!.territories.ural.armies === 5 && s!.territories.ukraine.armies === 5, `Ural ${s!.territories.ural.armies} (+2), Ukraine ${s!.territories.ukraine.armies} (+4)`, results);
  check(m.inputDropped === 0, `inputDropped ${m.inputDropped}`, results);
  check(u.line === 'All placed · Attack is next', `the line matches: ${u.line}`, results);
  await page.screenshot({ path: 'artifacts/e2e/rapid-stepper.png' });
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

finish(results, []);
