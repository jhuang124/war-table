// Couch-monkey fuzz of the controller in Node: whole games under fake timers against a fake board
// whose playEvent takes the modelled 1× durations, driven by a seeded stream of the inputs real people
// produce — legal and nonsense board clicks, double clicks, every button and Turn Track segment (legal,
// locked and past), key spam, menu and settings
// flips mid-animation, seat hand-offs, Save & quit → Continue, End game / Restart / Rematch at odd
// moments, and "hidden tab" stretches (board animations and rAF stop, timers keep running).
//
// Watchdogs: any console.error / thrown input, a human turn that never settles, a settled human turn
// with nothing to click, an AI turn that stops moving, and the board/HUD disagreeing with the engine
// once everything has settled. MONKEY_GAMES=n (default 3) / MONKEY_FIRST=seed for longer soaks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERRITORY_IDS, territoryCount, type GameState, type PlayerConfig, type TerritoryId } from '../../src/engine';
import type { AudioEngine } from '../../src/audio/types';
import type { BoardView, TerritoryPointerInfo } from '../../src/render/BoardView';
import { createController, type GameController } from '../../src/game/controller';
import { memoryKV } from '../../src/game/storage';
import { eventDurationMs, scaledDuration } from '../../src/game/timingModel';
import type { ButtonId, TrackSegId, UiIntent } from '../../src/game/viewModel';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A board that animates on (fake) time, can be "hidden" (rAF stops), and has the real board's 9 s watchdog. */
function monkeyBoard() {
  let speed = 1;
  let hidden = false;
  const pending = new Set<{ done: () => void; left: number; last: number; timer: ReturnType<typeof setTimeout> | null }>();
  let click: ((i: TerritoryPointerInfo) => void) | null = null;
  let synced: GameState | null = null;
  const arm = (p: { done: () => void; left: number; last: number; timer: ReturnType<typeof setTimeout> | null }) => {
    p.last = Date.now();
    p.timer = setTimeout(p.done, p.left);
  };
  const b: BoardView = {
    syncState: (s) => void (synced = s),
    playEvent(ev, _after, opts) {
      const ms = scaledDuration(eventDurationMs(ev, opts), speed);
      if (ms <= 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const p = {
          left: ms,
          last: 0,
          timer: null as ReturnType<typeof setTimeout> | null,
          done: () => {
            if (!pending.has(p)) return;
            pending.delete(p);
            if (p.timer) clearTimeout(p.timer);
            clearTimeout(dog);
            resolve();
          },
        };
        // src/render/index.ts: nothing may hang the queue (skipRun at 9 s, resolve 50 ms later).
        const dog = setTimeout(() => setTimeout(p.done, 50), 9000);
        pending.add(p);
        if (!hidden) arm(p);
      });
    },
    setAnimationSpeed: (m) => void (speed = m),
    skipAnimations: () => {
      for (const p of [...pending]) p.done();
    },
    setHighlights: () => undefined,
    onTerritoryClick: (cb) => void (click = cb),
    onTerritoryHover: () => undefined,
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
    click: (i: TerritoryPointerInfo) => click?.(i),
    get synced() {
      return synced;
    },
    setHidden(h: boolean) {
      if (h === hidden) return;
      hidden = h;
      for (const p of pending) {
        if (h && p.timer) {
          clearTimeout(p.timer);
          p.timer = null;
          p.left = Math.max(1, p.left - (Date.now() - p.last));
        } else if (!h) arm(p);
      }
    },
    get hidden() {
      return hidden;
    },
  };
}

const silentAudio: AudioEngine = {
  unlock: () => undefined,
  play: () => undefined,
  setVolume: () => undefined,
  setMuted: () => undefined,
  setMusic: () => undefined,
  setMusicVolume: () => undefined,
  stopAll: () => undefined,
  isUnlocked: () => false,
  stats: () => ({ state: 'locked', voices: 0, voicesByName: {}, played: 0, dropped: 0, stolen: 0, music: false }) as unknown as ReturnType<AudioEngine['stats']>,
  dispose: () => undefined,
};

