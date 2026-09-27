import { describe, expect, it } from 'vitest';
import { explainTerritory, REASON_CODES, type ExplainUi } from '../../src/game/explain';
import { board, card } from './fixtures';

const ui = (o: Partial<ExplainUi> = {}): ExplainUi => ({ selected: null, target: null, interactive: true, showWinChance: true, ...o });

describe('explainTerritory reason codes (UX.md §7.3)', () => {
  const seen = new Set<string>();
  const expectCode = (r: ReturnType<typeof explainTerritory>, code: string, text: string) => {
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
    expect(r.text).toBe(text);
    seen.add(code);
  };

  it('not_yours', () => {
    const s = board({ ural: [0, 3] }, { kind: 'reinforce', remaining: 3, mustTrade: false, placed: {}, midTurn: false });
    s.territories.siberia = { owner: 1, armies: 2 };
    expectCode(explainTerritory(s, ui(), 'siberia'), 'not_yours', "That's Sam's · click one of your territories");
  });
  it('one_army', () => {
    const s = board({ ural: [0, 1] });
    expectCode(explainTerritory(s, ui(), 'ural'), 'one_army', 'Ural has 1 army · you need 2 to attack');
  });
  it('no_source_for_target', () => {
    const s = board({ venezuela: [0, 1], peru: [0, 1] });
    expectCode(explainTerritory(s, ui(), 'brazil'), 'no_source_for_target', 'Nothing of yours next to Brazil has 2+ armies');
  });
  it('no_enemy_neighbors', () => {
    const s = board({ brazil: [0, 4], venezuela: [0, 1], peru: [0, 1], argentina: [0, 1], north_africa: [0, 1] });
    expectCode(explainTerritory(s, ui(), 'brazil'), 'no_enemy_neighbors', 'Everything next to Brazil is already yours');
  });
  it('not_adjacent', () => {
    const s = board({ ural: [0, 6] });
    expectCode(
      explainTerritory(s, ui({ selected: 'ural' }), 'peru'),
      'not_adjacent',
      "Peru doesn't border any of yours",
    );
  });
  it('own_as_target', () => {
    const s = board({ ural: [0, 6], ukraine: [0, 1] });
    expectCode(explainTerritory(s, ui({ selected: 'ural' }), 'ukraine'), 'own_as_target', "That's yours · click an enemy next to Ural");
  });
  it('must_trade_first', () => {
    const s = board({ ural: [0, 3] }, { kind: 'reinforce', remaining: 3, mustTrade: true, placed: {}, midTurn: false });
    s.players[0].cards = [0, 1, 2, 3, 4].map((i) => card(i, 'infantry'));
    expectCode(explainTerritory(s, ui(), 'ural'), 'must_trade_first', 'You hold 5 cards · trade a set first');
  });
  it('none_left', () => {
    const s = board({ ural: [0, 1] }, { kind: 'reinforce', remaining: 0, mustTrade: false, placed: {}, midTurn: false });
    expectCode(explainTerritory(s, ui(), 'ural'), 'none_left', 'All armies placed · click an enemy to attack');
  });
  it('fortify_unreachable', () => {
    const s = board({ ural: [0, 5], ukraine: [0, 1], brazil: [0, 1] }, { kind: 'fortify' });
    expectCode(
      explainTerritory(s, ui({ selected: 'ural' }), 'brazil'),
      'fortify_unreachable',
      "Can't reach Brazil · only through your own land",
    );
  });
  it('fortify_not_adjacent', () => {
    const s = board({ ural: [0, 5], ukraine: [0, 1], scandinavia: [0, 1] }, { kind: 'fortify' });
    s.config = { ...s.config, fortifyRule: 'adjacent' };
    expectCode(explainTerritory(s, ui({ selected: 'ural' }), 'scandinavia'), 'fortify_not_adjacent', 'House rule: fortify only to a neighbor');
  });
  it('fortify_one_army', () => {
    const s = board({ ural: [0, 1], ukraine: [0, 3] }, { kind: 'fortify' });
    expectCode(explainTerritory(s, ui(), 'ural'), 'fortify_one_army', 'Ural has 1 army · 1 has to stay to hold it');
  });
  it('already_claimed', () => {
    const s = board({}, { kind: 'setup-claim' });
    for (const t of Object.keys(s.territories)) s.territories[t as 'ural'] = { owner: -1, armies: 0 };
    s.territories.ural = { owner: 1, armies: 1 };
    expectCode(explainTerritory(s, ui(), 'ural'), 'already_claimed', 'Sam already claimed that · pick an open tile');
  });
  it('covers every reason code', () => {
    expect([...seen].sort()).toEqual([...REASON_CODES].sort());
  });
});

