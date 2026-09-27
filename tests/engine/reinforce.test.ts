import { describe, expect, it } from 'vitest';
import { CONTINENTS, legalActionsSummary, reinforcementsFor, TERRITORY_IDS, type TerritoryId } from '../../src/engine';
import { act, reject, scenario, types } from './helpers';

const reinforce = (remaining: number) => ({ kind: 'reinforce', remaining, mustTrade: false, placed: {}, midTurn: false }) as const;

describe('reinforcement math', () => {
  it('base is max(3, floor(territories / 3))', () => {
    // P0 owns 5 → 3 (minimum); P1 owns the other 37 → 12 (+ continents)
    const mine: TerritoryId[] = ['alaska', 'greenland', 'iceland', 'egypt', 'japan'];
    const terr = Object.fromEntries(mine.map((t) => [t, [0, 1]])) as never;
    const s = scenario({ fill: 1, terr });
    expect(reinforcementsFor(s, 0)).toEqual({ territoryCount: 5, base: 3, continents: [], total: 3 });
    const r1 = reinforcementsFor(s, 1);
    expect(r1.territoryCount).toBe(37);
    expect(r1.base).toBe(12);
  });

  it('adds every continent bonus: NA 5, SA 2, EU 5, AF 3, AS 7, AU 2', () => {
    const expected = { north_america: 5, south_america: 2, europe: 5, africa: 3, asia: 7, australia: 2 };
    for (const [c, bonus] of Object.entries(expected)) {
      const terr = Object.fromEntries(CONTINENTS[c as keyof typeof expected].territories.map((t) => [t, [0, 1]])) as never;
      const s = scenario({ fill: 1, terr });
      const r = reinforcementsFor(s, 0);
      expect(r.continents).toEqual([{ continent: c, bonus }]);
      const size = CONTINENTS[c as keyof typeof expected].territories.length;
      expect(r.total).toBe(Math.max(3, Math.floor(size / 3)) + bonus);
    }
    const all = scenario({ fill: 0, terr: { alaska: [1, 1] } }); // P0 owns 41, all but NA
    const r = reinforcementsFor(all, 0);
    expect(r.base).toBe(13);
    expect(r.continents.map((x) => x.continent)).toEqual(['south_america', 'europe', 'africa', 'asia', 'australia']);
    expect(r.total).toBe(13 + 2 + 5 + 3 + 7 + 2);
  });

  it('turnStarted carries the breakdown and remaining matches it', () => {
    const terr = Object.fromEntries(CONTINENTS.australia.territories.map((t) => [t, [1, 1]])) as never;
    const s = scenario({ phase: { kind: 'fortify' }, terr });
    const r = act(s, { type: 'endTurn', player: 0 });
    expect(types(r.events)).toEqual(['turnStarted', 'phaseChanged']);
    const e = r.events[0];
    if (e.type !== 'turnStarted') throw new Error();
    expect(e.player).toBe(1);
    expect(e.reinforcements).toEqual({ territoryCount: 4, base: 3, continents: [{ continent: 'australia', bonus: 2 }], total: 5 });
    expect(r.state.phase).toEqual({ kind: 'reinforce', remaining: 5, mustTrade: false, placed: {}, midTurn: false });
    expect(r.state.players[1].stats.reinforcementsReceived).toBe(5);
  });
});

