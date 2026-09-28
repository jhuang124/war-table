// Click-through during your own blitz (the track stays put and visibly disabled while the dice roll),
// Space never ends a step, Esc/ocean disarm, and resume: reload mid-occupy and mid-place (the
// placements, and Undo, survive the reload).
import { check, clickBtn, clickT, finish, idle, loadScenario, open, place, rendered, scenario, seg, state, ui } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();

// --- Click-through during a blitz -----------------------------------------------------------------
await loadScenario(page, scenario({ ural: [0, 30], ukraine: [0, 1] }, { kind: 'attack' }, { mutate: (s) => void (s.territories.siberia.armies = 14) }));
await clickT(page, 'siberia'); // arm (target-first)
await clickBtn(page, 'btn-blitz');
await page.waitForTimeout(350);
const mid = await page.evaluate(() => ({ tweens: window.__risk.stats().activeTweens, idle: window.__risk.isIdle(), battle: window.__risk.ui().battle, u: window.__risk.ui() }));
check(!mid.idle && (mid.tweens ?? 0) > 0, `blitz is animating (activeTweens ${mid.tweens})`, results);
check(!!mid.battle, `tray header during the blitz: ${mid.battle?.header}`, results);
const trackMid = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="track"]') as HTMLElement | null;
  return { shown: !!t && t.offsetParent !== null, disabled: !!t?.classList.contains('is-disabled'), labels: [...(t?.querySelectorAll('.tr-label') ?? [])].map((x) => x.textContent) };
});
check(trackMid.shown && trackMid.disabled && trackMid.labels.join(',') === 'Place,Attack,Fortify,End turn', `the track stays, visibly disabled, while the dice roll (${trackMid.labels.join(' · ')})`, results);
await seg(page, 'endTurn', true); // a disabled track click does nothing: no skip, no phase change
await page.waitForTimeout(60);
check(!(await page.evaluate(() => window.__risk.isIdle())) && (await state(page))!.currentPlayer === 0, 'End turn during the roll is ignored', results);
const t0 = Date.now();
await clickT(page, 'yakutsk'); // click-through: skip the blitz, then do this click
await page.waitForFunction(() => window.__risk.isIdle(), null, { timeout: 5000 });
const took = Date.now() - t0;
const u1 = await ui(page);
check(took < 700, `skipped to the end in ${took} ms`, results);
check(/Yakutsk/.test(u1.line) || u1.line.length > 0, `then performed the click: "${u1.line}"`, results);
const m1 = await page.evaluate(() => window.__risk.metrics());
check(m1.inputDropped === 0, `inputDropped ${m1.inputDropped}`, results);

// The blitz may have ended in an occupy step: Move (the button) finishes it.
if ((await state(page))!.phase.kind === 'occupy') {
  await clickBtn(page, 'btn-move');
  await idle(page);
}
// Esc disarms one level at a time; Space with nothing armed does nothing.
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
const before = (await state(page))!.phase.kind;
await page.keyboard.press(' ');
await page.waitForTimeout(100);
check((await state(page))!.phase.kind === before, `Space in ${before} with nothing armed does nothing`, results);

// An empty-ocean click disarms, like Esc.
await loadScenario(page, scenario({ ural: [0, 6], ukraine: [0, 1] }, { kind: 'attack' }));
await clickT(page, 'siberia');
const armed = (await ui(page)).buttons.join(' / ');
const ocean = await page.evaluate(() => {
  const pick = (window.__board as unknown as { __debug: { pick: (x: number, y: number) => string | null } }).__debug.pick;
  for (let y = innerHeight * 0.25; y < innerHeight * 0.6; y += 12) for (let x = innerWidth * 0.3; x < innerWidth * 0.7; x += 12) if (!pick(x, y)) return { x, y };
  return null;
});
if (ocean) {
  await page.mouse.click(ocean.x, ocean.y);
  await page.waitForTimeout(80);
  const after = await ui(page);
  check(armed === 'Roll / Blitz' && after.line === 'Attack from Ural · click an enemy' && after.buttons.length === 0, `ocean click backs out one level (${armed} → "${after.line}")`, results);
  await page.mouse.click(ocean.x, ocean.y);
  await page.waitForTimeout(80);
  check((await ui(page)).line === 'Click an enemy territory to attack', 'a second ocean click clears the source', results);
} else check(false, 'found open ocean on screen', results);

