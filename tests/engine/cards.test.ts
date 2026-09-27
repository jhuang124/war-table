import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  fixedSetValue,
  isValidSetSymbols,
  legalActionsSummary,
  progressiveValue,
  setValue,
  TERRITORY_IDS,
  validSets,
  type Card,
  type CardSymbol,
} from '../../src/engine';
import { act, cardId, idsBySymbol, reject, scenario, types } from './helpers';

const reinforce = (remaining = 0, mustTrade = false) =>
  ({ kind: 'reinforce', remaining, mustTrade, placed: {}, midTurn: false }) as const;

describe('set validation', () => {
  it('three alike, one of each, or any two + a wild', () => {
    const ok: CardSymbol[][] = [
      ['infantry', 'infantry', 'infantry'],
      ['cavalry', 'cavalry', 'cavalry'],
      ['artillery', 'artillery', 'artillery'],
      ['infantry', 'cavalry', 'artillery'],
      ['infantry', 'infantry', 'wild'],
      ['infantry', 'cavalry', 'wild'],
      ['wild', 'wild', 'artillery'],
    ];
    const bad: CardSymbol[][] = [
      ['infantry', 'infantry', 'cavalry'],
      ['artillery', 'artillery', 'cavalry'],
      ['infantry', 'cavalry'],
    ];
    for (const s of ok) expect(isValidSetSymbols(s)).toBe(true);
    for (const s of bad) expect(isValidSetSymbols(s)).toBe(false);
  });

  it('validSets lists every valid triple; any 5 cards contain a set', () => {
    const deck = buildDeck();
    const hand = [deck[0], deck[3], deck[1], deck[2]]; // inf, inf, cav, art
    const sets = validSets(hand);
    expect(sets).toEqual(expect.arrayContaining([[0, 1, 2], [1, 2, 3]]));
    expect(sets).toHaveLength(2);
    // pigeonhole: every 5-card hand from the real deck has at least one set
    for (let i = 0; i < 200; i++) {
      const h: Card[] = [];
      for (let k = 0; k < 5; k++) h.push(deck[(i * 7 + k * 11 + k * k * 3) % 44]);
      if (new Set(h.map((c) => c.id)).size === 5) expect(validSets(h).length).toBeGreaterThan(0);
    }
  });
});

describe('set values', () => {
  it('progressive: 4, 6, 8, 10, 12, 15, 20, 25, 30', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(progressiveValue)).toEqual([4, 6, 8, 10, 12, 15, 20, 25, 30]);
  });

  it('progressive values are a global count, applied through real trades', () => {
    // 24 cards = 8 three-alike sets; trade them one after another.
    const inf = idsBySymbol('infantry', 12);
    const cav = idsBySymbol('cavalry', 12);
    const ids = [...inf, ...cav];
    let s = scenario({ phase: reinforce(0, true), cards: { 0: ids }, terr: { alaska: [1, 1] } });
    const got: number[] = [];
    for (let k = 0; k < 8; k++) {
      const set = ids.slice(k * 3, k * 3 + 3) as [number, number, number];
      expect(setValue(s, set)).toBe(progressiveValue(k + 1));
      const r = act(s, { type: 'trade', player: 0, cardIds: set });
      const e = r.events[0];
      if (e.type !== 'cardsTraded') throw new Error('expected cardsTraded');
      got.push(e.armies);
      expect(e.tradeIndex).toBe(k + 1);
      s = r.state;
    }
    expect(got).toEqual([4, 6, 8, 10, 12, 15, 20, 25]);
    expect(s.tradeCount).toBe(8);
    expect(s.players[0].stats.cardsTraded).toBe(8);
  });

  it('fixed: infantry 4, cavalry 6, artillery 8, mixed 10; a wild takes the best value', () => {
    expect(fixedSetValue(['infantry', 'infantry', 'infantry'])).toBe(4);
    expect(fixedSetValue(['cavalry', 'cavalry', 'cavalry'])).toBe(6);
    expect(fixedSetValue(['artillery', 'artillery', 'artillery'])).toBe(8);
    expect(fixedSetValue(['infantry', 'cavalry', 'artillery'])).toBe(10);
    expect(fixedSetValue(['infantry', 'infantry', 'wild'])).toBe(4);
    expect(fixedSetValue(['cavalry', 'cavalry', 'wild'])).toBe(6);
    expect(fixedSetValue(['artillery', 'artillery', 'wild'])).toBe(8);
    expect(fixedSetValue(['infantry', 'artillery', 'wild'])).toBe(10); // wild → cavalry makes a mixed set
    expect(fixedSetValue(['wild', 'wild', 'infantry'])).toBe(10);
    expect(fixedSetValue(['infantry', 'infantry', 'cavalry'])).toBe(0);
  });

  it('fixed values through a real trade ignore the trade count', () => {
    const art = idsBySymbol('artillery', 3);
    const s0 = scenario({ phase: reinforce(), cards: { 0: [...art, 42] }, config: { cardBonus: 'fixed' }, terr: { alaska: [1, 1] } });
    const s = { ...s0, tradeCount: 7 };
    expect(setValue(s, art as [number, number, number])).toBe(8);
    const r = act(s, { type: 'trade', player: 0, cardIds: [art[0], art[1], 42] });
    expect(r.events[0]).toMatchObject({ type: 'cardsTraded', armies: 8 });
  });
});

