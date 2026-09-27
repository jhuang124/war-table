// The keyboard is a hidden accelerator (docs/SIMPLIFY.md §2): Enter = the brass primary, Space =
// Blitz / confirm (never a phase exit), Esc = back one level, then the menu. Nothing on screen names a
// key. Watched turns: a click only skips. Draft claim with a real click. AI narration lines.
import { check, clickT, finish, idle, loadScenario, open, rendered, scenario, state, ui } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();

// Place: pick a tile, Space = Place N; Enter = Attack →.
await loadScenario(page, scenario({ ural: [0, 9], ukraine: [0, 1] }, { kind: 'reinforce', remaining: 4, mustTrade: false, placed: {}, midTurn: false }));
await clickT(page, 'ural');
await page.keyboard.press(' ');
await idle(page);
let s = await state(page);
let u = await ui(page);
check(s!.territories.ural.armies === 13 && u.primary === 'Attack →', `Space placed all 4 (Ural ${s!.territories.ural.armies}); primary ${u.primary}`, results);
await page.keyboard.press('Enter');
await idle(page);
check((await state(page))!.phase.kind === 'attack', 'Enter = Attack →', results);

// Attack: Esc backs out one level at a time, then opens the menu.
await clickT(page, 'siberia');
u = await ui(page);
check(u.buttons.join(' / ') === 'Roll / Blitz', `armed: ${u.buttons.join(' / ')}`, results);
await page.keyboard.press('Escape');
await page.waitForTimeout(40);
u = await ui(page);
check(u.line === 'Attack from Ural · click an enemy', `Esc 1 → source only: ${u.line}`, results);
await page.keyboard.press('Escape');
await page.waitForTimeout(40);
u = await ui(page);
check(u.line === 'Click an enemy territory to attack', `Esc 2 → nothing picked: ${u.line}`, results);
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
check((await page.locator('[data-testid="pause"]').count()) === 1, 'Esc 3 → the menu', results);
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
check((await page.locator('[data-testid="pause"]').count()) === 0, 'Esc closes the menu', results);

// Space blitzes an armed attack and confirms the occupy; Space with nothing armed never ends a step.
await clickT(page, 'siberia');
await page.keyboard.press(' ');
await idle(page);
s = await state(page);
check(s!.territories.siberia.owner === 0, 'Space blitzed Siberia', results);
if (s!.phase.kind === 'occupy') {
  await page.keyboard.press(' ');
  await idle(page);
  s = await state(page);
  check(s!.phase.kind === 'attack', 'Space confirms the occupy', results);
}
await page.keyboard.press('Escape');
await page.keyboard.press(' ');
await page.waitForTimeout(80);
check((await state(page))!.phase.kind === 'attack', 'Space with nothing armed does not end the attack step', results);

// No keycaps anywhere on the HUD.
const kbd = await page.evaluate(() => [...document.querySelectorAll('#ui .hud kbd, #ui .overlays kbd')].filter((k) => (k as HTMLElement).offsetParent).length);
check(kbd === 0, `no keycaps on screen (${kbd})`, results);

// Enter = the brass primary (End turn) → AI turns; a click during an AI turn only skips.
// (Nothing is selected here, so another Esc would open the menu — Enter must then do nothing.)
u = await ui(page);
check(u.primary === 'End turn', `nothing armed: primary ${u.primary}`, results);
await page.keyboard.press('Enter');
// Wait for the turn to actually pass before sampling the AI narration.
await page.waitForFunction(() => (window.__risk.getState()?.currentPlayer ?? 0) !== 0, null, { timeout: 8000 });
const narr: string[] = [];
const steps = new Set<string>();
const t0 = Date.now();
let clickedDuringAi = false;
while (Date.now() - t0 < 60_000) {
  const st = await state(page);
  if (!st || st.currentPlayer === 0) break;
  const uu = await ui(page);
  if (!narr.includes(uu.line)) narr.push(uu.line);
  steps.add(uu.step);
  if (!clickedDuringAi && / attacks /.test(uu.line)) {
    const p0 = st.currentPlayer;
    await clickT(page, 'ural');
    const st2 = await state(page);
    check(st2!.currentPlayer === p0, 'a click during an AI turn does not act for anyone', results);
    clickedDuringAi = true;
  }
  await page.waitForTimeout(60);
}
console.log('   narration:', narr.slice(0, 8).join(' | '));
check(narr.some((l) => /^\w+ (is reinforcing|is placing armies|trades cards)$/.test(l)), 'narration: “Cobalt is reinforcing”', results);
check(narr.some((l) => /^\w+ attacks [\w ]+$/.test(l)), 'narration: “Cobalt attacks Siam”', results);
check([...steps].some((x) => /^\w+'s turn$/.test(x)), `step indicator names the AI seat (${[...steps].join(', ')})`, results);
const m = await page.evaluate(() => window.__risk.metrics());
check(m.inputDropped === 0, `watched-turn click counted as a skip, not dropped (${m.inputDropped})`, results);

// Draft: claim an open tile with a real click.
await page.evaluate(() => {
  window.__risk.newGame({
    players: [
      { name: 'John', color: 'crimson', kind: 'human' },
      { name: 'Cobalt', color: 'cobalt', kind: 'ai', difficulty: 'normal' },
    ],
    setupMode: 'draft',
    initialPlacement: 'auto',
    seed: 5,
  });
});
await page.waitForFunction(() => {
  const s = window.__risk.getState();
  return !!s && s.phase.kind === 'setup-claim' && s.currentPlayer === 0 && window.__risk.isIdle();
});
await rendered(page);
u = await ui(page);
check(u.line === 'Claim a territory · click an open tile' && u.step === 'Setup', `draft: [${u.step}] ${u.line}`, results);
const sd = await state(page);
const free = (Object.keys(sd!.territories) as (keyof NonNullable<typeof sd>['territories'])[]).find((t) => sd!.territories[t].owner === -1)!;
await clickT(page, free);
await page.waitForTimeout(80);
check((await state(page))!.territories[free].owner === 0, `claimed ${free}`, results);

await browser.close();
finish(results, errors);
