// Player colors. Renderer and UI both read from here so a seat looks the same everywhere.
// `base` is the tile/piece color, `deep` the shadowed side, `light` a highlight tint,
// `ink` a legible text color on top of `base`.

import type { PlayerColorId } from '../engine/types';

export interface PlayerPalette {
  id: PlayerColorId;
  name: string;
  base: string;
  deep: string;
  light: string;
  ink: string;
}

export const PLAYER_COLORS: Record<PlayerColorId, PlayerPalette> = {
  crimson: { id: 'crimson', name: 'Crimson', base: '#c63d36', deep: '#7e211d', light: '#f08a7f', ink: '#fff6f0' },
  cobalt: { id: 'cobalt', name: 'Cobalt', base: '#2f6fdc', deep: '#1a3f86', light: '#8fb5f5', ink: '#f2f6ff' },
  emerald: { id: 'emerald', name: 'Emerald', base: '#219e64', deep: '#11593a', light: '#7fd9ac', ink: '#f0fff7' },
  amber: { id: 'amber', name: 'Amber', base: '#e2a52c', deep: '#8f6414', light: '#f7d68b', ink: '#2a1c04' },
  violet: { id: 'violet', name: 'Violet', base: '#8a5ad6', deep: '#4f2f86', light: '#c7aef2', ink: '#f7f2ff' },
  rose: { id: 'rose', name: 'Rose', base: '#e0679e', deep: '#8a2f5a', light: '#f5b3d0', ink: '#2b0716' },
};

export const PLAYER_COLOR_IDS = Object.keys(PLAYER_COLORS) as PlayerColorId[];

/** Neutral tile color for unclaimed territories during a draft. */
export const UNCLAIMED_COLOR = '#cbbd9b';
