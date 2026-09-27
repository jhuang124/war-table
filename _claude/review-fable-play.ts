// Fable review: play the live build through the real UI and screenshot each beat.
// Usage: RISK_URL=http://127.0.0.1:5274/ npx tsx _claude/review-fable-play.ts
import { clickBtn, clickT, idle, open, state, ui } from '../tests/e2e/lib';
import { attackSources, attackTargets, fortifySources, fortifyTargets } from '../src/engine';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = '/Users/jhuang/Desktop/JH-Projects/risk3d/_claude/review-fable-shots';
mkdirSync(OUT, { recursive: true });
const log: string[] = [];
const note = (s: string) => {
  log.push(s);
  console.log(s);
};

async function main() {
  const { browser, page, errors } = await open('', { width: 1440, height: 900 });
  let n = 0;
  const shot = async (name: string) => {
    n++;
    const file = `${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: `${OUT}/${file}` });
    const u = await ui(page);
    note(`${file} · [${u.step}] "${u.line}" · buttons: ${u.buttons.join(' / ')}${u.battle ? ` · tray "${u.battle.header}"` : ''}${u.banners?.length ? ` · banner: ${u.banners.join(' | ')}` : ''}`);
  };
  const me = 0;
  const raw = async (testid: string) => {
    const bb = await page.locator(`[data-testid="${testid}"]`).first().boundingBox();
    if (!bb) throw new Error(`no box for ${testid}`);
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  };

  // --- Title → New game → Start, with real clicks
  await page.waitForTimeout(800);
  await shot('title');
  await clickBtn(page, 'title-new');
  await page.waitForTimeout(600);
  await shot('newgame');
  await page.getByRole('button', { name: /^Start/ }).click();
  await page.waitForFunction(() => window.__risk.ui().screen === 'game' && !!window.__risk.getState());
  await page.waitForTimeout(500);
  await shot('turn-banner');
  await idle(page);
  await page.waitForTimeout(1400);
  await shot('place-nothing-picked');

  // --- Hover one of mine
  let s = (await state(page))!;
  const mine = Object.entries(s.territories).filter(([, v]) => v.owner === me).map(([k]) => k);
  const big = mine.slice().sort((a, b) => s.territories[b].armies - s.territories[a].armies);
  const hoverPos = await page.evaluate((id) => window.__risk.screenPos(id as never), big[0]);
  await page.mouse.move(hoverPos!.x, hoverPos!.y);
  await page.waitForTimeout(400);
  await shot('place-hover-own');
  // hover an enemy tile
  const enemy = Object.entries(s.territories).filter(([, v]) => v.owner !== me).map(([k]) => k);
  const ePos = await page.evaluate((id) => window.__risk.screenPos(id as never), enemy[3]);
  await page.mouse.move(ePos!.x, ePos!.y);
  await page.waitForTimeout(400);
  await shot('place-hover-enemy');
  // misclick an enemy in Place
  await page.mouse.click(ePos!.x, ePos!.y);
  await page.waitForTimeout(300);
  await shot('place-misclick-enemy');

  // --- Place: split across two territories with the stepper
  await clickT(page, big[0]);
  await page.waitForTimeout(400);
  await shot('place-picked-stepper');
  const dbg = await page.evaluate(() => { const e = document.querySelector('[data-testid="count-dec"]') as HTMLElement; return { aria: e.getAttribute('aria-disabled'), dis: (e as HTMLButtonElement).disabled, anc: !!e.closest('[aria-disabled="true"],[disabled]') }; });
  note(`count-dec attrs ${JSON.stringify(dbg)}`);
  await raw('count-dec');
  await page.waitForTimeout(120);
  await raw('count-dec');
  await page.waitForTimeout(200);
  await clickBtn(page, 'btn-place');
  await page.waitForTimeout(700);
  await shot('place-after-first-placement');
  await clickT(page, big[1]);
  await page.waitForTimeout(400);
  await clickBtn(page, 'btn-place');
  await page.waitForTimeout(700);
  await shot('place-all-placed');
  await clickBtn(page, 'btn-attack');
  await idle(page);
  await page.waitForTimeout(400);
  await shot('attack-nothing-picked');

  // --- Attack: strongest source, weakest target
  s = (await state(page))!;
  const srcs = attackSources(s, me).sort((a, b) => s.territories[b].armies - s.territories[a].armies);
  const src = srcs[0];
  const tgts = attackTargets(s, src).sort((a, b) => s.territories[a].armies - s.territories[b].armies);
  const tgt = tgts[0];
  note(`attack ${src} (${s.territories[src].armies}) → ${tgt} (${s.territories[tgt].armies})`);
  // pick source first (click own), see targets pulse
  await clickT(page, src);
  await page.waitForTimeout(500);
  await shot('attack-source-picked');
  await clickT(page, tgt);
  await page.waitForTimeout(500);
  await shot('attack-armed');
  await clickBtn(page, 'btn-roll');
  await page.waitForTimeout(650);
  await shot('attack-roll-mid');
  await idle(page);
  await page.waitForTimeout(200);
  await shot('attack-roll-result');
  let took = false;
  for (let i = 0; i < 6; i++) {
    s = (await state(page))!;
    if (s.phase.kind !== 'attack') break;
    if (s.territories[tgt].owner === me) break;
    if (s.territories[src].armies < 2) break;
    await clickBtn(page, 'btn-blitz');
    await page.waitForTimeout(500);
    if (i === 0) await shot('attack-blitz-mid');
    await idle(page);
  }
  s = (await state(page))!;
  if (s.phase.kind === 'occupy') {
    took = true;
    await page.waitForTimeout(300);
    await shot('occupy');
    await clickBtn(page, 'btn-move');
    await page.waitForTimeout(500);
    await shot('occupy-after-move');
    await idle(page);
    await page.waitForTimeout(300);
    await shot('attack-after-conquest');
  } else {
    note(`no conquest: phase ${s.phase.kind}, ${tgt} owner ${s.territories[tgt].owner}`);
  }
  // misclick: click a far enemy that is not adjacent to anything of mine
  s = (await state(page))!;
  if (s.phase.kind === 'attack') {
    await page.keyboard.press('Escape');
    const all = attackSources(s, me).flatMap((x) => attackTargets(s, x));
    const far = Object.keys(s.territories).find((t) => s.territories[t as never].owner !== me && !all.includes(t as never));
    if (far) {
      await clickT(page, far);
      await page.waitForTimeout(250);
      await shot('attack-misclick-unreachable');
    }
  }

  // --- Fortify
  s = (await state(page))!;
  if (s.phase.kind === 'attack') {
    const hasFortify = (await ui(page)).buttons.some((b: string) => /Fortify/.test(b));
    if (hasFortify) await clickBtn(page, 'btn-fortify');
    else await clickBtn(page, 'btn-endTurn');
    await idle(page);
    await page.waitForTimeout(400);
  }
  s = (await state(page))!;
  if (s.phase.kind === 'fortify') {
    await shot('fortify-nothing-picked');
    const fs = fortifySources(s, me).filter((t) => s.territories[t].armies >= 2 && fortifyTargets(s, t).length > 0);
    if (fs.length) {
      const fsrc = fs.sort((a, b) => s.territories[b].armies - s.territories[a].armies)[0];
      await clickT(page, fsrc);
      await page.waitForTimeout(450);
      await shot('fortify-source-picked');
      const fdst = fortifyTargets(s, fsrc)[0];
      await clickT(page, fdst);
      await page.waitForTimeout(450);
      await shot('fortify-armed');
      await clickBtn(page, 'btn-move');
    } else {
      await clickBtn(page, 'btn-endTurn');
    }
  }
  // --- AI turns, at the default speed
  const t0 = Date.now();
  await page.waitForTimeout(900);
  await shot('ai-turn-a');
  await page.waitForTimeout(2500);
  await shot('ai-turn-b');
  await page.waitForTimeout(3000);
  await shot('ai-turn-c');
  await page.waitForFunction(() => {
    const s = window.__risk.getState();
    return !!s && s.currentPlayer === 0 && s.phase.kind === 'reinforce';
  }, null, { timeout: 90_000, polling: 100 });
  note(`AI round took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(350);
  await shot('turn2-banner');
  await idle(page);
  await page.waitForTimeout(1300);
  await shot('turn2-place');

  // --- Turn 2: double-click to place all, attack with blitz, end turn from Attack (skip fortify)
  s = (await state(page))!;
  const mine2 = Object.entries(s.territories).filter(([, v]) => v.owner === me).map(([k]) => k);
  const src2 = attackSources(s, me).sort((a, b) => s.territories[b].armies - s.territories[a].armies)[0] ?? mine2[0];
  const p2 = await page.evaluate((id) => window.__risk.screenPos(id as never), src2);
  await page.mouse.click(p2!.x, p2!.y);
  await page.mouse.click(p2!.x, p2!.y);
  await page.waitForTimeout(700);
  await shot('turn2-dblclick-placed');
  const u2 = await ui(page);
  if (u2.buttons.some((b: string) => /Attack/.test(b))) await clickBtn(page, 'btn-attack');
  await idle(page);
  s = (await state(page))!;
  if (s.phase.kind === 'attack') {
    const t2 = attackTargets(s, src2).sort((a, b) => s.territories[a].armies - s.territories[b].armies)[0];
    if (t2) {
      await clickT(page, t2);
      await page.waitForTimeout(400);
      await clickBtn(page, 'btn-blitz');
      await page.waitForTimeout(900);
      await shot('turn2-blitz-mid');
      await idle(page);
      s = (await state(page))!;
      if (s.phase.kind === 'occupy') {
        await page.waitForTimeout(200);
        await shot('turn2-occupy');
        // click the board to confirm default
        await clickT(page, t2);
        await idle(page);
        await page.waitForTimeout(300);
        await shot('turn2-after-occupy-chain');
      }
    }
    s = (await state(page))!;
    if (s.phase.kind === 'attack') {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await clickBtn(page, 'btn-endTurn');
      await page.waitForTimeout(600);
      await shot('turn2-ended-from-attack');
    }
  }
  // Menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await shot('menu');
  await page.keyboard.press('Escape');

  const m = await page.evaluate(() => window.__risk.metrics());
  note(`metrics: ${JSON.stringify(m.turns.map((t: any) => ({ p: t.player, k: t.kind, ms: t.ms, clicks: t.clicks, rejected: t.rejected })))}`);
  note(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
  await browser.close();

  // --- Layout at other sizes (Place state, nothing picked)
  for (const [w, h] of [[1280, 800], [1920, 1080]] as const) {
    const c = await open('', { width: w, height: h });
    await c.page.evaluate(() => window.__risk.newGame());
    await c.page.waitForFunction(() => window.__risk.ui().screen === 'game' && !!window.__risk.getState());
    await c.page.evaluate(() => window.__risk.waitIdle(20000));
    await c.page.waitForTimeout(1600);
    await c.page.screenshot({ path: `${OUT}/layout-${w}x${h}.png` });
    // measure land bbox vs viewport
    const bb = await c.page.evaluate(() => {
      const ids = Object.keys(window.__risk.getState()!.territories);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const id of ids) {
        const p = window.__risk.screenPos(id as never);
        if (!p) continue;
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      return { x0, x1, y0, y1 };
    });
    note(`${w}x${h} token bbox x ${bb.x0.toFixed(0)}–${bb.x1.toFixed(0)} y ${bb.y0.toFixed(0)}–${bb.y1.toFixed(0)}`);
    await c.browser.close();
  }
  writeFileSync(`${OUT}/log.txt`, log.join('\n') + '\n');
}

main().catch((e) => {
  console.error(e);
  writeFileSync(`${OUT}/log.txt`, log.join('\n') + '\nERROR ' + String(e) + '\n');
  process.exit(1);
});
