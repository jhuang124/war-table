// Keyboard map (SPEC §7 Input model): Tab/Enter on tiles, 1/2/3 dice, B blitz, Space commit-only,
// E exit, Esc backs out then pauses, L labels, M mute, ? rules. Watched turns: a click only skips.
// Draft claim with a real click. AI narration lines.
import { check, clickT, finish, idle, loadScenario, open, rendered, scenario, state, ui } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();

await loadScenario(page, scenario({ ural: [0, 9], ukraine: [0, 1] }, { kind: 'attack' }));
// Tab cycles clickable tiles (attack sources), with the tooltip; Enter clicks the focused one.
await page.keyboard.press('Tab');
await page.waitForTimeout(50);
let u = await ui(page);
check(u.tooltip?.startsWith('Ural · Attack from here') ?? false, `Tab focus tooltip: ${u.tooltip}`, results);
await page.keyboard.press('Enter');
await page.waitForTimeout(50);
u = await ui(page);
check(u.actionBarText.startsWith('Attacking from Ural (9)'), `Enter clicks the focused tile: ${u.actionBarText}`, results);
await clickT(page, 'siberia');
await page.keyboard.press('2');
await page.waitForTimeout(50);
const dice = await page.locator('[data-testid="dice-2"]').getAttribute('class');
check(/\bon\b/.test(dice ?? ''), 'key 2 sets two dice', results);
// Esc backs out one level at a time, then pauses.
await page.keyboard.press('Escape');
await page.waitForTimeout(30);
u = await ui(page);
check(u.actionBarText.startsWith('Attacking from Ural'), `Esc 1 → source only: ${u.actionBarText}`, results);
await page.keyboard.press('Escape');
await page.waitForTimeout(30);
u = await ui(page);
check(u.actionBarText === 'Attack · click an enemy territory next to yours', `Esc 2 → nothing selected`, results);
await page.keyboard.press('Escape');
await page.waitForTimeout(50);
check((await page.locator('[data-testid="pause"]').count()) === 1, 'Esc 3 → pause menu', results);
await page.keyboard.press('Escape');
await page.waitForTimeout(50);
check((await page.locator('[data-testid="pause"]').count()) === 0, 'Esc closes the pause menu', results);
// ? rules, L labels, M mute.
await page.keyboard.press('?');
await page.waitForTimeout(50);
check((await page.locator('[data-testid="rules"]').count()) === 1, '? opens the rules card', results);
await page.keyboard.press('Escape');
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('risk3d.settings.v1') ?? '{}'));
await page.keyboard.press('l');
await page.keyboard.press('m');
await page.waitForTimeout(50);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('risk3d.settings.v1') ?? '{}'));
check(after.showLabels === !(before.showLabels ?? true) && after.muted === !(before.muted ?? false), `L/M toggle labels (${after.showLabels}) and mute (${after.muted})`, results);
await page.keyboard.press('l');
await page.keyboard.press('m');
// B blitzes an armed attack; Space alone never ends the phase; E = Fortify →.
await clickT(page, 'siberia');
await page.keyboard.press('b');
await idle(page);
let s = await state(page);
check(s!.territories.siberia.owner === 0, 'B blitzed Siberia', results);
if (s!.phase.kind === 'occupy') {
  await page.keyboard.press(' '); // Space confirms the occupy (a commit)
  await idle(page);
  s = await state(page);
  check(s!.phase.kind === 'attack', 'Space confirms occupy', results);
}
await page.keyboard.press('Escape');
await page.keyboard.press(' ');
await page.waitForTimeout(50);
check((await state(page))!.phase.kind === 'attack', 'Space with nothing armed does not end the attack step', results);
await page.keyboard.press('e');
await idle(page);
check((await state(page))!.phase.kind === 'fortify', 'E = Fortify →', results);
u = await ui(page);
check(u.actionBarText === 'Fortify · one move, then your turn ends' && u.primary === 'End turn · draw a card', `fortify: ${u.actionBarText} · ${u.primary}`, results);
// Hints chip toggles line 2 for this seat.
await page.locator('[data-testid="chip-hints"]').click();
await page.waitForTimeout(40);
u = await ui(page);
check(u.hints === false && u.actionBarSub === '', 'Hints off → line 2 empty', results);
await page.locator('[data-testid="chip-hints"]').click();
// Enter = the brass primary (End turn) → AI turns; a click during an AI turn only skips.
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const narr: string[] = [];
const t0 = Date.now();
let clickedDuringAi = false;
while (Date.now() - t0 < 45_000) {
  const st = await state(page);
  if (!st || st.currentPlayer === 0) break;
  const line = (await ui(page)).actionBarText;
  if (!narr.includes(line)) narr.push(line);
  if (!clickedDuringAi && /attacks .+ from .+ · .+ defends/.test(line)) {
    const p0 = st.currentPlayer;
    await clickT(page, 'ural');
    const st2 = await state(page);
    check(st2!.currentPlayer === p0, 'a click during an AI turn does not act for anyone', results);
    clickedDuringAi = true;
  }
  await page.waitForTimeout(60);
}
console.log('   narration:', narr.slice(0, 8).join(' | '));
check(narr.some((l) => /^\w+ (is reinforcing|trades cards and reinforces)$/.test(l)), 'narration: “Cobalt is reinforcing”', results);
check(narr.some((l) => /^\w+ attacks .+ from .+ · \w+ defends$/.test(l)), 'narration: “Cobalt attacks Siam from India · Sam defends”', results);
const m = await page.evaluate(() => window.__risk.metrics());
check(m.inputDropped === 0, `watched-turn click counted as a skip, not dropped (${m.inputDropped})`, results);

// Draft: claim a parchment tile with a real click.
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
check(u.actionBarText === 'Claim a territory · click any parchment tile', `draft line 1: ${u.actionBarText}`, results);
const sd = await state(page);
const free = (Object.keys(sd!.territories) as (keyof NonNullable<typeof sd>['territories'])[]).find((t) => sd!.territories[t].owner === -1)!;
await clickT(page, free);
await page.waitForTimeout(50);
check((await state(page))!.territories[free].owner === 0, `claimed ${free}`, results);

await browser.close();
finish(results, errors);
