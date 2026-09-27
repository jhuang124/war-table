import { describe, expect, it } from 'vitest';
import { TERRITORY_IDS, applyAction, chooseAiAction, cloneState, createGame, type GameEvent } from '../../src/engine';
import { applyEventToDisplay, isBlocking } from '../../src/game/display';
import { buildAwards, buildRecap, emptyAwards, recordAward, recordRecap, type RecapLedger } from '../../src/game/recap';
import { autoSetupBatch, buildNewGameVM, defaultDraft, draftToConfig, lengthRules, patchSeat, addSeat, sanitizeDraft } from '../../src/game/presets';
import { reconcile } from '../../src/game/reconcile';
import { board } from './fixtures';

describe('recap: one line, only when you lost territory', () => {
  const conquer = (to: string, by: number, from = 0): GameEvent => ({ type: 'territoryConquered', player: by, from: 'ural', to: to as never, previousOwner: from });
  it('names a single loss, counts several, and joins attackers', () => {
    const s = board({ ural: [0, 3] });
    const ledger: RecapLedger = {};
    recordRecap(ledger, s, conquer('ukraine', 1));
    expect(buildRecap(ledger[0], s)).toBe('Sam took Ukraine');
    recordRecap(ledger, s, conquer('ural', 1));
    expect(buildRecap(ledger[0], s)).toBe('Sam took 2 of yours');
    recordRecap(ledger, s, conquer('siberia', 2));
    expect(buildRecap(ledger[0], s)).toBe('Sam and Priya took 3 of yours');
  });
  it('nothing lost → no line', () => {
    const s = board({ ural: [0, 3] });
    const ledger: RecapLedger = {};
    recordRecap(ledger, s, { type: 'continentLost', player: 0, continent: 'europe', to: 1 });
    recordRecap(ledger, s, { type: 'cardsTraded', player: 2, cards: [], armies: 15, bonusTerritory: null, tradeIndex: 6 });
    expect(buildRecap(ledger[0], s)).toBeNull();
    expect(buildRecap(undefined, s)).toBeNull();
  });
  it('only human seats collect', () => {
    const s = board({ ural: [0, 3] });
    const ledger: RecapLedger = {};
    recordRecap(ledger, s, conquer('ural', 0, 2)); // John took Ural from Priya (an AI)
    expect(ledger[2]).toBeUndefined();
    expect(ledger[0]).toBeUndefined();
  });
});

describe('awards (UX.md §4.6)', () => {
  it('needs ≥ 3 supporting events and caps at 3 cards', () => {
    const s = board({ ural: [0, 3] });
    const l = emptyAwards();
    const roll = (p: number, defLoss: number): GameEvent => ({
      type: 'diceRolled', player: p, defender: 2, from: 'ural', to: 'siberia', attackDice: [6, 5, 4], defendDice: [3, 2], attackerLosses: 2 - defLoss, defenderLosses: defLoss, blitz: true,
    });
    for (let i = 0; i < 4; i++) recordAward(l, s, roll(0, 2)); // hot: +0.921 per roll
    for (let i = 0; i < 4; i++) recordAward(l, s, roll(1, 0)); // cursed: −1.079 per roll
    for (let i = 0; i < 3; i++) recordAward(l, s, { type: 'territoryConquered', player: 1, from: 'ural', to: 'siberia', previousOwner: 0 });
    const cards = buildAwards(l, s);
    expect(cards.map((c) => c.id)).toEqual(['nemesis', 'hotDice', 'cursedDice']);
    expect(cards[0].text).toBe('Sam took 3 territories from John');
    expect(cards[1].text).toBe('John: +4 armies of pure luck');
    expect(cards[2].text).toBe('Sam: −4 armies the dice took back');
    for (let i = 0; i < 3; i++) recordAward(l, s, { type: 'cardsTraded', player: 2, cards: [], armies: 10 + i * 5, bonusTerritory: null, tradeIndex: i + 1 });
    const four = buildAwards(l, s);
    expect(four.length).toBe(3);
    expect(four.map((c) => c.id)).toEqual(['nemesis', 'hotDice', 'cashIn']);
  });
  it('no awards without support', () => {
    const s = board({ ural: [0, 3] });
    expect(buildAwards(emptyAwards(), s)).toEqual([]);
  });
});

describe('display follows the board', () => {
  it('per-event deltas reproduce the engine state at the end of each action', () => {
    const { state: s0, events } = createGame({
      players: [
        { name: 'A', color: 'crimson', kind: 'ai', difficulty: 'normal' },
        { name: 'B', color: 'cobalt', kind: 'ai', difficulty: 'hard' },
        { name: 'C', color: 'amber', kind: 'ai', difficulty: 'easy' },
      ],
      setupMode: 'random', initialPlacement: 'auto', setupBatch: 5, cardBonus: 'progressive', fortifyRule: 'connected', dominationPercent: 100, turnLimit: null, seed: 99,
    });
    const blank = cloneState(s0);
    for (const t of TERRITORY_IDS) blank.territories[t] = { owner: -1, armies: 0 };
    let d = blank;
    for (const e of events) d = applyEventToDisplay(d, e, s0, false);
    expect(d.territories).toEqual(s0.territories);
    let s = s0;
    for (let i = 0; i < 1500 && s.phase.kind !== 'game-over'; i++) {
      const r = applyAction(s, chooseAiAction(s, s.currentPlayer));
      if (!r.ok) throw new Error(r.error);
      let disp = cloneState(s);
      for (const e of r.events) disp = applyEventToDisplay(disp, e, r.state, false);
      expect(disp.territories).toEqual(r.state.territories);
      for (const p of r.state.players) expect(disp.players[p.id].cards.map((c) => c.id).sort()).toEqual(p.cards.map((c) => c.id).sort());
      expect(disp.currentPlayer).toBe(r.state.currentPlayer);
      s = r.state;
    }
  });
  it('classifies blocking events per UX.md §8.1', () => {
    const nb: GameEvent['type'][] = ['armiesPlaced', 'territoryClaimed', 'setupTurn', 'phaseChanged', 'cardDrawn', 'controllerChanged'];
    for (const t of nb) expect(isBlocking({ type: t } as GameEvent)).toBe(false);
    const b: GameEvent['type'][] = ['diceRolled', 'territoryConquered', 'armiesMoved', 'continentGained', 'continentLost', 'playerEliminated', 'cardsCaptured', 'cardsTraded', 'turnStarted', 'territoriesDealt', 'gameOver'];
    for (const t of b) expect(isBlocking({ type: t } as GameEvent)).toBe(true);
  });
});

