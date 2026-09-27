// Two humans with "Hide cards between turns" on: John looks at his hand in the Cards sheet, places,
// and ends his turn; zero frames of Sam's hand may be visible before the cover is up. Every DOM
// mutation and every animation frame is checked in the page. Then: the cover reads right, Enter
// accepts, the turn banner follows, and the cover does not fire for a human holding no cards.
import { ART, check, clickBtn, dblT, finish, idle, loadScenario, open, rendered, scenario, state, ui } from './lib';
import type { Card, GameState } from '../../src/engine';

const results: string[] = [];
const { browser, page, errors } = await open();
const TWO = [
  { name: 'John', color: 'crimson', kind: 'human' },
  { name: 'Sam', color: 'cobalt', kind: 'human' },
] as never;
const johnCards: Card[] = [
  { id: 0, territory: 'alaska', symbol: 'infantry' },
  { id: 1, territory: 'alberta', symbol: 'cavalry' },
];
const samCards: Card[] = [
  { id: 20, territory: 'brazil', symbol: 'infantry' },
  { id: 21, territory: 'peru', symbol: 'infantry' },
  { id: 22, territory: 'china', symbol: 'infantry' },
];
const hs = scenario({ ural: [0, 5], ukraine: [0, 2] }, { kind: 'reinforce', remaining: 3, mustTrade: false, placed: {}, midTurn: false }, {
  players: TWO,
  fill: (_t, i) => [i % 2, 2],
  mutate: (s: GameState) => {
    s.players[0].cards = johnCards;
    s.players[1].cards = samCards;
  },
});
await loadScenario(page, hs, { settings: { hideCardsBetweenTurns: true } });
const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('risk3d.settings.v1') ?? '{}'));
check(settings.hideCardsBetweenTurns === true, 'setting on: Hide cards between turns', results);

// John opens his hand from the strip (Cards 2), a read-only sheet.
let u0 = await ui(page);
check(u0.buttons.includes('Cards 2'), `Place strip offers Cards 2 (${u0.buttons.join(' / ')})`, results);
await clickBtn(page, 'btn-cards');
await page.waitForSelector('[data-testid="card-0"]', { state: 'visible' });
check(await page.locator('[data-testid="card-0"]').isVisible(), 'John’s hand is open', results);
u0 = await ui(page);
check(u0.cardsOpen && (await page.locator('[data-testid="cards-trade"]').isVisible()) === false, 'no set: the sheet only shows the hand', results);

await page.evaluate(`(() => {
  const sam = [20, 21, 22];
  const L = (window.__leak = { checks: 0, leaks: 0, coverSeen: 0, first: null, stop: false });
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; let n = el; while (n && n !== document.body) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; n = n.parentElement; } return true; };
  const probe = (src) => {
    if (L.stop) return;
    L.checks++;
    const cover = document.querySelector('[data-testid="handoff"]');
    const coverOn = !!cover && visible(cover) && Number(getComputedStyle(cover).opacity) >= 0.999;
    if (coverOn) L.coverSeen++;
    const shown = sam.filter((id) => visible(document.querySelector('[data-testid="card-' + id + '"]')));
    if (shown.length && !coverOn) { L.leaks++; if (!L.first) L.first = src + ' cards ' + shown.join(','); }
  };
  new MutationObserver(() => probe('mutation')).observe(document.getElementById('ui'), { subtree: true, childList: true, attributes: true, characterData: true });
  const raf = () => { probe('frame'); if (!L.stop) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
})()`);

// Place everything, attack step, End turn.
await dblT(page, 'ural');
await idle(page);
await clickBtn(page, 'btn-attack');
await idle(page);
await clickBtn(page, 'btn-endTurn');
await page.waitForSelector('[data-testid="handoff"]', { timeout: 5000 });
await page.waitForTimeout(600); // keep watching while the cover sits there
await page.screenshot({ path: `${ART}/handoff-cover.png` });
const leak = (await page.evaluate('window.__leak')) as { checks: number; leaks: number; coverSeen: number; first: string | null };
check(leak.leaks === 0, `zero frames of Sam’s hand before the cover (${leak.checks} checks, ${leak.leaks} leaks${leak.first ? ', first: ' + leak.first : ''})`, results);
check(leak.coverSeen > 0, 'the cover was up at full opacity', results);
const cover = (await page.locator('[data-testid="handoff"]').textContent())?.replace(/\s+/g, ' ').trim() ?? '';
check(/Pass to Sam/.test(cover) && /armies waiting · 3 cards · set ready/.test(cover) && /I'm Sam · start turn/.test(cover), `cover: ${cover}`, results);
let u = await ui(page);
check(u.line === 'Pass to Sam' && !u.banners.some((b) => b.startsWith("SAM'S TURN")), `under the cover: the line "${u.line}", turn banner waits`, results);
await page.evaluate('window.__leak.stop = true');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.querySelector('[data-testid="handoff"]'));
await page.waitForTimeout(120);
u = await ui(page);
check(u.banners.some((b) => b.startsWith("SAM'S TURN")), `after Enter: ${u.banners.join(' | ')}`, results);
await idle(page);
await rendered(page);
const s = (await state(page))!;
check(s.currentPlayer === 1 && s.phase.kind === 'reinforce', `Sam's reinforce (${s.phase.kind})`, results);
await page.screenshot({ path: `${ART}/handoff-after.png` });

// Sam holds cards → John next holds 2 cards → cover again; a human with no cards → no cover.
const noCards = scenario({ ural: [0, 5] }, { kind: 'attack' }, {
  players: TWO,
  fill: (_t, i) => [i % 2, 2],
  mutate: (st: GameState) => {
    st.players[0].cards = johnCards;
    st.players[1].cards = [];
  },
});
await loadScenario(page, noCards, { settings: { hideCardsBetweenTurns: true } });
await clickBtn(page, 'btn-endTurn');
await page.waitForTimeout(400);
check((await page.locator('[data-testid="handoff"]').count()) === 0, 'no cover when the next human holds no cards', results);
await browser.close();
finish(results, errors);
