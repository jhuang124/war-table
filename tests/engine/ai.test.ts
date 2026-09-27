import { describe, expect, it } from 'vitest';
import { chooseAiAction, createGame, validateAction, type AiDifficulty } from '../../src/engine';
import { deepFreeze, idsBySymbol, scenario } from './helpers';
import { aiConfig, playAi } from './sim';

const DIFFS: AiDifficulty[] = ['easy', 'normal', 'hard'];

describe('AI', () => {
  it('every decision is legal on the first try, across players, difficulties and rule variants', () => {
    let decisions = 0;
    const all: number[] = [];
    for (let i = 0; i < 18; i++) {
      const n = 2 + (i % 3);
      const diffs = Array.from({ length: n }, (_, k) => DIFFS[(i + k) % 3]);
      const g = playAi(
        aiConfig(diffs, {
          seed: 9000 + i,
          setupMode: i % 2 ? 'draft' : 'random',
          initialPlacement: Math.floor(i / 2) % 2 ? 'manual' : 'auto',
          cardBonus: Math.floor(i / 4) % 2 ? 'fixed' : 'progressive',
          fortifyRule: Math.floor(i / 3) % 2 ? 'adjacent' : 'connected',
          dominationPercent: i % 5 === 0 ? 70 : 100,
          turnLimit: i % 7 === 0 ? 20 : null,
        }),
      );
      expect(g.rawIllegal).toEqual([]);
      expect(g.state.phase.kind).toBe('game-over');
      expect(g.state.round).toBeLessThan(500);
      decisions += g.actions;
      all.push(...g.times);
    }
    all.sort((a, b) => a - b);
    const p99 = all[Math.floor(all.length * 0.99)];
    expect(decisions).toBeGreaterThan(1000);
    expect(p99).toBeLessThan(5);
  });

  it('does not mutate the state it reads', () => {
    const { state } = createGame(aiConfig(['hard', 'normal'], { seed: 3 }));
    deepFreeze(state);
    expect(() => chooseAiAction(state, state.currentPlayer)).not.toThrow();
  });

  it('is deterministic for a given state', () => {
    const { state } = createGame(aiConfig(['hard', 'easy', 'normal'], { seed: 4 }));
    expect(chooseAiAction(state, state.currentPlayer)).toEqual(chooseAiAction(state, state.currentPlayer));
  });

  it('returns a harmless legal action when asked for a seat that is not on the move', () => {
    const { state } = createGame(aiConfig(['normal', 'normal'], { seed: 5 }));
    const other = 1 - state.currentPlayer;
    const a = chooseAiAction(state, other);
    expect(a).toMatchObject({ type: 'setController', player: other, kind: 'ai' });
    expect(validateAction(state, a)).toBeNull();
  });

  it('handles a forced mid-turn trade and an occupy choice', () => {
    for (const d of DIFFS) {
      const hand = [...idsBySymbol('infantry', 3), ...idsBySymbol('cavalry', 3)];
      const forced = scenario({
        phase: { kind: 'reinforce', remaining: 0, mustTrade: true, placed: {}, midTurn: true },
        cards: { 0: hand },
        terr: { alaska: [1, 3] },
      });
      forced.players[0] = { ...forced.players[0], kind: 'ai', difficulty: d };
      const t = chooseAiAction(forced, 0);
      expect(t.type).toBe('trade');
      expect(validateAction(forced, t)).toBeNull();

      const occ = scenario({ phase: { kind: 'occupy', from: 'peru', to: 'argentina', min: 3, max: 9 }, terr: { peru: [0, 10], argentina: [0, 0], brazil: [1, 6] } });
      occ.players[0] = { ...occ.players[0], kind: 'ai', difficulty: d };
      const o = chooseAiAction(occ, 0);
      expect(o.type).toBe('occupy');
      if (o.type === 'occupy') expect(o.count >= 3 && o.count <= 9).toBe(true);
    }
  });

  it('hard clearly beats easy, and normal beats easy (2p, seats alternated)', () => {
    let hard = 0;
    let normal = 0;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const hFirst = i % 2 === 0;
      const g = playAi(aiConfig(hFirst ? ['hard', 'easy'] : ['easy', 'hard'], { seed: 700 + i }));
      if (g.state.phase.kind === 'game-over' && g.state.phase.winner === (hFirst ? 0 : 1)) hard++;
      const h = playAi(aiConfig(hFirst ? ['normal', 'easy'] : ['easy', 'normal'], { seed: 800 + i }));
      if (h.state.phase.kind === 'game-over' && h.state.phase.winner === (hFirst ? 0 : 1)) normal++;
    }
    expect(hard).toBeGreaterThanOrEqual(14);
    expect(normal).toBeGreaterThanOrEqual(12);
  });
});