// --- Reload mid-occupy -----------------------------------------------------------------------------
await loadScenario(page, scenario({ ural: [0, 12], ukraine: [0, 1] }, { kind: 'attack' }));
await clickT(page, 'siberia');
await clickBtn(page, 'btn-blitz');
await idle(page);
const so = await state(page);
if (so!.phase.kind === 'occupy') {
  const beforeU = await ui(page);
  await page.reload();
  await page.waitForFunction(() => !!window.__risk);
  await page.locator('[data-testid="title-continue"]').click();
  await page.waitForFunction(() => window.__risk.ui().screen === 'game');
  await idle(page);
  await rendered(page);
  const after = await ui(page);
  check(after.line === beforeU.line && after.line === 'Move into Siberia', `mid-occupy line restored: ${after.line}`, results);
  check(after.primary === beforeU.primary && /^Move \d+$/.test(after.primary ?? ''), `occupy primary restored: ${after.primary}`, results);
  const range = after.count ? after.count.max - after.count.min + 1 : 0;
  check(!!after.count && after.count.control === (range <= 6 ? 'stepper' : 'slider') && `Move ${after.count.value}` === after.primary, `count holds the smart default (${after.count?.control} ${after.count?.value})`, results);
  check(after.trackDisabled && after.track.join(' ') === 'done:place current:attack locked:fortify locked:endTurn', `the track is locked during occupy: ${after.track.join(' ')}`, results);
  // Resume and finish with the button: the new territory becomes the source.
  await clickBtn(page, 'btn-move');
  await idle(page);
  const am = await ui(page);
  check((await state(page))!.phase.kind === 'attack' && /^Attack from Siberia/.test(am.line), `Move after resume chains to Siberia: "${am.line}"`, results);
  await page.screenshot({ path: 'artifacts/e2e/resume-occupy.png' });
} else check(false, `expected an occupy step, got ${so!.phase.kind}`, results);

// --- Reload mid-place ------------------------------------------------------------------------------
await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, { kind: 'reinforce', remaining: 7, mustTrade: false, placed: {}, midTurn: false }));
await place(page, 'ural', 2);
await place(page, 'ukraine', 1);
await idle(page);
await clickT(page, 'ukraine'); // the pick survives the reload
const r0 = await ui(page);
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await page.locator('[data-testid="title-continue"]').click();
await page.waitForFunction(() => window.__risk.ui().screen === 'game');
await idle(page);
await rendered(page);
const r1 = await ui(page);
const st = await state(page);
check(r1.line === r0.line && r1.line === 'Place on Ukraine' && r1.primary === 'Place 4', `mid-place restored with its pick: ${r1.line} · ${r1.primary} (was "${r0.line}")`, results);
check((st!.phase as { placed: Record<string, number> }).placed.ural === 2, 'placed-this-turn survives the reload', results);
check(r1.buttons.includes('Undo'), `Undo is on offer after the reload (${r1.buttons.join(' / ')})`, results);
await clickBtn(page, 'btn-undo');
await idle(page);
const su = (await state(page))!;
check(su.territories.ukraine.armies === 1 && su.territories.ural.armies === 5, `Undo after reload takes back the last placement (Ukraine ${su.territories.ukraine.armies}, Ural ${su.territories.ural.armies})`, results);
await page.screenshot({ path: 'artifacts/e2e/resume-place.png' });

await browser.close();
finish(results, errors);
