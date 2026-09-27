// Test fixtures: a fresh main-phase game with a hand-set board.
import { TERRITORY_IDS, createGame, type Card, type GameState, type Phase, type PlayerConfig, type TerritoryId } from '../../src/engine';

export const SEATS: PlayerConfig[] = [
  { name: 'John', color: 'crimson', kind: 'human' },
  { name: 'Sam', color: 'cobalt', kind: 'human' },
  { name: 'Priya', color: 'amber', kind: 'ai', difficulty: 'normal' },
];

/**
 * A 3-seat game in `phase` for John (seat 0). Every territory belongs to Priya (seat 2) with 1 army
 * unless listed in `own` ({ territory: [owner, armies] }).
 */
export function board(own: Partial<Record<TerritoryId, [number, number]>>, phase: Phase = { kind: 'attack' }, over: Partial<GameState> = {}): GameState {
  const { state } = createGame({
    players: SEATS,
    setupMode: 'random',
    initialPlacement: 'auto',
    setupBatch: 5,
    cardBonus: 'progressive',
    fortifyRule: 'connected',
    dominationPercent: 100,
    turnLimit: null,
    seed: 7,
  });
  for (const t of TERRITORY_IDS) state.territories[t] = { owner: 2, armies: 1 };
  for (const [t, v] of Object.entries(own)) state.territories[t as TerritoryId] = { owner: v![0], armies: v![1] };
  state.currentPlayer = 0;
  state.phase = phase;
  state.round = 3;
  state.turn = 9;
  state.conqueredThisTurn = false;
  for (const p of state.players) p.cards = [];
  return { ...state, ...over };
}

export function card(id: number, symbol: Card['symbol'], territory: TerritoryId | null = null): Card {
  return { id, symbol, territory };
}
