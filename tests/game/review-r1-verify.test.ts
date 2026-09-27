// Review round 1, verifier: the cross-area requests applied at integration (seat hand-off R1-22,
// tooltip avoid R1-18, occupy card chip R1-09), on the fake board + modelled 1× durations.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent, GameState, TerritoryId } from '../../src/engine';
import type { AudioEngine } from '../../src/audio/types';
import type { BoardView, PlayEventOptions, TerritoryPointerInfo } from '../../src/render/BoardView';
import { createController } from '../../src/game/controller';
import { memoryKV, SAVE_KEY } from '../../src/game/storage';
import { eventDurationMs, scaledDuration } from '../../src/game/timingModel';
import { board as fixture } from './fixtures';

function fakeBoard() {
  let speed = 1;
  const pending = new Set<() => void>();
  let click: ((i: TerritoryPointerInfo) => void) | null = null;
  let hover: ((i: TerritoryPointerInfo | null) => void) | null = null;
  const b: BoardView = {
    syncState: () => undefined,
    playEvent(ev: GameEvent, _after: GameState, opts?: PlayEventOptions) {
      const ms = scaledDuration(eventDurationMs(ev, opts), speed);
      if (ms <= 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => {
          pending.delete(done);
          clearTimeout(h);
          resolve();
        };
        const h = setTimeout(done, ms);
        pending.add(done);
      });
    },
    setAnimationSpeed: (m) => void (speed = m),
    skipAnimations: () => {
      for (const d of [...pending]) d();
    },
    setHighlights: () => undefined,
    onTerritoryClick: (cb) => void (click = cb),
    onTerritoryHover: (cb) => void (hover = cb as typeof hover),
    focusTerritories: () => undefined,
    resetCamera: () => undefined,
    setAttractMode: () => undefined,
    setShowLabels: () => undefined,
    setViewportInsets: () => undefined,
    setUiScale: () => undefined,
    getScreenPosition: () => ({ x: 100, y: 100 }),
    getStats: () => ({ fps: 60, frameMsP95: 16, drawCalls: 0, triangles: 0, activeTweens: pending.size, cameraMoving: false }),
    dispose: () => undefined,
  };
  return {
    board: b,
    click: (t: TerritoryId, button = 0) =>
      click!({ territory: t, clientX: 0, clientY: 0, shiftKey: false, altKey: false, metaKey: false, button }),
    hover: (t: TerritoryId) => hover!({ territory: t, clientX: 300, clientY: 300, shiftKey: false, altKey: false, metaKey: false, button: 0 }),
  };
}

const silentAudio = {
  unlock: () => undefined,
  play: () => undefined,
  setVolume: () => undefined,
  setMuted: () => undefined,
  setMusic: () => undefined,
  setMusicVolume: () => undefined,
  stopAll: () => undefined,
  isUnlocked: () => false,
  stats: () => ({}),
  dispose: () => undefined,
} as unknown as AudioEngine;

const clock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  raf: (fn: () => void) => void setTimeout(fn, 16),
};

async function until(pred: () => boolean, maxMs: number, step = 20): Promise<boolean> {
  for (let t = 0; t < maxMs; t += step) {
    if (pred()) return true;
    await vi.advanceTimersByTimeAsync(step);
  }
  return pred();
}

/** Resume a hand-set board (John = seat 0, human; Sam human; Priya AI owns the rest). */
async function resume(s: GameState) {
  const kv = memoryKV();
  kv.set(SAVE_KEY, JSON.stringify({ v: 1, savedAt: 0, state: s }));
  const fb = fakeBoard();
  const c = createController({ board: fb.board, audio: silentAudio, storage: kv, clock, dom: false, prefersReducedMotion: () => false });
  c.intent({ type: 'continue' });
  await vi.advanceTimersByTimeAsync(50);
  return { c, fb };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R1-22 seat hand-off (Pause → Seats)', () => {
  it('offers a human seat to the AI, plays it, and gives it back', async () => {
    const s = fixture({ ural: [0, 5], ukraine: [0, 3], alaska: [1, 2] }, { kind: 'attack' });
    const { c } = await resume(s);
    const row = (id: number) => c.getViewModel().game!.roster.find((r) => r.seat.id === id)!;
    expect(row(0).seatAction?.label).toBe('Let the AI play John · Normal');
    expect(row(2).seatAction ?? null).toBeNull(); // started as AI
    c.intent({ type: 'overlay', overlay: 'pause' });
    c.intent(row(0).seatAction!.intent);
    await vi.advanceTimersByTimeAsync(100);
    expect(c.hooks.getState()!.players[0].kind).toBe('ai');
    expect(row(0).seatAction?.label).toBe('John takes the seat back');
    // Paused: the AI waits. Unpause and it plays John's turn to the next seat.
    expect(c.hooks.getState()!.currentPlayer).toBe(0);
    c.intent({ type: 'overlay', overlay: null });
    expect(await until(() => c.hooks.getState()!.currentPlayer !== 0, 30000)).toBe(true);
    c.intent(row(0).seatAction!.intent);
    await until(() => c.hooks.getState()!.players[0].kind === 'human', 30000);
    expect(c.hooks.getState()!.players[0].kind).toBe('human');
    c.dispose();
  });
});

describe('R1-18 tooltip avoids the armed pair', () => {
  it('names the selected source and armed target', async () => {
    const s = fixture({ ural: [0, 5] }, { kind: 'attack' });
    const { c, fb } = await resume(s);
    fb.click('siberia'); // target-first arm from Ural
    await vi.advanceTimersByTimeAsync(30);
    fb.hover('china');
    await vi.advanceTimersByTimeAsync(1200);
    const tip = c.getViewModel().game!.tooltip;
    expect(tip?.name).toBe('China');
    expect(new Set(tip!.avoid)).toEqual(new Set(['ural', 'siberia']));
    c.dispose();
  });
});

describe('R1-09 occupy keeps the card status', () => {
  it('shows Card earned in occupy', async () => {
    const s = fixture({ greenland: [0, 10], ontario: [0, 0] }, { kind: 'occupy', from: 'greenland', to: 'ontario', min: 3, max: 9, previousOwner: 2 });
    s.conqueredThisTurn = true;
    const { c } = await resume(s);
    expect(c.getViewModel().game!.actionBar.chips.map((x) => x.label)).toContain('Card earned ✓');
    c.dispose();
  });
});
