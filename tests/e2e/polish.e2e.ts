// UX.md §11 polish checklist items that need a real browser, on the real board + HUD:
//   #1 hover lands in the same frame on clickable tiles; non-clickable tiles don't react (cursor)
//   #2 no hover flicker sliding along the Ukraine/Ural edge (3 px hysteresis)
//   #3 an orbit drag released over another tile never clicks; right-click takes one back
//   #14 at most one brass button, every disabled button says why
//   #17 no numerals in Cinzel, no ASCII minus before a number
//   #19 no sound on tile hover
//   #22 no focus ring after a mouse click; a ring after Tab
//   #23 instant speed: dice still show their result; the turn banner still shows
//   #24 empty states: no attack sources / nothing to fortify / no valid set each say so
import { check, clickBtn, clickT, finish, idle, loadScenario, open, scenario, state, ui } from './lib';
import type { Phase } from '../../src/engine';

const results: string[] = [];
const { browser, page, errors } = await open();
const reinforce = (remaining: number): Phase => ({ kind: 'reinforce', remaining, mustTrade: false, placed: {}, midTurn: false });
const dbg = () => page.evaluate(() => (window.__board as unknown as { __debug: { hovered: string | null } }).__debug.hovered);

await loadScenario(page, scenario({ ural: [0, 4], ukraine: [0, 3] }, reinforce(5)));
// #1 same-frame hover, cursor only on clickable tiles.
const ural = (await page.evaluate(() => window.__risk.screenPos('ural')))!;
const sib = (await page.evaluate(() => window.__risk.screenPos('siberia')))!;
await page.mouse.move(ural.x + 1, ural.y + 8);
const sameFrame = await page.evaluate(
  () => new Promise<string | null>((r) => requestAnimationFrame(() => r((window.__board as unknown as { __debug: { hovered: string | null } }).__debug.hovered))),
);
const cur1 = await page.evaluate(() => getComputedStyle(document.querySelector('#board canvas')!).cursor);
check(sameFrame === 'ural' && cur1 === 'pointer', `hover lands by the next frame on a clickable tile (${sameFrame}, cursor ${cur1})`, results);
await page.mouse.move(sib.x + 1, sib.y + 8);
await page.waitForTimeout(40);
const cur2 = await page.evaluate(() => getComputedStyle(document.querySelector('#board canvas')!).cursor);
check((await dbg()) === 'siberia' && cur2 === 'default', `an enemy tile in reinforce: hover tracked, cursor ${cur2} (no lift, no pointer)`, results);

// #2 hysteresis along the Ukraine/Ural edge: find the edge between the anchors, then jiggle ±2 px.
const uk = (await page.evaluate(() => window.__risk.screenPos('ukraine')))!;
const edge = await page.evaluate(
  ([a, b]) => {
    const pick = (window.__board as unknown as { __debug: { pick: (x: number, y: number) => string | null } }).__debug.pick;
    let last = pick(a.x, a.y + 10);
    for (let i = 1; i <= 200; i++) {
      const x = a.x + ((b.x - a.x) * i) / 200;
      const y = a.y + 10 + ((b.y - a.y) * i) / 200;
      const p = pick(x, y);
      if (p !== last && p && last) return { x, y, from: last, to: p };
      last = p;
    }
    return null;
  },
  [uk, ural] as const,
);
if (edge) {
  let flips = 0;
  let prev = await dbg();
  for (let k = 0; k < 24; k++) {
    const dx = k % 2 === 0 ? -2 : 2;
    await page.mouse.move(edge.x + dx, edge.y);
    await page.waitForTimeout(18);
    const h = await dbg();
    if (h !== prev) flips++;
    prev = h;
  }
  check(flips <= 1, `jiggling ±2 px across the ${edge.from}/${edge.to} edge: ${flips} hover change(s) (≤ 1)`, results);
} else check(false, 'found the Ukraine/Ural edge on screen', results);

