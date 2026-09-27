// Contract between the 3D renderer (src/render/**) and the game controller (src/game/**).
// The renderer implements `createBoardView` in src/render/index.ts. The controller only talks
// to the board through this interface.

import type { GameEvent, GameState, TerritoryId } from '../engine/types';
import type { BoardGeometry } from '../map/types';

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
  playEvent(event: GameEvent, stateAfter: GameState): Promise<void>;
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

  /** Screen position (client px) of a territory's army anchor, or null if off-screen. */
  getScreenPosition(t: TerritoryId): { x: number; y: number } | null;
  getStats(): BoardStats;
  dispose(): void;
}

export type CreateBoardView = (opts: BoardViewOptions) => Promise<BoardView>;
