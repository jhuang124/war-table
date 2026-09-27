// Contract between the 3D renderer (src/render/**) and the game controller (src/game/**).
// The renderer implements `createBoardView` in src/render/index.ts. The controller only talks
// to the board through this interface.

import type { GameEvent, GameState, TerritoryId } from '../engine/types';
import type { BoardGeometry } from '../map/types';
import type { AudioEngine } from '../audio/types';

export interface BoardViewOptions {
  /** Element the WebGL canvas fills (position: absolute; inset: 0). */
  container: HTMLElement;
  geometry: BoardGeometry;
}

export interface BoardHighlights {
  /** Territories the player may click right now (subtle lift/glow). Others may dim if `dimOthers`. */
  selectable?: TerritoryId[];
  /** The chosen source territory (strong rim glow, raised). */
  selected?: TerritoryId | null;
  /** Valid targets for the selected source (pulsing outline). */
  targets?: TerritoryId[];
  /** A committed source → target pairing (attack arrow or fortify route). */
  arrow?: { from: TerritoryId; to: TerritoryId; kind: 'attack' | 'fortify'; path?: TerritoryId[] } | null;
  /** Staged/preview counts drawn as "+N" ghosts over tiles (e.g. reinforcements placed this phase). */
  pending?: Partial<Record<TerritoryId, number>>;
  dimOthers?: boolean;
}

export interface TerritoryPointerInfo {
  territory: TerritoryId;
  /** Client-space pixel position of the pointer. */
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** 0 = primary, 2 = secondary (context menu is suppressed on the canvas). */
  button: number;
}

export interface BoardStats {
  fps: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  activeTweens?: number;
  cameraMoving?: boolean;
  particles?: number;
  /**
   * Additive (controller builder): the fastest automatic camera rotation seen so far, in °/s (SPEC §10:
   * ≤ 45). Read by __risk.metrics().maxCameraDegPerSec.
   */
  maxCameraDegPerSec?: number;
}

export interface PlayEventOptions {
  /** 'full' (default): dice tray + full timings. 'brief': AI-vs-AI; no dice, <= 0.8 s per engagement. */
  style?: 'full' | 'brief';
  /**
   * For consecutive diceRolled events of one engagement (blitz or repeated rolls): 0-based index and
   * total count, so the renderer can compress to the blitz cap and slow the final roll.
   */
  seq?: { index: number; count: number };
  /**
   * Additive (controller builder): set on an `armiesMoved` (reason 'occupy') that follows its conquest
   * with no human choice in between (the AI's occupy, or an engine auto-occupy). It IS the conquest's
   * march (UX.md §6.1, §8.2 "Conquest ~650 ms … march starting at +150"), not a separate 400 ms move:
   * fold it into the running conquest animation and resolve as soon as the pieces land.
   */
  inlineMarch?: boolean;
}

/** HUD-covered edges in CSS px. The home view frames the board inside the rest; the dice tray sits
 *  in a band of height `trayBand` just above `bottom`. */
export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  trayBand: number;
}

export interface BoardView {
  /** Snap the whole board to `state` with no animation (load, resume, after a skip). */
  syncState(state: GameState): void;
  /**
   * Animate one event. Resolves when its animation finishes (immediately at speed 0).
   * The renderer keeps its own displayed owners/armies and updates them as the event plays,
   * so after the promise resolves the board matches the state right after this event.
   * `stateAfter` is the final state of the whole action batch, for reference only.
   */
  playEvent(event: GameEvent, stateAfter: GameState, opts?: PlayEventOptions): Promise<void>;
  /** 1 = normal, 2 = fast, 0 = instant (no tweens; resolve at once). */
  setAnimationSpeed(multiplier: number): void;
  /** Finish every running animation immediately. */
  skipAnimations(): void;

  setHighlights(h: BoardHighlights): void;
  onTerritoryClick(cb: (info: TerritoryPointerInfo) => void): void;
  onTerritoryHover(cb: (info: TerritoryPointerInfo | null) => void): void;

  /** Ease the camera to frame these territories. Empty array = whole board. */
  focusTerritories(ids: TerritoryId[], opts?: { durationMs?: number }): void;
  resetCamera(): void;
  /** Slow cinematic orbit for the title screen / victory. */
  setAttractMode(on: boolean): void;
  setShowLabels(on: boolean): void;
  /** Tell the board which screen edges the HUD covers (re-sent on resize / text-size change). */
  setViewportInsets(insets: ViewportInsets): void;
  /** UI text-size multiplier (1, 1.25, 1.5) for badges, the dice tray and DOM labels. */
  setUiScale(scale: number): void;

  /**
   * Additive (renderer builder): effective reduced-motion flag (settings.reduceMotion ||
   * prefers-reduced-motion). Steady outlines instead of pulses, no automatic camera moves (200 ms
   * crossfade cuts instead), dice fade in on their faces, the flood becomes a 250 ms crossfade.
   * Defaults to the `prefers-reduced-motion` media query until called.
   */
  setReducedMotion?(on: boolean): void;
  /**
   * Additive (renderer builder): hand the board the audio engine so motion-bound SFX land on their
   * contact frames. When set, the BOARD plays: place, unplace, diceShake, diceLand, hit, conquer,
   * march, whoosh (and calls audio.stopAll() inside skipAnimations). The controller must NOT play
   * those; it keeps turnStart, cardDraw, cardTrade, continent, eliminated, victory and UI sounds.
   * null = the board stays silent.
   */
  setAudio?(audio: AudioEngine | null): void;
  /** Additive (renderer builder): settings.autoCamera — return home at turn start if displaced. Default true. */
  setAutoCamera?(on: boolean): void;

  /** Screen position (client px) of a territory's army anchor, or null if off-screen. */
  getScreenPosition(t: TerritoryId): { x: number; y: number } | null;
  getStats(): BoardStats;
  dispose(): void;
}

export type CreateBoardView = (opts: BoardViewOptions) => Promise<BoardView>;