type Mode = '1h3ai' | '2h' | '3h' | '4h' | '2h2ai';
const MODES: Mode[] = ['1h3ai', '2h', '2h2ai', '3h', '4h'];
function seats(mode: Mode): PlayerConfig[] {
  const kinds: ('human' | 'ai')[] =
    mode === '1h3ai' ? ['human', 'ai', 'ai', 'ai'] : mode === '2h' ? ['human', 'human'] : mode === '3h' ? ['human', 'human', 'human'] : mode === '4h' ? ['human', 'human', 'human', 'human'] : ['human', 'ai', 'human', 'ai'];
  const colors = ['crimson', 'cobalt', 'amber', 'rose'] as const;
  return kinds.map((k, i) => ({ name: ['John', 'Sam', 'Ana', 'Lee'][i], color: colors[i], kind: k, ...(k === 'ai' ? { difficulty: 'normal' as const } : {}) }));
}

const BUTTONS: ButtonId[] = ['place', 'undo', 'trade', 'cards', 'blitz', 'roll', 'move', 'watchAis', 'callGame'];
const SEGS: TrackSegId[] = ['place', 'attack', 'fortify', 'endTurn', 'setup', 'done'];
const KEYS = ['Enter', 'Enter', ' ', ' ', 'Escape', 'Escape', 'e', 'E', 'b', '1', '2', '3', 'Tab', 'f', '?', 'l', 'm'];

export interface MonkeyResult {
  finished: boolean;
  failure: string | null;
  inputs: number;
  log: string[];
  turn: number;
}

