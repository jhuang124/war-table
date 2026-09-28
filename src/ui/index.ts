// The HTML UI (docs/SIMPLIFY.md): renders the ViewModel, sends UiIntents, never imports the engine.
//
// In game the only chrome floats on the board (docs/ROUND2.md): the seat pills + ≡ at the top, the
// bottom strip (Turn Track · line · count · ≤ 2 buttons) and, during a fight, the dice tray's header
// line. The banner slot, the cards sheet, the hand-off cover and the menu sheets come and go.
//
// Rendering: each component keeps its elements and patches them; every level short-circuits on
// ViewModel identity (the controller keeps unchanged subtrees identical), so an idle frame costs a few
// reference compares and no DOM writes.

import './styles.css';
import type { MountUi, Screen, UiIntent, ViewModel } from '../game/viewModel';
import type { ViewportInsets } from '../render/BoardView';
import { h, motion, setAttr, toggle } from './dom';
import { trayGeometry } from '../shared/tray';
import { Announcements } from './hud/announce';
import { BattleHeader } from './hud/battle';
import { CardsSheet } from './hud/cards';
import { BottomStrip } from './hud/strip';
import { TopStrip } from './hud/topstrip';
import { Confirm, Handoff, Overlays } from './overlays';
import { NewGameScreen } from './screens/newgame';
import { TitleScreen } from './screens/title';
import { VictoryScreen } from './screens/victory';
import { effectiveUiScale, isFitted } from './uiScale';

/**
 * Dice-tray band, just above the bottom strip. The renderer centres its tray in the band
 * (src/shared/tray.ts). Only the header line sits above the tray (nothing below it), so the band is the
 * tray plus the header's height and a small gap, split evenly; the header's bottom sits on the tray's top
 * edge and may rise a few px above the band. Returns the band, the header height (`strip`) and the
 * distance from the band's bottom to the tray's top (`trayTop`), in CSS px.
 */
export function solveBand(H: number, scale: number, W = typeof window !== 'undefined' ? window.innerWidth : 1440): { band: number; strip: number; trayTop: number } {
  const rem = 16 * scale;
  const need = Math.ceil(Math.max(0.022 * H, 1.0625 * rem) * 1.6);
  const cap = Math.round(H * 0.34);
  let band = 96;
  for (; band <= cap; band += 2) if (band - trayGeometry(W, H, band, scale).trayH >= need + 8) break;
  band = Math.min(band, cap);
  const trayH = trayGeometry(W, H, band, scale).trayH;
  const margin = Math.floor((band - trayH) / 2);
  return { band, strip: need, trayTop: margin + trayH };
}

interface Instance {
  newGame: NewGameScreen;
  victory: VictoryScreen;
}
let current: Instance | null = null;

/** Gallery / test hook: poke local-only UI state (house rules drawer, victory intro). */
export function uiDebug() {
  const c = current;
  return {
    openHouseRules: () => c?.newGame.setHouseOpen(true),
    skipVictoryIntro: () => c?.victory.showFull(),
  };
}

