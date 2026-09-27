// Controller wiring: settings reach the board and audio, controller-owned SFX, the ViewModel is built at
// most once per frame with unchanged subtrees kept, the last setup is remembered, the banner rules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../../src/audio/types';
import type { BoardView, TerritoryPointerInfo } from '../../src/render/BoardView';
import { createController } from '../../src/game/controller';
import { memoryKV, SAVE_KEY } from '../../src/game/storage';
import type { TerritoryId } from '../../src/engine';
import type { ViewModel } from '../../src/game/viewModel';
import { board as fixture } from './fixtures';

function recordingBoard() {
  const calls: [string, unknown][] = [];
  let click: ((i: TerritoryPointerInfo) => void) | null = null;
  const rec = (name: string) => (arg?: unknown) => void calls.push([name, arg]);
  const b: BoardView = {
    syncState: rec('syncState'),
    playEvent: (ev) => {
      calls.push(['playEvent', ev.type]);
      return Promise.resolve();
    },
    setAnimationSpeed: rec('setAnimationSpeed'),
    skipAnimations: rec('skipAnimations'),
    setHighlights: rec('setHighlights'),
    onTerritoryClick: (cb) => void (click = cb),
    onTerritoryHover: () => undefined,
    focusTerritories: rec('focusTerritories'),
    resetCamera: rec('resetCamera'),
    setAttractMode: rec('setAttractMode'),
    setShowLabels: rec('setShowLabels'),
    setViewportInsets: rec('setViewportInsets'),
    setUiScale: rec('setUiScale'),
    setReducedMotion: rec('setReducedMotion'),
    setAutoCamera: rec('setAutoCamera'),
    getScreenPosition: () => ({ x: 1, y: 1 }),
    getStats: () => ({ fps: 60, frameMsP95: 16, drawCalls: 0, triangles: 0, cameraMoving: false, maxCameraDegPerSec: 31 }),
    dispose: () => undefined,
  };
  return {
    b,
    calls,
    last: (name: string) => [...calls].reverse().find((c) => c[0] === name)?.[1],
    click: (t: TerritoryId, button = 0) => click!({ territory: t, clientX: 0, clientY: 0, shiftKey: false, altKey: false, metaKey: false, button }),
  };
}

function spyAudio() {
  const plays: { name: string; opts?: Record<string, unknown> }[] = [];
  const state = { volume: -1, muted: false, music: false };
  const a = {
    unlock: () => undefined,
    play: (name: string, opts?: Record<string, unknown>) => void plays.push({ name, opts }),
    setVolume: (v: number) => void (state.volume = v),
    setMuted: (m: boolean) => void (state.muted = m),
    setMusic: (m: boolean) => void (state.music = m),
    setMusicVolume: () => undefined,
    stopAll: () => undefined,
    isUnlocked: () => true,
    stats: () => ({}),
    dispose: () => undefined,
  } as unknown as AudioEngine;
  return { a, plays, state };
}

