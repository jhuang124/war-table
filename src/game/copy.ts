// Copy helpers: names, numbers and small phrases shared by every line the controller writes.
// Tone: sentence case, verb first, ' · ' separator, real names and numbers, minus is U+2212,
// arrows are →, the ellipsis is ….

import { CONTINENTS, TERRITORIES, type ContinentId, type GameState, type PlayerId, type TerritoryId } from '../engine';
import type { SeatRef } from './viewModel';

export const SEP = ' · ';

/** Touch devices say "tap", everything else "click" (docs/MOBILE.md). Set by the controller. */
let touchCopy = false;
export function setTouchCopy(on: boolean): void {
  touchCopy = on;
}
/** 'click' / 'tap', for the line's instructions. */
export function click(): string {
  return touchCopy ? 'tap' : 'click';
}
/** 'Click' / 'Tap'. */
export function Click(): string {
  return touchCopy ? 'Tap' : 'Click';
}
export const MINUS = '−';

export function tName(t: TerritoryId): string {
  return TERRITORIES[t].name;
}

export function cName(c: ContinentId): string {
  return CONTINENTS[c].name;
}

export function pName(s: GameState, p: PlayerId): string {
  return s.players[p]?.name ?? 'Nobody';
}

/** Possessive: "Sam's". */
export function poss(name: string): string {
  return `${name}'s`;
}

export function upper(s: string): string {
  return s.toLocaleUpperCase('en-US');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function armies(n: number): string {
  return plural(n, 'army', 'armies');
}

/** Signed number with a real minus: +5 / −3 / 0. */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${Math.abs(n)}`;
  return '0';
}

export function seatRef(s: GameState, p: PlayerId): SeatRef {
  const pl = s.players[p];
  return { id: p, name: pl.name, color: pl.color, kind: pl.kind };
}

/** Percent for display: never 100% unless certain, never 0% unless impossible, no decimals. */
export function pct(p: number): number {
  if (p >= 1) return 100;
  if (p <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(p * 100)));
}
