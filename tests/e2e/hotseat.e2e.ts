// Multi-human paths through real clicks: manual setup ("Place your own": pick, Place, Undo, Place the
// rest, Done on the Turn Track), the hand-off cover (setting on; End turn on the track), forced +
// mid-turn card trades (one button, the best set; the track locked meanwhile), and all humans out →
// the strip offers "Watch to the end" → victory → rematch.
import { check, clearStorage, clickBtn, clickT, finish, idle, loadScenario, open, place, rendered, scenario, seg, state, ui } from './lib';
import type { Card, GameState, TerritoryId } from '../../src/engine';

const results: string[] = [];
const { browser, page, errors } = await open();

// --- Manual setup, 2 humans + 1 AI, from the New game screen -------------------------------------
await clearStorage(page);
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await clickBtn(page, 'title-new');
await page.locator('[data-testid="seat-name-0"]').fill('John');
await page.locator('[data-testid="seat-name-0"]').press('Tab');
await clickBtn(page, 'seat-kind-1-human');
await page.waitForTimeout(50);
await page.locator('[data-testid="seat-name-1"]').fill('Sam');
await page.locator('[data-testid="seat-name-1"]').press('Tab');
await clickBtn(page, 'seat-remove-3');
await clickBtn(page, 'setup-placeOwn');
await page.waitForFunction(() => document.querySelector('[data-testid="ng-summary"]')?.textContent?.includes('your own'));
const summary = await page.locator('[data-testid="ng-summary"]').textContent();
check(summary === 'Territories dealt at random · you place your own armies · first to 30 territories wins', `summary: ${summary}`, results);
const t0 = Date.now();
await clickBtn(page, 'ng-start');
let humanSetupTurns = 0;
let sawCoverInSetup = false;
for (let guard = 0; guard < 40; guard++) {
  await page.waitForFunction(
    () => {
      const s = window.__risk.getState();
      return !!s && window.__risk.isIdle() && (s.phase.kind !== 'setup-place' || s.players[s.currentPlayer].kind === 'human');
    },
    null,
    { timeout: 60_000 },
  );
  await rendered(page);
  const s = await state(page);
  if (!s || s.phase.kind !== 'setup-place') break;
  if (await page.locator('[data-testid="handoff"]').count()) sawCoverInSetup = true;
  const toPlace = s.phase.toPlace;
  const u0 = await ui(page);
  if (humanSetupTurns === 0) check(u0.line === `Place ${toPlace} armies · click a territory` && u0.step === 'Setup', `setup: [${u0.step}] ${u0.line}`, results);
  const own = (Object.keys(s.territories) as TerritoryId[]).filter((t) => s.territories[t].owner === s.currentPlayer);
  await place(page, own[0], 1);
  await place(page, own[1], 2);
  await clickBtn(page, 'btn-undo'); // takes the 2 back
  await place(page, own[1]); // everything left on own[1]
  await page.waitForTimeout(100);
  const u1 = await ui(page);
  if (humanSetupTurns === 0) {
    check(u1.line === `All ${toPlace} placed · click Done` && u1.primary === null && u1.brass.join() === 'Done', `staged: ${u1.line} · brass ${u1.brass.join(' / ')}`, results);
    const before = await state(page);
    check(before!.territories[own[0]].armies === s.territories[own[0]].armies, 'staging does not touch the engine until Done', results);
  }
  await seg(page, 'done');
  humanSetupTurns++;
}
const sMain = await state(page);
check(sMain!.phase.kind === 'reinforce' && sMain!.round === 1, `setup finished → round 1 reinforce (${humanSetupTurns} human setup turns)`, results);
check(!sawCoverInSetup, 'no hand-off cover during setup', results);
console.log(`   manual setup took ${Math.round((Date.now() - t0) / 1000)} s of wall time with scripted clicks`);

