// Heuristic AI. Stateless: every call re-reads the board and returns ONE action for `me`.
// Randomness comes from a local generator seeded by hashing the state, so the AI never touches
// state.rng and the same state always yields the same decision.

import { bonusTerritoryFor, setValueFor, validSets } from '../cards';
import { ADJACENCY, CONTINENTS, CONTINENT_IDS, TERRITORIES, TERRITORY_IDS } from '../mapData';
import { blitzOdds, winProbability, winProbabilityStopAt } from '../probability';
import { hashInts, random, type RngHolder } from '../rng';
import { fortifyPath, fortifyTargets, reinforcementsFor } from '../rules';
import { UNCLAIMED, type Action, type ContinentId, type GameState, type Phase, type PlayerId, type TerritoryId } from '../types';
import { PERSONAS, type Persona } from './persona';

/** Territories in each continent that border another continent (static). */
const CONTINENT_BORDERS: Record<ContinentId, TerritoryId[]> = Object.fromEntries(
  CONTINENT_IDS.map((c) => [
    c,
    CONTINENTS[c].territories.filter((t) => ADJACENCY[t].some((n) => TERRITORIES[n].continent !== c)),
  ]),
) as Record<ContinentId, TerritoryId[]>;

const PHASE_ORD: Record<Phase['kind'], number> = {
  'setup-claim': 1,
  'setup-place': 2,
  reinforce: 3,
  attack: 4,
  occupy: 5,
  fortify: 6,
  'game-over': 7,
};

interface Ctx {
  s: GameState;
  me: PlayerId;
  p: Persona;
  rng: RngHolder;
  round: number;
  /** Per-player territory count and army totals. */
  terr: number[];
  armies: number[];
  income: number[];
  /** Strongest opponent by income + armies (or -1). */
  leader: PlayerId;
  /** Continent stats. */
  mineIn: Record<ContinentId, number>;
  owner: Record<ContinentId, PlayerId | null>;
  desire: Record<ContinentId, number>;
  goal: ContinentId;
  /** Opponent we're trying to eliminate this turn (hunt), or -1. */
  prey: PlayerId;
}

function mkRng(s: GameState, me: PlayerId): RngHolder {
  const ph = s.phase;
  const extra = ph.kind === 'reinforce' ? ph.remaining * 131 + Object.keys(ph.placed).length : ph.kind === 'setup-place' ? ph.toPlace : 0;
  return { rng: hashInts(s.rng, s.turn, me, PHASE_ORD[ph.kind], extra, s.round) };
}

function buildCtx(s: GameState, me: PlayerId): Ctx {
  const diff = s.players[me].difficulty ?? 'normal';
  const p = PERSONAS[diff];
  const n = s.players.length;
  const terr = new Array<number>(n).fill(0);
  const armies = new Array<number>(n).fill(0);
  for (const t of TERRITORY_IDS) {
    const ts = s.territories[t];
    if (ts.owner >= 0) {
      terr[ts.owner]++;
      armies[ts.owner] += ts.armies;
    }
  }
  const income = s.players.map((pl) => (pl.eliminated || s.phase.kind.startsWith('setup') ? 0 : reinforcementsFor(s, pl.id).total));
  let leader = -1;
  let best = -1;
  for (const pl of s.players) {
    if (pl.id === me || pl.eliminated) continue;
    const score = income[pl.id] * 3 + armies[pl.id] + terr[pl.id];
    if (score > best) {
      best = score;
      leader = pl.id;
    }
  }
  const mineIn = {} as Record<ContinentId, number>;
  const owner = {} as Record<ContinentId, PlayerId | null>;
  const desire = {} as Record<ContinentId, number>;
  let goal: ContinentId = 'australia';
  let goalScore = -Infinity;
  for (const c of CONTINENT_IDS) {
    const ts = CONTINENTS[c].territories;
    let mine = 0;
    let myA = 0;
    let enemyA = 0;
    let unclaimed = 0;
    for (const t of ts) {
      const x = s.territories[t];
      if (x.owner === me) {
        mine++;
        myA += x.armies;
      } else if (x.owner === UNCLAIMED) unclaimed++;
      else enemyA += x.armies;
    }
    mineIn[c] = mine;
    const o0 = s.territories[ts[0]].owner;
    owner[c] = o0 >= 0 && ts.every((t) => s.territories[t].owner === o0) ? o0 : null;
    const frac = mine / ts.length;
    const holdability = CONTINENTS[c].bonus / CONTINENT_BORDERS[c].length; // value per border to guard
    const strength = (myA + 1) / (myA + enemyA + unclaimed + 1);
    desire[c] = holdability * (0.25 + frac) * (0.35 + strength);
    if (desire[c] > goalScore) {
      goalScore = desire[c];
      goal = c;
    }
  }
  const c: Ctx = { s, me, p, rng: mkRng(s, me), round: s.round, terr, armies, income, leader, mineIn, owner, desire, goal, prey: -1 };
  if (p.hunt && !s.phase.kind.startsWith('setup')) c.prey = findPrey(c, huntExtra(c));
  return c;
}