describe('new game draft → GameConfig', () => {
  it('defaults: 1 human + 3 AI in crimson, cobalt, amber, rose; Evening; Quick deal', () => {
    const d = defaultDraft();
    expect(d.seats.map((s) => s.color)).toEqual(['crimson', 'cobalt', 'amber', 'rose']);
    expect(d.length).toBe('evening');
    expect(d.setup).toBe('quickDeal');
    const c = draftToConfig(d, 42);
    expect(c).toMatchObject({ setupMode: 'random', initialPlacement: 'auto', dominationPercent: 70, turnLimit: null, seed: 42 });
  });
  it('length presets, with the 2-player thresholds from the lead notes', () => {
    expect(lengthRules('quick', 4)).toEqual({ dominationPercent: 60, turnLimit: 12 });
    expect(lengthRules('quick', 2)).toEqual({ dominationPercent: 75, turnLimit: 12 });
    expect(lengthRules('evening', 3)).toEqual({ dominationPercent: 70, turnLimit: null });
    expect(lengthRules('evening', 2)).toEqual({ dominationPercent: 80, turnLimit: null });
    expect(lengthRules('full', 2)).toEqual({ dominationPercent: 100, turnLimit: null });
  });
  it("'auto' setup batch = two passes: 10 for 2p and 4p, 11 for 3p", () => {
    expect(autoSetupBatch(2)).toBe(10);
    expect(autoSetupBatch(3)).toBe(11);
    expect(autoSetupBatch(4)).toBe(10);
    const d = { ...defaultDraft(), setup: 'placeOwn' as const };
    expect(draftToConfig(d, 1)).toMatchObject({ initialPlacement: 'manual', setupBatch: 10 });
  });
  it('summary line, problems and seat naming', () => {
    const vm = buildNewGameVM(defaultDraft());
    expect(vm.summary).toBe('Territories dealt at random · armies placed for you · first to 30 territories wins');
    expect(vm.canStart).toBe(true);
    let d = patchSeat(defaultDraft(), 1, { color: 'crimson' });
    expect(buildNewGameVM(d).problems).toContain('Two seats share Crimson');
    expect(buildNewGameVM(d).canStart).toBe(false);
    d = patchSeat(defaultDraft(), 1, { color: 'violet' });
    expect(d.seats[1].name).toBe('Violet'); // AI seats follow their color's name
    d = patchSeat(d, 1, { kind: 'human' });
    expect(d.seats[1].name).toBe('Violet'); // flipping Human/AI keeps the name (R1-16)
    expect(defaultDraft().seats[0].name).toBe('Crimson'); // humans default to their color too
    d = patchSeat(d, 0, { name: 'John' });
    d = patchSeat(d, 0, { color: 'emerald' });
    expect(d.seats[0].name).toBe('John');
    const three = { ...defaultDraft(), seats: defaultDraft().seats.slice(0, 3), length: 'quick' as const };
    expect(buildNewGameVM(three).summary).toBe('Territories dealt at random · armies placed for you · first to 26 territories, or most after 12 rounds');
    expect(addSeat(three).seats[3].color).toBe('rose');
  });
  it('length options carry honest estimates', () => {
    const vm = buildNewGameVM(defaultDraft());
    for (const o of vm.lengthOptions) expect(o.estimate).toMatch(/^~[\d.]+(–[\d.]+)? (min|h)$/);
    const allHumans = buildNewGameVM({ ...defaultDraft(), seats: defaultDraft().seats.map((s) => ({ ...s, kind: 'human' as const })) });
    const n = (x: string) => parseFloat(x.slice(1)) * (x.endsWith(' h') ? 60 : 1);
    expect(n(allHumans.lengthOptions[1].estimate)).toBeGreaterThan(n(vm.lengthOptions[1].estimate));
  });
  it('sanitizes a remembered draft', () => {
    expect(sanitizeDraft(null)).toEqual(defaultDraft());
    const d = sanitizeDraft({ seats: [{ name: 'A', color: 'rose', kind: 'human' }, { name: 'B', color: 'nope' }], length: 'full' });
    expect(d.seats.length).toBe(4); // too few valid seats → defaults
    expect(d.length).toBe('full');
  });
});

describe('reconcile keeps identity of unchanged subtrees', () => {
  it('returns prev when deeply equal, shares unchanged children otherwise', () => {
    const a = { x: { y: [1, 2, { z: 3 }] }, w: { v: 'q' } };
    const b = { x: { y: [1, 2, { z: 3 }] }, w: { v: 'q' } };
    expect(reconcile(a, b)).toBe(a);
    const c = { x: { y: [1, 2, { z: 4 }] }, w: { v: 'q' } };
    const r = reconcile(a, c);
    expect(r).not.toBe(a);
    expect(r.w).toBe(a.w);
    expect(r.x.y[2]).toEqual({ z: 4 });
  });
});
