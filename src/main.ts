// Boot (SPEC §1): createAudio() → createBoardView(#board) → createController → mountUi(#ui, api).
//
// The renderer (src/render/index.ts) and the HTML UI (src/ui/index.ts) are loaded through
// import.meta.glob, so a missing or broken module falls back to the controller's own stand-ins:
// a 2D canvas board (src/game/stubBoard.ts) and a plain HTML HUD (src/game/debugHud.ts).
// URL switches for testing: ?stub (2D board), ?debughud (plain HUD), ?timings (stub board models the
// renderer's 1× durations instead of resolving events at once).
//
// Mobile (docs/MOBILE.md): the device class comes from src/ui/layout.ts (capability + viewport, never
// the user agent); the page itself never scrolls or zooms (index.html + installShell); the production
// build registers the offline service worker (public/sw.js, versioned by vite.config.ts).

import { createAudio } from './audio';
import type { AudioEngine } from './audio/types';
import { BOARD } from './map';
import { createController, type RiskHooks } from './game/controller';
import { createStubBoard } from './game/stubBoard';
import { mountDebugHud } from './game/debugHud';
import type { BoardView, CreateBoardView } from './render/BoardView';
import type { MountUi } from './game/viewModel';
import { installLayout, layout, onLayout } from './ui/layout';

/** Additive BoardView members from the mobile renderer pass; used when present. */
interface TouchModeBoard {
  setTouchMode?(on: boolean): void;
}

/**
 * The page never pinch-zooms, double-tap-zooms or rubber-bands (iOS Safari ignores user-scalable=no, so
 * its gesture events are cancelled here). Scrolling inside a sheet still works; the board does its own
 * pinch on its canvas (touch-action: none).
 */
function installShell(): void {
  const stop = (e: Event) => e.preventDefault();
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
  // Two fingers anywhere but the board: never a page zoom.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && !(e.target instanceof Element && e.target.closest('#board'))) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener('dblclick', stop, { passive: false });
  // A scroll that ever lands on the document (a focused input on iOS) snaps back.
  window.addEventListener('scroll', () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  });
}

/**
 * The e2e build (`npm run test:e2e` builds with VITE_E2E=1): a production bundle that keeps the dev-only
 * test hooks (window.__board, window.__audio) and never registers the service worker. Never shipped.
 */
const E2E_BUILD = !!import.meta.env.VITE_E2E;

/** Offline play after the first visit (production only; the dev server and the e2e build never register it). */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || E2E_BUILD || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (new URLSearchParams(location.search).has('nosw')) return;
  window.addEventListener('load', () => {
    // Relative to the page, so it works at / and under the Pages subpath (/war-table/).
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).catch((err) => console.warn('[risk] service worker', err));
  });
}

declare global {
  interface Window {
    __risk: RiskHooks;
    /** Dev and e2e builds only: the BoardView itself (e2e layout checks read its `__debug`). */
    __board?: BoardView;
    /** Dev and e2e builds only: the audio engine (e2e reads stats().played). */
    __audio?: AudioEngine;
  }
}

const renderModules = import.meta.glob('./render/index.ts');
const uiModules = import.meta.glob('./ui/index.ts');

async function loadBoard(container: HTMLElement, params: URLSearchParams): Promise<BoardView> {
  const loader = renderModules['./render/index.ts'];
  if (loader && !params.has('stub')) {
    try {
      const mod = (await loader()) as { createBoardView?: CreateBoardView };
      if (mod.createBoardView) return await mod.createBoardView({ container, geometry: BOARD });
    } catch (err) {
      console.error('[risk] 3D board failed to start; using the flat board', err);
      container.replaceChildren();
    }
  }
  return createStubBoard({ container, geometry: BOARD, simulateTimings: params.has('timings') });
}

async function loadUi(): Promise<MountUi> {
  const loader = uiModules['./ui/index.ts'];
  if (loader && !new URLSearchParams(location.search).has('debughud')) {
    try {
      const mod = (await loader()) as { mountUi?: MountUi; default?: MountUi };
      const m = mod.mountUi ?? mod.default;
      if (m) return m;
    } catch (err) {
      console.error('[risk] UI failed to load; using the debug HUD', err);
    }
  }
  return mountDebugHud;
}

async function boot(): Promise<void> {
  installLayout();
  installShell();
  registerServiceWorker();
  const params = new URLSearchParams(location.search);
  const boardEl = document.getElementById('board')!;
  const uiEl = document.getElementById('ui')!;
  const audio = createAudio();
  const [board, mountUi] = await Promise.all([loadBoard(boardEl, params), loadUi()]);
  board.setAudio?.(audio);
  (board as BoardView & TouchModeBoard).setTouchMode?.(layout.touch);
  onLayout((l) => (board as BoardView & TouchModeBoard).setTouchMode?.(l.touch));
  const controller = createController({ board, audio, menuKeys: mountUi === mountDebugHud, touch: layout.touch });
  window.__risk = controller.hooks;
  if (import.meta.env.DEV || E2E_BUILD) {
    window.__board = board;
    window.__audio = audio;
  }
  try {
    mountUi(uiEl, controller);
  } catch (err) {
    console.error('[risk] UI mount failed; using the debug HUD', err);
    uiEl.replaceChildren();
    mountDebugHud(uiEl, controller);
  }
}

void boot();