// --- Hand-off cover (setting on): John ends his turn, Sam holds cards ------------------------------
const TWO_PLUS_AI = [
  { name: 'John', color: 'crimson', kind: 'human' },
  { name: 'Sam', color: 'cobalt', kind: 'human' },
  { name: 'Amber', color: 'amber', kind: 'ai', difficulty: 'normal' },
] as never;
const cards = (ids: number[]): Card[] => ids.map((id) => ({ id, territory: null, symbol: (['infantry', 'cavalry', 'artillery'] as const)[id % 3] }));
const hs = scenario({ ural: [0, 5], ukraine: [0, 2] }, { kind: 'attack' }, {
  players: TWO_PLUS_AI,
  fill: (_t, i) => [1 + (i % 2), 2],
  mutate: (s: GameState) => {
    s.players[1].cards = cards([3, 4]);
  },
});
await loadScenario(page, hs);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('risk3d.settings.v1') ?? '{}');
  localStorage.setItem('risk3d.settings.v1', JSON.stringify({ ...s, hideCardsBetweenTurns: true }));
});
await loadScenario(page, hs); // reload so the setting is read
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('risk3d.settings.v1') ?? '{}');
  localStorage.setItem('risk3d.settings.v1', JSON.stringify({ ...s, hideCardsBetweenTurns: true }));
});
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await page.evaluate((st) => localStorage.setItem('risk3d.save.v1', JSON.stringify({ v: 1, savedAt: Date.now(), state: st })), hs as never);
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await clickBtn(page, 'title-continue');
await idle(page);
await rendered(page);
await seg(page, 'endTurn'); // straight from Attack: skips fortify
await page.waitForSelector('[data-testid="handoff"]', { timeout: 3000 });
const cover = await page.locator('[data-testid="handoff"]').textContent();
check(/Pass to Sam/.test(cover ?? '') && /armies waiting · 2 cards/.test(cover ?? ''), `cover: ${cover?.replace(/\s+/g, ' ').trim()}`, results);
const handHidden = await page.evaluate(() => window.__risk.ui().line);
check(handHidden === 'Pass to Sam', `the line under the cover: ${handHidden}`, results);
const turnBannerBefore = (await ui(page)).banners.filter((b) => b.endsWith('TURN'));
check(turnBannerBefore.length === 0 || !turnBannerBefore[0].startsWith('SAM'), 'turnStarted waits for the cover', results);
await clickBtn(page, 'handoff-accept');
await page.waitForFunction(() => !document.querySelector('[data-testid="handoff"]'));
await page.waitForTimeout(80);
const afterCover = await ui(page);
check(afterCover.banners.some((b) => b.startsWith("SAM'S TURN · +")), `after the cover: ${afterCover.banners.join(' | ')}`, results);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('risk3d.settings.v1') ?? '{}');
  localStorage.setItem('risk3d.settings.v1', JSON.stringify({ ...s, hideCardsBetweenTurns: false }));
});

// --- Forced trade at 5 cards -------------------------------------------------------------------------
const hand5: Card[] = [
  { id: 0, territory: 'ural', symbol: 'infantry' },
  { id: 1, territory: 'alberta', symbol: 'infantry' },
  { id: 2, territory: 'peru', symbol: 'infantry' },
  { id: 3, territory: 'brazil', symbol: 'cavalry' },
  { id: 4, territory: 'china', symbol: 'cavalry' },
];
await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 1] }, { kind: 'reinforce', remaining: 3, mustTrade: true, placed: {}, midTurn: false }, { mutate: (s) => void (s.players[0].cards = hand5) }));
let u = await ui(page);
let s0 = await state(page);
check(u.line === 'Trade cards first · you hold 5', `forced trade: ${u.line}`, results);
check(u.primary === 'Trade cards +4' && u.buttons.length === 1, `the only button: ${u.buttons.join(' / ')}`, results);
check(u.trackDisabled && u.recommended === null && u.brass.join() === 'Trade cards +4', `the track is locked during the forced trade (disabled ${u.trackDisabled}, brass ${u.brass.join(' / ')})`, results);
await seg(page, 'attack', true); // the track is disabled: the click changes no phase, only explains
await page.waitForTimeout(100);
s0 = await state(page);
u = await ui(page);
check(s0!.phase.kind === 'reinforce' && s0!.players[0].cards.length === 5 && u.line === 'Trade cards first', `a click on the locked track changes nothing, it says why (${s0!.phase.kind} · ${u.line})`, results);
await clickBtn(page, 'btn-trade');
await idle(page);
let s = await state(page);
u = await ui(page);
check(s!.players[0].cards.length === 2 && (s!.phase as { remaining: number }).remaining === 7, `traded: 2 cards left, 7 to place`, results);
check(s!.territories.ural.armies === 5, '+2 landed on Ural (a traded card shows it)', results);
const log = await page.evaluate(() => ((JSON.parse(localStorage.getItem('risk3d.ui.v1') ?? '{}').game?.log ?? []) as { text: string }[]).map((l) => l.text));
check(log.some((t) => t.startsWith('+2 on Ural')), 'the +2 is in the log (no toast)', results);
check(u.line === 'Place 7 armies · click a territory' && u.buttons.join(' / ') === 'Cards 2', `after the trade: ${u.line} · ${u.buttons.join(' / ')}`, results);

