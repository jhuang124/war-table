import { describe, expect, it } from 'vitest';
import { attackStakes, autoChain, autoSource, bestSet, noSetStatus, occupyDefault, oddsLabel, oddsWord } from '../../src/game/helpers';
import { pct } from '../../src/game/copy';
import { board, card } from './fixtures';

describe('oddsWord', () => {
  it('uses the UX bands on the displayed percent', () => {
    expect(oddsWord(0.9)).toBe('almost sure');
    expect(oddsWord(0.85)).toBe('almost sure');
    expect(oddsWord(0.846)).toBe('almost sure'); // shows 85%
    expect(oddsWord(0.844)).toBe('likely'); // shows 84%
    expect(oddsWord(0.6)).toBe('likely');
    expect(oddsWord(0.59)).toBe('coin flip');
    expect(oddsWord(0.4)).toBe('coin flip');
    expect(oddsWord(0.39)).toBe('long shot');
    expect(oddsWord(0)).toBe('long shot');
  });
  it('never shows a decimal, 100% only when certain', () => {
    expect(pct(0.9996)).toBe(99);
    expect(pct(1)).toBe(100);
    expect(pct(0.0004)).toBe(1);
    expect(oddsLabel(0.82, true)).toBe('Blitz · 82% · likely');
    expect(oddsLabel(0.82, false)).toBe('Blitz · likely');
  });
});

describe('autoSource', () => {
  it('picks the adjacent tile with the most armies (≥ 2)', () => {
    const s = board({ ural: [0, 8], afghanistan: [0, 3], ukraine: [0, 1] });
    expect(autoSource(s, 'siberia')).toBe('ural');
    expect(autoSource(s, 'china')).toBe('ural'); // ural 8 beats afghanistan 3
  });
  it('breaks ties toward the tile with more enemy-free sides', () => {
    // ural and afghanistan both 5; ukraine owned makes both have one friendly side, add china to afghanistan.
    const s = board({ ural: [0, 5], afghanistan: [0, 5], ukraine: [0, 1], middle_east: [0, 1], india: [0, 1] });
    // china borders both. afghanistan neighbors: ukraine, ural, china, india, middle_east → 4 friendly; ural: ukraine, afghanistan → 2.
    expect(autoSource(s, 'china')).toBe('afghanistan');
  });
  it('returns null when nothing next door has 2+', () => {
    const s = board({ ural: [0, 1] });
    expect(autoSource(s, 'siberia')).toBeNull();
    expect(autoSource(s, 'brazil')).toBeNull();
  });
  it('never targets your own tile', () => {
    const s = board({ ural: [0, 5], siberia: [0, 2] });
    expect(autoSource(s, 'siberia')).toBeNull();
  });
});

describe('occupyDefault', () => {
  it('to borders enemies, from does not → max, front moves forward', () => {
    // From alaska (owned neighbors only) into kamchatka (borders enemies).
    const s = board({ alaska: [0, 8], northwest_territory: [0, 1], alberta: [0, 1], kamchatka: [0, 0] }, { kind: 'occupy', from: 'alaska', to: 'kamchatka', min: 3, max: 7 });
    expect(occupyDefault(s, 'alaska', 'kamchatka', 3, 7)).toEqual({ count: 7, note: 'Front moves forward' });
  });
  it('to safe, from borders enemies → min', () => {
    // Australia pocket: western_australia conquered; its neighbors all John's.
    const s = board(
      { indonesia: [0, 9], new_guinea: [0, 1], eastern_australia: [0, 1], western_australia: [0, 0] },
      { kind: 'occupy', from: 'indonesia', to: 'western_australia', min: 2, max: 8 },
    );
    expect(occupyDefault(s, 'indonesia', 'western_australia', 2, 8)).toEqual({
      count: 2,
      note: 'Western Australia is safe · keeping your stack in Indonesia',
    });
  });
  it('both border enemies → max with the named threat', () => {
    const s = board({ ural: [0, 8], siberia: [0, 0] }, { kind: 'occupy', from: 'ural', to: 'siberia', min: 3, max: 7 });
    s.territories.afghanistan.armies = 6; // the biggest enemy next to Ural
    const d = occupyDefault(s, 'ural', 'siberia', 3, 7);
    expect(d.count).toBe(7);
    expect(d.note).toBe('Ural keeps 1 · still borders Afghanistan');
  });
  it('neither borders enemies → max, no note', () => {
    const s = board({
      indonesia: [0, 9],
      new_guinea: [0, 1],
      eastern_australia: [0, 1],
      western_australia: [0, 0],
      siam: [0, 1],
    });
    expect(occupyDefault(s, 'indonesia', 'western_australia', 2, 8)).toEqual({ count: 8, note: null });
  });
});

describe('autoChain', () => {
  it('selects to when it can attack, else from, else nothing', () => {
    const a = board({ ural: [0, 2], siberia: [0, 6] });
    expect(autoChain(a, 'ural', 'siberia')).toBe('siberia');
    const b = board({ ural: [0, 6], siberia: [0, 1] });
    expect(autoChain(b, 'ural', 'siberia')).toBe('ural');
    const c = board({ ural: [0, 1], siberia: [0, 1] });
    expect(autoChain(c, 'ural', 'siberia')).toBeNull();
  });
});

