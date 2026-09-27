import { describe, expect, it } from 'vitest';
import {
  applyAction,
  attackSources,
  attackTargets,
  CONTINENTS,
  legalActionsSummary,
  maxAttackDice,
  TERRITORY_IDS,
  type GameEvent,
  type TerritoryId,
} from '../../src/engine';
import { act, findOutcome, idsBySymbol, reject, scenario, types, withRng } from './helpers';

type Dice = Extract<GameEvent, { type: 'diceRolled' }>;
const dice = (evs: GameEvent[]) => evs.filter((e): e is Dice => e.type === 'diceRolled');
const conquered = (r: { events: GameEvent[] }) => r.events.some((e) => e.type === 'territoryConquered');

// 3 players: P0 everywhere, P1 argentina + brazil, P2 japan.
const base = (peru: number, argentina = 1, extra: Partial<Record<TerritoryId, [number, number]>> = {}) =>
  scenario({ players: 3, terr: { peru: [0, peru], argentina: [1, argentina], brazil: [1, 3], japan: [2, 2], ...extra } });

describe('attack validation and dice limits', () => {
  it('attacker rolls 1..min(3, armies − 1)', () => {
    const s = base(3);
    expect(maxAttackDice(s, 'peru')).toBe(2);
    expect(reject(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 })).toMatch(/at most 2 dice/);
    expect(reject(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 4 as never })).toMatch(/1, 2, or 3/);
    expect(reject(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 0 as never })).toMatch(/1, 2, or 3/);
    const r = act(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 2 });
    expect(dice(r.events)[0].attackDice).toHaveLength(2);
    expect(maxAttackDice(base(2), 'peru')).toBe(1);
    expect(maxAttackDice(base(9), 'peru')).toBe(3);
  });

  it('defender always rolls min(2, armies)', () => {
    const one = act(base(10, 1), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 });
    expect(dice(one.events)[0].defendDice).toHaveLength(1);
    const two = act(base(10, 5), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 });
    expect(dice(two.events)[0].defendDice).toHaveLength(2);
    const vsOneDie = act(base(10, 5), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 1 });
    const d = dice(vsOneDie.events)[0];
    expect(d.defendDice).toHaveLength(2);
    expect(d.attackerLosses + d.defenderLosses).toBe(1); // only min(a, d) pairs compare
  });

  it('rejects bad sources and targets with readable reasons', () => {
    const s = base(1);
    expect(reject(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 1 })).toMatch(/at least 2 armies/);
    expect(reject(s, { type: 'attack', player: 0, from: 'argentina', to: 'peru', dice: 1 })).toMatch(/isn't yours/);
    expect(reject(s, { type: 'attack', player: 0, from: 'venezuela', to: 'peru', dice: 1 })).toMatch(/already yours/);
    expect(reject(base(5), { type: 'attack', player: 0, from: 'peru', to: 'japan', dice: 1 })).toMatch(/doesn't border/);
    expect(reject(s, { type: 'attack', player: 0, from: 'nowhere' as never, to: 'peru', dice: 1 })).toMatch(/valid territory/);
  });

  it('sources and targets helpers', () => {
    const s = base(5);
    expect(attackTargets(s, 'peru')).toEqual(['brazil', 'argentina']);
    expect(attackTargets(s, 'venezuela')).toEqual([]); // 1 army
    expect(attackSources(s, 0)).toEqual(['peru']);
    expect(legalActionsSummary(s)).toMatchObject({ phase: 'attack', attackSources: ['peru'], canEndAttack: true, canEndTurn: true });
  });
});

describe('dice resolution', () => {
  it('dice sorted high → low, pairwise over min(a, d), ties to the defender (checked over many rolls)', () => {
    let ties = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = act(withRng(base(10, 6), seed), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 });
      const d = dice(r.events)[0];
      expect([...d.attackDice].sort((a, b) => b - a)).toEqual(d.attackDice);
      expect([...d.defendDice].sort((a, b) => b - a)).toEqual(d.defendDice);
      let al = 0;
      let dl = 0;
      for (let i = 0; i < 2; i++) {
        if (d.attackDice[i] > d.defendDice[i]) dl++;
        else al++;
        if (d.attackDice[i] === d.defendDice[i]) ties++;
      }
      expect([d.attackerLosses, d.defenderLosses]).toEqual([al, dl]);
      expect(r.state.territories.peru.armies).toBe(10 - al);
      expect(r.state.territories.argentina.armies).toBe(6 - dl);
      for (const x of [...d.attackDice, ...d.defendDice]) expect(x >= 1 && x <= 6).toBe(true);
    }
    expect(ties).toBeGreaterThan(20);
  });

  it('an exact tie on a single die goes to the defender', () => {
    const r = findOutcome(base(2, 3), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 1 }, (x) => {
      const d = dice(x.events)[0];
      return d.attackDice[0] === d.defendDice[0];
    });
    expect(dice(r.events)[0]).toMatchObject({ attackerLosses: 1, defenderLosses: 0 });
  });

  it('updates battle stats for both sides', () => {
    const r = findOutcome(base(10, 6), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, (x) => dice(x.events)[0].defenderLosses === 2);
    expect(r.state.players[0].stats).toMatchObject({ battlesWon: 1, battlesLost: 0, armiesDestroyed: 2, armiesLost: 0 });
    expect(r.state.players[1].stats).toMatchObject({ battlesWon: 0, battlesLost: 1, armiesDestroyed: 0, armiesLost: 2 });
  });
});