describe('placing and taking back', () => {
  it('reinforce places 1..remaining on an owned territory and tracks placed', () => {
    const s = scenario({ phase: reinforce(7), terr: { alaska: [1, 1] } });
    let r = act(s, { type: 'reinforce', player: 0, territory: 'brazil', count: 3 });
    expect(r.events).toEqual([{ type: 'armiesPlaced', player: 0, territory: 'brazil', count: 3, source: 'reinforce' }]);
    expect(r.state.territories.brazil.armies).toBe(4);
    expect(r.state.phase).toMatchObject({ remaining: 4, placed: { brazil: 3 } });
    r = act(r.state, { type: 'reinforce', player: 0, territory: 'brazil', count: 4 });
    expect(r.state.phase).toMatchObject({ remaining: 0, placed: { brazil: 7 } });
    expect(r.state.phase.kind).toBe('reinforce'); // never auto-advances
    expect(reject(r.state, { type: 'reinforce', player: 0, territory: 'brazil', count: 1 })).toMatch(/No armies left/);
  });

  it('rejects enemy territory, 0, fractions, and more than remaining', () => {
    const s = scenario({ phase: reinforce(3), terr: { alaska: [1, 1] } });
    expect(reject(s, { type: 'reinforce', player: 0, territory: 'alaska', count: 1 })).toMatch(/isn't yours/);
    expect(reject(s, { type: 'reinforce', player: 0, territory: 'brazil', count: 0 })).toMatch(/at least 1/);
    expect(reject(s, { type: 'reinforce', player: 0, territory: 'brazil', count: 1.5 })).toMatch(/at least 1/);
    expect(reject(s, { type: 'reinforce', player: 0, territory: 'brazil', count: 4 })).toMatch(/Only 3/);
  });

  it('unreinforce takes back only what was placed this phase', () => {
    const s = scenario({ phase: reinforce(5), terr: { alaska: [1, 1], brazil: [0, 6] } });
    let r = act(s, { type: 'reinforce', player: 0, territory: 'brazil', count: 2 });
    r = act(r.state, { type: 'unreinforce', player: 0, territory: 'brazil', count: 1 });
    expect(r.events).toEqual([{ type: 'armiesPlaced', player: 0, territory: 'brazil', count: -1, source: 'undo' }]);
    expect(r.state.territories.brazil.armies).toBe(7);
    expect(r.state.phase).toMatchObject({ remaining: 4, placed: { brazil: 1 } });
    expect(reject(r.state, { type: 'unreinforce', player: 0, territory: 'brazil', count: 2 })).toMatch(/only 1 army/);
    expect(reject(r.state, { type: 'unreinforce', player: 0, territory: 'peru', count: 1 })).toMatch(/haven't placed/);
    r = act(r.state, { type: 'unreinforce', player: 0, territory: 'brazil', count: 1 });
    expect(r.state.phase).toMatchObject({ remaining: 5, placed: {} });
    expect(r.state.territories.brazil.armies).toBe(6); // never below what was there before the phase
  });

  it('endReinforce requires 0 remaining and no forced trade, then goes to attack', () => {
    const s = scenario({ phase: reinforce(2), terr: { alaska: [1, 1] } });
    expect(reject(s, { type: 'endReinforce', player: 0 })).toMatch(/remaining 2 armies/);
    const r = act(act(s, { type: 'reinforce', player: 0, territory: 'brazil', count: 2 }).state, { type: 'endReinforce', player: 0 });
    expect(r.events).toEqual([{ type: 'phaseChanged', player: 0, phase: 'attack' }]);
    expect(r.state.phase).toEqual({ kind: 'attack' });
    const forced = scenario({ phase: { kind: 'reinforce', remaining: 0, mustTrade: true, placed: {}, midTurn: false }, terr: { alaska: [1, 1] } });
    expect(reject(forced, { type: 'endReinforce', player: 0 })).toMatch(/trade/);
  });

  it('summary reflects placeable / unplaceable / toPlace', () => {
    const s = scenario({ phase: reinforce(4), terr: { alaska: [1, 1] } });
    const r = act(s, { type: 'reinforce', player: 0, territory: 'brazil', count: 1 });
    const sum = legalActionsSummary(r.state);
    expect(sum.phase).toBe('reinforce');
    expect(sum.toPlace).toBe(3);
    expect(sum.placeable).toHaveLength(41);
    expect(sum.placeable).not.toContain('alaska');
    expect(sum.unplaceable).toEqual(['brazil']);
    expect(sum.canEndReinforce).toBe(false);
    expect(TERRITORY_IDS.filter((t) => sum.placeable.includes(t))).toEqual(sum.placeable); // canonical order
  });
});
