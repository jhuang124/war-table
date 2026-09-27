// Game creation: config defaults/sanitizing, seat setup, deck, first player, deal or draft.

import { buildDeck } from './cards';
import { afterTerritoriesAssigned, emit, setPhase, updatePeak, type Draft } from './flow';
import { STARTING_ARMIES, TERRITORY_IDS } from './mapData';
import { randInt, shuffleInPlace, toSeed } from './rng';
import {
  UNCLAIMED,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerConfig,
  type PlayerId,
  type PlayerStats,
  type TerritoryId,
  type TerritoryState,
} from './types';

const COLORS = ['crimson', 'cobalt', 'emerald', 'amber', 'violet', 'rose'] as const;

/** Sensible defaults: random deal, auto placement, progressive cards, connected fortify, world domination. */
export function defaultConfig(players: PlayerConfig[]): GameConfig {
  return {
    players,
    setupMode: 'random',
    initialPlacement: 'auto',
    setupBatch: 5,
    cardBonus: 'progressive',
    fortifyRule: 'connected',
    dominationPercent: 100,
    turnLimit: null,
    // Seed generation is the one place outside game logic that may use Math.random.
    seed: Math.floor(Math.random() * 0x100000000) >>> 0,
  };
}

/** Human-readable problem with a config, or null if createGame will accept it. */
export function validateConfig(config: GameConfig): string | null {
  if (!config || typeof config !== 'object') return 'Missing game settings.';
  if (!Array.isArray(config.players) || config.players.length < 2 || config.players.length > 4)
    return 'Risk needs 2 to 4 players.';
  const colors = new Set<string>();
  for (const [i, p] of config.players.entries()) {
    if (!p || typeof p !== 'object') return `Seat ${i + 1} is empty.`;
    if (p.kind !== 'human' && p.kind !== 'ai') return `Seat ${i + 1} must be human or AI.`;
    if (!COLORS.includes(p.color as (typeof COLORS)[number])) return `Seat ${i + 1} needs a color.`;
    if (colors.has(p.color)) return 'Each player needs a different color.';
    colors.add(p.color);
  }
  return null;
}

/**
 * Fill gaps and clamp numbers so the engine never sees nonsense. Documented clamps:
 * setupBatch ≥ 1 (default 5); startingArmies ≥ enough to hold every territory dealt;
 * dominationPercent in [30, 100]; turnLimit null or ≥ 1.
 */
export function sanitizeConfig(config: GameConfig): GameConfig {
  const n = config.players.length;
  const int = (x: unknown, dflt: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.floor(x) : dflt);
  const minArmies = Math.ceil(TERRITORY_IDS.length / n);
  const players = config.players.map((p, i) => ({
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Player ${i + 1}`,
    color: p.color,
    kind: p.kind,
    ...(p.kind === 'ai' ? { difficulty: p.difficulty ?? 'normal' } : p.difficulty ? { difficulty: p.difficulty } : {}),
  })) as PlayerConfig[];
  const out: GameConfig = {
    players,
    setupMode: config.setupMode === 'draft' ? 'draft' : 'random',
    initialPlacement: config.initialPlacement === 'manual' ? 'manual' : 'auto',
    setupBatch: Math.max(1, int(config.setupBatch, 5)),
    cardBonus: config.cardBonus === 'fixed' ? 'fixed' : 'progressive',
    fortifyRule: config.fortifyRule === 'adjacent' ? 'adjacent' : 'connected',
    dominationPercent: Math.min(100, Math.max(30, int(config.dominationPercent, 100))),
    turnLimit:
      config.turnLimit === null || config.turnLimit === undefined ? null : Math.max(1, int(config.turnLimit, 1)),
    seed: toSeed(int(config.seed, 0)),
  };
  if (config.startingArmies !== undefined) out.startingArmies = Math.max(minArmies, int(config.startingArmies, minArmies));
  return out;
}

export function emptyStats(): PlayerStats {
  return {
    territoriesConquered: 0,
    battlesWon: 0,
    battlesLost: 0,
    armiesDestroyed: 0,
    armiesLost: 0,
    cardsTraded: 0,
    reinforcementsReceived: 0,
    peakTerritories: 0,
  };
}

/**
 * Start a game. Throws only for configs `validateConfig` rejects (wrong seat count, duplicate
 * colors) — the UI should validate first. Events: gameStarted, then
 *   random: territoriesDealt → (auto) armiesPlaced×N(setup) → turnStarted → phaseChanged(reinforce)
 *                            → (manual) phaseChanged(setup-place) → setupTurn
 *   draft:  phaseChanged(setup-claim)
 */
export function createGame(inputConfig: GameConfig): { state: GameState; events: GameEvent[] } {
  const problem = validateConfig(inputConfig);
  if (problem) throw new Error(problem);
  const config = sanitizeConfig(inputConfig);
  const n = config.players.length;
  const starting = config.startingArmies ?? STARTING_ARMIES[n];

  const territories = {} as Record<TerritoryId, TerritoryState>;
  for (const t of TERRITORY_IDS) territories[t] = { owner: UNCLAIMED, armies: 0 };

  const s: GameState = {
    version: 1,
    id: '',
    config,
    players: config.players.map((p, i) => ({
      id: i,
      name: p.name,
      color: p.color,
      kind: p.kind,
      ...(p.kind === 'ai' ? { difficulty: p.difficulty ?? 'normal' } : {}),
      cards: [],
      eliminated: false,
      setupArmies: starting,
      stats: emptyStats(),
    })),
    territories,
    currentPlayer: 0,
    firstPlayer: 0,
    turn: 0,
    round: 0,
    phase: { kind: 'setup-claim' },
    deck: [],
    discard: [],
    tradeCount: 0,
    conqueredThisTurn: false,
    rng: config.seed,
    timeline: [],
  };
  const d: Draft = { s, ev: [] };

  let id = 'g_';
  for (let i = 0; i < 6; i++) id += '0123456789abcdefghijklmnopqrstuvwxyz'[randInt(s, 36)];
  s.id = id;

  s.deck = shuffleInPlace(s, buildDeck());
  s.firstPlayer = randInt(s, n);
  s.currentPlayer = s.firstPlayer;
  emit(d, { type: 'gameStarted', firstPlayer: s.firstPlayer });

  if (config.setupMode === 'random') {
    const order = shuffleInPlace(s, [...TERRITORY_IDS]);
    const owners = {} as Record<TerritoryId, PlayerId>;
    order.forEach((t, i) => {
      const pid = (s.firstPlayer + i) % n;
      s.territories[t] = { owner: pid, armies: 1 };
      s.players[pid].setupArmies -= 1;
    });
    for (const t of TERRITORY_IDS) owners[t] = s.territories[t].owner;
    for (const p of s.players) p.setupArmies = Math.max(0, p.setupArmies);
    emit(d, { type: 'territoriesDealt', owners });
    for (const p of s.players) updatePeak(d, p.id);
    afterTerritoriesAssigned(d);
  } else {
    setPhase(d, { kind: 'setup-claim' });
  }
  return { state: s, events: d.ev };
}