describe('attackStakes', () => {
  it('wins the game when the conquest reaches the goal', () => {
    // 70% → 30 territories; John owns 29 + attacks one more.
    const own: Record<string, [number, number]> = {};
    const ids = ['alaska', 'northwest_territory', 'greenland', 'alberta', 'ontario', 'quebec', 'western_us', 'eastern_us', 'central_america', 'venezuela', 'peru', 'brazil', 'argentina', 'iceland', 'scandinavia', 'great_britain', 'northern_europe', 'western_europe', 'southern_europe', 'ukraine', 'north_africa', 'egypt', 'east_africa', 'congo', 'south_africa', 'madagascar', 'ural', 'siberia', 'yakutsk'];
    for (const t of ids) own[t] = [0, 3];
    const s = board(own as never);
    s.config = { ...s.config, dominationPercent: 70 };
    const st = attackStakes(s, 'yakutsk', 'kamchatka');
    expect(st[0]).toEqual({ text: 'WINS THE GAME', priority: true });
  });
  it('knocks out a player and names their cards', () => {
    const s = board({ ural: [0, 5] });
    // Sam owns only Siberia and holds 4 cards.
    s.territories.siberia = { owner: 1, armies: 2 };
    s.players[1].cards = [card(1, 'infantry'), card(2, 'cavalry'), card(3, 'artillery'), card(4, 'infantry')];
    const st = attackStakes(s, 'ural', 'siberia');
    expect(st[0]).toEqual({ text: 'KNOCKS OUT SAM · takes their 4 cards', priority: true });
  });
  it('completes and breaks continents, then the first-conquest card, max 2 lines', () => {
    const s = board({ venezuela: [0, 4], peru: [0, 1], argentina: [0, 1], central_america: [0, 1] });
    const st = attackStakes(s, 'venezuela', 'brazil');
    expect(st).toEqual([
      { text: 'COMPLETES SOUTH AMERICA · +2 a turn', priority: false },
      { text: 'First conquest this turn · earns a card', priority: false },
    ]);
    const s2 = board({ north_africa: [0, 6] });
    for (const t of ['iceland', 'scandinavia', 'great_britain', 'northern_europe', 'western_europe', 'southern_europe', 'ukraine'] as const) {
      s2.territories[t] = { owner: 1, armies: 2 };
    }
    s2.conqueredThisTurn = true;
    expect(attackStakes(s2, 'north_africa', 'western_europe')).toEqual([
      { text: "BREAKS SAM'S EUROPE · −5 a turn for Sam", priority: false },
    ]);
  });
  it('never pads: no stakes → empty', () => {
    const s = board({ ural: [0, 5] });
    s.conqueredThisTurn = true;
    expect(attackStakes(s, 'ural', 'siberia')).toEqual([]);
  });
});

describe('bestSet', () => {
  it('prefers the highest value, then the +2 bonus, then keeping wilds', () => {
    const s = board({ ural: [0, 3] }, { kind: 'reinforce', remaining: 3, mustTrade: false, placed: {}, midTurn: false }, { tradeCount: 0 });
    s.config = { ...s.config, cardBonus: 'fixed' };
    // artillery ×3 (8) beats one-of-each (10)? No: one of each = 10 wins.
    s.players[0].cards = [card(0, 'artillery', 'alaska'), card(1, 'artillery', 'peru'), card(2, 'artillery', 'brazil'), card(3, 'infantry', 'siberia'), card(4, 'cavalry', 'china')];
    expect(bestSet(s, 0)!.value).toBe(10);
  });
  it('breaks value ties with the territory bonus', () => {
    const s = board({ ural: [0, 3] });
    s.players[0].cards = [card(0, 'infantry', 'alaska'), card(1, 'infantry', 'peru'), card(2, 'infantry', 'brazil'), card(3, 'infantry', 'ural')];
    const b = bestSet(s, 0)!;
    expect(b.bonusTerritory).toBe('ural');
    expect(b.cardIds).toContain(3);
  });
  it('keeps wilds when a plain set is worth the same', () => {
    const s = board({});
    s.players[0].cards = [card(0, 'infantry'), card(1, 'infantry'), card(2, 'infantry'), card(42, 'wild')];
    expect(bestSet(s, 0)!.cardIds).toEqual([0, 1, 2]);
  });
  it('returns null without a set', () => {
    const s = board({});
    s.players[0].cards = [card(0, 'infantry'), card(1, 'infantry'), card(2, 'cavalry')];
    expect(bestSet(s, 0)).toBeNull();
  });
});

describe('noSetStatus', () => {
  it('says exactly what is missing', () => {
    expect(noSetStatus([])).toBe('No cards yet · conquer a territory to earn one');
    expect(noSetStatus([card(0, 'infantry')])).toBe('Need 2 more cards');
    expect(noSetStatus([card(0, 'infantry'), card(1, 'infantry')])).toBe('Need a third infantry, or a wild');
    expect(noSetStatus([card(0, 'infantry'), card(1, 'cavalry')])).toBe('Need 1 artillery, or a wild');
    expect(noSetStatus([card(0, 'infantry'), card(1, 'infantry'), card(2, 'cavalry'), card(3, 'cavalry')])).toBe('Need 1 artillery, or a third match');
    expect(noSetStatus([card(0, 'infantry'), card(1, 'infantry'), card(2, 'cavalry')])).toBe('Need 1 artillery, or a third infantry');
  });
});