const clock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  raf: (fn: () => void) => void setTimeout(fn, 16),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe('settings reach the board and audio', () => {
  it('text size → setUiScale, labels, reduced motion, auto-camera, volume/mute/music; persisted', () => {
    const kv = memoryKV();
    const rb = recordingBoard();
    const au = spyAudio();
    const c = createController({ board: rb.b, audio: au.a, storage: kv, clock, dom: false, prefersReducedMotion: () => false });
    c.intent({ type: 'setting', patch: { textSize: 'tv', showLabels: false, reduceMotion: true, autoCamera: false, sfxVolume: 0.3, muted: true, music: true } });
    expect(rb.last('setUiScale')).toBe(1.5);
    expect(rb.last('setShowLabels')).toBe(false);
    expect(rb.last('setReducedMotion')).toBe(true);
    expect(rb.last('setAutoCamera')).toBe(false);
    expect(au.state).toEqual({ volume: 0.3, muted: true, music: true });
    expect(JSON.parse(kv.get('risk3d.settings.v1')!)).toMatchObject({ textSize: 'tv', showLabels: false, muted: true });
    expect(c.getViewModel().reducedMotion).toBe(true);
    // A new controller reads them back.
    const rb2 = recordingBoard();
    createController({ board: rb2.b, audio: spyAudio().a, storage: kv, clock, dom: false, prefersReducedMotion: () => false });
    expect(rb2.last('setUiScale')).toBe(1.5);
    c.dispose();
  });
  it('OS reduced motion counts even with the setting off', () => {
    const rb = recordingBoard();
    const c = createController({ board: rb.b, audio: spyAudio().a, storage: memoryKV(), clock, dom: false, prefersReducedMotion: () => true });
    expect(rb.last('setReducedMotion')).toBe(true);
    expect(c.getViewModel().reducedMotion).toBe(true);
  });
  it('board speed follows the seat: human setting on human turns', async () => {
    const kv = memoryKV();
    kv.set(SAVE_KEY, JSON.stringify({ v: 1, savedAt: 0, state: fixture({ ural: [0, 5] }) }));
    const rb = recordingBoard();
    const c = createController({ board: rb.b, audio: spyAudio().a, storage: kv, clock, dom: false });
    c.intent({ type: 'setting', patch: { animationSpeed: 2 } });
    c.intent({ type: 'continue' });
    await vi.advanceTimersByTimeAsync(50);
    expect(rb.last('setAnimationSpeed')).toBe(2);
    expect(c.hooks.metrics().maxCameraDegPerSec).toBe(31);
  });
});

describe('controller-owned sounds (UX.md §5.4)', () => {
  it('a rejected click plays a soft uiError at −12 dB', async () => {
    const kv = memoryKV();
    kv.set(SAVE_KEY, JSON.stringify({ v: 1, savedAt: 0, state: fixture({ ural: [0, 1] }) }));
    const rb = recordingBoard();
    const au = spyAudio();
    const c = createController({ board: rb.b, audio: au.a, storage: kv, clock, dom: false });
    c.intent({ type: 'continue' });
    await vi.advanceTimersByTimeAsync(50);
    rb.click('ural');
    expect(au.plays.find((p) => p.name === 'uiError')?.opts).toEqual({ volume: 0.25 });
  });
  it('turnStart only on human turns, bright after an AI turn', async () => {
    const rb = recordingBoard();
    const au = spyAudio();
    const c = createController({ board: rb.b, audio: au.a, storage: memoryKV(), clock, dom: false });
    c.hooks.newGame({
      players: [
        { name: 'John', color: 'crimson', kind: 'human' },
        { name: 'Cobalt', color: 'cobalt', kind: 'ai', difficulty: 'normal' },
      ],
      seed: 1,
      dominationPercent: 80,
      turnLimit: null,
    });
    // Let the AI play until it's John's turn at least twice.
    for (let i = 0; i < 400 && au.plays.filter((p) => p.name === 'turnStart').length < 2; i++) {
      const s = c.hooks.getState()!;
      if (s.players[s.currentPlayer].kind === 'human' && c.hooks.isIdle()) {
        c.hooks.dispatch({ type: 'endReinforce', player: 0 });
        const r = s.phase.kind === 'reinforce' ? (s.phase as { remaining: number }).remaining : 0;
        if (r > 0) {
          const t = (Object.keys(s.territories) as TerritoryId[]).find((x) => s.territories[x].owner === 0)!;
          c.hooks.dispatch({ type: 'reinforce', player: 0, territory: t, count: r });
          c.hooks.dispatch({ type: 'endReinforce', player: 0 });
        }
        c.hooks.dispatch({ type: 'endTurn', player: 0 });
      }
      await vi.advanceTimersByTimeAsync(200);
    }
    const starts = au.plays.filter((p) => p.name === 'turnStart');
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts[1].opts).toEqual({ variant: 'bright' });
    c.dispose();
  });
});