/** Armies we could still add this turn (reinforcements left + a tradeable set). */
function huntExtra(c: Ctx): number {
  const ph = c.s.phase;
  if (ph.kind !== 'reinforce') return 0;
  const sets = validSets(c.s.players[c.me].cards);
  const setV = sets.length ? setValueFor(c.s.config, c.s.tradeCount, ['infantry', 'cavalry', 'artillery']) : 0;
  return ph.remaining + (c.s.config.cardBonus === 'fixed' && sets.length ? 6 : setV);
}

/**
 * Best opponent we can plausibly wipe out this turn: all their territories must border ours or each
 * other (so a sweep can reach them), and our adjacent force must cover the expected cost.
 * Value = their cards (captured) + game-ending in 2-player.
 */
function findPrey(c: Ctx, extra: number): PlayerId {
  const s = c.s;
  let best = -1;
  let bestV = 0;
  for (const v of s.players) {
    if (v.id === c.me || v.eliminated) continue;
    const theirs = TERRITORY_IDS.filter((t) => s.territories[t].owner === v.id);
    if (theirs.length === 0 || theirs.length > 9) continue;
    let cost = 0;
    for (const t of theirs) cost += s.territories[t].armies * 1.15 + 1.6;
    // Force: our stacks touching their territories (they'd sweep), plus what we can still add.
    const touching = new Set<TerritoryId>();
    for (const t of theirs) for (const n of ADJACENCY[t]) if (s.territories[n].owner === c.me) touching.add(n);
    if (touching.size === 0) continue;
    let force = extra;
    let biggest = 0;
    for (const t of touching) {
      const a = s.territories[t].armies - 1;
      force += a * 0.6;
      biggest = Math.max(biggest, a);
    }
    force += biggest * 0.4; // the main stack counts in full
    if (force < cost * 1.1) continue;
    const alive = s.players.filter((p) => !p.eliminated).length;
    const value = 3 + v.cards.length * 3 + (alive === 2 ? 50 : 0) - theirs.length * 0.3;
    if (value > bestV) {
      bestV = value;
      best = v.id;
    }
  }
  return best;
}

function noisy(c: Ctx, v: number): number {
  if (c.p.noise <= 0) return v;
  return v * (1 + (random(c.rng) * 2 - 1) * c.p.noise);
}

function mine(c: Ctx, t: TerritoryId): boolean {
  return c.s.territories[t].owner === c.me;
}

function enemyNeighbors(c: Ctx, t: TerritoryId): TerritoryId[] {
  return ADJACENCY[t].filter((n) => {
    const o = c.s.territories[n].owner;
    return o !== c.me && o >= 0;
  });
}

/** Largest single enemy stack adjacent to t (what could hit it next turn), ignoring `except`. */
function maxThreat(c: Ctx, t: TerritoryId, except?: TerritoryId): number {
  let m = 0;
  for (const n of ADJACENCY[t]) {
    if (n === except) continue;
    const x = c.s.territories[n];
    if (x.owner !== c.me && x.owner >= 0) m = Math.max(m, x.armies);
  }
  return m;
}

function sumThreat(c: Ctx, t: TerritoryId, except?: TerritoryId): number {
  let m = 0;
  for (const n of ADJACENCY[t]) {
    if (n === except) continue;
    const x = c.s.territories[n];
    if (x.owner !== c.me && x.owner >= 0) m += x.armies;
  }
  return m;
}

/** Aggression creeps up in very long games so nothing stalls. */
function threshold(c: Ctx, base: number): number {
  const late = Math.max(0, c.round - 25) * 0.005;
  return Math.max(0.5, base - Math.min(0.35, late));
}

