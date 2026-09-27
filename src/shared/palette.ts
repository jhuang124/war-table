// Player colors. Renderer and UI both read from here so a seat looks the same everywhere.
// `base` is the tile/piece color, `deep` the shadowed side, `light` a highlight tint,
// `ink` a legible text color on top of `base`.

import type { PlayerColorId } from '../engine/types';

export type SeatEmblem = 'triangle' | 'circle' | 'square' | 'diamond' | 'star' | 'cross';

export interface PlayerPalette {
  id: PlayerColorId;
  /** Shape shown wherever the seat appears (badge, roster, banners, dice tray) — color-blind backup. */
  emblem: SeatEmblem;
  name: string;
  base: string;
  deep: string;
  light: string;
  ink: string;
}

export const PLAYER_COLORS: Record<PlayerColorId, PlayerPalette> = {
  crimson: { id: 'crimson', emblem: 'triangle', name: 'Crimson', base: '#c63d36', deep: '#7e211d', light: '#f08a7f', ink: '#fff6f0' },
  cobalt: { id: 'cobalt', emblem: 'circle', name: 'Cobalt', base: '#2f6fdc', deep: '#1a3f86', light: '#8fb5f5', ink: '#f2f6ff' },
  emerald: { id: 'emerald', emblem: 'square', name: 'Emerald', base: '#219e64', deep: '#11593a', light: '#7fd9ac', ink: '#f0fff7' },
  amber: { id: 'amber', emblem: 'diamond', name: 'Amber', base: '#e2a52c', deep: '#8f6414', light: '#f7d68b', ink: '#2a1c04' },
  violet: { id: 'violet', emblem: 'star', name: 'Violet', base: '#b48be8', deep: '#6a45a8', light: '#dccbf6', ink: '#1c1030' },
  rose: { id: 'rose', emblem: 'cross', name: 'Rose', base: '#e0679e', deep: '#8a2f5a', light: '#f5b3d0', ink: '#2b0716' },
};

export const PLAYER_COLOR_IDS = Object.keys(PLAYER_COLORS) as PlayerColorId[];

/** Default colors for seats 1-4: the most distinct set under color-vision simulation (UX.md §10.1). */
export const DEFAULT_SEAT_COLORS: PlayerColorId[] = ['crimson', 'cobalt', 'amber', 'rose'];

/** Emblem outlines as SVG path data in a 24x24 viewBox. Render and UI draw the same shapes. */
export const EMBLEM_PATHS: Record<SeatEmblem, string> = {
  triangle: 'M12 3 L21.5 20 H2.5 Z',
  circle: 'M12 3 A9 9 0 1 1 11.99 3 Z',
  square: 'M4 4 H20 V20 H4 Z',
  diamond: 'M12 2 L22 12 L12 22 L2 12 Z',
  star: 'M12 2.5 L14.6 9 L21.5 9.3 L16.1 13.6 L18 20.5 L12 16.6 L6 20.5 L7.9 13.6 L2.5 9.3 L9.4 9 Z',
  cross: 'M9 3 H15 V9 H21 V15 H15 V21 H9 V15 H3 V9 H9 Z',
};

/** Neutral tile color for unclaimed territories during a draft. */
export const UNCLAIMED_COLOR = '#cbbd9b';
