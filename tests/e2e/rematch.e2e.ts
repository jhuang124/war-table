// Rematch pressed while the victory wave is still playing: the next game's board must not inherit the
// finished game's attract orbit (which froze every blocking event at the renderer's 9 s watchdog).
import { check, clickBtn, clickT, finish, idle, loadScenario, open, scenario } from './lib';
import { TERRITORY_IDS, type TerritoryId } from '../../src/engine';

const results: string[] = [];
const { browser, page, errors } = await open();
await page.evaluate(() => localStorage.clear());

const own: Partial<Record<TerritoryId, [number, number]>> = {};
for (const t of TERRITORY_IDS) own[t] = [0, 1];
own.alaska = [1, 1];
own.kamchatka = [0, 30];
const s = scenario(own, { kind: 'attack' }, {
  mutate: (st) => {
    st.config.dominationPercent = 100;
    st.players[2].eliminated = true;
    st.players[3].eliminated = true;
  },
});
await loadScenario(page, s);
// Time every board event from here on.
await page.evaluate(() => {
  const w = window as unknown as { __slow: { type: string; ms: number }[]; __open: Set<string> };
  w.__slow = [];
  w.__open = new Set();
  const b = window.__board!;
  const pe = b.playEvent.bind(b);
  b.playEvent = (ev, after, opts) => {
    const t0 = performance.now();
    const key = `${ev.type}@${Math.round(t0)}`;
    w.__open.add(key);
    const p = pe(ev, after, opts);
    void p.then(() => {
      w.__open.delete(key);
      const ms = performance.now() - t0;
      if (ms > 3000 && ev.type !== 'gameOver') w.__slow.push({ type: ev.type, ms: Math.round(ms) });
    });
    return p;
  };
});
await clickT(page, 'alaska');
await clickBtn(page, 'btn-blitz');
await page.waitForFunction(() => window.__risk.ui().screen === 'victory', null, { timeout: 20000 });
const t0 = Date.now();
// A keen player: click the victory screen as soon as the intro can be skipped, then Rematch.
// (Enter skips the intro, the next Enter is Rematch; the controller ignores it for the first 1.5 s.)
await page.waitForTimeout(1550);
const at = Date.now() - t0;
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__risk.ui().screen === 'game', null, { timeout: 5000 });
// The new game plays its deal and the first turn; nothing may wait on the camera.
await page.waitForTimeout(6000);
const r = await page.evaluate(() => ({
  slow: (window as unknown as { __slow: { type: string; ms: number }[] }).__slow,
  open: [...(window as unknown as { __open: Set<string> }).__open],
  idle: window.__risk.isIdle(),
  phase: window.__risk.getState()?.phase.kind,
  moving: window.__risk.stats().cameraMoving,
  round: window.__risk.getState()?.round,
}));
check(at < 2400, `Rematch pressed ${at} ms into the victory (inside the 2.4 s wave)`, results);
console.log(r);
check(r.slow.length === 0, `no board event in the rematch took > 3 s (${JSON.stringify(r.slow)})`, results);
await idle(page, 60000).catch(() => undefined);
await page.waitForTimeout(1500);
const rig = await page.evaluate(() => {
  const r = (window.__board as unknown as { __debug: { rig: { attract: boolean; autoProgress: number; cur: object; goal: object } } }).__debug.rig;
  return { attract: r.attract, autoProgress: r.autoProgress, cur: r.cur, goal: r.goal, moving: window.__risk.stats().cameraMoving };
});
console.log(rig);
check(!rig.attract, `no attract orbit in the new game (attract ${rig.attract})`, results);
check(!rig.moving, `the camera settles in the new game (cameraMoving ${rig.moving})`, results);
await browser.close();
finish(results, errors);
