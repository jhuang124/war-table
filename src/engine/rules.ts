// Pure rule helpers shared by the reducer, the AI, and the UI. All cheap, none mutate.

import { ADJACENCY, CONTINENTS, CONTINENT_IDS, TERRITORIES, TERRITORY_IDS } from './mapData';
import type {
  ContinentId,
  GameState,
  PlayerId,
  ReinforcementBreakdown,
  TerritoryId,
} from './types';

export const TERRITORY_COUNT = TERRITORY_IDS.length; // 42

const TERRITORY_SET = new Set<string>(TERRITORY_IDS);
export function isTerritoryId(x: unknown): x is TerritoryId {
  return typeof x === 'string' && TERRITORY_SET.has(x);
}

export function territoryName(t: TerritoryId): string {
  return TERRITORIES[t].name;
}

export function ownedTerritories(state: GameState, player: PlayerId): TerritoryId[] {
  const out: TerritoryId[] = [];
  for (const t of TERRITORY_IDS) if (state.territories[t].owner === player) out.push(t);
  return out;
}

export function territoryCount(state: GameState, player: PlayerId): number {
  let n = 0;
  for (const t of TERRITORY_IDS) if (state.territories[t].owner === player) n++;
  return n;
}

export function totalArmies(state: GameState, player: PlayerId): number {
  let n = 0;
  for (const t of TERRITORY_IDS) {
    const ts = state.territories[t];
    if (ts.owner === player) n += ts.armies;
  }
  return n;
}

/** True if `player` owns every territory of `continent`. */
export function ownsContinent(state: GameState, player: PlayerId, continent: ContinentId): boolean {
  for (const t of CONTINENTS[continent].territories) if (state.territories[t].owner !== player) return false;
  return true;
}

/** Continents fully held by `player`. */
export function continentsOwned(state: GameState, player: PlayerId): ContinentId[] {
  return CONTINENT_IDS.filter((c) => ownsContinent(state, player, c));
}

/** Owner of each continent (or null when split). */
export function continentOwners(state: GameState): Record<ContinentId, PlayerId | null> {
  const out = {} as Record<ContinentId, PlayerId | null>;
  for (const c of CONTINENT_IDS) {
    const ts = CONTINENTS[c].territories;
    const o = state.territories[ts[0]].owner;
    out[c] = o >= 0 && ts.every((t) => state.territories[t].owner === o) ? o : null;
  }
  return out;
}

/** Base = max(3, floor(territories / 3)) + continent bonuses. Card trades are separate. */
export function reinforcementsFor(state: GameState, player: PlayerId): ReinforcementBreakdown {
  const territoryCount_ = territoryCount(state, player);
  const base = Math.max(3, Math.floor(territoryCount_ / 3));
  const continents = continentsOwned(state, player).map((c) => ({ continent: c, bonus: CONTINENTS[c].bonus }));
  const total = base + continents.reduce((s, c) => s + c.bonus, 0);
  return { territoryCount: territoryCount_, base, continents, total };
}

/** Attacker dice allowed from `from`: min(3, armies − 1), 0 if it can't attack. */
export function maxAttackDice(state: GameState, from: TerritoryId): 0 | 1 | 2 | 3 {
  const ts = state.territories[from];
  if (!ts) return 0;
  return Math.max(0, Math.min(3, ts.armies - 1)) as 0 | 1 | 2 | 3;
}

/** Defender dice: min(2, armies). Defender always rolls the max. */
export function defendDiceFor(armies: number): number {
  return Math.max(0, Math.min(2, armies));
}

/** Adjacent enemy territories `from` can attack (empty if `from` has < 2 armies). */
export function attackTargets(state: GameState, from: TerritoryId): TerritoryId[] {
  const ts = state.territories[from];
  if (!ts || ts.armies < 2 || ts.owner < 0) return [];
  return ADJACENCY[from].filter((n) => {
    const o = state.territories[n].owner;
    return o !== ts.owner && o >= 0;
  });
}

/** Owned territories with ≥ 2 armies and at least one adjacent enemy. */
export function attackSources(state: GameState, player: PlayerId): TerritoryId[] {
  const out: TerritoryId[] = [];
  for (const t of TERRITORY_IDS) {
    const ts = state.territories[t];
    if (ts.owner !== player || ts.armies < 2) continue;
    if (ADJACENCY[t].some((n) => state.territories[n].owner !== player && state.territories[n].owner >= 0)) out.push(t);
  }
  return out;
}

