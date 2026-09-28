// Feel and layout checks on the real board + HUD (SPEC §10, docs/SIMPLIFY.md):
//   - the renderer's dice tray sits inside the UI's tray band, just above the bottom strip, with the
//     header line above the tray, at 1280×800, 1440×900, 1920×1080 and TV text on 1920×1080
//   - the only chrome is the two strips (and the tray during a fight); the board spans the window
//   - ≤ 25 words on screen in an armed Attack state
//   - dice ≥ 56 px; army tokens ≥ 22 px tall at home on 1280×800
//   - the bottom strip's rect is identical in place / attack / armed / occupy / fortify / watching
//   - the idle board settles to 0 tweens; a Place click shows its effect within 50 ms
//   - no frame > 50 ms on the first roll after a cold load
//   - no text selection on double-click, no context menu, TV text ≥ 20 px and no HUD overlap
import { ART, check, clickBtn, clickT, finish, idle, loadScenario, open, place, scenario, seg, state } from './lib';
import type { Page } from 'playwright';
import type { Phase } from '../../src/engine';

const results: string[] = [];
const reinforce = (remaining: number): Phase => ({ kind: 'reinforce', remaining, mustTrade: false, placed: {}, midTurn: false });

interface TrayDbg {
  cx: number;
  cy: number;
  trayW: number;
  trayH: number;
  size: number;
}
async function trayAndBand(page: Page) {
  return page.evaluate(() => {
    const dbg = (window.__board as unknown as { __debug: { tray: TrayDbg } }).__debug.tray;
    const r = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    return {
      tray: { top: dbg.cy - dbg.trayH / 2, bottom: dbg.cy + dbg.trayH / 2, left: dbg.cx - dbg.trayW / 2, right: dbg.cx + dbg.trayW / 2, die: dbg.size },
      // The tray band the HUD reports (the header is only the line above the tray now).
      band: r('.band-probe'),
      headerText: (() => {
        const els = [...document.querySelectorAll('.bt-head .bt-side')];
        if (!els.length) return null;
        const rs = els.map((e) => e.getBoundingClientRect());
        return { top: Math.min(...rs.map((x) => x.top)), bottom: Math.max(...rs.map((x) => x.bottom)) };
      })(),
      bar: r('[data-testid="strip"]'),
      top: r('[data-testid="topstrip"]'),
      words: ['.topstrip', '.strip', '.battle:not(.hidden)']
        .map((q) => document.querySelector(q) as HTMLElement | null)
        .filter((e): e is HTMLElement => !!e && e.offsetParent !== null)
        .map((e) => e.innerText)
        .join(' ')
        .split(/\s+/)
        .filter((w) => /[A-Za-z0-9]/.test(w)).length,
      H: innerHeight,
    };
  });
}

