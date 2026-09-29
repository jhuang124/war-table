// Player colors. Renderer and UI both read from here so a seat looks the same everywhere.
// `base` is the tile wash / piece blot color, `deep` the shadowed side (edge darkening, dice shade),
// `light` a tint for text and marks on the indigo paper, `ink` the legible mark color on top of `base`
// (the ivory the figures and pips are drawn in).
//
// Ink overhaul (docs/INK.md A7): muted pigment washes on indigo paper. Ids stay (`crimson`… keys are
// in saved games and the engine); names, hexes and emblems changed. Vermilion, Slate and Ochre are the
// approved hexes; Sage, Wisteria and Plum moved in lightness only (CIELAB L; chroma and hue kept) to
// pass the colour-blind check: Machado 2009 at full severity (protan, deutan, tritan) + CIEDE2000, on
// the raw hexes and as a 0.92 wash over the #101a30 paper.
//   worst pair, default four (crimson, cobalt, amber, emerald): ΔE 9.84 (protan, Ochre/Sage)
//   worst pair, all six:                                       ΔE 9.84 (same pair); next 10.1 (tritan Vermilion/Plum)
//   (as approved, before the lightness moves: default-four 8.28 deutan Vermilion/Sage; all six 3.39 protan Slate/Wisteria)

import type { PlayerColorId } from '../engine/types';
import { brushMark } from './enso';

export type SeatEmblem = 'triangle' | 'circle' | 'square' | 'diamond' | 'star' | 'cross';

export interface PlayerPalette {
  id: PlayerColorId;
  /** Shape shown wherever the seat appears (seat ring, roster, dice tray) — color-blind backup. */
  emblem: SeatEmblem;
  name: string;
  base: string;
  deep: string;
  light: string;
  ink: string;
}

/** The ivory the figures, pips and marks are drawn in, on every wash. */
const IVORY_INK = '#f2ede2';

export const PLAYER_COLORS: Record<PlayerColorId, PlayerPalette> = {
  crimson: { id: 'crimson', emblem: 'triangle', name: 'Vermilion', base: '#b9574a', deep: '#823128', light: '#f0aa9e', ink: IVORY_INK },
  cobalt: { id: 'cobalt', emblem: 'circle', name: 'Slate', base: '#5b7ea3', deep: '#345473', light: '#aabdd6', ink: IVORY_INK },
  emerald: { id: 'emerald', emblem: 'square', name: 'Sage', base: '#799a74', deep: '#516d4d', light: '#acc1a8', ink: IVORY_INK },
  amber: { id: 'amber', emblem: 'diamond', name: 'Ochre', base: '#b8974f', deep: '#876c2e', light: '#dac194', ink: IVORY_INK },
  violet: { id: 'violet', emblem: 'star', name: 'Wisteria', base: '#a394cc', deep: '#766999', light: '#cac0e4', ink: IVORY_INK },
  rose: { id: 'rose', emblem: 'cross', name: 'Plum', base: '#904c6b', deep: '#5f2642', light: '#deafc2', ink: IVORY_INK },
};

export const PLAYER_COLOR_IDS = Object.keys(PLAYER_COLORS) as PlayerColorId[];

/** Default colors for seats 1-4 (docs/ROUND2.md §E): Vermilion, Slate, Ochre, Sage (worst pair ΔE 9.84). */
export const DEFAULT_SEAT_COLORS: PlayerColorId[] = ['crimson', 'cobalt', 'amber', 'emerald'];

type Pt = [number, number];
const ring = (n: number, r: number, cx = 12, cy = 12, rot = 0): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  });
const star: Pt[] = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  const r = i % 2 ? 4 : 9.2;
  return [12 + Math.sin(a) * r, 12.6 - Math.cos(a) * r];
});

/**
 * Emblem marks as filled SVG path data in a 24×24 viewBox, drawn as brush strokes (a loaded brush
 * round each outline, stopping just short where it started). Render and UI fill the same shapes.
 */
export const EMBLEM_PATHS: Record<SeatEmblem, string> = {
  triangle: brushMark([[12, 3.2], [21, 19.6], [3, 19.6]], { seed: 11, width: 3, closed: true }),
  circle: brushMark(ring(36, 8.4, 12, 12, 0.35), { seed: 12, width: 3, closed: true, samples: 80 }),
  square: brushMark([[4.2, 4.4], [19.8, 4.2], [19.9, 19.8], [4.1, 19.9]], { seed: 13, width: 3, closed: true }),
  diamond: brushMark([[12, 2.4], [21.6, 12], [12, 21.6], [2.4, 12]], { seed: 14, width: 3, closed: true }),
  star: brushMark(star, { seed: 15, width: 2.5, closed: true, samples: 96 }),
  cross: brushMark([[12, 3], [12, 21]], { seed: 16, width: 3.4 }) + brushMark([[3, 12.2], [21, 11.8]], { seed: 17, width: 3.4 }),
};

/** Neutral wash for unclaimed territories during a draft: bare paper-toned ivory, dimmed. */
export const UNCLAIMED_COLOR = '#8f8a7e';