describe('ViewModel cadence and identity', () => {
  it('many changes in one frame → one notification; unchanged subtrees keep identity', async () => {
    const kv = memoryKV();
    kv.set(SAVE_KEY, JSON.stringify({ v: 1, savedAt: 0, state: fixture({ ural: [0, 5] }, { kind: 'reinforce', remaining: 5, mustTrade: false, placed: {}, midTurn: false }) }));
    const rb = recordingBoard();
    const c = createController({ board: rb.b, audio: spyAudio().a, storage: kv, clock, dom: false });
    c.intent({ type: 'continue' });
    await vi.advanceTimersByTimeAsync(3000);
    rb.click('ural');
    await vi.advanceTimersByTimeAsync(500);
    const seen: ViewModel[] = [];
    c.subscribe((vm) => seen.push(vm));
    const before = c.getViewModel();
    c.intent({ type: 'setCount', value: 2 });
    c.intent({ type: 'setCount', value: 3 });
    c.intent({ type: 'setCount', value: 4 });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen.length).toBe(1);
    const after = seen[0];
    expect(after.game!.strip).not.toBe(before.game!.strip);
    expect(after.game!.strip.count?.value).toBe(4);
    expect(after.game!.seats).toBe(before.game!.seats);
    expect(after.game!.log).toBe(before.game!.log);
    expect(after.newGame).toBe(before.newGame);
    expect(after.settings).toBe(before.settings);
    // Nothing changed → no notification at all.
    await vi.advanceTimersByTimeAsync(100);
    expect(seen.length).toBe(1);
  });
});

describe('new game screen memory', () => {
  it('remembers the last setup across sessions', () => {
    const kv = memoryKV();
    const c = createController({ board: recordingBoard().b, audio: spyAudio().a, storage: kv, clock, dom: false });
    c.intent({ type: 'seat', index: 0, patch: { name: 'John' } });
    c.intent({ type: 'length', value: 'quick' });
    c.intent({ type: 'setup', value: 'placeOwn' });
    c.intent({ type: 'removeSeat', index: 3 });
    const c2 = createController({ board: recordingBoard().b, audio: spyAudio().a, storage: kv, clock, dom: false });
    const ng = c2.getViewModel().newGame;
    expect(ng.seats.map((s) => s.name)).toEqual(['John', 'Cobalt', 'Amber']);
    expect(ng.length).toBe('quick');
    expect(ng.setup).toBe('placeOwn');
    expect(ng.summary).toBe('Territories dealt at random · you place your own armies · first to 26 territories, or most after 12 rounds');
  });
});

describe('banners (docs/SIMPLIFY.md §5)', () => {
  it("a human's continent capture: 'JOHN HOLDS AUSTRALIA · +2'; the turn banner reads '+N armies'", async () => {
    const kv = memoryKV();
    const s = fixture({ indonesia: [0, 2], new_guinea: [0, 12], western_australia: [0, 2] }, { kind: 'attack' });
    s.territories.eastern_australia = { owner: 2, armies: 1 };
    kv.set(SAVE_KEY, JSON.stringify({ v: 1, savedAt: 0, state: s }));
    const rb = recordingBoard();
    const c = createController({ board: rb.b, audio: spyAudio().a, storage: kv, clock, dom: false });
    c.intent({ type: 'continue' });
    await vi.advanceTimersByTimeAsync(50);
    // Resumed mid-attack: the turn banner names the seat, no stale army count.
    expect(c.getViewModel().game!.banner).toMatchObject({ kind: 'turn', title: "JOHN'S TURN", sub: '' });
    await vi.advanceTimersByTimeAsync(2000);
    const titles = new Set<string>();
    c.hooks.dispatch({ type: 'blitz', player: 0, from: 'new_guinea', to: 'eastern_australia', stopAt: 1 });
    await vi.advanceTimersByTimeAsync(4000);
    // The continent changes hands when the armies move in.
    const ph = c.hooks.getState()!.phase;
    if (ph.kind === 'occupy') c.hooks.dispatch({ type: 'occupy', player: 0, count: ph.min });
    for (let t = 0; t < 3000; t += 50) {
      const b = c.getViewModel().game?.banner;
      if (b) titles.add(b.title);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(c.hooks.getState()!.territories.eastern_australia.owner).toBe(0);
    expect([...titles]).toContain('JOHN HOLDS AUSTRALIA · +2');
    c.dispose();
  });
});
