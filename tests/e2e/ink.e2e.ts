// The ink overhaul's three checks (docs/INK.md A9), on the real board + HUD:
//   1. One gold on screen at a time, sampled every frame across a real turn: place, attack by tap and
//      by a drawn stroke, a roll, a blitz and its conquest, occupy, fortify, end turn, the AI turns that
//      follow, and the menu sheet. Gold = any visible HUD element inked in the gold (text, border,
//      shadow, fill), plus the board's gold (the live stroke, or the arrow while the dice decide). The
//      gold rule and its ensō are the UI's signature, not a "thing", and don't count.
//   2. Draw to attack (A2), mouse and touch: a drag from an eligible source draws a live gold stroke
//      that arms nothing while it's drawn; release over an adjacent enemy arms it exactly like a tap
//      (the odds line, Roll / Blitz) and rolls nothing; release elsewhere cancels; a drag from anywhere
//      else pans (touch) and never draws.
//   3. The tempo budgets (A6), from __risk.metrics(): a single roll ≤ 1.25 s including the 250 ms
//      verdict silence, a blitz ≤ 3.0 s, forced wait on your own turn 0. (The AI turn median and the
//      brief AI-vs-AI engagement are measured over a long game in game.e2e.ts, at the same limits.)
import { check, clickBtn, clickT, finish, idle, loadScenario, open, scenario, seg, state, ui } from './lib';
import { openDevice, tapId } from './mobile-lib';
import type { Page } from 'playwright';
import type { Phase } from '../../src/engine';

const results: string[] = [];
const allErrors: string[] = [];
const reinforce = (remaining: number): Phase => ({ kind: 'reinforce', remaining, mustTrade: false, placed: {}, midTurn: false });