// #19 no sound on tile hover (after unlocking audio with a click).
await page.mouse.click(5, 450); // wood table: unlocks audio, clicks nothing
const played0 = await page.evaluate(() => (window.__audio as unknown as { stats?: () => { played: number } } | undefined)?.stats?.().played ?? -1);
for (const t of ['ural', 'ukraine', 'siberia', 'afghanistan', 'china']) {
  const p = (await page.evaluate((id) => window.__risk.screenPos(id as never), t))!;
  await page.mouse.move(p.x, p.y + 8, { steps: 3 });
}
const played1 = await page.evaluate(() => (window.__audio as unknown as { stats?: () => { played: number } } | undefined)?.stats?.().played ?? -1);
check(played0 >= 0 && played1 === played0, `hovering tiles plays no sound (${played0} → ${played1} played)`, results);

// #3 an orbit drag from Ural released over Ukraine never clicks; right-click takes one back.
const before = (await state(page))!.territories;
await page.mouse.move(ural.x, ural.y + 8);
await page.mouse.down();
await page.mouse.move(ural.x + 30, ural.y, { steps: 4 });
await page.mouse.move(uk.x, uk.y + 8, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(200);
let after = (await state(page))!.territories;
check(after.ural.armies === before.ural.armies && after.ukraine.armies === before.ukraine.armies, 'a drag released over a tile places nothing', results);
await page.evaluate(() => window.__risk.stats()); // camera settles
await clickT(page, 'ural');
await clickT(page, 'ural', { button: 'right' });
after = (await state(page))!.territories;
check(after.ural.armies === before.ural.armies, `click +1 then right-click −1 → Ural ${after.ural.armies}`, results);

// #14 brass and why, #17 numerals — across a few states.
const audit = async (label: string) => {
  await page.waitForTimeout(80); // the HUD renders on the next animation frame
  const a = await page.evaluate(() => {
    const vis = (el: Element) => (el as HTMLElement).offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
    const brass = [...document.querySelectorAll('#ui .btn.brass')].filter(vis).length;
    const u = window.__risk.ui();
    const noWhy = u.buttons.filter((b) => !b.enabled && !b.why).map((b) => b.label);
    const cinzelNums: string[] = [];
    const minus: string[] = [];
    const walk = document.createTreeWalker(document.getElementById('ui')!, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent ?? '';
      const el = n.parentElement!;
      if (!t.trim() || !el.offsetParent) continue;
      if (/\d/.test(t) && /Cinzel/i.test(getComputedStyle(el).fontFamily)) cinzelNums.push(t.trim().slice(0, 30));
      if (/(^|[\s(])-\d/.test(t)) minus.push(t.trim().slice(0, 30));
    }
    return { brass, noWhy, cinzelNums, minus };
  });
  check(a.brass <= 1, `${label}: ${a.brass} brass button(s)`, results);
  check(a.noWhy.length === 0, `${label}: every disabled button says why${a.noWhy.length ? ' — missing: ' + a.noWhy.join(', ') : ''}`, results);
  check(a.cinzelNums.length === 0 && a.minus.length === 0, `${label}: no Cinzel numerals, no ASCII minus${a.cinzelNums.concat(a.minus).length ? ' — ' + a.cinzelNums.concat(a.minus).join(' | ') : ''}`, results);
};
await audit('reinforce');
await page.locator('[data-testid="pill-all"]').click();
await clickT(page, 'siberia');
await audit('armed');

// #22 no focus ring after a mouse click on a HUD button; Tab from the HUD shows one.
await page.locator('[data-testid="btn-roll"]').click();
await page.waitForTimeout(40);
const ring = await page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return 'none';
  const cs = getComputedStyle(a);
  return `${cs.outlineStyle} ${cs.outlineWidth} / ${cs.boxShadow.slice(0, 40)} (${a.matches(':focus-visible') ? 'focus-visible' : 'no focus-visible'})`;
});
check(ring === 'none' || /no focus-visible/.test(ring), `no focus ring after a mouse click (${ring})`, results);
await idle(page);
await audit('rolled');