/** BFS over territories owned by `from`'s owner. Returns from → … → to (inclusive), or null. */
export function connectedPath(state: GameState, from: TerritoryId, to: TerritoryId): TerritoryId[] | null {
  const owner = state.territories[from]?.owner;
  if (owner === undefined || owner < 0 || !state.territories[to] || state.territories[to].owner !== owner) return null;
  if (from === to) return null;
  const prev = new Map<TerritoryId, TerritoryId | null>([[from, null]]);
  const queue: TerritoryId[] = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const n of ADJACENCY[cur]) {
      if (prev.has(n) || state.territories[n].owner !== owner) continue;
      prev.set(n, cur);
      if (n === to) {
        const path: TerritoryId[] = [to];
        let p: TerritoryId | null = cur;
        while (p) {
          path.push(p);
          p = prev.get(p) ?? null;
        }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

/** Territories of the same owner reachable from `from` through owned territories (excluding `from`). */
export function connectedOwned(state: GameState, from: TerritoryId): TerritoryId[] {
  const owner = state.territories[from]?.owner;
  if (owner === undefined || owner < 0) return [];
  const seen = new Set<TerritoryId>([from]);
  const queue: TerritoryId[] = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    for (const n of ADJACENCY[queue[qi]]) {
      if (seen.has(n) || state.territories[n].owner !== owner) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  seen.delete(from);
  return TERRITORY_IDS.filter((t) => seen.has(t));
}

/** Fortify path under the game's fortifyRule ('adjacent' → [from, to] if neighbors). */
export function fortifyPath(state: GameState, from: TerritoryId, to: TerritoryId): TerritoryId[] | null {
  const a = state.territories[from];
  const b = state.territories[to];
  if (!a || !b || from === to || a.owner < 0 || a.owner !== b.owner) return null;
  if (state.config.fortifyRule === 'adjacent') return ADJACENCY[from].includes(to) ? [from, to] : null;
  return connectedPath(state, from, to);
}

/** Where `from` may fortify to under the fortifyRule (empty if `from` has < 2 armies). */
export function fortifyTargets(state: GameState, from: TerritoryId): TerritoryId[] {
  const a = state.territories[from];
  if (!a || a.armies < 2 || a.owner < 0) return [];
  if (state.config.fortifyRule === 'adjacent') {
    return ADJACENCY[from].filter((n) => state.territories[n].owner === a.owner);
  }
  return connectedOwned(state, from);
}

/** Owned territories with ≥ 2 armies and at least one owned neighbor (so a fortify target exists). */
export function fortifySources(state: GameState, player: PlayerId): TerritoryId[] {
  const out: TerritoryId[] = [];
  for (const t of TERRITORY_IDS) {
    const ts = state.territories[t];
    if (ts.owner !== player || ts.armies < 2) continue;
    if (ADJACENCY[t].some((n) => state.territories[n].owner === player)) out.push(t);
  }
  return out;
}

/** Territories needed to win: ceil(42 × dominationPercent / 100). */
export function territoriesNeeded(state: GameState): number {
  return Math.ceil((TERRITORY_COUNT * state.config.dominationPercent) / 100);
}

export function alivePlayers(state: GameState): PlayerId[] {
  return state.players.filter((p) => !p.eliminated).map((p) => p.id);
}

/**
 * Winner by territory count (domination / percent / last standing), or null.
 * Reason is 'domination' at 100% (or last player standing), 'percent' below that.
 */
export function checkWinner(state: GameState): { winner: PlayerId; reason: 'domination' | 'percent' } | null {
  const alive = alivePlayers(state);
  if (alive.length === 1) return { winner: alive[0], reason: 'domination' };
  const need = territoriesNeeded(state);
  for (const p of alive) {
    const n = territoryCount(state, p);
    if (n >= need) return { winner: p, reason: need >= TERRITORY_COUNT ? 'domination' : 'percent' };
  }
  return null;
}

/** Turn-limit winner: most territories, then most armies, then lowest seat. */
export function turnLimitWinner(state: GameState): PlayerId {
  let best = -1;
  let bestT = -1;
  let bestA = -1;
  for (const p of alivePlayers(state)) {
    const t = territoryCount(state, p);
    const a = totalArmies(state, p);
    if (t > bestT || (t === bestT && a > bestA)) {
      best = p;
      bestT = t;
      bestA = a;
    }
  }
  return best;
}

/** Sum of enemy armies adjacent to `t` (from the owner's point of view). */
export function enemyNeighborArmies(state: GameState, t: TerritoryId): number {
  const owner = state.territories[t].owner;
  let s = 0;
  for (const n of ADJACENCY[t]) {
    const ns = state.territories[n];
    if (ns.owner !== owner && ns.owner >= 0) s += ns.armies;
  }
  return s;
}

/** True if `t` borders at least one territory owned by someone else. */
export function isBorder(state: GameState, t: TerritoryId): boolean {
  const owner = state.territories[t].owner;
  return ADJACENCY[t].some((n) => state.territories[n].owner !== owner && state.territories[n].owner >= 0);
}
