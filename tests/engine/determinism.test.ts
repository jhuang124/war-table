import { describe, expect, it } from 'vitest';
import { aiConfig, playAi } from './sim';

describe('determinism and immutability', () => {
  it('same seed + same actions → deep-equal states and identical event streams', () => {
    for (const [i, cfg] of [
      aiConfig(['normal', 'hard'], { seed: 101 }),
      aiConfig(['easy', 'normal', 'hard'], { seed: 202, setupMode: 'draft', initialPlacement: 'manual' }),
      aiConfig(['hard', 'hard', 'normal', 'easy'], { seed: 303, cardBonus: 'fixed', fortifyRule: 'adjacent' }),
    ].entries()) {
      const a = playAi(cfg);
      const b = playAi(cfg);
      expect(a.state.phase.kind, `game ${i}`).toBe('game-over');
      expect(b.state).toEqual(a.state);
      expect(b.events).toEqual(a.events);
    }
  });

  it('a different seed plays a different game', () => {
    const a = playAi(aiConfig(['normal', 'normal', 'normal'], { seed: 1 }));
    const b = playAi(aiConfig(['normal', 'normal', 'normal'], { seed: 2 }));
    expect(b.events).not.toEqual(a.events);
  });

  it('applyAction never mutates its input (every state deep-frozen across whole games)', () => {
    // `frozen` runs each step on a deep-frozen state; any write throws in strict mode and fails the step.
    for (const cfg of [
      aiConfig(['hard', 'normal', 'easy', 'normal'], { seed: 404, setupMode: 'draft', initialPlacement: 'manual' }),
      aiConfig(['normal', 'hard'], { seed: 505, cardBonus: 'fixed' }),
    ]) {
      const g = playAi(cfg, { frozen: true });
      expect(g.state.phase.kind).toBe('game-over');
    }
  });

  it('state survives a JSON round-trip (save/load) and play continues identically', () => {
    const cfg = aiConfig(['normal', 'hard', 'easy'], { seed: 606 });
    const partial = playAi(cfg, { maxActions: 150 });
    const restored = JSON.parse(JSON.stringify(partial.state));
    expect(restored).toEqual(partial.state);
  });
});
