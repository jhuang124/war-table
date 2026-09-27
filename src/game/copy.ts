// Copy helpers: names, numbers and small phrases shared by every line the controller writes.
// Tone (UX.md §7.7): sentence case, verb first, ' · ' separator, real names and numbers,
// minus is U+2212, arrows are →, the ellipsis is ….

import { CONTINENTS, TERRITORIES, type ContinentId, type GameState, type PlayerId, type TerritoryId } from '../engine';
import type { SeatRef } from './viewModel';

export const SEP = ' · ';
export const MINUS = '−';

export function tName(t: TerritoryId): string {
  return TERRITORIES[t].name;
}

export function cName(c: ContinentId): string {
  return CONTINENTS[c].name;
}

export const CONTINENT_ABBR: Record<ContinentId, string> = {
  north_america: 'NA',
  south_america: 'SA',
  europe: 'EU',
  africa: 'AF',
  asia: 'AS',
  australia: 'AU',
};

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

/** "Ukraine", "Ukraine and Ural", "Ukraine, Ural +3 more". */
export function listTerritories(ts: TerritoryId[]): string {
  const names = ts.map(tName);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
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

/**
 * AI-turn banners landing within 2 s merge into one line (UX.md §5.2):
 * [{COBALT, HOLDS ASIA}, {COBALT, BREAKS YOUR AUSTRALIA}] → 'COBALT HOLDS ASIA · AND BREAKS YOUR AUSTRALIA'.
 */
export function mergeBannerTitle(parts: { subject: string; predicate: string }[]): string {
  const subject = parts[0]?.subject ?? '';
  return parts
    .map((p, i) =>
      i === 0 ? `${p.subject} ${p.predicate}`.trim() : p.subject === subject && p.predicate ? `AND ${p.predicate}` : `${p.subject} ${p.predicate}`.trim(),
    )
    .join(SEP);
}
