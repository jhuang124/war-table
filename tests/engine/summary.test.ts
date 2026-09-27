import { describe, expect, it } from 'vitest';
import { createGame, legalActionsSummary, TERRITORY_IDS } from '../../src/engine';
import { cardId, config, idsBySymbol, scenario } from './helpers';

describe('legalActionsSummary', () => {
  it('setup-claim lists unclaimed territories', () => {
    const { state } = createGame(config(3, { setupMode: 'draft', seed: 1 }));
    const s = legalActionsSummary(state);
    expect(s).toMatchObject({ phase: 'setup-claim', player: state.currentPlayer, isAi: false, toPlace: 0 });
    expect(s.claimable).toEqual(TERRITORY_IDS);
  });

  it('setup-place lists own territories and the batch', () => {
    const { state } = createGame(config(2, { initialPlacement: 'manual', seed: 2 }));
    const s = legalActionsSummary(state);
    expect(s.phase).toBe('setup-place');
    expect(s.toPlace).toBe(5);
    expect(s.placeable).toHaveLength(21);
    expect(s.placeable.every((t) => state.territories[t].owner === state.currentPlayer)).toBe(true);
  });

  it('reinforce lists trade sets best-first with values and bonus territories', () => {
    const inf = idsBySymbol('infantry', 3);
    const art = idsBySymbol('artillery', 3);
    const st = scenario({
      phase: { kind: 'reinforce', remaining: 4, mustTrade: false, placed: {}, midTurn: false },
      cards: { 0: [...inf, ...art] },
      config: { cardBonus: 'fixed' },
      terr: Object.fromEntries([...inf, ...art].map((id) => [TERRITORY_IDS[id], [1, 1]])) as never,
    });
    const s = legalActionsSummary(st);
    expect(s.mustTrade).toBe(false);
    expect(s.hasSetInHand).toBe(true);
    expect(s.tradeSets[0]).toEqual({ cardIds: art, value: 8, bonusTerritory: null });
    // no cavalry and no wild → only the two three-alike sets exist
    expect(s.tradeSets).toEqual([
      { cardIds: art, value: 8, bonusTerritory: null },
      { cardIds: inf, value: 4, bonusTerritory: null },
    ]);
  });

  it('bonus territory is reported when a card shows an owned territory', () => {
    const ids = [cardId('alaska'), cardId('northwest_territory'), cardId('greenland')];
    const st = scenario({ phase: { kind: 'reinforce', remaining: 4, mustTrade: false, placed: {}, midTurn: false }, cards: { 0: ids }, terr: { brazil: [1, 1] } });
    expect(legalActionsSummary(st).tradeSets).toEqual([{ cardIds: ids, value: 4, bonusTerritory: 'alaska' }]);
  });

  it('marks AI seats', () => {
    const st = scenario();
    st.players[0] = { ...st.players[0], kind: 'ai', difficulty: 'hard' };
    expect(legalActionsSummary(st).isAi).toBe(true);
  });

  it('is cheap (< 0.2 ms per call on average)', () => {
    const { state } = createGame(config(4, { seed: 9 }));
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) legalActionsSummary(state);
    expect((performance.now() - t0) / 2000).toBeLessThan(0.2);
  });
});