// --- Tray ↔ battle band alignment at every target size ------------------------------------------
for (const vp of [
  { width: 1280, height: 800, text: 'laptop' },
  { width: 1440, height: 900, text: 'laptop' },
  { width: 1920, height: 1080, text: 'laptop' },
  { width: 1920, height: 1080, text: 'tv' },
]) {
  const tag = `${vp.width}x${vp.height}${vp.text === 'tv' ? '-tv' : ''}`;
  const { browser, page, errors } = await open(undefined, { width: vp.width, height: vp.height });
  await loadScenario(page, scenario({ ural: [0, 12], ukraine: [0, 2] }, { kind: 'attack' }, { mutate: (s) => void (s.territories.siberia.armies = 6) }), {
    settings: { textSize: vp.text },
  });
  await clickT(page, 'siberia');
  const armedWords = (await trayAndBand(page)).words;
  if (vp.text === 'laptop') check(armedWords <= 25, `${tag}: ${armedWords} words on screen in an armed Attack state (≤ 25)`, results);
  await clickBtn(page, 'btn-roll');
  await page.waitForFunction(() => (window.__board as unknown as { __debug: { tray: { visible: boolean } } }).__debug.tray.visible, null, { timeout: 5000 });
  await page.waitForTimeout(700);
  const g = await trayAndBand(page);
  await page.screenshot({ path: `${ART}/feel-tray-${tag}.png` });
  const tol = 1.5;
  check(!!g.band && g.tray.top >= g.band.top - tol && g.tray.bottom <= g.band.bottom + tol, `${tag}: tray ${Math.round(g.tray.top)}–${Math.round(g.tray.bottom)} inside band ${Math.round(g.band!.top)}–${Math.round(g.band!.bottom)}`, results);
  check(!!g.headerText && g.headerText.bottom <= g.tray.top + tol && g.headerText.bottom >= g.tray.top - 24 && !!g.top && g.headerText.top >= g.top.bottom, `${tag}: header line ${Math.round(g.headerText!.top)}–${Math.round(g.headerText!.bottom)} sits above the tray (${Math.round(g.tray.top)})`, results);
  check(!!g.bar && g.tray.bottom <= g.bar.top + tol, `${tag}: the tray clears the bottom strip (${Math.round(g.tray.bottom)} ≤ ${Math.round(g.bar!.top)})`, results);
  check(!!g.top && g.top.bottom <= 0.07 * g.H && !!g.bar && g.H - g.bar.top <= 0.11 * g.H, `${tag}: chrome is two thin strips (top ${Math.round(g.top!.bottom)} px, bottom ${Math.round(g.H - g.bar!.top)} px)`, results);
  check(Math.abs((g.tray.left + g.tray.right) / 2 - vp.width / 2) < 1 && Math.abs((g.band!.left + g.band!.right) / 2 - vp.width / 2) < 1, `${tag}: tray and band share the centre line`, results);
  check(g.tray.die >= 56, `${tag}: die ${Math.round(g.tray.die)} px (≥ 56)`, results);
  if (vp.text === 'tv') {
    // TV text: every visible HUD text ≥ 20 px, no overlap between the fixed HUD panels.
    const tv = await page.evaluate(() => {
      const small: string[] = [];
      const walk = document.createTreeWalker(document.getElementById('ui')!, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const t = n.textContent?.trim();
        const el = n.parentElement!;
        if (!t || !el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if (el.closest('.hidden, [aria-hidden="true"]')) continue;
        const fs = parseFloat(cs.fontSize);
        if (fs < 19.5) small.push(`${t.slice(0, 24)} (${fs}px ${el.className})`);
      }
      const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
      const panels = ['.topstrip', '.battle', '[data-testid="strip"]'].map((s) => [s, box(s)] as const).filter(([, b]) => b && b.width > 0);
      const overlaps: string[] = [];
      for (let i = 0; i < panels.length; i++)
        for (let j = i + 1; j < panels.length; j++) {
          const a = panels[i][1]!;
          const b = panels[j][1]!;
          if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overlaps.push(`${panels[i][0]} × ${panels[j][0]}`);
        }
      return { small, overlaps };
    });
    check(tv.small.length === 0, `TV text ≥ 20 px (${tv.small.length} smaller: ${tv.small.slice(0, 6).join(' | ')})`, results);
    check(tv.overlaps.length === 0, `TV: HUD panels don't overlap (${tv.overlaps.join(', ') || 'none'})`, results);
  }
  await browser.close();
  if (errors.length) results.push(`FAIL ${tag} console errors: ${errors.join(' | ')}`);
}

// --- 1280×800 home: badges ≥ 22 px; action bar never moves; idle 0 tweens; click → effect ≤ 50 ms ---
{
  const { browser, page, errors } = await open(undefined, { width: 1280, height: 800 });
  await loadScenario(page, scenario({ ural: [0, 3], ukraine: [0, 2], siberia: [0, 1] }, reinforce(6)));
  await page.waitForTimeout(1500);
  const badges = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.rb-badge')].filter((b) => b.style.visibility !== 'hidden').map((b) => b.getBoundingClientRect().height),
  );
  check(badges.length === 42 && Math.min(...badges) >= 22, `army tokens at home on 1280×800: ${badges.length} visible, min height ${Math.min(...badges).toFixed(1)} px (≥ 22)`, results);
  const st0 = await page.evaluate(() => window.__risk.stats());
  check(st0.activeTweens === 0 && !st0.cameraMoving, `idle board: ${st0.activeTweens} tweens, camera ${st0.cameraMoving ? 'moving' : 'still'}`, results);
  await page.screenshot({ path: `${ART}/feel-home-1280x800.png` });

  const rects: Record<string, string> = {};
  const tracks: Record<string, string> = {};
  const barRect = async (k: string) => {
    rects[k] = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="strip"]')!.getBoundingClientRect();
      return `${b.left},${b.top},${b.width},${b.height}`;
    });
    // The Turn Track never disappears or renames (docs/ROUND2.md §A): same labels, same place.
    tracks[k] = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="track"]') as HTMLElement | null;
      if (!t || !t.offsetParent) return 'hidden';
      const b = t.getBoundingClientRect();
      const labels = [...t.querySelectorAll('.tr-label')].map((x) => x.textContent).join('|');
      return `${labels} @ ${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.height)}`;
    });
  };
  await barRect('place');
  // Click → first visible effect: the strip's line says 'Place on Ural' within 50 ms of pointer-up.
  const pos = (await page.evaluate(() => window.__risk.screenPos('ural')))!;
  await page.evaluate(`(() => {
    const line = document.querySelector('[data-testid="line"]');
    window.__ack = { up: 0, seen: 0 };
    window.addEventListener('pointerup', () => (window.__ack.up = performance.now()), { capture: true, once: true });
    new MutationObserver(() => { if (!window.__ack.seen && window.__ack.up) window.__ack.seen = performance.now(); }).observe(line, { subtree: true, characterData: true, childList: true });
  })()`);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(150);
  const ack = (await page.evaluate('window.__ack')) as { up: number; seen: number };
  check(ack.seen > 0 && ack.seen - ack.up <= 50, `Place click → the line updated in ${(ack.seen - ack.up).toFixed(1)} ms (≤ 50)`, results);
  await barRect('place-picked');
  // No text selection on double-click; no context menu on the HUD or the board.
  await page.locator('[data-testid="line"]').dblclick();
  const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  check(sel === '', `double-click selects no text ("${sel}")`, results);
  const ctx = await page.evaluate(() => {
    const out: boolean[] = [];
    for (const el of [document.querySelector('[data-testid="strip"]'), document.querySelector('#board canvas')]) {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
      el!.dispatchEvent(ev);
      out.push(ev.defaultPrevented);
    }
    return out;
  });
  check(ctx.every(Boolean), `context menu suppressed on HUD and board (${ctx.join(', ')})`, results);
  await clickBtn(page, 'btn-place');
  await idle(page);
  await seg(page, 'attack');
  await idle(page);
  await barRect('attack');
  await clickT(page, 'afghanistan');
  await barRect('armed');
  await clickBtn(page, 'btn-blitz');
  await page.waitForTimeout(250);
  await barRect('rolling');
  await idle(page);
  if ((await state(page))!.phase.kind === 'occupy') await barRect('occupy');
  if ((await state(page))!.phase.kind === 'occupy') await clickBtn(page, 'btn-move');
  await idle(page);
  await seg(page, 'fortify');
  await idle(page);
  await barRect('fortify');
  await seg(page, 'endTurn');
  await page.waitForTimeout(700);
  await barRect('watching');
  const distinct = new Set(Object.values(rects));
  check(distinct.size === 1, `bottom strip rect identical across ${Object.keys(rects).join(', ')}: ${[...distinct].join(' | ')}`, results);
  const trackSet = new Set(Object.values(tracks));
  check(trackSet.size === 1 && [...trackSet][0].startsWith('Place|Attack|Fortify|End turn @'), `Turn Track identical across ${Object.keys(tracks).join(', ')}: ${[...trackSet].join(' | ')}`, results);
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

// --- Cold load → first roll: no frame over 50 ms -----------------------------------------------------
{
  const { browser, page, errors } = await open(undefined, { width: 1440, height: 900 });
  await loadScenario(page, scenario({ ural: [0, 12] }, { kind: 'attack' }, { mutate: (s) => void (s.territories.siberia.armies = 3) }));
  await clickT(page, 'siberia');
  await page.evaluate(`(() => { window.__frames = []; let last = performance.now(); const f = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 150) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
  await clickBtn(page, 'btn-roll');
  await page.waitForTimeout(1800);
  const frames = ((await page.evaluate('window.__frames')) as number[]).slice(1);
  const worst = Math.max(...frames);
  const sorted = [...frames].sort((a, b) => a - b);
  check(worst <= 50, `first roll after a cold load: worst frame ${worst.toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms (≤ 50)`, results);
  await browser.close();
  if (errors.length) results.push(`FAIL console errors: ${errors.join(' | ')}`);
}

finish(results, []);
