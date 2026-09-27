// Shared AI-game driver for tests.
import { performance } from 'node:perf_hooks';
import { applyAction, chooseAiAction, createGame, validateAction, type AiDifficulty, type GameConfig, type GameEvent, type GameState } from '../../src/engine';
import { decide } from '../../src/engine/ai/brain';
import { act, config } from './helpers';

const COLORS = ['crimson', 'cobalt', 'emerald', 'amber'] as const;

export function aiConfig(diffs: AiDifficulty[], over: Partial<GameConfig> = {}): GameConfig {
  return config(diffs.length, {
    players: diffs.map((d, i) => ({ name: `${d}${i}`, color: COLORS[i], kind: 'ai', difficulty: d })),
    ...over,
  });
}

export interface Played {
  state: GameState;
  events: GameEvent[];
  actions: number;
  times: number[];
  rawIllegal: string[];
}

/** Play a full AI game. `frozen` routes every step through the deep-freeze `act` helper. */
export function playAi(cfg: GameConfig, opts: { frozen?: boolean; maxActions?: number } = {}): Played {
  const created = createGame(cfg);
  let state = created.state;
  const events: GameEvent[] = [...created.events];
  const times: number[] = [];
  const rawIllegal: string[] = [];
  let actions = 0;
  while (state.phase.kind !== 'game-over' && actions < (opts.maxActions ?? 100000)) {
    const me = state.currentPlayer;
    const raw = decide(state, me);
    const err = validateAction(state, raw);
    if (err) rawIllegal.push(`${state.phase.kind}: ${JSON.stringify(raw)} → ${err}`);
    const t0 = performance.now();
    const a = chooseAiAction(state, me);
    times.push(performance.now() - t0);
    if (opts.frozen) {
      const r = act(state, a);
      state = r.state;
      events.push(...r.events);
    } else {
      const r = applyAction(state, a);
      if (!r.ok) throw new Error(r.error);
      state = r.state;
      events.push(...r.events);
    }
    actions++;
  }
  return { state, events, actions, times, rawIllegal };
}