describe('blitz', () => {
  it('rolls max dice until the attacker is down to stopAt, never below it', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = act(withRng(base(10, 30), seed), { type: 'blitz', player: 0, from: 'peru', to: 'argentina', stopAt: 4 });
      expect(conquered(r)).toBe(false);
      expect(r.state.territories.peru.armies).toBe(4);
      let a = 10;
      for (const d of dice(r.events)) {
        expect(d.blitz).toBe(true);
        expect(d.attackDice).toHaveLength(Math.min(3, a - 4));
        a -= d.attackerLosses;
      }
    }
  });

  it('default stopAt is 1; conquest ends the blitz with occupy min = the final roll’s dice', () => {
    const r = findOutcome(base(12, 2), { type: 'blitz', player: 0, from: 'peru', to: 'argentina' }, conquered);
    const rolls = dice(r.events);
    const last = rolls[rolls.length - 1];
    expect(types(r.events).slice(-2)).toEqual(['territoryConquered', 'phaseChanged']);
    expect(r.state.phase).toMatchObject({ kind: 'occupy', from: 'peru', to: 'argentina', min: last.attackDice.length, max: r.state.territories.peru.armies - 1 });
    const lose = findOutcome(base(3, 8), { type: 'blitz', player: 0, from: 'peru', to: 'argentina' }, (x) => !conquered(x));
    expect(lose.state.territories.peru.armies).toBe(1);
    expect(lose.state.phase.kind).toBe('attack');
  });

  it('rejects a blitz with nothing to attack with', () => {
    expect(reject(base(4), { type: 'blitz', player: 0, from: 'peru', to: 'argentina', stopAt: 4 })).toMatch(/nothing to blitz/);
    expect(reject(base(4), { type: 'blitz', player: 0, from: 'peru', to: 'argentina', stopAt: 0 })).toMatch(/stop at 1/);
  });
});

