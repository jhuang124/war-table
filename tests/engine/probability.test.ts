import { describe, expect, it } from 'vitest';
import { blitzOdds, expectedRollLosses, rollOutcomes, upcomingSetValues, winProbability, winProbabilityStopAt } from '../../src/engine';
import { findOutcome, scenario, withRng, act } from './helpers';

const dist = (k: number, m: number) => Object.fromEntries(rollOutcomes(k, m).map((o) => [o.attLoss, o.p]));

describe('single-roll odds', () => {
  it('match the published Risk tables', () => {
    expect(dist(1, 1)[0]).toBeCloseTo(15 / 36, 12);
    expect(dist(2, 1)[0]).toBeCloseTo(125 / 216, 12);
    expect(dist(3, 1)[0]).toBeCloseTo(855 / 1296, 12);
    expect(dist(1, 2)[0]).toBeCloseTo(55 / 216, 12);
    expect(dist(2, 2)[0]).toBeCloseTo(295 / 1296, 12);
    expect(dist(2, 2)[1]).toBeCloseTo(420 / 1296, 12);
    expect(dist(2, 2)[2]).toBeCloseTo(581 / 1296, 12);
    expect(dist(3, 2)[0]).toBeCloseTo(2890 / 7776, 12);
    expect(dist(3, 2)[1]).toBeCloseTo(2611 / 7776, 12);
    expect(dist(3, 2)[2]).toBeCloseTo(2275 / 7776, 12);
  });
});

describe('winProbability (blitz to 1)', () => {
  it('exact small cases', () => {
    expect(winProbability(1, 1)).toBe(0);
    expect(winProbability(5, 0)).toBe(1);
    expect(winProbability(2, 1)).toBeCloseTo(15 / 36, 12);
    expect(winProbability(3, 1)).toBeCloseTo(125 / 216 + (91 / 216) * (15 / 36), 12);
  });

  it('is correct on the very first call (tables built lazily) and across table growth', () => {
    expect(winProbability(300, 280)).toBeGreaterThan(0.5);
    expect(winProbability(300, 280)).toBeLessThan(1);
    expect(Number.isFinite(winProbability(900, 900))).toBe(true);
  });

  it('monotone: more attackers help, more defenders hurt', () => {
    for (let d = 1; d <= 15; d++)
      for (let a = 2; a <= 25; a++) {
        expect(winProbability(a + 1, d)).toBeGreaterThanOrEqual(winProbability(a, d) - 1e-12);
        expect(winProbability(a, d + 1)).toBeLessThanOrEqual(winProbability(a, d) + 1e-12);
      }
  });

  it('agrees with the engine’s own blitz (Monte Carlo, 2000 games)', () => {
    const s = scenario({ players: 2, terr: { peru: [0, 8], argentina: [1, 5], alaska: [1, 1] } });
    let wins = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const r = act(withRng(s, seed * 7919), { type: 'blitz', player: 0, from: 'peru', to: 'argentina' });
      if (r.events.some((e) => e.type === 'territoryConquered')) wins++;
    }
    expect(Math.abs(wins / N - winProbability(8, 5))).toBeLessThan(0.035);
  });

  it('stopAt variant matches the engine’s capped dice', () => {
    expect(winProbabilityStopAt(10, 4, 3)).toBeCloseTo(winProbability(8, 4), 12);
    const s = scenario({ players: 2, terr: { peru: [0, 10], argentina: [1, 4], alaska: [1, 1] } });
    let wins = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const r = act(withRng(s, seed * 104729), { type: 'blitz', player: 0, from: 'peru', to: 'argentina', stopAt: 3 });
      if (r.events.some((e) => e.type === 'territoryConquered')) wins++;
    }
    expect(Math.abs(wins / 1500 - winProbabilityStopAt(10, 4, 3))).toBeLessThan(0.04);
    // sanity: the helper exists for UI use with findOutcome elsewhere
    expect(typeof findOutcome).toBe('function');
  });
});

describe('blitzOdds', () => {
  it('expectations are consistent', () => {
    for (const [a, d] of [
      [5, 3],
      [12, 10],
      [3, 1],
      [40, 25],
    ]) {
      const o = blitzOdds(a, d);
      expect(o.win).toBeCloseTo(winProbability(a, d), 12);
      expect(o.expectedAttackerLosses + o.expectedAttackersLeft).toBeCloseTo(a, 9);
      expect(o.expectedDefenderLosses + o.expectedDefendersLeft).toBeCloseTo(d, 9);
      expect(o.expectedAttackersLeft).toBeGreaterThanOrEqual(1);
      expect(o.expectedAttackersLeftIfWin).toBeGreaterThanOrEqual(2);
      expect(o.expectedAttackersLeftIfWin).toBeLessThanOrEqual(a);
    }
    expect(blitzOdds(1, 3)).toMatchObject({ win: 0, expectedAttackersLeft: 1, expectedDefendersLeft: 3 });
    expect(blitzOdds(4, 0)).toMatchObject({ win: 1, expectedAttackersLeftIfWin: 4 });
  });
});

describe('expectedRollLosses', () => {
  it('matches the UX award table (expected defender losses per roll)', () => {
    const table: [number, number, number][] = [
      [3, 2, 1.079],
      [3, 1, 0.66],
      [2, 2, 0.779],
      [2, 1, 0.579],
      [1, 2, 0.255],
      [1, 1, 0.417],
    ];
    for (const [a, d, exp] of table) {
      const e = expectedRollLosses(a, d);
      expect(e.defender).toBeCloseTo(exp, 3);
      expect(e.attacker + e.defender).toBeCloseTo(Math.min(a, d), 12);
    }
  });

  it('upcomingSetValues: progressive next two, fixed none', () => {
    const s = scenario();
    expect(upcomingSetValues({ ...s, tradeCount: 2 })).toEqual([8, 10]);
    expect(upcomingSetValues({ ...s, tradeCount: 5 }, 3)).toEqual([15, 20, 25]);
    expect(upcomingSetValues({ ...s, config: { ...s.config, cardBonus: 'fixed' } })).toEqual([]);
  });
});
