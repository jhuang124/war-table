// Boot (SPEC §1): createAudio() → createBoardView(#board) → createController → mountUi(#ui, api).
//
// The renderer (src/render/index.ts) and the HTML UI (src/ui/index.ts) are loaded through
// import.meta.glob, so a missing or broken module falls back to the controller's own stand-ins:
// a 2D canvas board (src/game/stubBoard.ts) and a plain HTML HUD (src/game/debugHud.ts).
// URL switches for testing: ?stub (2D board), ?debughud (plain HUD), ?timings (stub board models the
// renderer's 1× durations instead of resolving events at once).

import { createAudio } from './audio';
import type { AudioEngine } from './audio/types';
import { BOARD } from './map';
import { createController, type RiskHooks } from './game/controller';
import { createStubBoard } from './game/stubBoard';
import { mountDebugHud } from './game/debugHud';
import type { BoardView, CreateBoardView } from './render/BoardView';
import type { MountUi } from './game/viewModel';

declare global {
  interface Window {
    __risk: RiskHooks;
    /** Dev builds only: the BoardView itself (e2e layout checks read its `__debug`). */
    __board?: BoardView;
    /** Dev builds only: the audio engine (e2e reads stats().played). */
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
  const params = new URLSearchParams(location.search);
  const boardEl = document.getElementById('board')!;
  const uiEl = document.getElementById('ui')!;
  const audio = createAudio();
  const [board, mountUi] = await Promise.all([loadBoard(boardEl, params), loadUi()]);
  board.setAudio?.(audio);
  const controller = createController({ board, audio, menuKeys: mountUi === mountDebugHud });
  window.__risk = controller.hooks;
  if (import.meta.env.DEV) {
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