// #8 no spoilers: during a blitz the battle header's numbers never run ahead of the board's badges,
// and the defender's roster armies never drop before the board shows the loss (sampled every frame).
await loadScenario(page, scenario({ ural: [0, 25] }, { kind: 'attack' }, { mutate: (s) => void (s.territories.siberia.armies = 12) }));
await clickT(page, 'siberia');
await page.evaluate(`(() => {
  const S = (window.__spoil = { frames: 0, ahead: 0, first: null, stop: false });
  const armies = window.__board.__debug.armies;
  const f = () => {
    const b = window.__risk.ui().battle;
    if (b) {
      S.frames++;
      const m = b.header.match(/URAL (\\d+) vs .* SIBERIA (\\d+)/);
      if (m) {
        const hudA = +m[1], hudD = +m[2];
        const boardA = armies.ural, boardD = armies.siberia;
        if (hudA < boardA || hudD < boardD) { S.ahead++; if (!S.first) S.first = b.header + ' vs board ' + boardA + '/' + boardD; }
      }
    }
    if (!S.stop) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
})()`);
await clickBtn(page, 'btn-blitz');
await idle(page);
await page.evaluate('window.__spoil.stop = true');
const spoil = (await page.evaluate('window.__spoil')) as { frames: number; ahead: number; first: string | null };
check(spoil.frames > 30 && spoil.ahead === 0, `battle header never ahead of the board during a blitz (${spoil.frames} frames, ${spoil.ahead} ahead${spoil.first ? ': ' + spoil.first : ''})`, results);

// #23 instant speed: the roll still shows a result; the tray still shows the dice.
await page.evaluate(() => window.__risk.setSpeed(0));
await loadScenario(page, scenario({ ural: [0, 12] }, { kind: 'attack' }, { mutate: (s) => void (s.territories.siberia.armies = 8) }), { settings: { animationSpeed: 0 } });
await clickT(page, 'siberia');
await clickBtn(page, 'btn-roll');
await page.waitForTimeout(120);
const inst = await page.evaluate(() => ({
  result: window.__risk.ui().battle?.result ?? null,
  tray: (window.__board as unknown as { __debug: { tray: { visible: boolean } } }).__debug.tray.visible,
}));
check(!!inst.result && inst.tray, `instant speed: result "${inst.result}", dice tray ${inst.tray ? 'showing' : 'hidden'}`, results);
await page.screenshot({ path: 'artifacts/e2e/polish-instant-dice.png' });
await page.evaluate(() => window.__risk.setSpeed(1));

// #24 empty states.
await loadScenario(page, scenario({ ural: [0, 1], ukraine: [0, 1] }, { kind: 'attack' }));
let u = await ui(page);
check(u.actionBarText === 'No attacks left · every border army is down to 1' && /^Fortify|^End turn/.test(u.primary ?? ''), `no sources: "${u.actionBarText}" · primary ${u.primary}`, results);
await loadScenario(page, scenario({ ural: [0, 1], ukraine: [0, 1] }, { kind: 'fortify' }));
u = await ui(page);
check(u.actionBarText === 'Nothing to move · End turn' && /^End turn/.test(u.primary ?? ''), `nothing to fortify: "${u.actionBarText}" · primary ${u.primary}`, results);
await loadScenario(
  page,
  scenario({ ural: [0, 3] }, reinforce(3), {
    mutate: (s) =>
      void (s.players[0].cards = [
        { id: 0, territory: 'alaska', symbol: 'infantry' },
        { id: 1, territory: 'peru', symbol: 'cavalry' },
      ]),
  }),
);
await clickBtn(page, 'rail-cards');
await page.waitForTimeout(300);
const status = await page.locator('.cards-status').textContent();
check(/^Need 1 .+/.test(status ?? ''), `no valid set: "${status}"`, results);

await browser.close();
finish(results, errors);