describe('explainTerritory plans', () => {
  it('target-first arms from the best source with odds in the verb', () => {
    const s = board({ ural: [0, 8], afghanistan: [0, 3] });
    s.territories.siberia.armies = 3;
    const r = explainTerritory(s, ui(), 'siberia');
    expect(r.ok).toBe(true);
    expect(r.plan).toEqual({ kind: 'arm', from: 'ural', to: 'siberia' });
    expect(r.verb).toMatch(/^Attack · \d+% · (almost sure|likely|coin flip|long shot)$/);
  });
  it('clicking the armed target again rolls', () => {
    const s = board({ ural: [0, 8] });
    expect(explainTerritory(s, ui({ selected: 'ural', target: 'siberia' }), 'siberia').plan).toEqual({ kind: 'roll', from: 'ural', to: 'siberia' });
  });
  it('clicking another own eligible tile switches the source and keeps an adjacent target', () => {
    const s = board({ ural: [0, 8], afghanistan: [0, 4] });
    const r = explainTerritory(s, ui({ selected: 'ural', target: 'china' }), 'afghanistan');
    expect(r.plan).toEqual({ kind: 'arm', from: 'afghanistan', to: 'china' });
  });
  it('an enemy the source can’t reach re-picks the best source', () => {
    const s = board({ ural: [0, 8], brazil: [0, 5] });
    expect(explainTerritory(s, ui({ selected: 'ural' }), 'peru').plan).toEqual({ kind: 'arm', from: 'brazil', to: 'peru' });
  });
  it('implicit reinforce exit: an enemy click at 0 left ends reinforce then arms', () => {
    const s = board({ ural: [0, 8] }, { kind: 'reinforce', remaining: 0, mustTrade: false, placed: { ural: 3 }, midTurn: false });
    const r = explainTerritory(s, ui(), 'siberia');
    expect(r.plan).toEqual({ kind: 'exitReinforce', then: { kind: 'arm', from: 'ural', to: 'siberia' } });
    const own = explainTerritory(s, ui(), 'ural');
    expect(own.plan).toEqual({ kind: 'exitReinforce', then: { kind: 'selectSource', t: 'ural' } });
  });
  it('a board click during occupy confirms then acts from the chained source', () => {
    const s = board({ ural: [0, 5], siberia: [0, 3] }, { kind: 'occupy', from: 'ural', to: 'siberia', min: 3, max: 4 });
    s.territories.siberia = { owner: 0, armies: 0 };
    s.territories.ural.armies = 8;
    s.phase = { kind: 'occupy', from: 'ural', to: 'siberia', min: 3, max: 7, previousOwner: 2 };
    const r = explainTerritory(s, ui({ occupyCount: 7 }), 'yakutsk');
    expect(r.ok).toBe(true);
    expect(r.plan).toEqual({ kind: 'occupyThen', count: 7, select: 'siberia', then: { kind: 'arm', from: 'siberia', to: 'yakutsk' } });
  });
  it('during occupy, clicking the conquered tile confirms and keeps it selected', () => {
    const s = board({ ural: [0, 8], siberia: [0, 0] }, { kind: 'occupy', from: 'ural', to: 'siberia', min: 3, max: 7, previousOwner: 2 });
    const r = explainTerritory(s, ui({ occupyCount: 7 }), 'siberia');
    expect(r.verb).toBe('Move 7 in');
    expect(r.plan).toEqual({ kind: 'occupyThen', count: 7, select: 'siberia', then: null });
  });
  it('during occupy, an enemy next to `from` keeps the stack home: min moves in, then attack from `from`', () => {
    const s = board({ greenland: [0, 10], ontario: [0, 0] }, { kind: 'occupy', from: 'greenland', to: 'ontario', min: 3, max: 9, previousOwner: 2 });
    const r = explainTerritory(s, ui({ occupyCount: 9 }), 'iceland');
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/^Move 3 in · attack from Greenland · \d+% · (almost sure|likely)$/);
    expect(r.plan).toEqual({ kind: 'occupyThen', count: 3, select: 'greenland', then: { kind: 'arm', from: 'greenland', to: 'iceland' } });
    // Next to the conquered tile: the pending count stands.
    expect(explainTerritory(s, ui({ occupyCount: 9 }), 'alberta').plan).toMatchObject({ kind: 'occupyThen', count: 9, select: 'ontario' });
    // Next to neither: the old reason is still true.
    const far = explainTerritory(s, ui({ occupyCount: 9 }), 'ukraine');
    expect(far.ok).toBe(false);
  });
  it('during occupy, clicking `from` itself moves the minimum and keeps attacking from it', () => {
    const s = board({ greenland: [0, 10], ontario: [0, 0] }, { kind: 'occupy', from: 'greenland', to: 'ontario', min: 3, max: 9, previousOwner: 2 });
    const r = explainTerritory(s, ui({ occupyCount: 9 }), 'greenland');
    expect(r.text).toBe('Move 3 in · keep attacking from Greenland');
    expect(r.plan).toEqual({ kind: 'occupyThen', count: 3, select: 'greenland', then: null });
  });
  it('Place and setup: a click on your territory picks it; setup stops at the batch size', () => {
    const r = board({ ural: [0, 1] }, { kind: 'reinforce', remaining: 4, mustTrade: false, placed: {}, midTurn: false });
    expect(explainTerritory(r, ui(), 'ural').plan).toEqual({ kind: 'pick', t: 'ural' });
    const s = board({ ural: [0, 1] }, { kind: 'setup-place', toPlace: 2 });
    expect(explainTerritory(s, ui({ staged: { ural: 1 } }), 'ural').plan).toEqual({ kind: 'pick', t: 'ural' });
    expect(explainTerritory(s, ui({ staged: { ural: 2 } }), 'ural').code).toBe('none_left');
  });
  it('watched turns never act and give no code', () => {
    const s = board({ ural: [0, 8] });
    const r = explainTerritory(s, ui({ interactive: false }), 'siberia');
    expect(r.ok).toBe(false);
    expect(r.code).toBeUndefined();
  });
  it('fortify: source → destination; another source switches', () => {
    const s = board({ ural: [0, 5], ukraine: [0, 1], brazil: [0, 4], peru: [0, 1] }, { kind: 'fortify' });
    expect(explainTerritory(s, ui(), 'ural').plan).toEqual({ kind: 'fortifySource', t: 'ural' });
    expect(explainTerritory(s, ui({ selected: 'ural' }), 'ukraine').plan).toEqual({ kind: 'fortifyDest', from: 'ural', to: 'ukraine' });
    expect(explainTerritory(s, ui({ selected: 'ural' }), 'brazil').plan).toEqual({ kind: 'fortifySource', t: 'brazil' });
  });
});