describe('conquest and occupy', () => {
  it('flips ownership, enters occupy with min = dice, max = armies − 1; occupy moves and returns to attack', () => {
    const r = findOutcome(base(10), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(types(r.events)).toEqual(['diceRolled', 'territoryConquered', 'phaseChanged']);
    expect(r.events[1]).toEqual({ type: 'territoryConquered', player: 0, from: 'peru', to: 'argentina', previousOwner: 1 });
    expect(r.state.territories.argentina).toEqual({ owner: 0, armies: 0 });
    expect(r.state.phase).toMatchObject({ kind: 'occupy', from: 'peru', to: 'argentina', min: 3, max: 9 });
    expect(r.state.conqueredThisTurn).toBe(true);
    expect(r.state.players[0].stats.territoriesConquered).toBe(1);
    expect(legalActionsSummary(r.state).occupy).toEqual({ from: 'peru', to: 'argentina', min: 3, max: 9 });
    expect(reject(r.state, { type: 'occupy', player: 0, count: 2 })).toMatch(/between 3 and 9/);
    expect(reject(r.state, { type: 'occupy', player: 0, count: 10 })).toMatch(/between 3 and 9/);
    expect(reject(r.state, { type: 'endTurn', player: 0 })).toMatch(/Move armies into Argentina/);
    expect(reject(r.state, { type: 'attack', player: 0, from: 'peru', to: 'brazil', dice: 3 })).toMatch(/Move armies into Argentina/);
    const o = act(r.state, { type: 'occupy', player: 0, count: 5 });
    expect(o.events).toEqual([
      { type: 'armiesMoved', player: 0, from: 'peru', to: 'argentina', count: 5, reason: 'occupy' },
      { type: 'phaseChanged', player: 0, phase: 'attack' },
    ]);
    expect(o.state.territories.peru.armies).toBe(5);
    expect(o.state.territories.argentina.armies).toBe(5);
  });

  it('min is the number of dice in the final roll (1 die → min 1)', () => {
    const r = findOutcome(base(10), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 1 }, conquered);
    expect(r.state.phase).toMatchObject({ kind: 'occupy', min: 1, max: 9 });
  });

  it('auto-occupies when min === max (no occupy phase)', () => {
    const r = findOutcome(base(2), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 1 }, conquered);
    expect(types(r.events)).toEqual(['diceRolled', 'territoryConquered', 'armiesMoved']);
    expect(r.events[2]).toMatchObject({ reason: 'occupy', count: 1 });
    expect(r.state.phase).toEqual({ kind: 'attack' });
    const r3 = findOutcome(base(4), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(r3.events[2]).toMatchObject({ type: 'armiesMoved', count: 3 });
    expect(r3.state.territories.peru.armies).toBe(1);
    expect(r3.state.territories.argentina.armies).toBe(3);
  });

  it('continentLost when an owner is broken, continentGained on completion — after the move', () => {
    const sa = Object.fromEntries(CONTINENTS.south_america.territories.map((t) => [t, [1, 1]])) as Partial<Record<TerritoryId, [number, number]>>;
    const broken = scenario({ players: 3, terr: { ...sa, central_america: [0, 10], japan: [2, 1] } });
    const r = findOutcome(broken, { type: 'attack', player: 0, from: 'central_america', to: 'venezuela', dice: 3 }, conquered);
    const o = act(r.state, { type: 'occupy', player: 0, count: 3 });
    expect(types(o.events)).toEqual(['armiesMoved', 'continentLost', 'phaseChanged']);
    expect(o.events[1]).toEqual({ type: 'continentLost', player: 1, continent: 'south_america', to: 0 });

    const almost = scenario({ players: 3, terr: { peru: [0, 4], argentina: [1, 1], egypt: [1, 1], japan: [2, 1] } });
    const g = findOutcome(almost, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(types(g.events)).toEqual(['diceRolled', 'territoryConquered', 'armiesMoved', 'continentGained']);
    expect(g.events[3]).toEqual({ type: 'continentGained', player: 0, continent: 'south_america' });
  });
});

describe('elimination', () => {
  const elimBase = (p0Cards: number[], p1Cards: number[]) =>
    scenario({ players: 3, terr: { peru: [0, 10], argentina: [1, 1], japan: [2, 2] }, cards: { 0: p0Cards, 1: p1Cards } });

  it('playerEliminated then cardsCaptured, before the occupy phase', () => {
    const p1 = idsBySymbol('artillery', 2);
    const r = findOutcome(elimBase([], p1), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(types(r.events)).toEqual(['diceRolled', 'territoryConquered', 'playerEliminated', 'cardsCaptured', 'phaseChanged']);
    expect(r.events[2]).toEqual({ type: 'playerEliminated', player: 1, by: 0 });
    expect(r.events[3]).toMatchObject({ type: 'cardsCaptured', player: 0, from: 1 });
    expect(r.state.players[1]).toMatchObject({ eliminated: true, eliminatedBy: 0, eliminatedOnTurn: 1, cards: [] });
    expect(r.state.players[0].cards.map((c) => c.id)).toEqual(p1);
    // 2 cards → no forced trade after the move
    const o = act(r.state, { type: 'occupy', player: 0, count: 3 });
    expect(o.state.phase).toEqual({ kind: 'attack' });
  });

  it('no cardsCaptured event when the loser held no cards', () => {
    const r = findOutcome(elimBase([], []), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(types(r.events)).toEqual(['diceRolled', 'territoryConquered', 'playerEliminated', 'phaseChanged']);
  });

  it('6+ cards after a capture → forced mid-turn trade → back to attack', () => {
    const mine = [...idsBySymbol('infantry', 3), ...idsBySymbol('cavalry', 1)];
    const theirs = idsBySymbol('artillery', 2);
    const r = findOutcome(elimBase(mine, theirs), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(r.state.phase.kind).toBe('occupy');
    const o = act(r.state, { type: 'occupy', player: 0, count: 3 });
    expect(types(o.events)).toEqual(['armiesMoved', 'continentGained', 'phaseChanged']);
    expect(o.events[2]).toEqual({ type: 'phaseChanged', player: 0, phase: 'reinforce' });
    expect(o.state.phase).toEqual({ kind: 'reinforce', remaining: 0, mustTrade: true, placed: {}, midTurn: true });
    const sum = legalActionsSummary(o.state);
    expect(sum).toMatchObject({ mustTrade: true, midTurn: true, canEndReinforce: false });
    expect(reject(o.state, { type: 'endReinforce', player: 0 })).toMatch(/trade/);
    expect(reject(o.state, { type: 'attack', player: 0, from: 'argentina', to: 'brazil', dice: 1 })).toMatch(/Trade/);
    const t = act(o.state, { type: 'trade', player: 0, cardIds: idsBySymbol('infantry', 3) as [number, number, number] });
    expect(t.state.phase).toMatchObject({ kind: 'reinforce', remaining: 4, mustTrade: false, midTurn: true });
    expect(reject(t.state, { type: 'endReinforce', player: 0 })).toMatch(/remaining 4/);
    const p = act(t.state, { type: 'reinforce', player: 0, territory: 'argentina', count: 4 });
    const e = act(p.state, { type: 'endReinforce', player: 0 });
    expect(e.events).toEqual([{ type: 'phaseChanged', player: 0, phase: 'attack' }]);
    expect(e.state.phase).toEqual({ kind: 'attack' });
    expect(e.state.turn).toBe(1); // same turn
  });

  it('forced trade also follows an auto-occupy', () => {
    const mine = [...idsBySymbol('infantry', 3), ...idsBySymbol('cavalry', 1)];
    const s = scenario({ players: 3, terr: { peru: [0, 4], argentina: [1, 1], japan: [2, 2] }, cards: { 0: mine, 1: idsBySymbol('artillery', 2) } });
    const r = findOutcome(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(types(r.events)).toEqual(['diceRolled', 'territoryConquered', 'playerEliminated', 'cardsCaptured', 'armiesMoved', 'continentGained', 'phaseChanged']);
    expect(r.state.phase).toMatchObject({ kind: 'reinforce', midTurn: true, mustTrade: true });
  });

  it('capturing up to exactly 5 cards does not force a trade', () => {
    const s = elimBase(idsBySymbol('infantry', 3), idsBySymbol('artillery', 2));
    const r = findOutcome(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(act(r.state, { type: 'occupy', player: 0, count: 3 }).state.phase).toEqual({ kind: 'attack' });
  });

  it('eliminated players are skipped in turn order', () => {
    const r = findOutcome(elimBase([], []), { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    const o = act(r.state, { type: 'occupy', player: 0, count: 3 });
    const e = act(o.state, { type: 'endTurn', player: 0 });
    expect(e.state.currentPlayer).toBe(2);
    expect(e.events.find((x) => x.type === 'turnStarted')).toMatchObject({ player: 2 });
  });
});

describe('winning', () => {
  it('last conquest wins immediately: auto-occupy with max, continent events, then gameOver', () => {
    const s = scenario({ players: 2, terr: { peru: [0, 10], argentina: [1, 1] }, cards: { 1: [42] } });
    const r = findOutcome(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(types(r.events)).toEqual([
      'diceRolled',
      'territoryConquered',
      'playerEliminated',
      'cardsCaptured',
      'armiesMoved',
      'continentGained',
      'gameOver',
    ]);
    expect(r.events[4]).toMatchObject({ count: 9 });
    expect(r.events[6]).toEqual({ type: 'gameOver', winner: 0, reason: 'domination' });
    expect(r.state.phase).toEqual({ kind: 'game-over', winner: 0, reason: 'domination' });
    expect(r.state.timeline[r.state.timeline.length - 1].territories).toEqual([42, 0]);
    expect(legalActionsSummary(r.state).gameOver).toEqual({ winner: 0, reason: 'domination' });
    expect(reject(r.state, { type: 'endTurn', player: 0 })).toMatch(/over/);
    // controller changes still fine after the game
    expect(applyAction(r.state, { type: 'setController', player: 1, kind: 'ai' }).ok).toBe(true);
  });

  it('dominationPercent: reaching ceil(42 × pct / 100) territories wins with reason "percent"', () => {
    // P0 owns 29, needs 30 at 70%.
    const terr: Partial<Record<TerritoryId, [number, number]>> = { peru: [0, 10], argentina: [1, 1], japan: [2, 1] };
    // 12 territories for P1 (argentina + 11 in North America/Europe), 1 for P2 → P0 holds 29.
    for (const t of [...CONTINENTS.north_america.territories, 'iceland', 'scandinavia'] as TerritoryId[]) terr[t] = [1, 1];
    const s = scenario({ players: 3, terr, config: { dominationPercent: 70 } });
    expect(TERRITORY_IDS.filter((t) => s.territories[t].owner === 0)).toHaveLength(29);
    const r = findOutcome(s, { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: 3 }, conquered);
    expect(types(r.events).slice(-1)).toEqual(['gameOver']);
    expect(r.state.phase).toEqual({ kind: 'game-over', winner: 0, reason: 'percent' });
  });

  it('endAttack → fortify; endTurn is allowed from attack', () => {
    const s = base(5);
    expect(act(s, { type: 'endAttack', player: 0 }).events).toEqual([{ type: 'phaseChanged', player: 0, phase: 'fortify' }]);
    const e = act(s, { type: 'endTurn', player: 0 });
    expect(e.state.currentPlayer).toBe(1);
  });
});