// --- Mid-turn trade after a knockout ------------------------------------------------------------------
await loadScenario(
  page,
  scenario({ ural: [0, 12], ukraine: [0, 1] }, { kind: 'attack' }, {
    players: TWO_PLUS_AI,
    fill: (_t, i) => [i % 2 === 0 ? 0 : 2, 1 + (i % 2)],
    mutate: (s) => {
      s.territories.siberia = { owner: 1, armies: 1 };
      s.players[0].cards = cards([0, 1]);
      s.players[1].cards = cards([5, 6, 7, 8]);
    },
  }),
);
await clickT(page, 'siberia');
await clickBtn(page, 'btn-blitz');
await idle(page);
s = await state(page);
if (s!.phase.kind === 'occupy') {
  await clickBtn(page, 'btn-move');
  await idle(page);
  s = await state(page);
}
u = await ui(page);
check(s!.phase.kind === 'reinforce' && (s!.phase as { midTurn: boolean }).midTurn, 'mid-turn reinforce after the knockout', results);
check(u.line === 'Trade cards first · you hold 6' && u.step === 'Place', `[${u.step}] ${u.line}`, results);
await clickBtn(page, 'btn-trade');
await idle(page);
s = await state(page);
u = await ui(page);
check(s!.players[0].cards.length === 3 && (s!.phase as { remaining: number }).remaining > 0, `after the trade: ${u.line}`, results);
const own = (Object.keys(s!.territories) as TerritoryId[]).find((t) => s!.territories[t].owner === 0)!;
await place(page, own);
await page.waitForTimeout(100);
u = await ui(page);
check(u.line === 'All placed · keep attacking' && u.primary === null && u.recommended === 'attack' && u.brass.join() === 'Attack', `exit: ${u.line} · brass ${u.brass.join(' / ')}`, results);
await clickT(page, own); // in Place with 0 left, a board click is refused
u = await ui(page);
check(u.line === 'All armies placed · click Attack to go on' && u.lineKind === 'rejection', `board click with all placed: ${u.line}`, results);
await seg(page, 'attack');
await idle(page);
s = await state(page);
u = await ui(page);
check(s!.phase.kind === 'attack' && u.step === 'Attack', `back to Attack via the track (${s!.phase.kind})`, results);
const gotBanner = await page.evaluate(() => window.__risk.getState()!.players[1].eliminated);
check(gotBanner, 'Sam is out', results);

// --- All humans out ----------------------------------------------------------------------------------
await loadScenario(
  page,
  scenario({ siberia: [0, 1] }, { kind: 'attack' }, {
    fill: (_t, i) => [1 + (i % 3), 3],
    mutate: (s) => {
      s.currentPlayer = 1;
      s.territories.ural = { owner: 1, armies: 30 };
      s.territories.yakutsk = { owner: 1, armies: 30 };
    },
  }),
  { waitIdle: false },
);
await page.waitForFunction(() => window.__risk.ui().line === 'All humans are out', null, { timeout: 60_000 });
const ho = await ui(page);
check(ho.buttons.join(' / ') === 'End game / Watch to the end', `all humans out: ${ho.buttons.join(' / ')}`, results);
check(!ho.trackLive && ho.trackSeat !== 'John', `all humans out: the track follows the AI (${ho.trackSeat}, live ${ho.trackLive})`, results);
await clickBtn(page, 'btn-watchAis');
{
  // Poll with a progress trail, so a stall shows where it happened.
  const t0 = Date.now();
  let last = '';
  let same = 0;
  let done = false;
  while (Date.now() - t0 < 180_000) {
    const r = await page.evaluate(() => {
      const s = window.__risk.getState();
      const u = window.__risk.ui();
      return { screen: u.screen, key: `${s?.round}/${s?.turn}/${s?.currentPlayer}/${s?.phase.kind}`, line: u.line, idle: window.__risk.isIdle() };
    });
    if (r.screen === 'victory') {
      done = true;
      break;
    }
    same = r.key === last ? same + 1 : 0;
    last = r.key;
    if (same === 20) console.log(`   stalled 10 s at ${r.key} · "${r.line}" · idle ${r.idle}`);
    await page.waitForTimeout(500);
  }
  check(done, `Watch the AIs finish → victory (${Math.round((Date.now() - t0) / 1000)} s)`, results);
  if (!done) finish(results, errors);
}
await page.waitForTimeout(1700);
await clickBtn(page, 'rematch');
await page.waitForFunction(() => window.__risk.ui().screen === 'game');
const rs = await state(page);
check(rs!.players.map((p) => p.name).join(',') === 'John,Cobalt,Amber,Emerald', 'Rematch: same seats, new game', results);
await page.screenshot({ path: 'artifacts/e2e/hotseat-rematch.png' });

await browser.close();
finish(results, errors);
