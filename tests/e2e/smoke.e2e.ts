// Smoke: title → new game via the HUD → first human turn; screenshot.
import { ART, check, clearStorage, clickBtn, finish, idle, open, ui } from './lib';

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
await clickBtn(page, 'ng-start');
await page.waitForTimeout(300);
await idle(page, 60000).catch(() => undefined);
const u1 = await ui(page);
console.log(JSON.stringify(u1, null, 2));
check(u1.screen === 'game', 'in game', results);
check(u1.line.length > 0, `the line: ${u1.line}`, results);
await page.screenshot({ path: `${ART}/smoke-game.png` });
await browser.close();
finish(results, errors);
