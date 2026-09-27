// The HTML UI (SPEC §7, UX.md). Renders the ViewModel, sends UiIntents, never imports the engine.
//
// Rendering: each component keeps its elements and patches them; every level short-circuits on
// ViewModel identity (the controller keeps unchanged subtrees identical), so an idle frame costs a few
// reference compares and no DOM writes. The only per-frame work is positioning the reinforce pills.

import './styles.css';
import type { ControllerApi, MountUi, Screen, UiIntent, ViewModel } from '../game/viewModel';
import type { ViewportInsets } from '../render/BoardView';
import { h, motion, setAttr, toggle } from './dom';
import { trayGeometry } from '../shared/tray';
import { ActionBar } from './hud/actionbar';
import { Announcements } from './hud/announce';
import { BattlePanel } from './hud/battle';
import { Pills, Tooltip } from './hud/float';
import { CardsDrawer, LogDrawer, Rail } from './hud/rail';
import { Roster } from './hud/roster';
import { TopBar } from './hud/topbar';
import { Confirm, Handoff, HumansOut, Overlays } from './overlays';
import { NewGameScreen } from './screens/newgame';
import { TitleScreen } from './screens/title';
import { VictoryScreen } from './screens/victory';
import { effectiveUiScale, isFitted } from './uiScale';

/**
 * Battle band height. The renderer centers its tray in the band (src/render/dice.ts layout():
 * die = max(56, min(8vh × uiScale, 0.56 × band)), tray = max(1.75 × die, 0.66 × band)). This panel's
 * text lives only in the margins above and below the tray, so pick the smallest band whose margins fit
 * the worst-case text (header above; odds + two priority stakes below), capped at 34% of the height.
 * Returns the band and the margin (= the height of each text strip), in CSS px.
 */
export function solveBand(H: number, scale: number, W = typeof window !== 'undefined' ? window.innerWidth : 1440): { band: number; strip: number } {
  const rem = 16 * scale;
  const header = Math.max(0.022 * H, 1.0625 * rem) * 1.5;
  const odds = Math.max(0.03 * H, 1.375 * rem) * 1.2;
  const stakes = 2 * Math.max(0.0186 * H, 1.05 * rem) * 1.12 + 4;
  const need = Math.ceil(Math.max(header, odds, stakes));
  const cap = Math.round(H * 0.34);
  // The tray itself comes from the formula the renderer uses (src/shared/tray.ts): grow the band until
  // the strips above and below the centred tray fit their text.
  let band = 120;
  let strip = 0;
  for (; band <= cap; band += 2) {
    strip = Math.floor((band - trayGeometry(W, H, band, scale).trayH) / 2);
    if (strip >= need) break;
  }
  band = Math.min(band, cap);
  strip = Math.floor((band - trayGeometry(W, H, band, scale).trayH) / 2);
  return { band, strip };
}

interface Instance {
  root: HTMLElement;
  newGame: NewGameScreen;
  log: LogDrawer;
  victory: VictoryScreen;
  announce: Announcements;
  tooltip: Tooltip;
}
let current: Instance | null = null;

/** Gallery / test hook: poke local-only UI state (house rules drawer, log expansion, victory intro). */
export function uiDebug() {
  const c = current;
  return {
    openHouseRules: () => c?.newGame.setHouseOpen(true),
    expandLog: () => c?.log.expandFirst(),
    skipVictoryIntro: () => c?.victory.showFull(),
    recap: () => c?.announce.recap ?? [],
    tooltip: () => c?.tooltip.text() ?? null,
  };
}

