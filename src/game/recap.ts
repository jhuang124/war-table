// "Since your last turn" recap (UX.md §6.2) and the award ledger (UX.md §4.6), both built from the
// event stream as the board plays it. Plain data so they can be saved alongside the game.

import {
  CONTINENTS,
  expectedRollLosses,
  territoriesNeeded,
  territoryCount,
  type ContinentId,
  type GameEvent,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from '../engine';
import { MINUS, SEP, cName, listTerritories, pName, signed } from './copy';

// ---------------------------------------------------------------------------
// Recap
// ---------------------------------------------------------------------------

export interface RecapEntry {
  /** territoriesLost[attacker] = territories this seat lost to them, in order. */
  lost: Record<number, TerritoryId[]>;
  continentsLost: ContinentId[];
  eliminations: { player: PlayerId; by: PlayerId }[];
  trades: { player: PlayerId; armies: number }[];
  nearGoal: { player: PlayerId }[];
}

export type RecapLedger = Record<number, RecapEntry>;

export function emptyRecap(): RecapEntry {
  return { lost: {}, continentsLost: [], eliminations: [], trades: [], nearGoal: [] };
}

/**
 * Record one played event into every human seat's ledger. `disp` is the displayed state after the
 * event. `nearGoalNew` = players who just came within 5 of the goal for the first time.
 */
export function recordRecap(ledger: RecapLedger, disp: GameState, e: GameEvent, nearGoalNew: PlayerId[]): void {
  for (const p of disp.players) {
    if (p.kind !== 'human' || p.eliminated) continue;
    const entry = (ledger[p.id] ??= emptyRecap());
    switch (e.type) {
      case 'territoryConquered':
        if (e.previousOwner === p.id) (entry.lost[e.player] ??= []).push(e.to);
        break;
      case 'continentLost':
        if (e.player === p.id) entry.continentsLost.push(e.continent);
        break;
      case 'playerEliminated':
        if (e.player !== p.id) entry.eliminations.push({ player: e.player, by: e.by });
        break;
      case 'cardsTraded':
        if (e.player !== p.id && e.armies >= 10) entry.trades.push({ player: e.player, armies: e.armies });
        break;
    }
    for (const q of nearGoalNew) if (q !== p.id) entry.nearGoal.push({ player: q });
  }
}

/** ≤ 2 recap lines for `seat` (UX.md §6.2), highest drama first. */
export function buildRecap(entry: RecapEntry | undefined, state: GameState, seat: PlayerId): string[] {
  if (!entry) return [`Quiet round${SEP}nobody touched you`];
  const lines: string[] = [];
  const attackers = Object.entries(entry.lost)
    .map(([a, ts]) => ({ a: Number(a), ts }))
    .filter((x) => x.ts.length > 0)
    .sort((x, y) => y.ts.length - x.ts.length);
  const takeLine = (x: { a: number; ts: TerritoryId[] }) => `${pName(state, x.a)} took ${listTerritories(x.ts)} from you`;
  if (attackers[0]) lines.push(takeLine(attackers[0]));
  for (const c of entry.continentsLost) lines.push(`You lost ${cName(c)}${SEP}${MINUS}${CONTINENTS[c].bonus} a turn`);
  for (const x of attackers.slice(1)) lines.push(takeLine(x));
  for (const el of entry.eliminations) lines.push(`${pName(state, el.by)} knocked out ${pName(state, el.player)}`);
  const need = territoriesNeeded(state);
  const seen = new Set<number>();
  for (const n of entry.nearGoal) {
    if (seen.has(n.player) || state.players[n.player]?.eliminated) continue;
    seen.add(n.player);
    const left = Math.max(1, need - territoryCount(state, n.player));
    lines.push(`${pName(state, n.player)} is ${left} from victory`);
  }
  for (const tr of entry.trades) lines.push(`${pName(state, tr.player)} cashed in for ${tr.armies}`);
  if (lines.length === 0) return [`Quiet round${SEP}nobody touched you`];
  void seat;
  return lines.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

export interface AwardLedger {
  /** taken["attacker>victim"] = territories taken. */
  taken: Record<string, number>;
  /** Actual − expected defender losses over each player's attack rolls, and the roll count. */
  luck: Record<number, { sum: number; rolls: number }>;
  trades: { player: PlayerId; armies: number; round: number }[];
  upsets: { player: PlayerId; kind: 'held' | 'odds'; pct: number; round: number }[];
}

export function emptyAwards(): AwardLedger {
  return { taken: {}, luck: {}, trades: [], upsets: [] };
}

export function recordAward(ledger: AwardLedger, disp: GameState, e: GameEvent): void {
  switch (e.type) {
    case 'diceRolled': {
      if (e.defender < 0) break;
      const exp = expectedRollLosses(e.attackDice.length, e.defendDice.length).defender;
      const l = (ledger.luck[e.player] ??= { sum: 0, rolls: 0 });
      l.sum += e.defenderLosses - exp;
      l.rolls += 1;
      break;
    }
    case 'territoryConquered':
      if (e.previousOwner >= 0) {
        const k = `${e.player}>${e.previousOwner}`;
        ledger.taken[k] = (ledger.taken[k] ?? 0) + 1;
      }
      break;
    case 'cardsTraded':
      ledger.trades.push({ player: e.player, armies: e.armies + (e.bonusTerritory ? 2 : 0), round: disp.round });
      break;
  }
}

export interface AwardCard {
  id: 'nemesis' | 'hotDice' | 'cursedDice' | 'cashIn';
  title: string;
  text: string;
  player: PlayerId;
}

/** ≤ 3 award cards, only awards with ≥ 3 supporting events (UX.md §4.6). */
export function buildAwards(ledger: AwardLedger, state: GameState): AwardCard[] {
  const out: AwardCard[] = [];
  let nem: { a: number; v: number; n: number } | null = null;
  for (const [k, n] of Object.entries(ledger.taken)) {
    const [a, v] = k.split('>').map(Number);
    if (n >= 3 && (!nem || n > nem.n)) nem = { a, v, n };
  }
  if (nem) {
    out.push({
      id: 'nemesis',
      title: 'Nemesis',
      text: `${pName(state, nem.a)} took ${nem.n} territories from ${pName(state, nem.v)}`,
      player: nem.a,
    });
  }
  const lucky = Object.entries(ledger.luck)
    .map(([p, l]) => ({ p: Number(p), sum: l.sum, rolls: l.rolls }))
    .filter((x) => x.rolls >= 3);
  const hot = [...lucky].sort((a, b) => b.sum - a.sum)[0];
  if (hot && Math.round(hot.sum) >= 1) {
    out.push({
      id: 'hotDice',
      title: 'Hot dice',
      text: `${pName(state, hot.p)}: ${signed(Math.round(hot.sum))} armies of pure luck`,
      player: hot.p,
    });
  }
  const cold = [...lucky].sort((a, b) => a.sum - b.sum)[0];
  if (cold && Math.round(cold.sum) <= -1 && cold.p !== hot?.p) {
    out.push({
      id: 'cursedDice',
      title: 'Cursed dice',
      text: `${pName(state, cold.p)}: ${signed(Math.round(cold.sum))} armies the dice took back`,
      player: cold.p,
    });
  }
  if (ledger.trades.length >= 3) {
    const big = [...ledger.trades].sort((a, b) => b.armies - a.armies || a.round - b.round)[0];
    out.push({
      id: 'cashIn',
      title: 'Biggest cash-in',
      text: `${pName(state, big.player)}: +${big.armies}${SEP}round ${big.round}`,
      player: big.player,
    });
  }
  // Keep at most 3; prefer nemesis, hot dice, cash-in over cursed dice.
  if (out.length > 3) {
    const i = out.findIndex((a) => a.id === 'cursedDice');
    if (i >= 0) out.splice(i, 1);
  }
  return out.slice(0, 3);
}
