import { describe, expect, it } from 'vitest';
import {
  ADJACENCY,
  createGame,
  defaultConfig,
  sanitizeConfig,
  STARTING_ARMIES,
  TERRITORY_IDS,
  UNCLAIMED,
  validateConfig,
  type GameState,
} from '../../src/engine';
import { act, config, reject, seats, types } from './helpers';

const counts = (s: GameState) => s.players.map((p) => TERRITORY_IDS.filter((t) => s.territories[t].owner === p.id).length);
const armyTotals = (s: GameState) =>
  s.players.map((p) => TERRITORY_IDS.filter((t) => s.territories[t].owner === p.id).reduce((a, t) => a + s.territories[t].armies, 0));

describe('createGame: random deal', () => {
  it('deals 11/11/10/10 for 4 players, starting at the first player', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const { state } = createGame(config(4, { seed, initialPlacement: 'manual' }));
      const c = counts(state);
      const f = state.firstPlayer;
      expect(c[f]).toBe(11);
      expect(c[(f + 1) % 4]).toBe(11);
      expect(c[(f + 2) % 4]).toBe(10);
      expect(c[(f + 3) % 4]).toBe(10);
      expect(TERRITORY_IDS.every((t) => state.territories[t].armies === 1)).toBe(true);
    }
  });

  it('deals 21/21 for 2 players and 14/14/14 for 3', () => {
    expect(counts(createGame(config(2, { initialPlacement: 'manual' })).state)).toEqual([21, 21]);
    expect(counts(createGame(config(3, { initialPlacement: 'manual' })).state)).toEqual([14, 14, 14]);
  });

  it('picks the first player with the seeded rng (varies by seed, fixed per seed)', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) firsts.add(createGame(config(4, { seed })).state.firstPlayer);
    expect(firsts.size).toBe(4);
    expect(createGame(config(4, { seed: 7 })).state.firstPlayer).toBe(createGame(config(4, { seed: 7 })).state.firstPlayer);
  });

  it('emits gameStarted → territoriesDealt → auto placements → turnStarted → phaseChanged', () => {
    const { state, events } = createGame(config(3));
    const t = types(events);
    expect(t[0]).toBe('gameStarted');
    expect(t[1]).toBe('territoriesDealt');
    const lastPlace = t.lastIndexOf('armiesPlaced');
    expect(t.slice(2, lastPlace + 1).every((x) => x === 'armiesPlaced')).toBe(true);
    expect(t.slice(lastPlace + 1)).toEqual(['turnStarted', 'phaseChanged']);
    expect(events[0]).toEqual({ type: 'gameStarted', firstPlayer: state.firstPlayer });
    const dealt = events[1] as Extract<(typeof events)[number], { type: 'territoriesDealt' }>;
    expect(Object.keys(dealt.owners)).toHaveLength(42);
    for (const e of events) if (e.type === 'armiesPlaced') expect(e.source).toBe('setup');
  });

  it('auto placement uses exactly the starting armies, ≥ 1 everywhere, then turn 1 for the first player', () => {
    for (const n of [2, 3, 4]) {
      for (const seed of [5, 6, 7]) {
        const { state } = createGame(config(n, { seed }));
        expect(armyTotals(state)).toEqual(new Array(n).fill(STARTING_ARMIES[n]));
        expect(TERRITORY_IDS.every((t) => state.territories[t].armies >= 1)).toBe(true);
        expect(state.players.every((p) => p.setupArmies === 0)).toBe(true);
        expect(state.phase.kind).toBe('reinforce');
        expect(state.currentPlayer).toBe(state.firstPlayer);
        expect(state.round).toBe(1);
        expect(state.turn).toBe(1);
        expect(state.timeline).toHaveLength(1);
        expect(state.timeline[0].round).toBe(1);
      }
    }
  });

  it('auto placement favors border territories', () => {
    let border = 0;
    let interior = 0;
    let bN = 0;
    let iN = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state } = createGame(config(3, { seed }));
      for (const t of TERRITORY_IDS) {
        const o = state.territories[t].owner;
        const isB = ADJACENCY[t].some((x) => state.territories[x].owner !== o);
        if (isB) {
          border += state.territories[t].armies - 1;
          bN++;
        } else {
          interior += state.territories[t].armies - 1;
          iN++;
        }
      }
    }
    expect(border / bN).toBeGreaterThan((interior / Math.max(1, iN)) * 2);
  });

  it('deck is 44 cards (42 territories + 2 wilds), shuffled', () => {
    const { state } = createGame(config(2));
    expect(state.deck).toHaveLength(44);
    expect(new Set(state.deck.map((c) => c.id)).size).toBe(44);
    expect(state.deck.filter((c) => c.symbol === 'wild')).toHaveLength(2);
    for (const sym of ['infantry', 'cavalry', 'artillery'] as const) expect(state.deck.filter((c) => c.symbol === sym)).toHaveLength(14);
    expect(state.deck.map((c) => c.id)).not.toEqual([...Array(44).keys()]);
    expect(state.id).toMatch(/^g_[0-9a-z]{6}$/);
  });

  it('honors a startingArmies override', () => {
    const { state } = createGame(config(2, { startingArmies: 25 }));
    expect(armyTotals(state)).toEqual([25, 25]);
  });
});

