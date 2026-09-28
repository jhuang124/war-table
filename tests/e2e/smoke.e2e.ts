// Smoke: title → new game via the HUD → first human turn; the Turn Track is up; screenshot.
import { ART, check, clearStorage, clickBtn, finish, idle, open, state, ui } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();
await clearStorage(page);
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await page.screenshot({ path: `${ART}/smoke-title.png` });
const u0 = await ui(page);
check(u0.screen === 'title', `title screen (${u0.screen})`, results);
await clickBtn(page, 'title-new');
await page.screenshot({ path: `${ART}/smoke-newgame.png` });
// One colour emblem per seat; the defaults are crimson, cobalt, amber, emerald.
const emblems = await page.locator('[data-testid^="seat-color-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid).filter((id) => /^seat-color-\d+$/.test(id ?? '')));
check(emblems.length >= 2, `one colour emblem per seat (${emblems.join(', ')})`, results);
await clickBtn(page, 'ng-start');
await page.waitForTimeout(300);
await idle(page, 60000).catch(() => undefined);
const u1 = await ui(page);
console.log(JSON.stringify(u1, null, 2));
check(u1.screen === 'game', 'in game', results);
check(u1.line.length > 0, `the line: ${u1.line}`, results);
const s1 = await state(page);
const colors = s1!.players.map((p) => p.color).join(', ');
check(colors === 'crimson, cobalt, amber, emerald', `default seat colours: ${colors}`, results);
// The Turn Track is the phase control: four segments, and none of the removed phase buttons.
await page.waitForFunction(() => !!document.querySelector('[data-testid="seg-place"]'), null, { timeout: 3000 }).catch(() => undefined);
const segs = await page.locator('[data-testid^="seg-"]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => (e as HTMLElement).dataset.testid));
check(segs.join(' ') === 'seg-place seg-attack seg-fortify seg-endTurn', `Turn Track on screen: ${segs.join(' ')}`, results);
check(u1.track.length === 4 && u1.track.some((x) => x.startsWith('current:')), `track state: ${u1.track.join(' ')} · step ${u1.step}`, results);
const gone = await page.locator('[data-testid="btn-attack"], [data-testid="btn-fortify"], [data-testid="btn-endTurn"], [data-testid="btn-done"]').count();
check(gone === 0, `no Attack → / Fortify → / End turn / Done buttons (${gone})`, results);
// Once idle, the seat chips agree with the board.
if (s1 && s1.players[s1.currentPlayer].kind === 'human' && (await page.evaluate(() => window.__risk.isIdle()))) {
  const want = s1.players.map((p, i) => `${p.name} ${Object.values(s1.territories).filter((t) => t.owner === i).length}`);
  check(u1.seats.join(', ') === want.join(', '), `seat chips ${u1.seats.join(', ')} = the board ${want.join(', ')}`, results);
}
await page.screenshot({ path: `${ART}/smoke-game.png` });
await browser.close();
finish(results, errors);