// ---------------------------------------------------------------------------------------------------
// The sampler: counts gold things on screen every frame, keeps the worst moments.
// ---------------------------------------------------------------------------------------------------
async function startGoldSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const GOLD = [201, 169, 97];
    const near = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return false;
      const [r, g, b, a = '1'] = m[1].split(/[,\s/]+/).filter(Boolean);
      return Math.abs(+r - GOLD[0]) <= 14 && Math.abs(+g - GOLD[1]) <= 14 && Math.abs(+b - GOLD[2]) <= 14 && +a >= 0.35;
    };
    const effOpacity = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
      return o;
    };
    const signature = (el: Element) => !!el.closest('.st-rule, .lk-rule, #boot-splash');
    const goldThings = (): string[] => {
      const found: Element[] = [];
      for (const el of document.querySelectorAll('.ui-root *')) {
        if (signature(el)) continue;
        if (el.closest('.leaving')) continue; // a screen drying out (its gold has already stepped down)
        if (found.some((f) => f.contains(el))) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
        if (!(el as HTMLElement).checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) continue;
        const cs = getComputedStyle(el);
        const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
        const border = sides.some((s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) >= 0.5 && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== 'none' && near(cs.getPropertyValue(`border-${s.toLowerCase()}-color`)));
        const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && near(cs.color);
        const shadow = /rgba?\(\s*20[0-2],\s*1(6[89]|7\d),\s*(9\d|10\d)/.test(cs.boxShadow);
        const bg = near(cs.backgroundColor);
        const svg = el instanceof SVGElement && !(el instanceof SVGSVGElement) && (near(cs.fill) || near(cs.stroke));
        // The track's marker (.tr-fill) and the current word inside it are one gold thing.
        const key = el.closest('.tr-fill') ? (document.querySelector('.tr-seg.is-current') ?? el) : (el.closest('button, [data-testid], .seat') ?? el);
        if ((border || text || shadow || bg || svg) && effOpacity(el) >= 0.3) found.push(key);
      }
      const uniq = [...new Set(found)];
      return uniq.map((e) => (e as HTMLElement).dataset?.testid ?? `${e.tagName.toLowerCase()}.${String(e.getAttribute('class') ?? '').split(' ')[0]}`);
    };
    const board = () => {
      const d = (window.__board as unknown as {
        __debug?: { arrow: { group: { visible: boolean }; gold: number }; live: { active: boolean; group: { visible: boolean }; body: { u: { uOpacity: { value: number } } } } };
      }).__debug;
      if (!d) return [] as string[];
      // The live stroke settles into the arrow: one gold mark on the board, whichever is showing.
      const stroke = d.live.group.visible && d.live.body.u.uOpacity.value > 0.5;
      const arrow = d.arrow.group.visible && d.arrow.gold > 0.5;
      return stroke || arrow ? ['board:gold-stroke'] : [];
    };
    const w = window as unknown as { __gold: { n: number; max: number; worst: string[][]; stop: boolean } };
    w.__gold = { n: 0, max: 0, worst: [], stop: false };
    // Every frame; a double counts only if it holds on two consecutive frames. (The HUD and the board
    // repaint on their own frame loops, so for one frame one of them can be a frame behind the other.)
    let prev: string[] = [];
    const tick = (t: number) => {
      if (w.__gold.stop) return;
      {
        const now = [...goldThings(), ...board()];
        const all = now.length > 1 && prev.length > 1 ? now : now.slice(0, Math.min(now.length, Math.max(1, prev.length)));
        prev = now;
        w.__gold.n++;
        if (all.length > w.__gold.max) w.__gold.max = all.length;
        if (all.length > 1 && w.__gold.worst.length < 8) w.__gold.worst.push([...all, `@${Math.round(t)}ms "${window.__risk.ui().line}" vm ${window.__risk.ui().gold} arrow ${(window.__board as unknown as { __debug: { arrow: { gold: number; key: string } } }).__debug.arrow.gold.toFixed(2)} live ${JSON.stringify((({ active, group, body }) => [active, group.visible, +body.u.uOpacity.value.toFixed(2)])((window.__board as unknown as { __debug: { live: { active: boolean; group: { visible: boolean }; body: { u: { uOpacity: { value: number } } } } } }).__debug.live))}`]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const goldReport = (page: Page) => page.evaluate(() => (window as unknown as { __gold: { n: number; max: number; worst: string[][] } }).__gold);

const pos = (page: Page, t: string) => page.evaluate((id) => window.__risk.screenPos(id as never)!, t);
const boardDbg = (page: Page) =>
  page.evaluate(() => {
    const d = (window.__board as unknown as { __debug: { live: { active: boolean }; arrow: { group: { visible: boolean }; gold: number } } }).__debug;
    return { live: d.live.active, arrow: d.arrow.group.visible, arrowGold: d.arrow.gold };
  });

// ---------------------------------------------------------------------------------------------------
// Desktop: a real turn with the sampler running (1 + 3 inside it).
// ---------------------------------------------------------------------------------------------------
{
  const { browser, page, errors } = await open();
  await loadScenario(
    page,
    scenario({ ural: [0, 4], siberia: [1, 2], ukraine: [0, 1], afghanistan: [0, 2] }, reinforce(9), {
      mutate: (s) => {
        s.territories.china = { owner: 1, armies: 1 };
        s.territories.middle_east = { owner: 1, armies: 1 };
      },
    }),
  );
  await startGoldSampler(page);

  // Place: pick + Place 9.
  await clickT(page, 'ural');
  await page.waitForTimeout(150);
  await clickBtn(page, 'btn-place');
  await idle(page);
  await seg(page, 'attack');
  await idle(page);

  // Arm by tap; one single roll.
  await clickT(page, 'siberia');
  await page.waitForTimeout(250);
  let u = await ui(page);
  check(u.gold === 'button:blitz' && !(await boardDbg(page)).arrowGold, `armed by tap: the arrow rests ivory, Blitz holds the gold (${u.gold})`, results);
  await clickBtn(page, 'btn-roll');
  await page.waitForTimeout(350);
  const mid = await boardDbg(page);
  u = await ui(page);
  check(mid.arrowGold > 0.5 && u.gold === null, `while the dice decide the arrow is gold and the HUD steps down (arrow ${mid.arrowGold.toFixed(2)}, HUD ${u.gold})`, results);
  await idle(page);

  // Arm by a drawn stroke (mouse), then blitz it through. (Esc clears the undecided roll's selection.)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const a = await pos(page, 'ural');
  const b = await pos(page, 'china');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12);
    await page.waitForTimeout(16);
  }
  const drawing = await boardDbg(page);
  u = await ui(page);
  const before = await state(page);
  check(drawing.live && u.gold === null && !u.buttons.includes('Blitz'), `mouse: mid-stroke the live gold stroke is drawn, nothing is armed, the HUD holds no gold (${u.buttons.join('/') || 'no buttons'})`, results);
  await page.screenshot({ path: 'artifacts/e2e/ink-stroke-mid.png' });
  await page.mouse.up();
  await page.waitForTimeout(200);
  u = await ui(page);
  const after = await state(page);
  check(/^Ural → China · \d+%( · .+)?$/.test(u.line) && u.buttons.join(' / ') === 'Roll / Blitz' && u.gold === 'button:blitz', `mouse: release on China arms it like a tap: "${u.line}" · ${u.buttons.join(' / ')} · gold ${u.gold}`, results);
  check(JSON.stringify(after!.territories) === JSON.stringify(before!.territories), 'mouse: the stroke itself rolled nothing', results);
  await page.waitForTimeout(400);
  check(!(await boardDbg(page)).live && (await boardDbg(page)).arrowGold < 0.5, 'mouse: the stroke settled into the resting ivory arrow', results);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  if ((await state(page))!.phase.kind === 'occupy') {
    await clickBtn(page, 'btn-move');
    await idle(page);
  }

  // A stroke released over open water cancels.
  const c0 = await pos(page, 'afghanistan');
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(c0.x + 12 * i, c0.y + 26 * i);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  u = await ui(page);
  check(!u.buttons.includes('Blitz') && !/→/.test(u.line), `mouse: released elsewhere, the stroke dries out and nothing is armed ("${u.line}")`, results);

  // Fortify, end the turn, watch the AIs for a while, open the menu sheet.
  await seg(page, 'fortify');
  await idle(page);
  await seg(page, 'endTurn');
  await page.waitForTimeout(6000);
  await clickBtn(page, 'menu');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await idle(page, 60000).catch(() => undefined);

  const g = await goldReport(page);
  check(g.n > 600 && g.max <= 1, `one gold at a time: max ${g.max} over ${g.n} samples${g.worst.length ? ` — ${g.worst.map((w) => w.join(' + ')).join(' | ')}` : ''}`, results);

  // Tempo (A6).
  const m = await page.evaluate(() => window.__risk.metrics());
  const singles = m.rolls.filter((r) => r.style === 'full' && !r.blitz && r.count === 1).map((r) => r.ms);
  const blitzes = m.rolls.filter((r) => r.style === 'full' && r.blitz).map((r) => r.ms);
  const human = m.turns.filter((t) => t.kind === 'human');
  check(singles.length > 0 && Math.max(...singles) <= 1250, `single roll ≤ 1.25 s incl. the 250 ms silence (${singles.join(', ')} ms)`, results);
  check(blitzes.length > 0 && Math.max(...blitzes) <= 3000, `blitz ≤ 3.0 s (${blitzes.join(', ')} ms)`, results);
  check(human.length > 0 && human.every((t) => t.forcedWaitMs === 0), `forced wait on your own turn: ${human.map((t) => t.forcedWaitMs).join(', ')} ms`, results);
  allErrors.push(...errors);
  await browser.close();
}

// A long blitz on its own: the cap holds even with many rolls.
{
  const { browser, page, errors } = await open();
  await loadScenario(page, scenario({ ural: [0, 40], siberia: [1, 30] }, { kind: 'attack' }));
  await clickT(page, 'siberia');
  await page.waitForTimeout(150);
  await clickBtn(page, 'btn-blitz');
  await idle(page, 30000);
  const m = await page.evaluate(() => window.__risk.metrics());
  const bl = m.rolls.filter((r) => r.blitz && r.style === 'full');
  check(bl.length > 0 && Math.max(...bl.map((r) => r.ms)) <= 3000, `a ${bl[0]?.count ?? '?'}-roll blitz ≤ 3.0 s (${bl.map((r) => r.ms).join(', ')} ms)`, results);
  allErrors.push(...errors);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
// Touch (iPhone 15 Pro, landscape: the smallest board): draw, cancel, and a drag elsewhere pans.
// ---------------------------------------------------------------------------------------------------
for (const dev of ['iphone-land', 'iphone'] as const) {
  const ctx = await openDevice(dev);
  const { page, cdp } = ctx;
  await loadScenario(page, scenario({ ural: [0, 8], siberia: [1, 2], ukraine: [0, 1] }, { kind: 'attack' }));
  await page.waitForTimeout(350); // past the turn-start guard
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const stroke = async (x0: number, y0: number, x1: number, y1: number, mid?: () => Promise<void>) => {
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= 14; i++) {
      await touch('touchMove', x0 + ((x1 - x0) * i) / 14, y0 + ((y1 - y0) * i) / 14);
      await page.waitForTimeout(16);
      if (i === 10 && mid) await mid();
    }
    await touch('touchEnd');
  };
  const k = await pos(page, 'ural');
  const al = await pos(page, 'siberia');
  let midSeen = { live: false, armed: true };
  await stroke(k.x, k.y, al.x, al.y, async () => {
    const d = await boardDbg(page);
    const u = await ui(page);
    midSeen = { live: d.live, armed: u.buttons.includes('Blitz') };
  });
  await page.waitForTimeout(250);
  let u = await ui(page);
  check(midSeen.live && !midSeen.armed, `${dev} touch: mid-stroke the gold stroke follows the finger, nothing armed yet`, results);
  check(/^Ural → Siberia · \d+%( · .+)?$/.test(u.line) && u.buttons.join(' / ') === 'Roll / Blitz', `${dev} touch: release on Siberia arms it: "${u.line}" · ${u.buttons.join(' / ')}`, results);
  const s1 = await state(page);
  check(s1!.territories.siberia.owner === 1 && s1!.territories.siberia.armies === 2, `${dev} touch: the stroke rolled nothing`, results);
  await page.screenshot({ path: `artifacts/e2e/ink-touch-armed-${dev}.png` });

  // A drag from open water pans the board and never draws.
  const cam0 = await page.evaluate(() => JSON.stringify((window.__board as unknown as { __debug: { rig: { goal: { tx: number; tz: number } } } }).__debug.rig.goal));
  let sawStroke = false;
  const vw = page.viewportSize()!;
  await stroke(vw.width * 0.5, vw.height * 0.62, vw.width * 0.5 - 80, vw.height * 0.62 + 30, async () => {
    sawStroke = (await boardDbg(page)).live;
  });
  await page.waitForTimeout(250);
  const cam1 = await page.evaluate(() => JSON.stringify((window.__board as unknown as { __debug: { rig: { goal: { tx: number; tz: number } } } }).__debug.rig.goal));
  check(!sawStroke && cam1 !== cam0, `${dev} touch: a drag from the sea pans (${cam0 !== cam1}) and draws nothing`, results);
  // Still armed (a pan never cancels), then a stroke to nowhere clears nothing it shouldn't: tap-to-target still works.
  u = await ui(page);
  check(u.buttons.includes('Blitz'), `${dev} touch: the pan left the armed attack alone`, results);
  await tapId(page, 'btn-blitz');
  await idle(page, 20000).catch(() => undefined);
  allErrors.push(...ctx.errors.map((e) => `${dev} ${e}`));
  await ctx.browser.close();
}

finish(results, allErrors);