describe('manual placement (setup-place)', () => {
  it('batches of setupBatch per turn, rotating, last batch partial, then turn 1 for the first player', () => {
    // 4p: 30 armies; dealt 11/11/10/10 → 19/19/20/20 left → batches 5,5,5,4 / 5,5,5,5.
    let { state, events } = createGame(config(4, { initialPlacement: 'manual', seed: 3 }));
    const f = state.firstPlayer;
    expect(types(events).slice(-2)).toEqual(['phaseChanged', 'setupTurn']);
    expect(state.phase).toEqual({ kind: 'setup-place', toPlace: 5 });
    expect(state.currentPlayer).toBe(f);
    expect(state.round).toBe(0);
    const seen: [number, number][] = [];
    let guard = 0;
    while (state.phase.kind === 'setup-place' && guard++ < 100) {
      const p = state.currentPlayer;
      const toPlace = state.phase.toPlace;
      seen.push([p, toPlace]);
      const mine = TERRITORY_IDS.filter((t) => state.territories[t].owner === p);
      // split the batch: 1 on one territory, the rest on another
      let r = act(state, { type: 'placeSetup', player: p, territory: mine[0], count: 1 });
      expect(r.state.phase).toEqual({ kind: 'setup-place', toPlace: toPlace - 1 });
      expect(r.state.currentPlayer).toBe(p);
      if (toPlace > 1) r = act(r.state, { type: 'placeSetup', player: p, territory: mine[1], count: toPlace - 1 });
      state = r.state;
      events = r.events;
    }
    const byPlayer = [0, 1, 2, 3].map((p) => seen.filter(([q]) => q === p).map(([, n]) => n));
    expect(byPlayer[f]).toEqual([5, 5, 5, 4]);
    expect(byPlayer[(f + 1) % 4]).toEqual([5, 5, 5, 4]);
    expect(byPlayer[(f + 2) % 4]).toEqual([5, 5, 5, 5]);
    expect(byPlayer[(f + 3) % 4]).toEqual([5, 5, 5, 5]);
    // rotation order: f, f+1, f+2, f+3, f, ...
    expect(seen.slice(0, 4).map(([p]) => p)).toEqual([f, (f + 1) % 4, (f + 2) % 4, (f + 3) % 4]);
    // the last two setup turns belong to the 20-army players only
    expect(seen.slice(-2).map(([p]) => p)).toEqual([(f + 2) % 4, (f + 3) % 4]);
    expect(state.phase.kind).toBe('reinforce');
    expect(state.currentPlayer).toBe(f);
    expect(types(events).slice(-2)).toEqual(['turnStarted', 'phaseChanged']);
    expect(armyTotals(state)).toEqual([30, 30, 30, 30]);
  });

  it('rejects placing on others, too many, zero, or out of turn', () => {
    const { state } = createGame(config(2, { initialPlacement: 'manual', seed: 4 }));
    const p = state.currentPlayer;
    const theirs = TERRITORY_IDS.find((t) => state.territories[t].owner !== p)!;
    const mine = TERRITORY_IDS.find((t) => state.territories[t].owner === p)!;
    expect(reject(state, { type: 'placeSetup', player: p, territory: theirs, count: 1 })).toMatch(/isn't yours/);
    expect(reject(state, { type: 'placeSetup', player: p, territory: mine, count: 6 })).toMatch(/only 5/);
    expect(reject(state, { type: 'placeSetup', player: p, territory: mine, count: 0 })).toMatch(/at least 1/);
    expect(reject(state, { type: 'placeSetup', player: 1 - p, territory: theirs, count: 1 })).toMatch(/turn/);
    expect(reject(state, { type: 'reinforce', player: p, territory: mine, count: 1 })).toMatch(/starting arm/);
  });

  it('setupTurn is emitted at the start of each setup-place turn', () => {
    const { state } = createGame(config(2, { initialPlacement: 'manual', seed: 8, setupBatch: 3 }));
    const p = state.currentPlayer;
    const mine = TERRITORY_IDS.find((t) => state.territories[t].owner === p)!;
    const r = act(state, { type: 'placeSetup', player: p, territory: mine, count: 3 });
    expect(r.events.map((e) => e.type)).toEqual(['armiesPlaced', 'setupTurn']);
    expect(r.events[1]).toEqual({ type: 'setupTurn', player: 1 - p, toPlace: 3 });
  });
});

describe('draft (setup-claim)', () => {
  it('players claim in turn from the first player until all 42 are taken; then manual placement starts', () => {
    let { state, events } = createGame(config(3, { setupMode: 'draft', initialPlacement: 'manual', seed: 11 }));
    expect(types(events)).toEqual(['gameStarted', 'phaseChanged']);
    expect(state.phase.kind).toBe('setup-claim');
    expect(TERRITORY_IDS.every((t) => state.territories[t].owner === UNCLAIMED)).toBe(true);
    const f = state.firstPlayer;
    for (let i = 0; i < 42; i++) {
      const p = state.currentPlayer;
      expect(p).toBe((f + i) % 3);
      const t = TERRITORY_IDS[i];
      const r = act(state, { type: 'claim', player: p, territory: t });
      expect(r.events[0]).toEqual({ type: 'territoryClaimed', player: p, territory: t });
      expect(r.state.territories[t]).toEqual({ owner: p, armies: 1 });
      if (i < 41) {
        expect(reject(r.state, { type: 'claim', player: r.state.currentPlayer, territory: t })).toMatch(/already claimed/);
      }
      state = r.state;
      events = r.events;
    }
    expect(types(events)).toEqual(['territoryClaimed', 'phaseChanged', 'setupTurn']);
    expect(state.phase).toEqual({ kind: 'setup-place', toPlace: 5 });
    expect(state.currentPlayer).toBe(f);
    expect(state.players.map((p) => p.setupArmies)).toEqual([21, 21, 21]);
  });

  it('draft + auto placement goes straight to turn 1 after the last claim', () => {
    let { state } = createGame(config(2, { setupMode: 'draft', initialPlacement: 'auto', seed: 12 }));
    let last: string[] = [];
    for (const t of TERRITORY_IDS) {
      const r = act(state, { type: 'claim', player: state.currentPlayer, territory: t });
      state = r.state;
      last = types(r.events);
    }
    expect(last[0]).toBe('territoryClaimed');
    expect(last.slice(-2)).toEqual(['turnStarted', 'phaseChanged']);
    expect(last.filter((x) => x === 'armiesPlaced').length).toBeGreaterThan(0);
    expect(armyTotals(state)).toEqual([40, 40]);
    expect(state.phase.kind).toBe('reinforce');
  });

  it('rejects non-claim actions during the draft', () => {
    const { state } = createGame(config(2, { setupMode: 'draft', seed: 13 }));
    const p = state.currentPlayer;
    expect(reject(state, { type: 'endTurn', player: p })).toMatch(/Claim/);
    expect(reject(state, { type: 'claim', player: p, territory: 'atlantis' as never })).toMatch(/valid territory/);
  });
});

describe('config', () => {
  it('defaultConfig gives sensible classic defaults with a random seed', () => {
    const c = defaultConfig(seats(3));
    expect(c).toMatchObject({
      setupMode: 'random',
      initialPlacement: 'auto',
      setupBatch: 5,
      cardBonus: 'progressive',
      fortifyRule: 'connected',
      dominationPercent: 100,
      turnLimit: null,
    });
    expect(Number.isInteger(c.seed)).toBe(true);
    expect(() => createGame(c)).not.toThrow();
  });

  it('validateConfig explains bad seat setups; createGame throws with the same message', () => {
    expect(validateConfig(config(2))).toBeNull();
    expect(validateConfig({ ...config(2), players: seats(1) })).toMatch(/2 to 4/);
    expect(validateConfig({ ...config(2), players: [...seats(4), ...seats(1)] })).toMatch(/2 to 4/);
    const dup = seats(2);
    dup[1] = { ...dup[1], color: dup[0].color };
    expect(validateConfig({ ...config(2), players: dup })).toMatch(/different color/);
    expect(() => createGame({ ...config(2), players: dup })).toThrow(/different color/);
  });

  it('sanitizeConfig clamps nonsense', () => {
    const c = sanitizeConfig({ ...config(2), setupBatch: 0, dominationPercent: 500, turnLimit: -3, seed: -7.5, startingArmies: 3 });
    expect(c.setupBatch).toBe(1);
    expect(c.dominationPercent).toBe(100);
    expect(c.turnLimit).toBe(1);
    expect(Number.isInteger(c.seed) && c.seed >= 0 && c.seed <= 0xffffffff).toBe(true);
    expect(c.startingArmies).toBe(21);
    const ai = sanitizeConfig({ ...config(2), players: [{ name: '  ', color: 'crimson', kind: 'ai' }, seats(2)[1]] });
    expect(ai.players[0]).toMatchObject({ name: 'Player 1', difficulty: 'normal' });
  });
});
