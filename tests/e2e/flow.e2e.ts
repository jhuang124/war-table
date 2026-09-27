// Click-through during your own blitz, Space never ends a phase, reload mid-occupy and mid-reinforce.
// Runs with ?timings so the stub board takes the modelled 1× durations (the blitz really takes ~3 s).
import { check, clickBtn, clickT, finish, idle, loadScenario, open, rendered, scenario, state, ui } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();

// --- Click-through during a blitz -----------------------------------------------------------------
await loadScenario(page, scenario({ ural: [0, 30], ukraine: [0, 1] }, { kind: 'attack' }, { mutate: (s) => void (s.territories.siberia.armies = 14) }));
await clickT(page, 'siberia'); // arm (target-first)
await clickBtn(page, 'btn-blitz');
await page.waitForTimeout(350);
const mid = await page.evaluate(() => ({ tweens: window.__risk.stats().activeTweens, idle: window.__risk.isIdle(), battle: window.__risk.ui().battle }));
check(!mid.idle && (mid.tweens ?? 0) > 0, `blitz is animating (activeTweens ${mid.tweens})`, results);
check(!!mid.battle, `battle panel during the blitz: ${mid.battle?.header} · ${mid.battle?.odds}`, results);
const t0 = Date.now();
await clickT(page, 'yakutsk'); // click-through: skip the blitz, then do this click
await page.waitForFunction(() => window.__risk.isIdle(), null, { timeout: 5000 });
const took = Date.now() - t0;
const s1 = await state(page);
const u1 = await ui(page);
check(took < 700, `skipped to the end in ${took} ms`, results);
const performed = s1!.territories.siberia.owner === 0 ? /Yakutsk/.test(u1.actionBarText) : /Yakutsk/.test(u1.actionBarText) || u1.actionBarText.length > 0;
check(performed, `then performed the click: "${u1.actionBarText}"`, results);
const m1 = await page.evaluate(() => window.__risk.metrics());
check(m1.inputDropped === 0, `inputDropped ${m1.inputDropped}`, results);

// Space never ends a phase: in attack with nothing armed, Space does nothing.
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
const before = (await state(page))!.phase.kind;
await page.keyboard.press(' ');
await page.waitForTimeout(100);
check((await state(page))!.phase.kind === before, `Space in ${before} with nothing armed does nothing`, results);
// Enter = the brass primary (fortify step: End turn).
await clickBtn(page, 'btn-fortifyNext');
await idle(page);
const u2 = await ui(page);
check(u2.primary?.startsWith('End turn') ?? false, `fortify primary: ${u2.primary}`, results);

// --- Reload mid-occupy -----------------------------------------------------------------------------
await loadScenario(page, scenario({ ural: [0, 12], ukraine: [0, 1] }, { kind: 'attack' }));
await clickT(page, 'siberia');
await clickBtn(page, 'btn-blitz');
await idle(page);
const so = await state(page);
if (so!.phase.kind === 'occupy') {
  const before = await ui(page);
  await page.reload();
  await page.waitForFunction(() => !!window.__risk);
  await page.locator('[data-testid="title-continue"]').click();
  await page.waitForFunction(() => window.__risk.ui().screen === 'game');
  await idle(page);
  await rendered(page);
  const after = await ui(page);
  check(after.actionBarText === before.actionBarText && after.actionBarText === 'You took Siberia · move armies in', `mid-occupy line 1 restored: ${after.actionBarText}`, results);
  check(after.primary === before.primary && /^Move \d+$/.test(after.primary ?? ''), `occupy primary restored: ${after.primary}`, results);
  const counter = await page.locator('[data-testid="counter"]').textContent();
  check(counter === before.primary!.replace('Move ', ''), `counter shows the smart default (${counter})`, results);
  await page.screenshot({ path: 'artifacts/e2e/resume-occupy.png' });
} else check(false, `expected an occupy step, got ${so!.phase.kind}`, results);

// --- Reload mid-reinforce --------------------------------------------------------------------------
await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, { kind: 'reinforce', remaining: 7, mustTrade: false, placed: {}, midTurn: false }));
await clickT(page, 'ural');
await clickT(page, 'ural');
await clickT(page, 'ukraine');
await idle(page);
const r0 = await ui(page);
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await page.locator('[data-testid="title-continue"]').click();
await page.waitForFunction(() => window.__risk.ui().screen === 'game');
await idle(page);
await rendered(page);
const r1 = await ui(page);
const st = await state(page);
check(r1.actionBarText === r0.actionBarText && r1.actionBarText === 'Place 4 more', `mid-reinforce line 1 restored: ${r1.actionBarText}`, results);
check((st!.phase as { placed: Record<string, number> }).placed.ural === 2, 'placed-this-turn survives the reload (undo still works)', results);
await clickBtn(page, 'btn-undo');
await idle(page);
check((await state(page))!.territories.ukraine.armies === 1, 'Undo after reload takes back the last placement (Ukraine)', results);
await page.screenshot({ path: 'artifacts/e2e/resume-reinforce.png' });

await browser.close();
finish(results, errors);
