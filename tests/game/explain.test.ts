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
    expectCode(explainTerritory(s, ui(), 'ural'), 'none_left', 'All armies placed · click Attack to go on');
    // An enemy click never leaves Place implicitly (docs/ROUND2.md §B).
    expect(explainTerritory(s, ui(), 'siberia').code).toBe('none_left');
  });
  it('must_occupy_first', () => {
    const s = board({ ural: [0, 8], siberia: [0, 0] }, { kind: 'occupy', from: 'ural', to: 'siberia', min: 3, max: 7, previousOwner: 2 });
    expectCode(explainTerritory(s, ui(), 'yakutsk'), 'must_occupy_first', 'Finish moving armies into Siberia first');
    // Even the conquered tile: a board click never confirms the move; `Move N` does.
    expect(explainTerritory(s, ui(), 'siberia').code).toBe('must_occupy_first');
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
  it('clicking the armed target again keeps it armed (Roll / Blitz commit)', () => {
    const s = board({ ural: [0, 8] });
    expect(explainTerritory(s, ui({ selected: 'ural', target: 'siberia' }), 'siberia').plan).toEqual({ kind: 'arm', from: 'ural', to: 'siberia' });
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
