// A 1-human + 3-AI game from the title via real clicks, timed by __risk.metrics().turns, with the stub
// board modelling the renderer's 1× durations (?timings). The human plays a short real-click turn each
// round (reinforce all on one tile, End turn); the AIs run the highlight reel at `watch`.
// Budgets: AI turn median ≤ 6 s, p95 ≤ 12 s; a round of 3 AI turns ≤ 25 s; Start → first click ≤ 20 s.
import { check, clearStorage, clickBtn, clickT, finish, open, rendered, state } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();
await clearStorage(page);
await page.reload();
await page.waitForFunction(() => !!window.__risk);
await clickBtn(page, 'title-new');
await page.locator('[data-testid="seat-name-0"]').fill('John');
await page.locator('[data-testid="seat-name-0"]').press('Tab');
const tStart = Date.now();
await clickBtn(page, 'ng-start');

let firstClickAt = 0;
let rounds = 0;
const deadline = Date.now() + 240_000;
while (Date.now() < deadline && rounds < 3) {
  // Wait for the human's turn to be playable.
  await page.waitForFunction(
    () => {
      const s = window.__risk.getState();
      if (!s || s.phase.kind === 'game-over') return true;
      return s.players[s.currentPlayer].kind === 'human' && s.phase.kind === 'reinforce' && window.__risk.isIdle();
    },
    null,
    { timeout: 120_000, polling: 50 },
  );
  const s = await state(page);
  if (!s || s.phase.kind === 'game-over') break;
  await rendered(page);
  const mine = (Object.keys(s.territories) as (keyof typeof s.territories)[]).filter((t) => s.territories[t].owner === 0);
  const tile = mine.sort((a, b) => s.territories[b].armies - s.territories[a].armies)[0];
  if (!firstClickAt) firstClickAt = Date.now();
  await clickT(page, tile);
  await page.locator('[data-testid="pill-all"]').click().catch(() => undefined);
  await clickBtn(page, 'btn-beginAttack');
  await clickBtn(page, 'btn-endTurn');
  rounds++;
}
const m = await page.evaluate(() => window.__risk.metrics());
const ai = m.turns.filter((t) => t.kind === 'ai').map((t) => t.ms);
const sorted = [...ai].sort((a, b) => a - b);
const med = sorted[Math.floor(sorted.length / 2)];
const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
console.log('AI turn ms:', ai.join(', '));
const firstSeat = m.turns[0]?.player;
const before = m.turns.findIndex((t) => t.kind === 'human');
check(firstClickAt - tStart <= 20_000, `Start → first reinforce click ${firstClickAt - tStart} ms (≤ 20 s; ${before} AI turns went first, first seat ${firstSeat})`, results);
check(ai.length >= 6, `${ai.length} AI turns measured`, results);
check(med <= 6000, `AI turn median ${med} ms (≤ 6 s)`, results);
check(p95 <= 12000, `AI turn p95 ${p95} ms (≤ 12 s)`, results);
// Rounds: the three AI turns between two human turns.
const turns = m.turns;
let worst = 0;
for (let i = 0; i < turns.length; i++) {
  if (turns[i].kind !== 'human') continue;
  let sum = 0;
  let j = i + 1;
  while (j < turns.length && turns[j].kind === 'ai') sum += turns[j++].ms;
  if (j < turns.length && j - i - 1 === 3) worst = Math.max(worst, sum);
}
check(worst > 0 && worst <= 25_000, `a full round of 3 AI turns ≤ 25 s (worst ${worst} ms)`, results);
const humans = turns.filter((t) => t.kind === 'human');
check(humans.every((t) => t.forcedWaitMs === 0), `human forced wait: ${humans.map((t) => t.forcedWaitMs).join(', ')} ms`, results);
check(humans.every((t) => t.clicks <= 4), `human clicks per quick turn: ${humans.map((t) => t.clicks).join(', ')}`, results);
check(m.cameraMovesDuringHumanInput === 0, `cameraMovesDuringHumanInput ${m.cameraMovesDuringHumanInput}`, results);
await page.screenshot({ path: 'artifacts/e2e/round-end.png' });
await browser.close();
finish(results, errors);
