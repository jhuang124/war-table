// The turn banner's one recap line (docs/SIMPLIFY.md §5) and the award ledger (victory screen), both
// built from the event stream as the board plays it. Plain data so they can be saved alongside the game.

import { expectedRollLosses, type GameEvent, type GameState, type PlayerId, type TerritoryId } from '../engine';
import { SEP, pName, signed, tName } from './copy';

// ---------------------------------------------------------------------------
// Recap
// ---------------------------------------------------------------------------

export interface RecapEntry {
  /** lost[attacker] = territories this seat lost to them since its last turn, in order. */
  lost: Record<number, TerritoryId[]>;
}

export type RecapLedger = Record<number, RecapEntry>;

/** Record one played event into every human seat's ledger. `disp` is the displayed state after it. */
export function recordRecap(ledger: RecapLedger, disp: GameState, e: GameEvent): void {
  if (e.type !== 'territoryConquered') return;
  const victim = disp.players[e.previousOwner];
  if (!victim || victim.kind !== 'human') return;
  const entry = (ledger[victim.id] ??= { lost: {} });
  (entry.lost[e.player] ??= []).push(e.to);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * One line, only if the seat lost territory since its last turn: 'Cobalt took Ural',
 * 'Cobalt took 2 of yours', 'Cobalt and Amber took 3 of yours'. null when nothing was lost.
 */
export function buildRecap(entry: RecapEntry | undefined, state: GameState): string | null {
  if (!entry) return null;
  const attackers = Object.entries(entry.lost)
    .map(([a, ts]) => ({ a: Number(a), ts }))
    .filter((x) => x.ts.length > 0)
    .sort((x, y) => y.ts.length - x.ts.length);
  if (!attackers.length) return null;
  const total = attackers.reduce((n, x) => n + x.ts.length, 0);
  const who = joinNames(attackers.map((x) => pName(state, x.a)));
  if (total === 1) return `${who} took ${tName(attackers[0].ts[0])}`;
  return `${who} took ${total} of yours`;
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
