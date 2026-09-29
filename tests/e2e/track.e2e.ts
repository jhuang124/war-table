// The Turn Track and the round-2 HUD rules (docs/ROUND2.md §A–C, E), mouse only, on the real board + HUD:
//   the track never hides or renames · locked segments explain themselves · the pointer cursor only on
//   eligible segments · exactly one brass-filled thing per state · the marker slides (180 ms) · skip
//   fortify from Attack and End turn straight from Place are one click · the line never shows two
//   sentences at once · the conquest header reads 'X captured' then clears · an AI's marker moves through
//   the same track and its narration says what happened, in order · Reset view appears only after the
//   player moves the camera · the Rules card explains the pieces · New game: default seats and the
//   one-emblem colour popover.
import { check, clickBtn, clickT, finish, idle, loadScenario, open, place, scenario, seg, state, ui } from './lib';
import type { Page } from 'playwright';

const results: string[] = [];
const { browser, page, errors } = await open();

/** What the strip looks like in the DOM: the segment labels, states, cursors, and every brass fill. */
async function dom(p: Page) {
  // The HUD paints on the next frame after the view model changes.
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return p.evaluate(() => {
    const segs = [...document.querySelectorAll<HTMLElement>('[data-testid="track"] .tr-seg')];
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const brass = [...document.querySelectorAll<HTMLElement>('.strip .btn.brass, .strip .tr-seg.is-primary, .cards-sheet:not(.hidden) .btn.brass')].filter(vis);
    return {
      labels: segs.map((s) => s.querySelector('.tr-label')?.textContent ?? ''),
      states: segs.map((s) => s.dataset.state ?? ''),
      cursors: segs.map((s) => getComputedStyle(s).cursor),
      shown: segs.length > 0 && segs.every(vis),
      brass: brass.map((b) => (b.querySelector('.tr-label, .btn-label') ?? b).textContent?.trim() ?? ''),
      fill: (document.querySelector('.tr-fill') as HTMLElement | null)?.style.transform ?? '',
      fillMs: getComputedStyle(document.querySelector('.tr-fill')!).transitionDuration,
    };
  });
}
const oneBrass = async (label: string, want: string) => {
  const d = await dom(page);
  check(d.brass.length === 1 && d.brass[0].startsWith(want), `${label}: one brass fill (${d.brass.join(' + ') || 'none'})`, results);
};

// --- Place: locked segments, cursors, brass ---------------------------------------------------------
const board = () =>
  scenario(
    { ural: [0, 12], ukraine: [0, 3], afghanistan: [0, 2], kamchatka: [0, 1] },
    { kind: 'reinforce', remaining: 9, mustTrade: false, placed: {}, midTurn: false },
    { mutate: (s) => void (s.territories.siberia = { owner: 1, armies: 2 }) },
  );
await loadScenario(page, board());
let d = await dom(page);
check(d.shown && d.labels.join(',') === 'Place,Attack,Fortify,End turn', `the track: ${d.labels.join(' · ')}`, results);
check(d.states.join(',') === 'current,locked,locked,locked', `Place with armies left: ${d.states.join(' ')}`, results);
check(d.cursors.every((c) => c !== 'pointer'), `no pointer on locked / current segments (${d.cursors.join(', ')})`, results);
// One gold (docs/INK.md B2.1): with nothing pending, the gold falls back to the current segment.
await oneBrass('nothing picked: the current segment', 'Place');
await seg(page, 'fortify');
check((await ui(page)).line === 'Place your 9 armies first', `locked Fortify: "${(await ui(page)).line}"`, results);
await page.waitForTimeout(2200);
check((await ui(page)).line === 'Place 9 armies · click a territory', `the reason goes after 2 s: "${(await ui(page)).line}"`, results);
await clickT(page, 'ural');
await oneBrass('Ural picked', 'Place 9');
const c = (await ui(page)).count;
check(c?.control === 'slider' && c.max === 9, `9 options: a slider (${c?.control})`, results);
await clickBtn(page, 'btn-place');
await idle(page);
d = await dom(page);
check(d.states.join(',') === 'current,eligible,eligible,eligible', `all placed: ${d.states.join(' ')}`, results);
check(d.cursors.slice(1).every((x) => x === 'pointer') && d.cursors[0] !== 'pointer', `pointer only on eligible segments (${d.cursors.join(', ')})`, results);
await oneBrass('all placed', 'Attack');
check((await ui(page)).recommended === 'attack', 'Attack is the recommended next step', results);
const fill0 = d.fill;

// --- Attack: the fill slides; armed; the track never hides ------------------------------------------
await seg(page, 'attack');
await page.waitForTimeout(40);
d = await dom(page);
check(d.fill !== fill0 && d.fillMs.split(',').some((x) => Math.abs(parseFloat(x) - 0.18) < 0.001), `the marker slides to Attack (transition ${d.fillMs})`, results);
check(d.states.join(',') === 'done,current,eligible,eligible' && d.labels[0] === 'Place', `Attack: ${d.states.join(' ')}`, results);
await oneBrass('Attack with targets left and nothing armed: the current segment', 'Attack');
await clickT(page, 'siberia');
d = await dom(page);
check(d.shown && d.labels.join(',') === 'Place,Attack,Fortify,End turn', 'armed: the track is still there, same words', results);
await oneBrass('armed', 'Blitz');
check(/^Ural → Siberia · \d+%( · .+)?$/.test((await ui(page)).line), `armed line: "${(await ui(page)).line}"`, results);