describe('trading in reinforce', () => {
  it('adds armies to remaining, moves cards to discard, and the +2 lands on the first owned card territory', () => {
    // cards for alaska (owned by 1), greenland (owned by 0), quebec (owned by 0)? pick an inf/cav/art triple
    const a = cardId('alaska'); // infantry (index 0)
    const b = cardId('northwest_territory'); // cavalry
    const c = cardId('greenland'); // artillery
    const s = scenario({ phase: reinforce(3), cards: { 0: [a, b, c] }, terr: { alaska: [1, 2] } });
    const r = act(s, { type: 'trade', player: 0, cardIds: [a, b, c] });
    expect(types(r.events)).toEqual(['cardsTraded', 'armiesPlaced']);
    expect(r.events[0]).toMatchObject({ type: 'cardsTraded', armies: 4, bonusTerritory: 'northwest_territory', tradeIndex: 1 });
    expect(r.events[1]).toEqual({ type: 'armiesPlaced', player: 0, territory: 'northwest_territory', count: 2, source: 'cardBonus' });
    expect(r.state.territories.northwest_territory.armies).toBe(3);
    expect(r.state.territories.greenland.armies).toBe(1); // only one +2 per trade
    expect(r.state.phase).toMatchObject({ kind: 'reinforce', remaining: 7 });
    expect(r.state.players[0].cards).toHaveLength(0);
    expect(r.state.discard.map((x) => x.id).sort()).toEqual([a, b, c].sort());
    // bonus isn't undoable reinforcement
    expect(r.state.phase.kind === 'reinforce' && r.state.phase.placed).toEqual({});
  });

  it('bonus follows cardIds order', () => {
    const a = cardId('alaska');
    const b = cardId('northwest_territory');
    const c = cardId('greenland');
    const s = scenario({ phase: reinforce(), cards: { 0: [a, b, c] }, terr: { brazil: [1, 1] } });
    const r = act(s, { type: 'trade', player: 0, cardIds: [c, a, b] });
    expect(r.events[0]).toMatchObject({ bonusTerritory: 'greenland' });
  });

  it('no bonus when no traded card shows an owned territory (wilds never do)', () => {
    const a = cardId('alaska');
    const b = cardId('northwest_territory');
    const s = scenario({ phase: reinforce(), cards: { 0: [a, b, 42] }, terr: { alaska: [1, 1], northwest_territory: [1, 1] } });
    const r = act(s, { type: 'trade', player: 0, cardIds: [a, b, 42] });
    expect(types(r.events)).toEqual(['cardsTraded']);
    expect(r.events[0]).toMatchObject({ bonusTerritory: null });
  });

  it('rejects non-sets, cards not held, duplicates, and trading outside reinforce', () => {
    const inf = idsBySymbol('infantry', 2);
    const cav = idsBySymbol('cavalry', 1);
    const s = scenario({ phase: reinforce(), cards: { 0: [...inf, ...cav], 1: [42] }, terr: { alaska: [1, 1] } });
    expect(reject(s, { type: 'trade', player: 0, cardIds: [inf[0], inf[1], cav[0]] })).toMatch(/aren't a set/);
    expect(reject(s, { type: 'trade', player: 0, cardIds: [inf[0], inf[1], 42] })).toMatch(/don't hold/);
    expect(reject(s, { type: 'trade', player: 0, cardIds: [inf[0], inf[0], inf[1]] })).toMatch(/different/);
    expect(reject(s, { type: 'trade', player: 0, cardIds: [inf[0], inf[1]] as never })).toMatch(/three/);
    const atk = { ...s, phase: { kind: 'attack' } as const };
    expect(reject(atk, { type: 'trade', player: 0, cardIds: [inf[0], inf[1], cav[0]] })).toMatch(/reinforcing/);
  });

  it('5+ cards at turn start → mustTrade; placing and ending are blocked until under 5', () => {
    const hand = [...idsBySymbol('infantry', 3), ...idsBySymbol('cavalry', 2)];
    // P1 ends their turn → P0's turn starts holding 5 cards
    const s = scenario({ phase: { kind: 'fortify' }, current: 1, cards: { 0: hand }, terr: { alaska: [1, 3], kamchatka: [1, 1] } });
    const r = act(s, { type: 'endTurn', player: 1 });
    expect(r.state.currentPlayer).toBe(0);
    expect(r.state.phase).toMatchObject({ kind: 'reinforce', mustTrade: true });
    const sum = legalActionsSummary(r.state);
    expect(sum.mustTrade).toBe(true);
    expect(sum.placeable).toEqual([]);
    expect(sum.canEndReinforce).toBe(false);
    expect(sum.tradeSets.length).toBeGreaterThan(0);
    expect(reject(r.state, { type: 'reinforce', player: 0, territory: 'brazil', count: 1 })).toMatch(/trade/);
    expect(reject(r.state, { type: 'endReinforce', player: 0 })).toMatch(/trade/);
    const t = act(r.state, { type: 'trade', player: 0, cardIds: hand.slice(0, 3) as [number, number, number] });
    expect(t.state.phase).toMatchObject({ kind: 'reinforce', mustTrade: false });
    expect(t.state.players[0].cards).toHaveLength(2);
  });

  it('4 cards at turn start: no forced trade (but a set may still be traded)', () => {
    const hand = idsBySymbol('infantry', 4);
    const s = scenario({ phase: { kind: 'fortify' }, current: 1, cards: { 0: hand }, terr: { alaska: [1, 3] } });
    const r = act(s, { type: 'endTurn', player: 1 });
    expect(r.state.phase).toMatchObject({ kind: 'reinforce', mustTrade: false });
    act(r.state, { type: 'trade', player: 0, cardIds: hand.slice(0, 3) as [number, number, number] });
  });
});

describe('deck', () => {
  it('draws only after a conquest, from the top', () => {
    const s = scenario({ phase: { kind: 'attack' }, terr: { alaska: [1, 3] }, conquered: true });
    const top = s.deck[s.deck.length - 1];
    const r = act(s, { type: 'endTurn', player: 0 });
    expect(r.events[0]).toEqual({ type: 'cardDrawn', player: 0, card: top });
    expect(r.state.players[0].cards).toEqual([top]);
    expect(r.state.deck).toHaveLength(s.deck.length - 1);
    const none = act({ ...s, conqueredThisTurn: false }, { type: 'endTurn', player: 0 });
    expect(types(none.events)).not.toContain('cardDrawn');
  });

  it('reshuffles the discard into the deck when the deck runs out', () => {
    const base = scenario({ phase: { kind: 'attack' }, terr: { alaska: [1, 3] }, conquered: true });
    const s = { ...base, discard: base.deck.slice(0, 10), deck: [] as Card[] };
    // put the remaining 34 cards in P1's hand so the total stays 44
    s.players = s.players.map((p) => (p.id === 1 ? { ...p, cards: base.deck.slice(10) } : p));
    const r = act(s, { type: 'endTurn', player: 0 });
    expect(types(r.events)[0]).toBe('cardDrawn');
    expect(r.state.discard).toHaveLength(0);
    expect(r.state.deck).toHaveLength(9);
    const ids = new Set([...r.state.deck, ...r.state.players[0].cards].map((c) => c.id));
    expect(ids).toEqual(new Set(base.deck.slice(0, 10).map((c) => c.id)));
  });

  it('no card when deck and discard are both empty', () => {
    const base = scenario({ phase: { kind: 'attack' }, terr: { alaska: [1, 3] }, conquered: true });
    const s = { ...base, deck: [] as Card[], discard: [] as Card[] };
    s.players = s.players.map((p) => (p.id === 1 ? { ...p, cards: base.deck } : p));
    const r = act(s, { type: 'endTurn', player: 0 });
    expect(types(r.events)).not.toContain('cardDrawn');
  });

  it('card ids map to TERRITORY_IDS order and cycle infantry/cavalry/artillery', () => {
    const d = buildDeck();
    expect(d[0]).toEqual({ id: 0, territory: TERRITORY_IDS[0], symbol: 'infantry' });
    expect(d[1].symbol).toBe('cavalry');
    expect(d[2].symbol).toBe('artillery');
    expect(d[42]).toEqual({ id: 42, territory: null, symbol: 'wild' });
  });
});