export const mountUi: MountUi = (host, api) => {
  const boot = host.querySelector('#boot-splash') as HTMLElement | null;
  const root = h('div', 'ui-root');
  host.append(root);
  const send = (i: UiIntent) => api.intent(i);

  // ---- components ---------------------------------------------------------
  const hud = h('div', 'hud');
  const top = new TopStrip(send);
  const strip = new BottomStrip(send);
  const battle = new BattleHeader();
  const announce = new Announcements();
  const cards = new CardsSheet(send);
  // Always-laid-out twin of the tray band, so the insets are right while the header is hidden.
  const bandProbe = h('div', 'band-probe');
  bandProbe.setAttribute('aria-hidden', 'true');
  hud.append(top.el, battle.el, strip.el, cards.el, announce.el, bandProbe);

  const title = new TitleScreen(send);
  const newGame = new NewGameScreen(send);
  const victory = new VictoryScreen(send);
  const handoff = new Handoff(send);
  const overlays = new Overlays(send);
  const confirm = new Confirm(send);
  root.append(hud, title.el, newGame.el, victory.el, handoff.el, overlays.el, confirm.el);
  current = { newGame, victory };

  const screens: Partial<Record<Screen, HTMLElement>> = { title: title.el, newGame: newGame.el, victory: victory.el };
  for (const el of Object.values(screens)) el!.classList.add('off');
  hud.classList.add('off');

  // ---- screen crossfade (360 ms) ------------------------------------------
  let screen: Screen | null = null;
  const showScreen = (next: Screen) => {
    if (next === screen) return;
    const prev = screen;
    screen = next;
    const outEl = prev === 'game' ? hud : prev ? screens[prev] : null;
    const inEl = next === 'game' ? hud : screens[next];
    if (outEl && outEl !== inEl) {
      outEl.getAnimations().forEach((a) => a.cancel());
      if (motion.reduced || prev === 'boot') outEl.classList.add('off');
      else {
        outEl.classList.add('leaving');
        const a = outEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'ease-in-out', fill: 'forwards' });
        a.onfinish = () => {
          if (screen !== prev) outEl.classList.add('off');
          outEl.classList.remove('leaving');
          a.cancel();
        };
      }
    }
    if (inEl) {
      inEl.getAnimations().forEach((a) => a.cancel());
      inEl.classList.remove('off', 'leaving');
      if (!motion.reduced && prev) inEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-in-out' });
    }
    if (next === 'newGame') requestAnimationFrame(() => screen === 'newGame' && !vm?.overlay && newGame.focusFirstName());
    if (next !== 'boot' && boot) {
      const b = boot;
      b.animate([{ opacity: getComputedStyle(b).opacity }, { opacity: 0 }], { duration: 240, fill: 'forwards' }).onfinish = () => b.remove();
    }
  };

  // ---- viewport insets: the top strip, the bottom strip, the tray band above it ---------------------
  let lastInsets = '';
  let scale = 1;
  const measure = () => {
    const H = window.innerHeight;
    const W = window.innerWidth;
    const { band, strip: headerStrip, trayTop } = solveBand(H, scale, W);
    root.style.setProperty('--tray', `${band}px`);
    root.style.setProperty('--strip', `${headerStrip}px`);
    root.style.setProperty('--tray-top', `${trayTop}px`);
    // The real HUD edges: the bottom of the top pills, the top of the floating strip.
    let topEdge = 0;
    for (const el of top.el.querySelectorAll<HTMLElement>('.seat-chip, .ts-menu')) {
      if (el.offsetParent === null) continue;
      topEdge = Math.max(topEdge, el.getBoundingClientRect().bottom);
    }
    if (!topEdge) topEdge = top.el.getBoundingClientRect().bottom;
    const st = strip.el.getBoundingClientRect();
    // The persistent floating HUD as rectangles (seat pills, ≡, the strip; not the transient Reset view
    // pill), so the home view can run the board up between the corner pills.
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    const rectOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    };
    const seatsRow = top.el.querySelector('.ts-seats');
    if (seatsRow) rectOf(seatsRow);
    const menuPill = top.el.querySelector('.ts-menu');
    if (menuPill) rectOf(menuPill);
    rectOf(strip.el);
    const insets: ViewportInsets = {
      top: Math.round(topEdge),
      left: 0,
      right: 0,
      bottom: Math.round(H - st.top + 4),
      trayBand: band,
      rects,
    };
    const key = JSON.stringify(insets);
    if (key !== lastInsets) {
      lastInsets = key;
      api.setViewportInsets(insets);
    }
  };
  let measureQueued = false;
  const queueMeasure = () => {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => {
      measureQueued = false;
      measure();
    });
  };
  const ro = new ResizeObserver(queueMeasure);
  for (const el of [top.el, strip.el, bandProbe, top.el.querySelector('.ts-seats')!]) ro.observe(el);
  window.addEventListener('resize', queueMeasure);

  // ---- text size, fitted to the screen (src/ui/uiScale.ts) ------------------
  let fitted = false;
  const applyScale = (relayout: boolean) => {
    const size = vm?.settings.textSize ?? 'laptop';
    const W = window.innerWidth;
    const H = window.innerHeight;
    const nextScale = effectiveUiScale(size, W, H);
    const nextFitted = isFitted(size, W, H);
    const fitChanged = nextFitted !== fitted;
    fitted = nextFitted;
    if (fitChanged && vm) {
      title.setFitted(fitted);
      overlays.setFitted(fitted);
    }
    if (nextScale === scale && document.documentElement.style.fontSize) return;
    scale = nextScale;
    document.documentElement.style.fontSize = `${scale * 100}%`;
    queueMeasure();
    if (relayout) requestAnimationFrame(() => victory.refreshChart());
  };
  const onResizeScale = () => applyScale(true);
  window.addEventListener('resize', onResizeScale);

  // ---- render -------------------------------------------------------------
  let vm: ViewModel | null = null;
  const render = (next: ViewModel) => {
    const prev = vm;
    vm = next;
    if (prev === next) return;
    motion.reduced = next.reducedMotion;
    toggle(root, 'rm', next.reducedMotion);
    if (!prev || prev.settings.textSize !== next.settings.textSize) applyScale(!!prev);
    showScreen(next.screen);
    toggle(root, 'in-game', next.screen === 'game');

    if (next.screen === 'title' || next.overlay) title.update(next);
    if (next.screen === 'newGame') newGame.update(next.newGame);
    victory.update(next.victory, next.screen === 'victory');
    setAttr(victory.el, 'data-testid', next.screen === 'victory' ? 'victory' : null);

    const g = next.game;
    if (g && (!prev || prev.game !== g)) {
      top.update(g.seats);
      top.setViewMoved(g.viewMoved);
      strip.update(g.strip);
      battle.update(g.battle);
      announce.update(g.banner);
      cards.update(g.cards);
      handoff.update(g.handoff);
      confirm.update(g.confirm);
    } else if (!g && prev?.game) {
      battle.update(null);
      announce.update(null);
      cards.update(null);
      handoff.update(null);
      confirm.update(null);
    }
    if (!prev || prev.overlay !== next.overlay || prev.settings !== next.settings || prev.screen !== next.screen || prev.rulesNotes !== next.rulesNotes || (next.overlay && prev.game !== next.game))
      overlays.update(next);
    toggle(root, 'overlay-open', !!next.overlay || !!g?.confirm);
  };

  // ---- delegated input behavior -------------------------------------------
  let lastHover: Element | null = null;
  let lastHoverAt = 0;
  const isBtn = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('button, [role="slider"]') : null);
  const onPointerDown = (e: PointerEvent) => {
    const b = isBtn(e.target);
    if (b && b.getAttribute('aria-disabled') !== 'true') b.classList.add('is-down');
    // Any press on the UI dismisses the turn banner (board clicks are the controller's).
    if (vm?.game?.banner?.kind === 'turn') send({ type: 'dismissTurnBanner' });
  };
  const clearDown = () => root.querySelectorAll('.is-down').forEach((el) => el.classList.remove('is-down'));
  const onMouseDown = (e: MouseEvent) => {
    // No mouse focus on buttons: the keyboard stays with the game, and focus rings stay keyboard-only.
    if (isBtn(e.target)?.tagName === 'BUTTON') e.preventDefault();
  };
  const onClick = (e: MouseEvent) => {
    const b = isBtn(e.target);
    if (!b || b.tagName !== 'BUTTON' || b.getAttribute('aria-disabled') === 'true') return;
    // The Turn Track's advance is a wooden clack (the controller plays it), not a UI tick.
    if (b.classList.contains('tr-seg')) return;
    api.audio.play('uiClick');
  };
  const onOver = (e: PointerEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    const b = t?.closest<HTMLElement>('button');
    if (b && b !== lastHover) {
      lastHover = b;
      if (b.classList.contains('tr-seg') && b.getAttribute('aria-disabled') === 'true') return;
      const now = performance.now();
      if (b.getAttribute('aria-disabled') !== 'true' && now - lastHoverAt > 90) {
        lastHoverAt = now;
        api.audio.play('uiHover');
      }
    } else if (!b) lastHover = null;
  };
  const onContext = (e: MouseEvent) => e.preventDefault();

  // Keyboard: the controller owns game keys. The UI only handles keys for its own layers (menus,
  // dialogs, text fields) and stops them there so nothing fires twice.
  const onKey = (e: KeyboardEvent) => {
    const v = vm;
    if (!v) return;
    const t = e.target as HTMLElement | null;
    const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (inField) {
      // An open colour popover closes first (the name field keeps focus while the emblem is clicked).
      if (e.key === 'Escape' && v.screen === 'newGame' && newGame.closeSwatches()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Typing a name must never trigger game shortcuts. Enter / Esc finish the edit.
      if (e.key === 'Escape' || e.key === 'Enter') t!.blur();
      e.stopPropagation();
      return;
    }
    const focusedCtl = !!t && t !== document.body && root.contains(t) && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'slider');
    const g = v.game;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return stop();
    if (g?.confirm && v.screen === 'game') {
      if (e.key === 'Escape') (stop(), send({ type: 'confirm', yes: false }));
      else if (e.key === 'Enter' && !focusedCtl) (stop(), send({ type: 'confirm', yes: true }));
      else if (focusedCtl && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
      else if (e.key !== 'Tab') stop();
      return;
    }
    if (v.overlay) {
      if (e.key === 'Escape') {
        stop();
        send({ type: 'overlay', overlay: v.overlay !== 'pause' ? overlays.backTarget() : null });
      } else if (e.key === 'Enter' && !focusedCtl && v.overlay === 'pause') (stop(), send({ type: 'overlay', overlay: null }));
      else if (focusedCtl && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
      else if (e.key !== 'Tab' && !e.key.startsWith('Arrow')) stop();
      return;
    }
    if (v.screen === 'game') {
      if (g?.handoff && (e.key === 'Enter' || e.key === ' ')) (stop(), send({ type: 'handoffAccept' }));
      else if (focusedCtl && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
      return;
    }
    // Menu screens.
    if (focusedCtl && (e.key === 'Enter' || e.key === ' ')) return void e.stopPropagation();
    if (v.screen === 'title') {
      if (e.key === 'Enter') (stop(), send(v.save ? { type: 'continue' } : { type: 'nav', screen: 'newGame' }));
    } else if (v.screen === 'newGame') {
      if (e.key === 'Enter') (stop(), v.newGame.canStart && send({ type: 'start' }));
      else if (e.key === 'Escape') (stop(), newGame.closeSwatches() || send({ type: 'nav', screen: 'title' }));
    } else if (v.screen === 'victory') {
      if (e.key === 'Enter') {
        stop();
        if (victory.phase === 'full') send({ type: 'rematch' });
        else victory.showFull();
      }
    }
  };

  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', clearDown);
  window.addEventListener('pointercancel', clearDown);
  root.addEventListener('pointerleave', clearDown);
  root.addEventListener('mousedown', onMouseDown);
  root.addEventListener('click', onClick);
  root.addEventListener('pointerover', onOver);
  root.addEventListener('contextmenu', onContext);
  window.addEventListener('keydown', onKey, true);

  render(api.getViewModel());
  measure();
  document.fonts?.ready.then(queueMeasure);
  const unsub = api.subscribe(render);

  return {
    dispose() {
      unsub();
      ro.disconnect();
      window.removeEventListener('resize', queueMeasure);
      window.removeEventListener('resize', onResizeScale);
      window.removeEventListener('pointerup', clearDown);
      window.removeEventListener('pointercancel', clearDown);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      if (current?.newGame === newGame) current = null;
    },
  };
};

export default mountUi;