export async function monkeyGame(seed: number, opts: { maxFakeMinutes?: number; mode?: Mode } = {}): Promise<MonkeyResult> {
  const R = rng(seed * 7919 + 13);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];
  const mode = opts.mode ?? MODES[seed % MODES.length];
  const kv = memoryKV();
  kv.set('risk3d.settings.v1', JSON.stringify({ animationSpeed: 1, aiSpeed: 'watch', hideCardsBetweenTurns: mode !== '1h3ai' && R() < 0.6 }));
  let fb = monkeyBoard();
  const rafHeld: (() => void)[] = [];
  // A controller that keeps re-arming timers without time passing is a busy loop in a real browser.
  let stormAt = -1;
  let stormN = 0;
  let storm = null as string | null;
  // One clock per page: a reload kills the old page's timers the way the browser does.
  const pageClock = () => {
    let dead = false;
    return {
      kill: () => void (dead = true),
      now: () => Date.now(),
      setTimeout: (fn: () => void, ms: number) => {
        if (dead) return null;
        if (Date.now() !== stormAt) {
          stormAt = Date.now();
          stormN = 0;
        }
        if (++stormN > 5000) {
          storm ??= `timer storm: ${stormN} timers armed at t=${stormAt} without time passing\n${new Error().stack}`;
          return null;
        }
        return setTimeout(() => {
          if (!dead) fn();
        }, ms);
      },
      clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
      raf: (fn: () => void) => {
        if (dead) return;
        if (fb.hidden) rafHeld.push(fn);
        else setTimeout(() => !dead && fn(), 16);
      },
    };
  };
  let clock = pageClock();
  const errors: string[] = [];
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' '));
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let c: GameController = createController({ board: fb.board, audio: silentAudio, storage: kv, clock, dom: false, prefersReducedMotion: () => false });
  const log: string[] = [];
  const t0 = Date.now();
  const note = (s: string) => {
    log.push(`${((Date.now() - t0) / 1000).toFixed(2)}s ${s}`);
    if (log.length > 300) log.shift();
  };
  const turnLimit = 4 + Math.floor(R() * 4);
  const manual = R() < 0.25;
  c.hooks.newGame({ players: seats(mode), seed, dominationPercent: 60, turnLimit, initialPlacement: manual ? 'manual' : 'auto' });
  note(`start seed=${seed} mode=${mode} turnLimit=${turnLimit} manual=${manual}`);

  const vm = () => c.getViewModel();
  const st = () => c.hooks.getState();
  const humanTurn = () => {
    const s = st();
    return !!s && s.phase.kind !== 'game-over' && s.players[s.currentPlayer].kind === 'human';
  };
  const clickable = () => {
    const s = st();
    if (!s) return [] as TerritoryId[];
    return TERRITORY_IDS.filter((t) => c.hooks.explain(t).ok);
  };
  const clickT = (t: TerritoryId, button = 0, mods: Partial<TerritoryPointerInfo> = {}) =>
    fb.click({ territory: t, clientX: 0, clientY: 0, shiftKey: false, altKey: false, metaKey: false, button, ...mods });
  const send = (i: UiIntent) => c.intent(i);

  let inputs = 0;
  let failure: string | null = null;
  const fail = (why: string) => {
    if (!failure) failure = why;
  };

  async function wait(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  async function act(progressBias: number) {
    inputs++;
    const r = R();
    const g = vm().game;
    if (r < progressBias) {
      // Legal progress: the brass thing (Enter), a forward track segment, a legal click, or the
      // action zone's buttons.
      const k = pick(['Enter', 'track', 'legal', 'legal', 'legal', 'button']);
      if (k === 'track') {
        const tr = g?.strip.track;
        const fwd = tr?.segments.filter((x) => x.state === 'eligible') ?? [];
        if (fwd.length) {
          const seg = R() < 0.5 && tr!.recommended ? tr!.recommended : pick(fwd).id;
          note(`progress track ${seg}`);
          send({ type: 'track', seg });
        }
      } else if (k === 'button') {
        const shown = g?.strip.buttons ?? [];
        if (shown.length) {
          const b = shown.find((x) => x.primary) ?? pick(shown);
          note(`progress button ${b.id}`);
          send({ type: 'button', id: b.id });
        }
      } else if (k === 'legal') {
        const cl = clickable();
        if (cl.length) {
          const t = pick(cl);
          note(`progress click ${t}`);
          clickT(t);
        }
      } else {
        note(`progress key ${k}`);
        c.handleKey(k);
      }
      return;
    }
    const x = R();
    if (x < 0.28) {
      const cl = clickable();
      if (!cl.length) return;
      const t = pick(cl);
      const dbl = R() < 0.15;
      const mods = R() < 0.1 ? (R() < 0.5 ? { shiftKey: true } : { altKey: true }) : {};
      note(`legal ${dbl ? 'dbl' : ''}click ${t} ${JSON.stringify(mods)}`);
      clickT(t, 0, mods);
      if (dbl) {
        await wait(Math.floor(R() * 40));
        clickT(t, 0, mods);
      }
    } else if (x < 0.4) {
      const t = pick(TERRITORY_IDS);
      const right = R() < 0.3;
      note(`random ${right ? 'right' : ''}click ${t}`);
      clickT(t, right ? 2 : 0);
    } else if (x < 0.52) {
      const bar = g?.strip;
      const shown = bar?.buttons.map((b) => b.id) ?? [];
      const id = R() < 0.75 && shown.length ? pick(shown) : pick(BUTTONS);
      const twice = R() < 0.15;
      note(`button ${id}${twice ? ' x2' : ''}`);
      send({ type: 'button', id });
      if (twice) {
        await wait(Math.floor(R() * 30));
        send({ type: 'button', id });
      }
    } else if (x < 0.58) {
      // Any track segment: forward, locked, past, current, or one that isn't on this track at all.
      const segs = g?.strip.track.segments.map((s) => s.id) ?? [];
      const seg = R() < 0.7 && segs.length ? pick(segs) : pick(SEGS);
      const twice = R() < 0.15;
      note(`track ${seg}${twice ? ' x2' : ''}`);
      send({ type: 'track', seg });
      if (twice) {
        await wait(Math.floor(R() * 30));
        send({ type: 'track', seg });
      }
    } else if (x < 0.74) {
      const k = pick(KEYS);
      note(`key ${JSON.stringify(k)}`);
      c.handleKey(k, R() < 0.1);
    } else if (x < 0.8) {
      note('burst');
      for (let i = 0; i < 4 + Math.floor(R() * 10); i++) {
        const y = R();
        if (y < 0.35) {
          const cl = clickable();
          const t = cl.length && y < 0.25 ? pick(cl) : pick(TERRITORY_IDS);
          clickT(t);
        } else if (y < 0.7) c.handleKey(pick(['Enter', ' ', 'e', 'b', 'Escape']));
        else if (y < 0.85) send({ type: 'button', id: pick(BUTTONS) });
        else send({ type: 'track', seg: pick(SEGS) });
        if (R() < 0.5) await wait(Math.floor(R() * 25));
      }
    } else if (x < 0.86) {
      // HUD bits: pills, counters, dice, cards, log, hints, seat highlight, banner dismiss.
      const which = Math.floor(R() * 10);
      const s = st();
      const hand = s ? s.players[s.currentPlayer].cards : [];
      const intents: UiIntent[] = [
        { type: 'setCount', value: Math.floor(R() * 12) - 1 },
        { type: 'setCount', value: Math.floor(R() * 30) },
        { type: 'cardsPanel', open: R() < 0.6 },
        { type: 'cardsPanel', open: false },
        { type: 'dismissTurnBanner' },
        { type: 'dismissTurnBanner' },
        { type: 'setting', patch: { aiSpeed: R() < 0.8 ? 'watch' : pick(['fast', 'instant'] as const) } },
        { type: 'setting', patch: { animationSpeed: pick([0, 1, 2] as const) } },
        { type: 'overlay', overlay: R() < 0.5 ? 'pause' : null },
        { type: 'overlay', overlay: null },
      ];
      const i = intents[which];
      note(`intent ${JSON.stringify(i)}`);
      send(i);
    } else if (x < 0.91) {
      // Menus and settings mid-anything.
      const y = R();
      if (y < 0.3) {
        note('pause menu');
        c.handleKey('Escape');
        await wait(Math.floor(R() * 600));
        const z = R();
        if (z < 0.4) {
          const patch = pick([
            { animationSpeed: pick([0, 1, 2] as const) },
            { textSize: pick(['laptop', 'couch', 'tv'] as const) },
            { reduceMotion: R() < 0.5 },
            { hideCardsBetweenTurns: R() < 0.5 },
            { showWinChance: R() < 0.5 },
            { autoCamera: R() < 0.5 },
          ]);
          note(`settings ${JSON.stringify(patch)}`);
          send({ type: 'overlay', overlay: 'settings' });
          send({ type: 'setting', patch: patch as never });
          await wait(Math.floor(R() * 300));
        } else if (z < 0.5) {
          note('rules');
          send({ type: 'overlay', overlay: 'rules' });
          await wait(Math.floor(R() * 300));
        } else if (z < 0.6) {
          const s = st();
          if (s) {
            const p = Math.floor(R() * s.players.length);
            const pl = s.players[p];
            const kind = pl.kind === 'ai' ? 'human' : 'ai';
            // Only seats that started human can be handed back (the pause menu offers nothing else).
            if (kind === 'ai' || s.config.players[p].kind === 'human') {
              note(`seat ${p} → ${kind}`);
              send({ type: 'setController', player: p, kind, difficulty: 'normal' });
            }
          }
        }
        note('resume');
        send({ type: 'overlay', overlay: null });
      } else if (y < 0.45) {
        note('? rules');
        c.handleKey('?');
        await wait(Math.floor(R() * 400));
        c.handleKey('Escape');
        send({ type: 'overlay', overlay: null });
      } else if (y < 0.55) {
        const patch = pick([{ animationSpeed: pick([0, 1, 2] as const) }, { reduceMotion: R() < 0.5 }, { hideCardsBetweenTurns: R() < 0.5 }, { textSize: pick(['laptop', 'couch', 'tv'] as const) }]);
        note(`setting ${JSON.stringify(patch)}`);
        send({ type: 'setting', patch: patch as never });
      } else if (y < 0.63) {
        // Reload the page (a new controller on the same storage), then Continue like a player would.
        if (st()?.phase.kind === 'game-over') return; // the save is gone once the game is decided
        note('reload → continue');
        c.dispose();
        clock.kill();
        clock = pageClock();
        fb = monkeyBoard();
        c = createController({ board: fb.board, audio: silentAudio, storage: kv, clock, dom: false, prefersReducedMotion: () => false });
        await wait(100 + Math.floor(R() * 600));
        if (!vm().save) {
          fail('reload left no save to continue');
          return;
        }
        send({ type: 'continue' });
        if (vm().screen !== 'game') fail(`Continue after reload went to ${vm().screen}`);
      } else if (y < 0.75) {
        note('hide tab');
        fb.setHidden(true);
        await wait(500 + Math.floor(R() * 12000));
        fb.setHidden(false);
        for (const f of rafHeld.splice(0)) setTimeout(f, 16);
        note('show tab');
      } else if (y < 0.85) {
        note('save & quit → continue');
        send({ type: 'overlay', overlay: 'pause' });
        send({ type: 'saveAndQuit' });
        await wait(Math.floor(R() * 800));
        if (!vm().save) fail('Save & quit left no save to continue');
        else send({ type: 'continue' });
      } else if (y < 0.9) {
        note('restart → confirm');
        send({ type: 'overlay', overlay: 'pause' });
        send({ type: 'restart' });
        await wait(Math.floor(R() * 300));
        send({ type: 'confirm', yes: R() < 0.3 });
      } else {
        note('end game now → maybe');
        send({ type: 'overlay', overlay: 'pause' });
        send({ type: 'endGameNow' });
        await wait(Math.floor(R() * 300));
        send({ type: 'confirm', yes: R() < 0.15 });
      }
    } else {
      note('handoff accept / nothing');
      send({ type: 'handoffAccept' });
    }
  }

  const deadline = t0 + (opts.maxFakeMinutes ?? 60) * 60_000;
  let lastKey = '';
  let lastKeyAt = Date.now();
  let stuckSince = 0;
  let finished = false;
  let quietEvery = 20 + Math.floor(R() * 20);
  try {
    while (Date.now() < deadline && !failure) {
      if (storm) {
        fail(storm.slice(0, 1500));
        break;
      }
      if (errors.length) {
        fail('console.error: ' + errors[0].slice(0, 800));
        break;
      }
      const v = vm();
      if (v.screen === 'victory') {
        finished = true;
        note('victory');
        break;
      }
      if (v.screen === 'title') {
        if (!v.save) {
          fail('title screen with no save to continue');
          break;
        }
        note('title → continue');
        send({ type: 'continue' });
        await wait(100);
        continue;
      }
      if (v.screen !== 'game') {
        fail(`unexpected screen ${v.screen}`);
        break;
      }
      const s = st()!;
      const g = v.game!;
      const key = `${s.turn}:${s.currentPlayer}:${JSON.stringify(s.phase)}:${TERRITORY_IDS.map((t) => s.territories[t].owner * 1000 + s.territories[t].armies).join(',')}`;
      const now = Date.now();
      if (key !== lastKey) {
        lastKey = key;
        lastKeyAt = now;
      }
      const blocked = !!v.overlay || !!g.confirm || !!g.handoff || fb.hidden;
      if (blocked) lastKeyAt = now; // a paused game (menu, confirm, cover, hidden tab) is not a frozen one
      if (!humanTurn() && !blocked && now - lastKeyAt > 30_000) {
        fail(`AI turn frozen for 30 s (phase ${s.phase.kind}, player ${s.currentPlayer}, idle ${c.hooks.isIdle()})`);
        break;
      }
      if (humanTurn() && !blocked && c.hooks.isIdle()) {
        const tr = g.strip.track;
        const anyButton = g.strip.buttons.some((b) => !b.busy) || (tr.live && !tr.disabled && tr.segments.some((x) => x.state === 'eligible'));
        if (!anyButton && clickable().length === 0) {
          if (!stuckSince) stuckSince = now;
          if (now - stuckSince > 3000) {
            fail(`stuck: human turn (${s.phase.kind}), idle, nothing enabled and nothing clickable · line "${g.strip.line}"`);
            break;
          }
        } else stuckSince = 0;
      } else stuckSince = 0;
      if (g.handoff) {
        await wait(200 + Math.floor(R() * 800));
        if (R() < 0.8) {
          note('handoff accept');
          send({ type: 'handoffAccept' });
        } else await act(0);
        continue;
      }
      if (humanTurn() && !blocked && inputs >= quietEvery) {
        // A quiet moment: everyone looks at the board. It must settle, and agree with the engine.
        quietEvery = inputs + 20 + Math.floor(R() * 30);
        let settled = false;
        for (let i = 0; i < 300 && !settled; i++) {
          await wait(50);
          settled = c.hooks.isIdle() || !humanTurn() || !!vm().game?.handoff;
        }
        if (!settled) {
          fail(`human turn did not settle within 15 s of the last input (phase ${st()?.phase.kind})`);
          break;
        }
        await wait(400);
        const s2 = st();
        const v2 = vm();
        if (humanTurn() && c.hooks.isIdle() && s2 && v2.screen === 'game' && !v2.overlay) {
          const b = fb.synced;
          if (b) {
            const bad = TERRITORY_IDS.filter((t) => b.territories[t].owner !== s2.territories[t].owner || b.territories[t].armies !== s2.territories[t].armies);
            if (bad.length) {
              fail(`board drift after settle: ${bad.slice(0, 4).map((t) => `${t} board ${b.territories[t].owner}/${b.territories[t].armies} vs ${s2.territories[t].owner}/${s2.territories[t].armies}`).join('; ')}`);
              break;
            }
          }
          for (const row of v2.game!.seats) {
            const n = territoryCount(s2, row.seat.id);
            if (!row.eliminated && row.territories !== n) {
              fail(`roster drift: ${row.seat.name} shows ${row.territories} territories, engine ${n}`);
              break;
            }
          }
          if (v2.game!.strip.mode === 'watching') fail('human turn settled but the action bar says watching');
        }
        continue;
      }
      // Humans click a lot; during AI turns people mostly watch but still poke.
      const bias = Date.now() - t0 > 20 * 60_000 ? 0.6 : 0.12;
      if (humanTurn() || R() < 0.25) await act(bias);
      await wait(humanTurn() ? Math.floor(R() * 180) : 100 + Math.floor(R() * 500));
    }
    if (!finished && !failure) fail(`game did not finish in ${opts.maxFakeMinutes ?? 60} fake minutes (round ${st()?.round})`);
  } catch (e) {
    fail('input threw: ' + String((e as Error).stack ?? e));
  } finally {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    c.dispose();
  }
  if (errors.length && !failure) failure = 'console.error: ' + errors[0].slice(0, 800);
  return { finished, failure, inputs, log, turn: st()?.turn ?? -1 };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

const GAMES = Number(process.env.MONKEY_GAMES ?? 3);
const FIRST = Number(process.env.MONKEY_FIRST ?? 1);

describe('couch monkey (controller fuzz)', () => {
  for (let seed = FIRST; seed < FIRST + GAMES; seed++) {
    it(`seed ${seed} plays to the end with no crash, hang or drift`, async () => {
      const r = await monkeyGame(seed);
      if (process.env.MONKEY_VERBOSE) console.log(`seed ${seed}: ${r.inputs} inputs, turn ${r.turn}, ${r.log[r.log.length - 1]}`);
      if (r.failure) console.log(`seed ${seed} FAILED: ${r.failure}\n  ` + r.log.slice(-30).join('\n  '));
      expect(r.failure).toBeNull();
      expect(r.finished).toBe(true);
    }, 300_000);
  }
});
