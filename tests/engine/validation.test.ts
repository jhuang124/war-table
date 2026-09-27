import { describe, expect, it } from 'vitest';
import { applyAction, createGame, validateAction, type Action } from '../../src/engine';
import { act, config, reject, scenario } from './helpers';

describe('validation never throws and explains itself', () => {
  const s = scenario({ players: 2, terr: { peru: [0, 5], argentina: [1, 1] } });
  const junk: unknown[] = [
    null,
    undefined,
    42,
    'attack',
    [],
    {},
    { type: 'nope', player: 0 },
    { type: 'attack' },
    { type: 'attack', player: -1, from: 'peru', to: 'argentina', dice: 1 },
    { type: 'attack', player: 1.5, from: 'peru', to: 'argentina', dice: 1 },
    { type: 'attack', player: 99, from: 'peru', to: 'argentina', dice: 1 },
    { type: 'attack', player: '0', from: 'peru', to: 'argentina', dice: 1 },
    { type: 'attack', player: 0, from: 'narnia', to: 'argentina', dice: 1 },
    { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: '3' },
    { type: 'attack', player: 0, from: 'peru', to: 'argentina', dice: NaN },
    { type: 'blitz', player: 0, from: 'peru', to: 'argentina', stopAt: -2 },
    { type: 'blitz', player: 0, from: 'peru', to: 'argentina', stopAt: 1.5 },
    { type: 'reinforce', player: 0, territory: 'peru', count: 1 },
    { type: 'occupy', player: 0, count: 1 },
    { type: 'fortify', player: 0, from: 'peru', to: 'brazil', count: Infinity },
    { type: 'trade', player: 0, cardIds: 'abc' },
    { type: 'trade', player: 0, cardIds: [1, 2, null] },
    { type: 'setController', player: 0, kind: 'robot' },
    { type: 'setController', player: 0, kind: 'ai', difficulty: 'insane' },
    { type: 'claim', player: 0, territory: 'peru' },
    { type: 'placeSetup', player: 0, territory: 'peru', count: 1 },
  ];
  it.each(junk.map((j) => [JSON.stringify(j) ?? String(j), j]))('%s → ok:false with a reason', (_label, action) => {
    const before = JSON.stringify(s);
    let r: ReturnType<typeof applyAction> | undefined;
    expect(() => {
      r = applyAction(s, action as Action);
    }).not.toThrow();
    expect(r!.ok).toBe(false);
    if (!r!.ok) {
      expect(r!.error).toMatch(/^[A-Z"].{5,}/);
      expect(r!.error).not.toMatch(/undefined|NaN|\[object/);
    }
    expect(JSON.stringify(s)).toBe(before);
  });

  it('garbage state is rejected, not thrown on', () => {
    expect(applyAction(null as never, { type: 'endTurn', player: 0 })).toEqual({ ok: false, error: 'No game in progress.' });
    expect(applyAction({} as never, { type: 'endTurn', player: 0 }).ok).toBe(false);
    expect(validateAction(null as never, null as never)).toBeTruthy();
  });

  it('out-of-turn actions name whose turn it is', () => {
    expect(reject(s, { type: 'endTurn', player: 1 })).toBe("It's Ann's turn, not Ben's.");
    expect(reject(s, { type: 'attack', player: 1, from: 'argentina', to: 'peru', dice: 1 })).toMatch(/Ann's turn/);
  });

  it('phase-mismatched actions say what to do instead', () => {
    const rein = scenario({ phase: { kind: 'reinforce', remaining: 3, mustTrade: false, placed: {}, midTurn: false }, terr: { alaska: [1, 1] } });
    expect(reject(rein, { type: 'endTurn', player: 0 })).toBe('Place your 3 armies first.');
    expect(reject(rein, { type: 'attack', player: 0, from: 'kamchatka', to: 'alaska', dice: 1 })).toBe('Place your 3 armies first.');
    expect(reject(s, { type: 'occupy', player: 0, count: 1 })).toMatch(/nothing to move/);
    expect(reject(s, { type: 'endReinforce', player: 0 })).toMatch(/attack step/);
  });
});

describe('setController', () => {
  it('works any time for any seat, even out of turn, and emits controllerChanged', () => {
    const { state } = createGame(config(3, { setupMode: 'draft', seed: 5 }));
    const other = (state.currentPlayer + 1) % 3;
    const r = act(state, { type: 'setController', player: other, kind: 'ai' });
    expect(r.events).toEqual([{ type: 'controllerChanged', player: other, kind: 'ai', difficulty: 'normal' }]);
    expect(r.state.players[other]).toMatchObject({ kind: 'ai', difficulty: 'normal' });
    expect(r.state.currentPlayer).toBe(state.currentPlayer);
    const h = act(r.state, { type: 'setController', player: other, kind: 'ai', difficulty: 'hard' });
    expect(h.state.players[other].difficulty).toBe('hard');
    const back = act(h.state, { type: 'setController', player: other, kind: 'human' });
    expect(back.state.players[other].kind).toBe('human');
    expect(back.state.players[other].difficulty).toBeUndefined();
    expect(back.events).toEqual([{ type: 'controllerChanged', player: other, kind: 'human' }]);
  });

  it('works during occupy and after game over; rejects unknown seats', () => {
    const occ = scenario({ phase: { kind: 'occupy', from: 'peru', to: 'argentina', min: 1, max: 3 }, terr: { peru: [0, 4], argentina: [0, 0], alaska: [1, 1] } });
    expect(act(occ, { type: 'setController', player: 1, kind: 'ai', difficulty: 'easy' }).state.phase.kind).toBe('occupy');
    const over = scenario({ phase: { kind: 'game-over', winner: 0, reason: 'domination' } });
    act(over, { type: 'setController', player: 0, kind: 'ai' });
    expect(reject(over, { type: 'setController', player: 7, kind: 'ai' })).toMatch(/No such player/);
  });
});