export const mountUi: MountUi = (host, api) => {
  const boot = host.querySelector('#boot-splash') as HTMLElement | null;
  const root = h('div', 'ui-root');
  host.append(root);

  // ---- sounds + intents ---------------------------------------------------
  let lastHover: Element | null = null;
  let lastHoverAt = 0;
  const send = (i: UiIntent) => api.intent(i);

  // ---- components ---------------------------------------------------------
  const hud = h('div', 'hud');
  const topBar = new TopBar(send);
  const roster = new Roster(send);
  const rail = new Rail(send);
  const cards = new CardsDrawer(send);
  const log = new LogDrawer(send);
  const battle = new BattlePanel();
  const actionBar = new ActionBar(send);
  const announce = new Announcements();
  const tooltip = new Tooltip(api);
  const pills = new Pills(api, send);
  const humansOut = new HumansOut(send);
  tooltip.avoid = pills.el;
  hud.append(topBar.el, roster.el, rail.el, battle.el, actionBar.el, humansOut.el, announce.el, pills.el, cards.el, log.el, tooltip.el);

  const title = new TitleScreen(send);
  const newGame = new NewGameScreen(send);
  const victory = new VictoryScreen(send);
  const handoff = new Handoff(send);
  const overlays = new Overlays(send);
  const confirm = new Confirm(send);
  // Always-laid-out twin of the battle band, so insets are right even while the panel is hidden.
  const bandProbe = h('div', 'band-probe');
  bandProbe.setAttribute('aria-hidden', 'true');
  hud.append(bandProbe);
  const bubble = h('div', 'bubble hidden');
  bubble.setAttribute('role', 'tooltip');
  root.append(hud, title.el, newGame.el, victory.el, handoff.el, overlays.el, confirm.el, bubble);
  current = { root, newGame, log, victory, announce, tooltip };

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

  // ---- viewport insets ----------------------------------------------------
  let lastInsets = '';
  let scale = 1;
  const measure = () => {
    const H = window.innerHeight;
    const W = window.innerWidth;
    const { band: tray, strip } = solveBand(H, scale, W);
    root.style.setProperty('--tray', `${tray}px`);
    root.style.setProperty('--strip', `${strip}px`);
    topBar.fit();
    roster.fitAbove(actionBar.el.getBoundingClientRect().top - 12);
    const tb = topBar.el.getBoundingClientRect();
    const ro = roster.el.getBoundingClientRect();
    const ra = rail.el.getBoundingClientRect();
    const bt = bandProbe.getBoundingClientRect();
    const insets: ViewportInsets = {
      top: Math.round(tb.bottom),
      left: Math.round(ro.width ? ro.right : 0),
      right: Math.round(ra.width ? W - ra.left : 0),
      bottom: Math.round(H - bt.top),
      trayBand: tray,
    };
    root.style.setProperty('--inset-bottom', `${insets.bottom}px`);
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
  for (const el of [topBar.el, roster.el, rail.el, actionBar.el, bandProbe]) ro.observe(el);
  window.addEventListener('resize', queueMeasure);
  const refit = () => actionBar.fit();
  window.addEventListener('resize', refit);

  // ---- per-frame: pills follow their tile ---------------------------------
  let raf = 0;
  const tick = () => {
    raf = 0;
    if (!pills.active) return;
    pills.frame();
    raf = requestAnimationFrame(tick);
  };
  const ensureTick = () => {
    if (pills.active && !raf) raf = requestAnimationFrame(tick);
  };

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
    if (relayout)
      requestAnimationFrame(() => {
        actionBar.fit();
        victory.refreshChart();
      });
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
      topBar.update(g.topBar);
      roster.update(g.roster);
      rail.update(g.cards, g.log.open);
      const brassFree = !g.actionBar.buttons.some((b) => b.brass);
      cards.update(g.cards, brassFree);
      log.update(g.log.open, g.log.lines);
      actionBar.update(g.actionBar);
      battle.update(g.battle);
      announce.update(g.turnBanner, g.banner, g.toasts);
      tooltip.update(next.overlay ? null : g.tooltip, g.battle);
      pills.update(g.pills);
      humansOut.update(g.allHumansOut);
      handoff.update(g.handoff);
      confirm.update(g.confirm);
      ensureTick();
    } else if (!g && prev?.game) {
      tooltip.update(null);
      pills.update(null);
      handoff.update(null);
      confirm.update(null);
      battle.update(null);
      announce.update(null, null, []);
    }
    if (!prev || prev.overlay !== next.overlay || prev.settings !== next.settings || prev.screen !== next.screen || (next.overlay === 'pause' && prev.game?.roster !== next.game?.roster))
      overlays.update(next);
    toggle(root, 'overlay-open', !!next.overlay || !!g?.confirm);
    revalidateBubble();
  };

  // ---- delegated input behavior -------------------------------------------
  const isBtn = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('button, .slider') : null);
  const onPointerDown = (e: PointerEvent) => {
    const b = isBtn(e.target);
    if (b && b.getAttribute('aria-disabled') !== 'true') b.classList.add('is-down');
    // Any press on the UI dismisses the turn banner (board clicks are the controller's).
    if (vm?.game?.turnBanner) send({ type: 'dismissTurnBanner' });
  };
  const clearDown = () => root.querySelectorAll('.is-down').forEach((el) => el.classList.remove('is-down'));
  const onMouseDown = (e: MouseEvent) => {
    // No mouse focus on buttons: keyboard shortcuts stay with the game, and focus rings stay keyboard-only.
    if (isBtn(e.target)?.tagName === 'BUTTON') e.preventDefault();
  };
  const onClick = (e: MouseEvent) => {
    const b = isBtn(e.target);
    if (!b || b.tagName !== 'BUTTON') return;
    if (b.getAttribute('aria-disabled') === 'true') {
      if (b.dataset.why) showBubble(b, b.dataset.why, 2200);
      return;
    }
    api.audio.play('uiClick');
  };
  const onOver = (e: PointerEvent) => {
    // Button hover sound only; the bubble follows real pointer movement (onMove).
    const t = e.target instanceof Element ? e.target : null;
    const b = t?.closest<HTMLElement>('button');
    if (b && b !== lastHover) {
      lastHover = b;
      const now = performance.now();
      if (b.getAttribute('aria-disabled') !== 'true' && now - lastHoverAt > 90 && movedRecently()) {
        lastHoverAt = now;
        api.audio.play('uiHover');
      }
    } else if (!b) lastHover = null;
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
  };

  // Disabled-button reasons and icon tips share one bubble. It follows real pointer movement only:
  // a render that slides a disabled button under a still pointer (the turn-start case) never opens
  // it, any move off the element (onto the board too) closes it, and every render re-checks it, so it
  // never goes stale or outlives its reason. Action-bar bubbles sit above the whole bar, so they never
  // cover a sibling button (e.g. the brass Trade on a forced trade).
  let bubbleTimer = 0;
  let bubbleFor: HTMLElement | null = null;
  let bubbleText = '';
  let lastX = -1;
  let lastY = -1;
  let lastMoveAt = -1e9;
  const movedRecently = () => performance.now() - lastMoveAt < 400;
  const tipOf = (el: HTMLElement): string => {
    if (!el.isConnected || el.closest('.hidden, .off, .leaving')) return '';
    const why = el.getAttribute('aria-disabled') === 'true' ? el.dataset.why : '';
    return why || el.dataset.tip || '';
  };
  const placeBubble = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let x = r.left + r.width / 2 - b.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - b.width - 8, x));
    const bar = el.closest('.actionbar');
    const top = bar ? bar.getBoundingClientRect().top : r.top;
    let y = top - b.height - 8;
    if (y < 8) y = r.bottom + 8;
    bubble.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };
  const showBubble = (el: HTMLElement, text: string, autoHideMs: number) => {
    window.clearTimeout(bubbleTimer);
    bubbleText = text;
    bubble.textContent = text;
    bubble.classList.remove('hidden');
    bubbleFor = el;
    placeBubble(el);
    if (autoHideMs) bubbleTimer = window.setTimeout(hideBubble, autoHideMs);
  };
  const hideBubble = () => {
    window.clearTimeout(bubbleTimer);
    if (!bubbleFor) return;
    bubbleFor = null;
    bubbleText = '';
    bubble.classList.add('hidden');
  };
  /** After every render: hide if the element lost its reason, re-word it if the reason changed. */
  const revalidateBubble = () => {
    if (!bubbleFor) return;
    const text = tipOf(bubbleFor);
    if (!text) hideBubble();
    else if (text !== bubbleText) {
      bubbleText = text;
      bubble.textContent = text;
      placeBubble(bubbleFor);
    }
  };
  const onMove = (e: PointerEvent) => {
    if (e.clientX === lastX && e.clientY === lastY) return; // synthetic re-hover after a DOM change
    lastX = e.clientX;
    lastY = e.clientY;
    lastMoveAt = performance.now();
    const t = e.target instanceof Element && root.contains(e.target) ? e.target : null;
    const tipEl = t?.closest<HTMLElement>('[data-why], [data-tip]') ?? null;
    const text = tipEl ? tipOf(tipEl) : '';
    if (!tipEl || !text) return hideBubble();
    if (tipEl === bubbleFor && text === bubbleText) return;
    showBubble(tipEl, text, 0);
  };
  const onDocOut = (e: PointerEvent) => {
    if (!e.relatedTarget) hideBubble(); // the pointer left the window
  };
  const onAnyDown = (e: PointerEvent) => {
    if (bubbleFor && !(e.target instanceof Node && bubbleFor.contains(e.target))) hideBubble();
  };

  // Keyboard: the controller owns game keys. The UI only handles keys for its own layers (menus,
  // dialogs, text fields) and stops them there so nothing fires twice.
  const onKey = (e: KeyboardEvent) => {
    const v = vm;
    if (!v) return;
    const t = e.target as HTMLElement | null;
    const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (inField) {
      // Typing a name must never trigger game shortcuts. Enter / Esc finish the edit.
      if (e.key === 'Escape' || e.key === 'Enter') t!.blur();
      e.stopPropagation();
      return;
    }
    const focusedBtn = !!t && t !== document.body && root.contains(t) && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'slider');
    const g = v.game;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return stop();
    if (g?.confirm && v.screen === 'game') {
      if (e.key === 'Escape') (stop(), send({ type: 'confirm', yes: false }));
      else if (e.key === 'Enter' && !focusedBtn) (stop(), send({ type: 'confirm', yes: true }));
      else if (focusedBtn && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
      else if (e.key !== 'Tab') stop();
      return;
    }
    if (v.overlay) {
      if (e.key === 'Escape') {
        stop();
        send({ type: 'overlay', overlay: v.overlay !== 'pause' ? overlays.backTarget() : null });
      } else if (e.key === 'Enter' && !focusedBtn && v.overlay === 'pause') (stop(), send({ type: 'overlay', overlay: null }));
      else if (e.key === '?' && v.overlay !== 'rules') (stop(), send({ type: 'overlay', overlay: 'rules' }));
      else if (focusedBtn && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
      else if (e.key !== 'Tab' && !e.key.startsWith('Arrow')) stop();
      return;
    }
    if (v.screen === 'game') {
      if (g?.handoff && (e.key === 'Enter' || e.key === ' ')) (stop(), send({ type: 'handoffAccept' }));
      else if (focusedBtn && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
      return;
    }
    // Menu screens.
    if (focusedBtn && (e.key === 'Enter' || e.key === ' ')) return void e.stopPropagation();
    if (v.screen === 'title') {
      if (e.key === 'Enter') (stop(), send(v.save ? { type: 'continue' } : { type: 'nav', screen: 'newGame' }));
      else if (e.key === '?') (stop(), send({ type: 'overlay', overlay: 'rules' }));
    } else if (v.screen === 'newGame') {
      if (e.key === 'Enter') (stop(), v.newGame.canStart && send({ type: 'start' }));
      else if (e.key === 'Escape') (stop(), send({ type: 'nav', screen: 'title' }));
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
  window.addEventListener('pointermove', onMove, { passive: true, capture: true });
  window.addEventListener('pointerdown', onAnyDown, { capture: true });
  document.addEventListener('pointerout', onDocOut);
  root.addEventListener('contextmenu', onContext);
  window.addEventListener('keydown', onKey, true);

  render(api.getViewModel());
  measure();
  document.fonts?.ready.then(() => {
    actionBar.fit();
    queueMeasure();
  });
  const unsub = api.subscribe(render);

  return {
    dispose() {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', queueMeasure);
      window.removeEventListener('resize', refit);
      window.removeEventListener('resize', onResizeScale);
      window.removeEventListener('pointerup', clearDown);
      window.removeEventListener('pointercancel', clearDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerdown', onAnyDown, { capture: true });
      document.removeEventListener('pointerout', onDocOut);
      root.remove();
      if (current?.root === root) current = null;
    },
  };
};

export default mountUi;