// The line never shows two sentences at once (sampled every frame while it changes).
await page.evaluate(() => {
  const w = window as unknown as { __overlap: { max: number; frames: number; stop: boolean } };
  w.__overlap = { max: 0, frames: 0, stop: false };
  const tick = () => {
    const spans = [...document.querySelectorAll<HTMLElement>('.st-line .ln-text')];
    const on = spans.filter((s) => parseFloat(getComputedStyle(s).opacity) > 0.35).length;
    w.__overlap.max = Math.max(w.__overlap.max, on);
    w.__overlap.frames++;
    if (!w.__overlap.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.keyboard.press('Escape'); // armed → source
await page.waitForTimeout(120);
await page.keyboard.press('Escape'); // source → nothing
await page.waitForTimeout(120);
await seg(page, 'place', true); // past: inert
await clickT(page, 'siberia'); // re-arm
await page.waitForTimeout(400);
const ov = (await page.evaluate(() => {
  const w = window as unknown as { __overlap: { max: number; frames: number; stop: boolean } };
  w.__overlap.stop = true;
  return w.__overlap;
})) as { max: number; frames: number };
check(ov.frames > 20 && ov.max <= 1, `the line never shows two sentences (max ${ov.max} over ${ov.frames} frames)`, results);
check((await state(page))!.phase.kind === 'attack', 'a past segment (Place) is inert', results);

// --- Conquest: 'Siberia captured', then the header clears; occupy locks the track ---------------------
await clickBtn(page, 'btn-blitz');
await idle(page);
let st = (await state(page))!;
if (st.phase.kind === 'occupy' || st.territories.siberia.owner === 0) {
  const b = (await ui(page)).battle;
  check(b?.header === 'Siberia captured', `the tray header after the conquest: ${b?.header}`, results);
  if (st.phase.kind === 'occupy') {
    d = await dom(page);
    check((await ui(page)).trackDisabled && d.states.join(',') === 'done,current,locked,locked', `occupy: the track is disabled (${d.states.join(' ')})`, results);
    await seg(page, 'endTurn', true);
    check((await ui(page)).line === 'Finish moving armies in first', `locked End turn in occupy: "${(await ui(page)).line}"`, results);
    await oneBrass('occupy', 'Move');
  }
  await page.waitForTimeout(1400);
  check((await ui(page)).battle === null, 'the header clears about a second after the fight', results);
  if (st.phase.kind === 'occupy') {
    await clickBtn(page, 'btn-move');
    await idle(page);
  }
} else check(false, `expected the blitz to take Siberia (${st.phase.kind})`, results);

// --- Fortify: End turn is the brass one until a move is pending ---------------------------------------
await seg(page, 'fortify');
await idle(page);
await oneBrass('fortify, nothing picked', 'End turn');
st = (await state(page))!;
const src = (['siberia', 'ural', 'ukraine', 'afghanistan'] as const).find((t) => st.territories[t].owner === 0 && st.territories[t].armies >= 2)!;
const dst = (['ural', 'ukraine', 'afghanistan', 'siberia'] as const).find((t) => t !== src && st.territories[t].owner === 0)!;
await clickT(page, src);
await clickT(page, dst);
await oneBrass(`fortify, a move pending (${src} → ${dst})`, 'Move');
check((await ui(page)).recommended === 'endTurn', 'End turn still glows (recommended) while the move is brass', results);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// --- AI turn: the marker moves through the same track; narration in order ----------------------------
await page.evaluate(() => {
  const w = window as unknown as { __ai: { lines: string[]; steps: string[]; seats: string[] } };
  w.__ai = { lines: [], steps: [], seats: [] };
  setInterval(() => {
    const u = window.__risk.ui();
    if (u.trackLive || u.screen !== 'game') return;
    if (u.lineKind === 'narration' && w.__ai.lines[w.__ai.lines.length - 1] !== u.line) w.__ai.lines.push(u.line);
    if (w.__ai.steps[w.__ai.steps.length - 1] !== u.step) w.__ai.steps.push(u.step);
    if (!w.__ai.seats.includes(u.trackSeat)) w.__ai.seats.push(u.trackSeat);
  }, 25);
});
await seg(page, 'endTurn');
await page.waitForFunction(() => window.__risk.getState()!.currentPlayer === 0 && window.__risk.getState()!.phase.kind === 'reinforce' && window.__risk.isIdle(), null, { timeout: 90_000, polling: 50 });
const ai = (await page.evaluate(() => (window as unknown as { __ai: unknown }).__ai)) as { lines: string[]; steps: string[]; seats: string[] };
console.log('   AI lines:', ai.lines.slice(0, 14).join(' | '));
console.log('   AI steps:', ai.steps.join(' → '), '· seats', ai.seats.join(', '));
check(ai.lines.length > 0 && ai.lines.every((l) => !/ is (reinforcing|attacking|fortifying|placing)/.test(l)), 'AI narration says what happened (no "is reinforcing")', results);
check(ai.seats.length >= 1 && !ai.seats.includes('John'), `the AI's own marker is on the track (${ai.seats.join(', ')})`, results);
// Per seat, narration never goes back to "gets N armies" after an attack.
const bySeat = new Map<string, string[]>();
for (const l of ai.lines) {
  const who = l.split(' ')[0];
  bySeat.set(who, [...(bySeat.get(who) ?? []), l]);
}
const outOfOrder = [...bySeat.values()].filter((ls) => {
  const firstAttack = ls.findIndex((l) => / (attacks|takes) /.test(l));
  return firstAttack >= 0 && ls.slice(firstAttack).some((l) => / (gets|places|trades) /.test(l));
});
check(outOfOrder.length === 0, 'AI narration stays in order (place → attack → move)', results);
check(ai.steps.includes('Place') && ai.steps.includes('Attack'), `the marker moved through the segments (${ai.steps.join(' → ')})`, results);

// --- End turn straight from Place (all placed) is one click --------------------------------------------
st = (await state(page))!;
const mine = Object.entries(st.territories).find(([, t]) => t.owner === 0)![0];
await place(page, mine);
await idle(page);
const turn0 = (await state(page))!.turn;
await seg(page, 'endTurn');
await page.waitForFunction((t) => window.__risk.getState()!.turn !== t, turn0, { timeout: 10_000 });
check((await state(page))!.currentPlayer !== 0, 'End turn from Place (all placed) passes the turn in one click', results);

// --- Reset view: only after the player moves the camera -----------------------------------------------
await loadScenario(page, board());
check(!(await ui(page)).viewMoved && !(await page.locator('[data-testid="reset-view"]').isVisible()), 'no Reset view at home', results);
const vp = page.viewportSize()!;
await page.mouse.move(vp.width * 0.5, vp.height * 0.45);
await page.mouse.down({ button: 'right' });
await page.mouse.move(vp.width * 0.62, vp.height * 0.4, { steps: 8 });
await page.mouse.up({ button: 'right' });
await page.mouse.wheel(0, -300);
await page.waitForTimeout(400);
const moved = await ui(page);
check(moved.viewMoved && (await page.locator('[data-testid="reset-view"]').isVisible()), 'after a drag and a zoom: Reset view beside ≡', results);
await clickBtn(page, 'reset-view');
await page.waitForTimeout(900);
check(!(await ui(page)).viewMoved && !(await page.locator('[data-testid="reset-view"]').isVisible()), 'Reset view brings the camera home and goes away', results);

// --- Rules card -----------------------------------------------------------------------------------
await clickBtn(page, 'menu');
await clickBtn(page, 'pause-rules');
const rules = await page.locator('.rules-sheet').innerText();
check(rules.includes('Pieces show army size: soldier 1–4, horse 5–9, cannon 10+.'), 'the Rules card explains the pieces', results);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// --- New game: default seats, one emblem per seat, six swatches in a popover ------------------------------
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__risk?.ui().screen === 'title');
await clickBtn(page, 'title-new');
await page.waitForTimeout(400);
const ng = await page.evaluate(() => ({
  colors: window.__risk ? [0, 1, 2, 3].map((i) => document.querySelector(`[data-testid="seat-color-${i}"]`)?.getAttribute('aria-label') ?? '') : [],
  visibleSwatches: [...document.querySelectorAll<HTMLElement>('[data-testid^="seat-color-"][data-testid$="-rose"]')].filter((e) => e.offsetParent !== null).length,
}));
check(ng.colors.map((x) => x.split(': ')[1]).join(',') === 'Vermilion,Slate,Ochre,Sage', `default seats: ${ng.colors.map((x) => x.split(': ')[1]).join(', ')}`, results);
check(ng.visibleSwatches === 0, 'swatches stay hidden until an emblem is clicked', results);
await clickBtn(page, 'seat-color-3');
const open3 = await page.locator('[data-testid^="seat-color-3-"]:visible').count();
check(open3 === 6, `seat 4's emblem opens six swatches (${open3})`, results);
await clickBtn(page, 'seat-color-3-violet');
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({
  label: document.querySelector('[data-testid="seat-color-3"]')?.getAttribute('aria-label'),
  open: [...document.querySelectorAll<HTMLElement>('[data-testid^="seat-color-3-"]')].filter((e) => e.offsetParent !== null).length,
}));
check(after.label?.endsWith('Wisteria') === true && after.open === 0, `picking a swatch sets the colour and closes it (${after.label})`, results);
await clickBtn(page, 'seat-color-1');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check((await ui(page)).screen === 'newGame' && (await page.locator('[data-testid^="seat-color-1-"]:visible').count()) === 0, 'Esc closes the popover and stays on New game', results);

await browser.close();
finish(results, errors);
