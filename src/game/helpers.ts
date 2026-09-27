// Pure game-side helpers (SPEC §7 Controller): all derived from state + mapData + engine helpers.
// attackStakes, bestSet, occupyDefault, autoSource, oddsWord, plus the card-status line.

import {
  ADJACENCY,
  CONTINENTS,
  TERRITORIES,
  TERRITORY_IDS,
  bonusTerritoryFor,
  setValue,
  territoriesNeeded,
  territoryCount,
  validSets,
  type Card,
  type CardSymbol,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from '../engine';
import { MINUS, SEP, cName, pName, pct, poss, tName, upper } from './copy';

// ---------------------------------------------------------------------------
// Odds
// ---------------------------------------------------------------------------

export type OddsWord = 'almost sure' | 'likely' | 'coin flip' | 'long shot';

/** UX.md §5.1 bands on the displayed (rounded) percent: ≥85 almost sure, 60–84 likely, 40–59 coin flip, <40 long shot. */
export function oddsWord(p: number): OddsWord {
  const v = pct(p);
  if (v >= 85) return 'almost sure';
  if (v >= 60) return 'likely';
  if (v >= 40) return 'coin flip';
  return 'long shot';
}

/** 'Blitz · 82% · likely' (or 'Blitz · likely' when the win chance is hidden). */
export function oddsLabel(p: number, showPercent: boolean): string {
  return showPercent ? `Blitz${SEP}${pct(p)}%${SEP}${oddsWord(p)}` : `Blitz${SEP}${oddsWord(p)}`;
}

// ---------------------------------------------------------------------------
// Stakes
// ---------------------------------------------------------------------------

export interface StakeLine {
  text: string;
  /** Lines 1–2 of the ladder (wins the game, knocks out a player): brass and 20% larger. */
  priority: boolean;
}

/**
 * What conquering `to` from `from` would decide, highest first, at most 2 lines (UX.md §5.1):
 * WINS THE GAME › KNOCKS OUT SAM › COMPLETES A CONTINENT › BREAKS A CONTINENT › first conquest earns a card.
 */
export function attackStakes(state: GameState, from: TerritoryId, to: TerritoryId): StakeLine[] {
  const me = state.territories[from]?.owner;
  const them = state.territories[to]?.owner;
  if (me === undefined || them === undefined || me < 0 || them < 0 || me === them) return [];
  const out: StakeLine[] = [];
  const mine = territoryCount(state, me);
  const theirs = territoryCount(state, them);
  const aliveOthers = state.players.filter((p) => !p.eliminated && p.id !== me).length;
  const knocksOut = theirs === 1;
  if (mine + 1 >= territoriesNeeded(state) || (knocksOut && aliveOthers === 1)) {
    out.push({ text: 'WINS THE GAME', priority: true });
  }
  if (knocksOut) {
    const n = state.players[them].cards.length;
    const who = upper(pName(state, them));
    out.push({
      text: n > 0 ? `KNOCKS OUT ${who}${SEP}takes their ${n === 1 ? '1 card' : `${n} cards`}` : `KNOCKS OUT ${who}`,
      priority: true,
    });
  }
  const c = TERRITORIES[to].continent;
  const others = CONTINENTS[c].territories.filter((t) => t !== to);
  if (others.every((t) => state.territories[t].owner === me)) {
    out.push({ text: `COMPLETES ${upper(cName(c))}${SEP}+${CONTINENTS[c].bonus} a turn`, priority: false });
  }
  if (CONTINENTS[c].territories.every((t) => state.territories[t].owner === them)) {
    const name = pName(state, them);
    out.push({
      text: `BREAKS ${upper(poss(name))} ${upper(cName(c))}${SEP}${MINUS}${CONTINENTS[c].bonus} a turn for ${name}`,
      priority: false,
    });
  }
  if (!state.conqueredThisTurn) out.push({ text: `First conquest this turn${SEP}earns a card`, priority: false });
  return out.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface BestSet {
  cardIds: [number, number, number];
  value: number;
  bonusTerritory: TerritoryId | null;
}

/** Best trade in `player`'s hand: max setValue, then the +2 territory bonus, then keep wilds. */
export function bestSet(state: GameState, player: PlayerId): BestSet | null {
  const hand = state.players[player]?.cards ?? [];
  if (hand.length < 3) return null;
  let best: (BestSet & { wilds: number }) | null = null;
  for (const ids of validSets(hand)) {
    const cards = ids.map((id) => hand.find((c) => c.id === id)!) as Card[];
    const value = setValue(state, ids);
    const bonusTerritory = bonusTerritoryFor(state, player, cards);
    const wilds = cards.filter((c) => c.symbol === 'wild').length;
    const better =
      !best ||
      value > best.value ||
      (value === best.value && !!bonusTerritory && !best.bonusTerritory) ||
      (value === best.value && !!bonusTerritory === !!best.bonusTerritory && wilds < best.wilds);
    if (better) best = { cardIds: ids, value, bonusTerritory, wilds };
  }
  if (!best) return null;
  return { cardIds: best.cardIds, value: best.value, bonusTerritory: best.bonusTerritory };
}

const KIND_NAMES: Record<Exclude<CardSymbol, 'wild'>, string> = {
  infantry: 'infantry',
  cavalry: 'cavalry',
  artillery: 'artillery',
};

/** Card status when there's no valid set (UX.md §7.5), e.g. 'Need 1 artillery, or a third match'. */
export function noSetStatus(hand: Card[]): string {
  const n = hand.length;
  if (n === 0) return `No cards yet${SEP}conquer a territory to earn one`;
  if (n === 1) return 'Need 2 more cards';
  const counts: Record<string, number> = { infantry: 0, cavalry: 0, artillery: 0 };
  for (const c of hand) if (c.symbol !== 'wild') counts[c.symbol]++;
  const kinds = (Object.keys(KIND_NAMES) as Exclude<CardSymbol, 'wild'>[]).filter((k) => counts[k] > 0);
  const missing = (Object.keys(KIND_NAMES) as Exclude<CardSymbol, 'wild'>[]).filter((k) => counts[k] === 0);
  if (n === 2) {
    if (kinds.length === 1) return `Need a third ${KIND_NAMES[kinds[0]]}, or a wild`;
    return `Need 1 ${KIND_NAMES[missing[0]]}, or a wild`;
  }
  // 3+ cards and no set: exactly two kinds, at most two of each, no wild.
  const pairs = kinds.filter((k) => counts[k] === 2);
  const third = pairs.length === 1 ? `a third ${KIND_NAMES[pairs[0]]}` : 'a third match';
  return missing.length ? `Need 1 ${KIND_NAMES[missing[0]]}, or ${third}` : `Need 1 more of any kind, or ${third}`;
}

// ---------------------------------------------------------------------------
// Occupy default (UX.md §3.3)
// ---------------------------------------------------------------------------

function enemyNeighbors(state: GameState, t: TerritoryId, owner: PlayerId): TerritoryId[] {
  return ADJACENCY[t].filter((n) => state.territories[n].owner !== owner && state.territories[n].owner >= 0);
}

export interface OccupyDefault {
  count: number;
  note: string | null;
}

/**
 * Smart occupy default, a pure function of adjacency. `state` is the occupy-phase state (`to` already
 * belongs to the attacker).
 *   to borders enemies, from doesn't → max, 'Front moves forward'
 *   to safe, from borders enemies   → min, 'Siberia is safe · keeping your stack in Ural'
 *   both border enemies             → max, 'Ural keeps 1 · still borders Mongolia'
 *   neither                         → max, no note
 */
export function occupyDefault(state: GameState, from: TerritoryId, to: TerritoryId, min: number, max: number): OccupyDefault {
  const me = state.territories[from].owner;
  const toEnemies = enemyNeighbors(state, to, me);
  const fromEnemies = enemyNeighbors(state, from, me);
  if (toEnemies.length > 0 && fromEnemies.length === 0) return { count: max, note: 'Front moves forward' };
  if (toEnemies.length === 0 && fromEnemies.length > 0) {
    return { count: min, note: `${tName(to)} is safe${SEP}keeping your stack in ${tName(from)}` };
  }
  if (toEnemies.length > 0 && fromEnemies.length > 0) {
    const worst = [...fromEnemies].sort((a, b) => state.territories[b].armies - state.territories[a].armies)[0];
    return { count: max, note: `${tName(from)} keeps 1${SEP}still borders ${tName(worst)}` };
  }
  return { count: max, note: null };
}

// ---------------------------------------------------------------------------
// Target-first attack source (UX.md §3.3)
// ---------------------------------------------------------------------------

/**
 * The attacker's adjacent territory with the most armies (≥ 2) that can hit `target`. Ties go to the
 * one with more enemy-free sides (fewer enemy neighbors), then TERRITORY_IDS order. null if none.
 */
export function autoSource(state: GameState, target: TerritoryId, player: PlayerId = state.currentPlayer): TerritoryId | null {
  const tOwner = state.territories[target]?.owner;
  if (tOwner === undefined || tOwner === player || tOwner < 0) return null;
  let best: TerritoryId | null = null;
  let bestArmies = -1;
  let bestSafe = -1;
  for (const n of ADJACENCY[target]) {
    const ts = state.territories[n];
    if (ts.owner !== player || ts.armies < 2) continue;
    const safe = ADJACENCY[n].length - enemyNeighbors(state, n, player).length;
    const better =
      ts.armies > bestArmies ||
      (ts.armies === bestArmies && safe > bestSafe) ||
      (ts.armies === bestArmies && safe === bestSafe && best !== null && TERRITORY_IDS.indexOf(n) < TERRITORY_IDS.indexOf(best));
    if (better) {
      best = n;
      bestArmies = ts.armies;
      bestSafe = safe;
    }
  }
  return best;
}

/** True if `t` can attack right now (own, ≥ 2 armies, an enemy next door). */
export function canAttackFrom(state: GameState, t: TerritoryId, player: PlayerId = state.currentPlayer): boolean {
  const ts = state.territories[t];
  return ts.owner === player && ts.armies >= 2 && enemyNeighbors(state, t, player).length > 0;
}

/**
 * Auto-chain after an occupy (UX.md §3.3): select `to` if it can attack, else keep `from` if it still
 * can, else nothing. `state` is the state after the occupy move.
 */
export function autoChain(state: GameState, from: TerritoryId, to: TerritoryId): TerritoryId | null {
  const p = state.territories[to].owner;
  if (canAttackFrom(state, to, p)) return to;
  if (canAttackFrom(state, from, p)) return from;
  return null;
}

/** Own territories bordering `t`, any army count. */
export function ownNeighbors(state: GameState, t: TerritoryId, player: PlayerId): TerritoryId[] {
  return ADJACENCY[t].filter((n) => state.territories[n].owner === player);
}
