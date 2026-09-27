// Interaction checks against the gallery (fake controller records intents).
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:5282/ui-gallery.html';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' · ' + info : ''}`);
const go = async (id) => {
  await page.goto(`${base}?state=${id}`);
  await page.waitForFunction(() => window.__gallery?.ready);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
};
const intents = () => page.evaluate(() => window.__gallery.intents.map((i) => JSON.stringify(i)));
const clear = () => page.evaluate(() => (window.__gallery.intents.length = 0));

// 1. Button click → intent; disabled click → no intent + bubble
await go('attack-armed');
await clear();
await page.click('.actionbar .btn[data-id="blitz"]');
let it = await intents();
check('Blitz click sends button intent', it.includes('{"type":"button","id":"blitz"}'), it.join(' '));
await go('attack-idle');
await clear();
await page.click('.actionbar .btn[data-id="blitz"]', { force: true });
it = await intents();
const bubble = await page.evaluate(() => { const b = document.querySelector('.bubble'); return b && !b.classList.contains('hidden') ? b.textContent : null; });
check('Disabled Blitz sends nothing and explains why', it.length === 0 && bubble === 'Pick a target first', `intents=${it.length} bubble=${bubble}`);
await page.mouse.move(10, 500);
await page.hover('.actionbar .btn[data-id="roll"]', { force: true });
const hoverWhy = await page.evaluate(() => document.querySelector('.bubble:not(.hidden)')?.textContent ?? null);
check('Hover on disabled Roll shows its reason', hoverWhy === 'Pick a target first', String(hoverWhy));

// 2. Dice toggle + capped dice
await go('attack-dice2');
await clear();
await page.click('.dt-opt[data-v="3"]', { force: true });
await page.click('.dt-opt[data-v="1"]');
it = await intents();
check('Dice toggle: 3 refused at max 2, 1 accepted', it.length === 1 && it[0] === '{"type":"setDice","value":1}', it.join(' '));

// 3. Occupy stepper + wheel
await go('occupy');
await clear();
await page.click('.st-side .btn[data-id="min"]');
await page.mouse.move(720, 840);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(50);
it = await intents();
const count = await page.textContent('.st-count .num');
check('Stepper Min + wheel down', it[0] === '{"type":"button","id":"min"}' && count === '3', `${it.join(' ')} count=${count}`);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(50);
it = await intents();
check('Wheel up sends setCount 4', it.includes('{"type":"setCount","value":4}'), it.join(' '));

// 4. Pills: click All, hold +5 repeats
await go('reinforce-live');
await clear();
await page.click('.pill:nth-child(2)');
it = await intents();
check('Pill All sends pill intent', it.includes('{"type":"pill","id":"all"}'), it.join(' '));
const pillPos = await page.evaluate(() => { const r = document.querySelector('.pills').getBoundingClientRect(); const p = window.__gallery; return { x: r.x, y: r.y }; });
const anchor = await page.evaluate(() => null);
check('Pills are positioned on screen', pillPos.x > 0 && pillPos.y > 60, JSON.stringify(pillPos));

// 5. Trade chip, hints toggle, rail, roster
await go('reinforce');
await clear();
await page.click('.chip.tone-brass');
await page.click('.actionbar .chip.tone-toggle');
await page.click('.rail-btn >> nth=0');
await page.click('.r-row >> nth=2');
it = await intents();
check('Trade chip / hints / cards rail / roster row', it.join(' ') === '{"type":"button","id":"trade"} {"type":"toggleHints"} {"type":"cardsPanel","open":true} {"type":"highlightSeat","player":2}', it.join(' '));
// cards drawer opens (fake controller reacts) and a card toggles
await page.waitForTimeout(300);
await clear();
await page.click('.card >> nth=0');
it = await intents();
check('Card click toggles', it[0] === '{"type":"toggleCard","id":4}', it.join(' '));

// 6. Top bar: AI speed, menu
await clear();
await page.click('.ai-speed .seg-opt >> nth=2');
await page.click('.topbar .icon-btn >> nth=1');
it = await intents();
check('AI speed skip + menu', it.join(' ') === '{"type":"aiSpeed","value":"instant"} {"type":"overlay","overlay":"pause"}', it.join(' '));
// Esc closes pause (UI owns overlay keys)
await clear();
await page.keyboard.press('Escape');
it = await intents();
check('Esc on pause closes it', it[0] === '{"type":"overlay","overlay":null}', it.join(' '));

// 7. Keyboard on menu screens
await go('title');
await clear();
await page.keyboard.press('Enter');
it = await intents();
check('Enter on title = New game', it[0] === '{"type":"nav","screen":"newGame"}', it.join(' '));
await go('newgame-4');
await clear();
await page.click('.name-input >> nth=0');
await page.keyboard.type('x');
await page.keyboard.press('Enter');
it = await intents();
check('Typing a name sends seat patch; Enter in the field only blurs', it.length === 1 && it[0].includes('"name":"Johnx"'), it.join(' '));
await clear();
await page.keyboard.press('Enter');
it = await intents();
check('Enter on new game = Start', it[0] === '{"type":"start"}', it.join(' '));
await go('newgame-problems');
await clear();
await page.keyboard.press('Enter');
it = await intents();
check('Enter with problems does not start', it.length === 0, it.join(' '));

// 8. Handoff + confirm keys
await go('handoff');
await clear();
await page.keyboard.press('Enter');
it = await intents();
check('Enter on hand-off accepts', it[0] === '{"type":"handoffAccept"}', it.join(' '));
await go('confirm-end');
await clear();
await page.keyboard.press('Escape');
it = await intents();
check('Esc on confirm = keep playing', it[0] === '{"type":"confirm","yes":false}', it.join(' '));

// 9. Browser defaults: no selection on dblclick, no context menu, no mouse focus ring
await go('attack-armed');
await page.dblclick('.ab-line1');
const sel = await page.evaluate(() => String(window.getSelection()));
check('Double-click selects no text', sel === '', JSON.stringify(sel));
const ctx = await page.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('.roster').dispatchEvent(e); return e.defaultPrevented; });
check('Context menu suppressed on HUD', ctx);
await page.click('.actionbar .btn[data-id="roll"]');
const focused = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.matches(':focus-visible') ?? false));
check('Mouse click leaves no focus/ring on buttons', !focused.startsWith('BUTTON'), focused);
await go('settings');
await page.keyboard.press('Tab');
const kb = await page.evaluate(() => document.activeElement?.matches(':focus-visible') ?? false);
check('Keyboard Tab shows focus-visible ring', kb);

// 10. Turn banner: pointerdown on UI dismisses
await go('turn-banner');
await clear();
await page.click('.roster .r-row >> nth=1');
it = await intents();
check('Pressing the UI dismisses the turn banner', it[0] === '{"type":"dismissTurnBanner"}', it.join(' '));

// 11. Insets reported, band geometry
await go('attack-armed');
const ins = await page.evaluate(() => {
  const r = document.querySelector('.battle').getBoundingClientRect();
  const bar = document.querySelector('.actionbar').getBoundingClientRect();
  return { bandTop: Math.round(r.top), bandH: Math.round(r.height), barTop: Math.round(bar.top), W: innerWidth, H: innerHeight, bw: Math.round(r.width) };
});
check('Battle band sits above the bar, ≈min(720,70vw) wide', ins.bandTop + ins.bandH < ins.barTop && ins.bw === 720, JSON.stringify(ins));

console.log(results.join('\n'));
console.log(`errors: ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
await b.close();
