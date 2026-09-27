// Effective UI scale (UX.md §10.3). Pure: no DOM, safe for the controller and the renderer to import.
//
// The HUD is laid out for a CSS viewport of at least 1280×720 at scale 1.0. A text size only applies as
// far as the screen has room for it, so TV (1.5) is exact on 1920×1080, fitted to 1.125 on a 1440×900
// mirror and to 1.0 on 1280×800, where the full 1.5 would pile the top bar, roster and badges into
// each other. Laptop is never scaled down.

import type { TextSize } from '../game/viewModel';

export const TEXT_SCALE: Record<TextSize, number> = { laptop: 1, couch: 1.25, tv: 1.5 };

/** The CSS viewport the HUD needs at scale 1.0. */
export const BASE_VIEWPORT = { width: 1280, height: 720 } as const;

export function effectiveUiScale(size: TextSize, width: number, height: number): number {
  const nominal = TEXT_SCALE[size] ?? 1;
  const room = Math.max(1, Math.min(width / BASE_VIEWPORT.width, height / BASE_VIEWPORT.height));
  return Math.min(nominal, Math.round(room * 1000) / 1000);
}

/** True when the screen is too small for the chosen size and it was fitted down. */
export function isFitted(size: TextSize, width: number, height: number): boolean {
  return effectiveUiScale(size, width, height) < (TEXT_SCALE[size] ?? 1) - 1e-6;
}
