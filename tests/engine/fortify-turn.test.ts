import { describe, expect, it } from 'vitest';
import {
  ADJACENCY,
  createGame,
  fortifyPath,
  fortifySources,
  fortifyTargets,
  legalActionsSummary,
  turnLimitWinner,
  type GameEvent,
} from '../../src/engine';
import { act, config, passTurn, reject, scenario, types } from './helpers';

// P1 holds siam + indonesia, cutting P0's Australia (new_guinea, WA, EA) off from the mainland.
const cut = (over = {}) =>
  scenario({
    players: 2,
    phase: { kind: 'fortify' },
    terr: { siam: [1, 1], indonesia: [1, 1], alaska: [0, 6], new_guinea: [0, 4], india: [0, 3] },
    ...over,
  });

describe('fortify', () => {
  it('connected: moves along any chain of owned territories, event carries the BFS path, then the turn ends', () => {
    const s = cut();
    const r = act(s, { type: 'fortify', player: 0, from: 'alaska', to: 'argentina', count: 5 });
    const moved = r.events[0] as Extract<GameEvent, { type: 'armiesMoved' }>;
    expect(moved).toMatchObject({ type: 'armiesMoved', player: 0, from: 'alaska', to: 'argentina', count: 5, reason: 'fortify' });
    const path = moved.path!;
    expect(path[0]).toBe('alaska');
    expect(path[path.length - 1]).toBe('argentina');
    expect(path).toHaveLength(7); // shortest: alaska → alberta → western_us → central_america → venezuela → peru|brazil → argentina
    for (let i = 1; i < path.length; i++) {
      expect(ADJACENCY[path[i - 1]]).toContain(path[i]);
      expect(s.territories[path[i]].owner).toBe(0);
    }
    expect(r.state.territories.alaska.armies).toBe(1);
    expect(r.state.territories.argentina.armies).toBe(6);
    expect(types(r.events)).toEqual(['armiesMoved', 'turnStarted', 'phaseChanged']);
    expect(r.state.currentPlayer).toBe(1);
  });

  it('never through enemy territory', () => {
    const s = cut();
    expect(fortifyPath(s, 'new_guinea', 'india')).toBeNull();
    expect(reject(s, { type: 'fortify', player: 0, from: 'new_guinea', to: 'india', count: 1 })).toMatch(/No chain/);
    expect(fortifyTargets(s, 'new_guinea').sort()).toEqual(['eastern_australia', 'western_australia']);
    expect(fortifyPath(s, 'new_guinea', 'eastern_australia')).toEqual(['new_guinea', 'eastern_australia']);
  });

  it('adjacent rule: neighbors only', () => {
    const s = cut({ config: { fortifyRule: 'adjacent' } });
    expect(reject(s, { type: 'fortify', player: 0, from: 'alaska', to: 'argentina', count: 1 })).toMatch(/neighboring/);
    expect(fortifyTargets(s, 'alaska').sort()).toEqual(['alberta', 'kamchatka', 'northwest_territory']);
    const r = act(s, { type: 'fortify', player: 0, from: 'alaska', to: 'alberta', count: 2 });
    expect(r.events[0]).toMatchObject({ path: ['alaska', 'alberta'], count: 2 });
  });

  it('always leaves 1 behind; rejects enemy, same, and zero', () => {
    const s = cut();
    expect(reject(s, { type: 'fortify', player: 0, from: 'alaska', to: 'alberta', count: 6 })).toMatch(/at most 5 armies/);
    expect(reject(s, { type: 'fortify', player: 0, from: 'alaska', to: 'siam', count: 1 })).toMatch(/isn't yours/);
    expect(reject(s, { type: 'fortify', player: 0, from: 'alaska', to: 'alaska', count: 1 })).toMatch(/different/);
    expect(reject(s, { type: 'fortify', player: 0, from: 'alaska', to: 'alberta', count: 0 })).toMatch(/at least 1/);
    expect(reject(s, { type: 'fortify', player: 0, from: 'peru', to: 'brazil', count: 1 })).toMatch(/1 must stay/);
  });

  it('only in the fortify step; endTurn skips it', () => {
    const s = cut({ phase: { kind: 'attack' } });
    expect(reject(s, { type: 'fortify', player: 0, from: 'alaska', to: 'alberta', count: 1 })).toMatch(/End your attack/);
    const r = act(cut(), { type: 'endTurn', player: 0 });
    expect(r.state.currentPlayer).toBe(1);
  });

  it('sources and summary', () => {
    const s = cut();
    expect(fortifySources(s, 0)).toEqual(['alaska', 'india', 'new_guinea']);
    expect(legalActionsSummary(s)).toMatchObject({ phase: 'fortify', fortifySources: ['alaska', 'india', 'new_guinea'], canEndTurn: true, canEndAttack: false });
  });
});

describe('turn order, rounds, timeline', () => {
  it('round increments when play returns to the first player; a timeline point per round', () => {
    let { state } = createGame(config(3, { seed: 21 }));
    const f = state.firstPlayer;
    expect(state.timeline.map((p) => p.round)).toEqual([1]);
    expect(state.timeline[0].territories.reduce((a, b) => a + b, 0)).toBe(42);
    const order: number[] = [];
    for (let i = 0; i < 7; i++) {
      order.push(state.currentPlayer);
      state = passTurn(state).state;
    }
    expect(order).toEqual([f, f + 1, f + 2, f, f + 1, f + 2, f].map((x) => x % 3));
    expect(state.turn).toBe(8);
    expect(state.round).toBe(3);
    expect(state.timeline.map((p) => p.round)).toEqual([1, 2, 3]);
    expect(state.timeline[2].armies.reduce((a, b) => a + b, 0)).toBeGreaterThan(state.timeline[0].armies.reduce((a, b) => a + b, 0));
  });

  it('turnStarted carries turn and round', () => {
    const { state } = createGame(config(2, { seed: 22 }));
    const a = passTurn(state);
    const b = passTurn(a.state);
    expect(a.events.find((e) => e.type === 'turnStarted')).toMatchObject({ turn: 2, round: 1 });
    expect(b.events.find((e) => e.type === 'turnStarted')).toMatchObject({ turn: 3, round: 2 });
  });

  it('wraps correctly when the first player has been eliminated', () => {
    const s = scenario({ players: 3, fill: 1, terr: { japan: [2, 3] }, current: 2 });
    expect(s.players[0].eliminated).toBe(true);
    const r = act(s, { type: 'endTurn', player: 2 });
    expect(r.state.currentPlayer).toBe(1);
    expect(r.state.round).toBe(2);
    expect(r.state.timeline[r.state.timeline.length - 1].round).toBe(2);
  });
});

describe('turn limit', () => {
  const ending = (terr: Record<string, [number, number]>, fill = 0) =>
    scenario({ players: 2, fill, terr: terr as never, current: 1, config: { turnLimit: 1 } });

  it('ends after the limit round finishes: most territories wins', () => {
    const s = ending({ alaska: [1, 1], kamchatka: [1, 1] }, 0);
    const r = act(s, { type: 'endTurn', player: 1 });
    expect(types(r.events)).toEqual(['gameOver']);
    expect(r.state.phase).toEqual({ kind: 'game-over', winner: 0, reason: 'turnLimit' });
    expect(r.state.timeline[r.state.timeline.length - 1].territories).toEqual([40, 2]);
  });

  it('tiebreak: total armies, then lowest seat', () => {
    // 21 / 21 split by continent-agnostic halves
    const half = Object.fromEntries(
      Object.keys(scenario().territories)
        .slice(0, 21)
        .map((t) => [t, [1, 1]]),
    ) as Record<string, [number, number]>;
    const tied = ending(half);
    expect(turnLimitWinner(tied)).toBe(0);
    const more = ending({ ...half, alaska: [1, 5] });
    expect(turnLimitWinner(more)).toBe(1);
    expect(act(more, { type: 'endTurn', player: 1 }).state.phase).toMatchObject({ winner: 1, reason: 'turnLimit' });
  });

  it('does not end early; the card is drawn before the game ends', () => {
    const s = scenario({ players: 2, terr: { alaska: [1, 1] }, current: 1, config: { turnLimit: 2 } });
    const r = act(s, { type: 'endTurn', player: 1 });
    expect(r.state.phase.kind).toBe('reinforce');
    expect(r.state.round).toBe(2);
    const last = act({ ...s, round: 2, conqueredThisTurn: true }, { type: 'endTurn', player: 1 });
    expect(types(last.events)).toEqual(['cardDrawn', 'gameOver']);
  });
});