/** How much we want to own enemy territory `n`. */
function targetValue(c: Ctx, n: TerritoryId): number {
  const s = c.s;
  const x = s.territories[n];
  const cont = TERRITORIES[n].continent;
  const info = CONTINENTS[cont];
  let v = 1;
  v += c.p.goalWeight * c.desire[cont] * 2.2 * (cont === c.goal ? 1.5 : 1);
  if (c.mineIn[cont] === info.territories.length - 1) v += c.p.completeWeight * info.bonus;
  if (c.owner[cont] !== null && c.owner[cont] !== c.me) v += c.p.breakWeight * info.bonus;
  if (x.owner >= 0) {
    const victim = s.players[x.owner];
    const vt = c.terr[x.owner];
    if (vt <= 4) v += (c.p.elimWeight * (1 + victim.cards.length * 1.2)) / vt;
    if (x.owner === c.leader) v += c.p.leaderWeight;
    if (x.owner === c.prey) v += 4 + victim.cards.length * 1.5;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function chooseClaim(c: Ctx): Action {
  const s = c.s;
  const free = TERRITORY_IDS.filter((t) => s.territories[t].owner === UNCLAIMED);
  let best = free[0];
  let bestV = -Infinity;
  for (const t of free) {
    const cont = TERRITORIES[t].continent;
    const size = CONTINENTS[cont].territories.length;
    let enemy = 0;
    for (const x of CONTINENTS[cont].territories) {
      const o = s.territories[x].owner;
      if (o !== c.me && o !== UNCLAIMED) enemy++;
    }
    const adjMine = ADJACENCY[t].filter((nb) => s.territories[nb].owner === c.me).length;
    const holdability = CONTINENTS[cont].bonus / CONTINENT_BORDERS[cont].length;
    let v = (2.2 * (c.mineIn[cont] + 1)) / size - (1.6 * enemy) / size + 0.35 * adjMine + 0.5 * holdability;
    if (c.p.noise > 0.3) v = random(c.rng) * 2 + adjMine * 0.3; // easy: mostly random, likes clumps
    v = noisy(c, v + 5) - 5;
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return { type: 'claim', player: c.me, territory: best };
}

// ---------------------------------------------------------------------------
// Placement (setup-place and reinforce)
// ---------------------------------------------------------------------------

/** Where a stack of `extra` more armies would do the most attacking good. */
function stagingScore(c: Ctx, b: TerritoryId, extra: number): number {
  const a = c.s.territories[b].armies + extra;
  let best = 0;
  for (const n of enemyNeighbors(c, b)) {
    const d = c.s.territories[n].armies;
    const v = targetValue(c, n) * (0.25 + winProbability(a, d));
    if (v > best) best = v;
  }
  // Staging inside/next to the goal continent keeps the push coherent.
  if (TERRITORIES[b].continent === c.goal) best *= 1.15;
  return best;
}

/**
 * Expected value of a greedy conquest chain starting from `start` with `armies` in it: repeatedly
 * blitz the best adjacent target (win prob ≥ threshold), march everything but 1 forward, continue.
 * Each step's value is weighted by the probability of having got that far. Continent completion
 * is tracked along the chain so a sweep through a continent is valued as a whole.
 */
function chainValue(c: Ctx, start: TerritoryId, armies: number, depth: number): number {
  const s = c.s;
  const thr = threshold(c, c.p.attackThreshold);
  const taken = new Set<TerritoryId>();
  const mineIn = { ...c.mineIn };
  let cur = start;
  let a = armies;
  let reach = 1;
  let total = 0;
  for (let step = 0; step < depth && a >= 2; step++) {
    let bestN: TerritoryId | null = null;
    let bestV = 0;
    let bestP = 0;
    for (const n of ADJACENCY[cur]) {
      if (taken.has(n)) continue;
      const o = s.territories[n].owner;
      if (o === c.me || o < 0) continue;
      const p = winProbability(a, s.territories[n].armies);
      if (p < thr) continue;
      const cont = TERRITORIES[n].continent;
      let v = targetValue(c, n);
      // Completion discovered along the chain (targetValue only sees the current board).
      if (mineIn[cont] === CONTINENTS[cont].territories.length - 1 && c.mineIn[cont] !== mineIn[cont])
        v += c.p.completeWeight * CONTINENTS[cont].bonus;
      if (p * v > bestV) {
        bestV = p * v;
        bestN = n;
        bestP = p;
      }
    }
    if (!bestN) break;
    total += reach * bestV;
    reach *= bestP;
    const odds = blitzOdds(a, s.territories[bestN].armies);
    a = Math.floor((Number.isFinite(odds.expectedAttackersLeftIfWin) ? odds.expectedAttackersLeftIfWin : 1) - 1);
    taken.add(bestN);
    mineIn[TERRITORIES[bestN].continent]++;
    cur = bestN;
  }
  return total;
}

/** Armies `t` should hold to be safe next turn. */
function garrisonFor(c: Ctx, t: TerritoryId, cap: number): number {
  const threat = maxThreat(c, t);
  if (c.p.deter > 0 && threat >= 2) {
    // Smallest garrison that pushes the biggest neighbor's blitz odds under `deter` (bounded search).
    const have = c.s.territories[t].armies;
    for (let d = have; d <= have + cap; d++) if (winProbability(threat, d) < c.p.deter) return d;
    return have + cap;
  }
  return Math.ceil(threat * 0.9 + sumThreat(c, t) * 0.15) + 1;
}

function choosePlacement(c: Ctx, remaining: number, placedSoFar: number, kind: 'setupPlace' | 'reinforce'): Action {
  const s = c.s;
  const owned = TERRITORY_IDS.filter((t) => mine(c, t));
  const borders = owned.filter((t) => enemyNeighbors(c, t).length > 0);
  const pool = borders.length ? borders : owned;
  const mk = (territory: TerritoryId, count: number): Action =>
    kind === 'setupPlace'
      ? { type: 'placeSetup', player: c.me, territory, count }
      : { type: 'reinforce', player: c.me, territory, count };

  if (!c.p.concentrate) {
    // Easy: pick a random-ish front territory, dump a few there.
    const t = pool[Math.floor(random(c.rng) * pool.length)];
    const count = Math.max(1, Math.min(remaining, 1 + Math.floor(random(c.rng) * remaining)));
    return mk(t, count);
  }

  // 1) Defend borders of continents we hold (and near-complete goal continents on hard).
  const total = remaining + placedSoFar;
  const budget = Math.floor(total * c.p.defenseShare) - placedSoFar;
  if (budget > 0 && kind === 'reinforce') {
    let bestT: TerritoryId | null = null;
    let bestNeed = 0;
    let bestRaw = 0;
    for (const t of borders) {
      const cont = TERRITORIES[t].continent;
      if (c.owner[cont] !== c.me) continue;
      const want = garrisonFor(c, t, remaining);
      const need = (want - s.territories[t].armies) * (1 + CONTINENTS[cont].bonus / 10);
      if (need > bestNeed) {
        bestNeed = need;
        bestT = t;
        bestRaw = want - s.territories[t].armies;
      }
    }
    if (bestT) {
      const count = Math.max(1, Math.min(remaining, budget, bestRaw));
      return mk(bestT, count);
    }
  }

  // 2) Hunting: stack the biggest territory touching the prey.
  if (c.prey >= 0 && kind === 'reinforce') {
    let bestT: TerritoryId | null = null;
    let bestA = -1;
    for (const t of borders) {
      if (!ADJACENCY[t].some((n) => s.territories[n].owner === c.prey)) continue;
      if (s.territories[t].armies > bestA) {
        bestA = s.territories[t].armies;
        bestT = t;
      }
    }
    if (bestT) return mk(bestT, remaining);
  }

  // 3) Everything else onto the best staging territory.
  let best = pool[0];
  let bestV = -Infinity;
  for (const t of pool) {
    const v = noisy(
      c,
      c.p.lookahead > 0 ? chainValue(c, t, s.territories[t].armies + remaining, c.p.lookahead) + stagingScore(c, t, remaining) * 0.25 : stagingScore(c, t, remaining),
    );
    if (v > bestV) {
      bestV = v;
      best = t;
    }
  }
  return mk(best, remaining);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function bestTrade(c: Ctx): [number, number, number] | null {
  const s = c.s;
  const hand = s.players[c.me].cards;
  const sets = validSets(hand);
  if (!sets.length) return null;
  let best = sets[0];
  let bestV = -Infinity;
  for (const ids of sets) {
    const cards = ids.map((id) => hand.find((x) => x.id === id)!);
    const wilds = cards.filter((x) => x.symbol === 'wild').length;
    const v =
      setValueFor(s.config, s.tradeCount, cards.map((x) => x.symbol)) +
      (bonusTerritoryFor(s, c.me, cards) ? 2 : 0) -
      wilds * 0.5; // keep wilds for later if it's a wash
    if (v > bestV) {
      bestV = v;
      best = ids;
    }
  }
  return best;
}

function wantsOptionalTrade(c: Ctx, ph: Extract<Phase, { kind: 'reinforce' }>): boolean {
  const s = c.s;
  const hand = s.players[c.me].cards;
  const ids = bestTrade(c);
  if (!ids) return false;
  const value = setValueFor(s.config, s.tradeCount, ids.map((id) => hand.find((x) => x.id === id)!.symbol));
  switch (c.p.trade) {
    case 'forced':
      return false;
    case 'eager':
      return value >= 6 || hand.length >= 4;
    case 'timed': {
      if (hand.length >= 4 || value >= 10) return true;
      // Cash in when a held continent is in danger or an elimination is on the table.
      let deficit = 0;
      for (const t of TERRITORY_IDS) {
        if (!mine(c, t)) continue;
        const cont = TERRITORIES[t].continent;
        if (c.owner[cont] !== c.me) continue;
        deficit += Math.max(0, maxThreat(c, t) - s.territories[t].armies);
      }
      if (deficit > ph.remaining) return true;
      if (c.prey >= 0) return true;
      const weak = s.players.some((pl) => pl.id !== c.me && !pl.eliminated && c.terr[pl.id] <= 3 && pl.cards.length >= 2);
      return weak || value >= 8;
    }
  }
}

// ---------------------------------------------------------------------------
// Attack
// ---------------------------------------------------------------------------

interface AttackPlan {
  from: TerritoryId;
  to: TerritoryId;
  stopAt: number;
  p: number;
  score: number;
}

function reserveFor(c: Ctx, from: TerritoryId, to: TerritoryId): number {
  if (!c.p.keepReserve) return 1;
  const a = c.s.territories[from].armies;
  const cont = TERRITORIES[from].continent;
  if (c.owner[cont] !== c.me) return 1;
  const other = maxThreat(c, from, to);
  if (other === 0) return 1;
  return Math.max(1, Math.min(a - 2, Math.round(other * 0.6)));
}

function bestAttack(c: Ctx): AttackPlan | null {
  const s = c.s;
  const thr = threshold(c, c.p.attackThreshold);
  const cardThr = threshold(c, c.p.cardGrabThreshold);
  let best: AttackPlan | null = null;
  for (const from of TERRITORY_IDS) {
    const fs = s.territories[from];
    if (fs.owner !== c.me || fs.armies < 2) continue;
    for (const to of enemyNeighbors(c, from)) {
      const d = s.territories[to].armies;
      const stopAt = reserveFor(c, from, to);
      if (fs.armies <= stopAt) continue;
      const p = stopAt > 1 ? winProbabilityStopAt(fs.armies, d, stopAt) : winProbability(fs.armies, d);
      const cardPull = !s.conqueredThisTurn ? 2.2 : 0;
      const huntThr = s.territories[to].owner === c.prey ? Math.min(thr, 0.42) : thr;
      const needed = !s.conqueredThisTurn ? Math.min(huntThr, cardThr) : huntThr;
      if (p < needed) continue;
      let v = targetValue(c, to) + cardPull;
      // Plain-card grabs only count when they are cheap.
      if (p < huntThr && !s.conqueredThisTurn) v = cardPull + 0.5;
      const odds = blitzOdds(fs.armies - stopAt + 1, d);
      if (c.p.lookahead > 0 && p >= huntThr) {
        // Where can the surviving stack go next? Follow-up value, discounted by the odds of getting there.
        const left = Number.isFinite(odds.expectedAttackersLeftIfWin) ? Math.floor(odds.expectedAttackersLeftIfWin) - 1 : 0;
        if (left >= 2) v += 0.6 * chainValue(c, to, left, c.p.lookahead - 1);
      }
      let score = p * v - (odds.expectedAttackerLosses / Math.max(4, fs.armies)) * 1.2;
      if (c.p.overextendCare > 0) {
        const left = Number.isFinite(odds.expectedAttackersLeftIfWin) ? odds.expectedAttackersLeftIfWin + stopAt - 1 : 1;
        const exposure = maxThreat(c, to) - left * 0.7;
        const strategic = c.mineIn[TERRITORIES[to].continent] === CONTINENTS[TERRITORIES[to].continent].territories.length - 1;
        if (exposure > 0 && !strategic) score -= c.p.overextendCare * Math.min(2.5, exposure / 6);
      }
      score = noisy(c, score);
      if (score <= 0.05) continue;
      if (!best || score > best.score) best = { from, to, stopAt, p, score };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Occupy
// ---------------------------------------------------------------------------

function chooseOccupy(c: Ctx, ph: Extract<Phase, { kind: 'occupy' }>): Action {
  const { from, to, min, max } = ph;
  if (!c.p.concentrate) {
    const count = min + Math.floor(random(c.rng) * (max - min + 1));
    return { type: 'occupy', player: c.me, count };
  }
  const tFrom = sumThreat(c, from);
  const tTo = sumThreat(c, to);
  let count: number;
  if (tFrom === 0) count = max;
  else if (tTo === 0) count = min;
  else {
    // Push forward if the new territory has juicier targets; keep enough home to hold.
    const oppTo = enemyNeighbors(c, to).reduce((m, n) => Math.max(m, targetValue(c, n)), 0);
    const oppFrom = enemyNeighbors(c, from).reduce((m, n) => Math.max(m, targetValue(c, n)), 0);
    const wTo = tTo + oppTo * 3;
    const wFrom = tFrom + oppFrom * 3;
    count = Math.round(min + (max - min) * (wTo / (wTo + wFrom)) * 1.1);
  }
  count = Math.max(min, Math.min(max, count));
  return { type: 'occupy', player: c.me, count };
}

// ---------------------------------------------------------------------------
// Fortify
// ---------------------------------------------------------------------------

function importance(c: Ctx, t: TerritoryId): number {
  const threat = maxThreat(c, t);
  if (threat === 0 && enemyNeighbors(c, t).length === 0) return 0;
  const cont = TERRITORIES[t].continent;
  let v = threat + stagingScore(c, t, 0) * 2;
  if (c.owner[cont] === c.me) v += CONTINENTS[cont].bonus * 1.5;
  return v;
}

function chooseFortify(c: Ctx): Action | null {
  const s = c.s;
  if (c.p.fortifyChance < 1 && random(c.rng) > c.p.fortifyChance) return null;
  let best: { from: TerritoryId; to: TerritoryId; count: number; score: number } | null = null;
  for (const from of TERRITORY_IDS) {
    const fs = s.territories[from];
    if (fs.owner !== c.me || fs.armies < 2) continue;
    const interior = enemyNeighbors(c, from).length === 0;
    const keep = interior ? 1 : Math.max(1, Math.ceil(maxThreat(c, from) * 0.9));
    const avail = fs.armies - keep;
    if (avail < (interior ? 1 : 3)) continue;
    const srcImp = interior ? 0 : importance(c, from);
    for (const to of fortifyTargets(s, from)) {
      if (enemyNeighbors(c, to).length === 0) continue;
      const imp = importance(c, to) - srcImp;
      if (imp <= 0.5) continue;
      const score = noisy(c, avail * imp);
      if (!best || score > best.score) best = { from, to, count: avail, score };
    }
  }
  if (!best) return null;
  if (!fortifyPath(s, best.from, best.to)) return null;
  return { type: 'fortify', player: c.me, from: best.from, to: best.to, count: best.count };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** Raw decision (may, in theory, be illegal; `chooseAiAction` validates and falls back). */
export function decide(s: GameState, me: PlayerId): Action {
  const c = buildCtx(s, me);
  const ph = s.phase;
  switch (ph.kind) {
    case 'setup-claim':
      return chooseClaim(c);
    case 'setup-place':
      return choosePlacement(c, ph.toPlace, 0, 'setupPlace');
    case 'reinforce': {
      if (ph.mustTrade || wantsOptionalTrade(c, ph)) {
        const ids = bestTrade(c);
        if (ids) return { type: 'trade', player: me, cardIds: ids };
      }
      if (ph.remaining > 0) {
        const placedSoFar = Object.values(ph.placed).reduce((a: number, b) => a + (b ?? 0), 0);
        return choosePlacement(c, ph.remaining, placedSoFar, 'reinforce');
      }
      return { type: 'endReinforce', player: me };
    }
    case 'attack': {
      const plan = bestAttack(c);
      if (plan) {
        return plan.stopAt > 1
          ? { type: 'blitz', player: me, from: plan.from, to: plan.to, stopAt: plan.stopAt }
          : { type: 'blitz', player: me, from: plan.from, to: plan.to };
      }
      // Only walk into fortify if there's a move worth making.
      return chooseFortify(c) ? { type: 'endAttack', player: me } : { type: 'endTurn', player: me };
    }
    case 'occupy':
      return chooseOccupy(c, ph);
    case 'fortify':
      return chooseFortify(buildCtx(s, me)) ?? { type: 'endTurn', player: me };
    case 'game-over':
      return { type: 'setController', player: me, kind: s.players[me].kind, ...(s.players[me].difficulty ? { difficulty: s.players[me].difficulty } : {}) };
  }
}
