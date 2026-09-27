// The game controller (SPEC §7 Controller, UX.md [ctrl]).
//
// Owns the GameState, applies actions through the engine, queues the resulting events and plays them
// on the board one at a time, keeps a *displayed* state that follows the board (no spoilers), runs the
// input state machine and the keyboard map, drives the AI as a highlight reel, writes every line of
// copy into the ViewModel, autosaves, and exposes the window.__risk hooks.
//
// Flow:  input/AI → applyAction → queue entries {event, stateAfter}
//        → pump: board.playEvent (blocking events awaited, non-blocking fired) → display delta + HUD
//        → queue empty: pending click-through inputs run; all settled: syncState, next AI beat.

import {
  CONTINENTS,
  TERRITORIES,
  TERRITORY_IDS,
  UNCLAIMED,
  applyAction,
  attackSources,
  attackTargets,
  chooseAiAction,
  cloneState,
  continentsOwned,
  createGame,
  fallbackAction,
  fortifyPath,
  fortifySources,
  fortifyTargets,
  isValidSetSymbols,
  maxAttackDice,
  reinforcementsFor,
  setValue,
  territoriesNeeded,
  territoryCount,
  totalArmies,
  upcomingSetValues,
  validateConfig,
  winProbability,
  type Action,
  type ActionResult,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerConfig,
  type PlayerId,
  type ReinforcementBreakdown,
  type TerritoryId,
} from '../engine';
import type { AudioEngine, PlayOptions, SfxName } from '../audio/types';
import type { BoardHighlights, BoardView, PlayEventOptions, TerritoryPointerInfo, ViewportInsets } from '../render/BoardView';
import { baseReceipt, buildActionBar, emptySel, selectionTargets, stagedTotal, type Sel } from './actionBar';
import { CONTINENT_ABBR, MINUS, SEP, cName, mergeBannerTitle, pName, pct, poss, seatRef, tName, upper } from './copy';
import { applyEventToDisplay, isBlocking } from './display';
import { clickableTerritories, explainTerritory, type ClickPlan, type ExplainUi, type Explanation } from './explain';
import { attackStakes, autoChain, bestSet, noSetStatus, occupyDefault, oddsLabel, oddsWord } from './helpers';
import {
  addSeat,
  buildNewGameVM,
  defaultDraft,
  draftToConfig,
  lengthRules,
  patchSeat,
  removeSeat,
  sanitizeDraft,
  type NewGameDraft,
} from './presets';
import { reconcile } from './reconcile';
import {
  buildAwards,
  buildRecap,
  emptyAwards,
  recordAward,
  recordRecap,
  type AwardLedger,
  type RecapLedger,
} from './recap';
import {
  DEFAULT_SETTINGS,
  SAVE_KEY,
  SETTINGS_KEY,
  TEXT_SCALE,
  UI_KEY,
  browserKV,
  isPlausibleState,
  readJson,
  sanitizeSettings,
  writeJson,
  type KV,
  type SaveFile,
} from './storage';
import type {
  AiSpeed,
  BannerVM,
  BattleVM,
  ButtonId,
  ButtonVM,
  CardsVM,
  ControllerApi,
  GameVM,
  LogLineVM,
  Overlay,
  PillsVM,
  RosterRowVM,
  Screen,
  SeatRef,
  Settings,
  ToastVM,
  TooltipVM,
  TopBarVM,
  TurnBannerVM,
  UiIntent,
  ViewModel,
  VictoryVM,
} from './viewModel';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  raf(fn: () => void): void;
}

export interface ControllerOptions {
  board: BoardView;
  audio: AudioEngine;
  storage?: KV;
  clock?: Clock;
  /** Install window listeners (keyboard map, click metrics). Default: true when `window` exists. */
  dom?: boolean;
  /** OS-level reduced motion; default reads matchMedia. */
  prefersReducedMotion?: () => boolean;
  /**
   * Also handle menu/overlay keys (Esc on overlays and confirms, Enter on the hand-off, title, new game
   * and victory). Off when src/ui is mounted (it owns those); on for the fallback debug HUD.
   */
  menuKeys?: boolean;
}

export interface TurnMetric {
  player: PlayerId;
  kind: 'human' | 'ai';
  ms: number;
  clicks: number;
  rejected: number;
  forcedWaitMs: number;
}

export interface RollMetric {
  blitz: boolean;
  count: number;
  ms: number;
  style: 'full' | 'brief';
}

export interface Metrics {
  turns: TurnMetric[];
  rolls: RollMetric[];
  maxCameraDegPerSec: number;
  cameraMovesDuringHumanInput: number;
  inputDropped: number;
}

export interface UiSnapshot {
  screen: string;
  actionBarText: string;
  actionBarSub: string;
  primary: string | null;
  buttons: { label: string; enabled: boolean; why?: string }[];
  banners: string[];
  toasts: string[];
  battle: { header: string; odds: string | null; stakes: string[]; result: string | null } | null;
  recap: string[];
  tooltip: string | null;
  hints: boolean;
}

export interface RiskHooks {
  getState(): GameState | null;
  newGame(config?: Partial<GameConfig> & { players?: PlayerConfig[] }): void;
  dispatch(action: Action): { ok: boolean; error?: string };
  isIdle(): boolean;
  waitIdle(timeoutMs?: number): Promise<void>;
  setSpeed(animation: number, ai?: AiSpeed): void;
  autoplay(on: boolean): void;
  screenPos(t: TerritoryId): { x: number; y: number } | null;
  stats(): ReturnType<BoardView['getStats']>;
  ui(): UiSnapshot;
  explain(t: TerritoryId): { ok: boolean; code?: string; text: string };
  metrics(): Metrics;
  resetMetrics(): void;
}

export interface GameController extends ControllerApi {
  hooks: RiskHooks;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Entry {
  ev: GameEvent;
  after: GameState;
  /** Last event of its action: the display snaps to `after`. */
  end: boolean;
  opts?: PlayEventOptions;
  beat: number;
  /** HUD only, no board animation (instant AI turns). */
  skip?: boolean;
  /** Stagger before firing (AI placement beats). */
  delayMs?: number;
  ai: boolean;
  /** Board speed for this entry (compressed AI-vs-AI engagements); default = the seat's speed. */
  speed?: number;
}

interface Engagement {
  attacker: PlayerId;
  defender: PlayerId;
  from: TerritoryId;
  to: TerritoryId;
  startA: number;
  startD: number;
  rolls: number;
  attLost: number;
  defLost: number;
  blitz: boolean;
  winP: number;
  style: 'full' | 'brief';
  conquered: boolean;
  startedAt: number;
  lastRollEnd: number;
  logId: number;
  lastResult: string | null;
  tie: boolean;
  endedAt: number | null;
  turn: number;
  details: string[];
}

interface BannerItem {
  vm: BannerVM;
  createdAt: number;
  aiTurn: number | null;
  parts: { subject: string; predicate: string }[] | null;
  sound?: { name: SfxName; opts?: PlayOptions };
}

interface AiTurnCtx {
  key: string;
  player: PlayerId;
  startedAt: number;
  first: boolean;
  /** AI-vs-AI engagements played this turn (headline compression from the 3rd). */
  briefCount: number;
  /** Past the cap: the rest of the turn plays at instant. */
  capped: boolean;
  /** 10 s normally; 5 s for opening turns before any human has played (Start → first click ≤ 20 s). */
  capMs: number;
  headlineMs: number;
  /** The n-th AI-vs-AI engagement of the turn from which they play at 2×. */
  compressFrom: number;
}

interface GameMeta {
  id: string;
  hints: Record<number, boolean>;
  setHintSeen: number[];
  recap: RecapLedger;
  awards: AwardLedger;
  log: LogLineVM[];
  logId: number;
  nearGoal: number[];
  finalRoundShown: boolean;
  elimRound: Record<number, number>;
  sel: Sel;
  lastTurnKind: 'human' | 'ai' | null;
  tradedThisTurn: number;
  knockout: { by: PlayerId; victim: string; cards: number } | null;
}

interface UiFile {
  v: 1;
  lastSetup?: NewGameDraft;
  game?: GameMeta;
}

const defaultClock = (): Clock => ({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  raf: (fn) => {
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => fn());
    else setTimeout(fn, 16);
  },
});

const THINK_TURN_START = 350;
const THINK_BETWEEN = 200;
/** Between AI-vs-AI engagements once they run compressed (the 3rd+ in a turn, or past the headline point). */
const THINK_BETWEEN_COMPRESSED = 140;
/** The beat after a snapped AI-vs-AI conquest (a human's instant speed keeps 250 ms, UX.md §8.2). */
const SNAP_BEAT_MS = 170;
const AI_TURN_CAP_MS = 10_000;
/** Past this point in an AI turn, AI-vs-AI engagements snap; fights against a human keep their weight. */
const AI_HEADLINE_MS = 6_000;
/** Round-1 AI turns before any human has moved: nothing is at stake yet, so they stay short. */
const AI_OPENING_CAP_MS = 5_000;
const TELEGRAPH_MS = 400;
const PLAY_SAFETY_MS = 15_000;
const LOG_CAP = 300;

function freshMeta(id: string, s: GameState): GameMeta {
  const hints: Record<number, boolean> = {};
  for (const p of s.players) hints[p.id] = true;
  return {
    id,
    hints,
    setHintSeen: [],
    recap: {},
    awards: emptyAwards(),
    log: [],
    logId: 1,
    nearGoal: [],
    finalRoundShown: false,
    elimRound: {},
    sel: emptySel(),
    lastTurnKind: null,
    tradedThisTurn: 0,
    knockout: null,
  };
}

function isAttackAction(a: Action): a is Extract<Action, { type: 'attack' | 'blitz' }> {
  return a.type === 'attack' || a.type === 'blitz';
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class Controller {
  readonly board: BoardView;
  readonly audio: AudioEngine;
  private kv: KV;
  private clock: Clock;
  private prefersReduced: () => boolean;
  private menuKeys: boolean;
  private disposers: (() => void)[] = [];

  // App
  private screen: Screen = 'title';
  private overlay: Overlay = null;
  private overlayReturn: Overlay = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private draft: NewGameDraft = defaultDraft();
  private saveSummary: { summary: string } | null = null;
  private sessionAiSpeed: AiSpeed | null = null;
  private autoplayOn = false;

  // Game
  private state: GameState | null = null;
  private disp: GameState | null = null;
  private meta: GameMeta | null = null;
  private sel: Sel = emptySel();
  private frozenSel: Sel | null = null;
  private victory: VictoryVM | null = null;
  private confirm: GameVM['confirm'] = null;
  private allHumansOut = false;
  private allHumansOutDismissed = false;
  private seatHighlight: PlayerId | null = null;
  private cardsOpen = false;
  private logOpen = false;

  // Queue
  private queue: Entry[] = [];
  private pumping = false;
  private blockingNow: Entry | null = null;
  private inflight = 0;
  private skipAll = false;
  private skipBeat: number | null = null;
  private beat = 1;
  private currentBeat = 0;
  private boardStale = false;
  private pendingInputs: { fn: () => void; at: number }[] = [];
  private sleepers = new Set<() => void>();
  private handoff: { player: PlayerId } | null = null;
  private rolling = false;
  /** Bumps on every new/loaded game so stale async work drops out. */
  private epoch = 0;

  // AI
  private aiBusy = false;
  private aiCtx: AiTurnCtx | null = null;
  private aiHighlights: BoardHighlights | null = null;
  private aiPreview: { from: TerritoryId; to: TerritoryId } | null = null;
  private narration: string | null = null;
  private aiScheduled = false;
  /** A human seat has started a main turn this game (ends the short "opening" AI turns). */
  private humanHasPlayed = false;

  // Presentation
  private eng: Engagement | null = null;
  private banner: BannerItem | null = null;
  private bannerQueue: BannerItem[] = [];
  private bannerNextAt = 0;
  private bannerTimer: unknown = null;
  private toasts: { vm: ToastVM; until: number }[] = [];
  private toastQueue: ToastVM[] = [];
  private turnBanner: TurnBannerVM | null = null;
  private turnBannerTimer: unknown = null;
  private idSeq = 1;
  private rejection: { text: string; key: number; until: number; code: string } | null = null;
  private rejectCounts = new Map<string, number>();
  private lineKey = 0;
  private hover: { t: TerritoryId; x: number; y: number; visible: boolean } | null = null;
  private hoverTimer: unknown = null;
  private kbFocus: TerritoryId | null = null;
  private nextSetValue = 0;
  private nextSetPulse = 0;
  private lastHighlightsKey = '';
  private insets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0, trayBand: 0 };

  // Timing guards
  private guardUntil = 0;
  private holdUntil = 0;
  private spaceGuardUntil = 0;

  // Metrics
  private metricTurns: TurnMetric[] = [];
  private curTurn: (TurnMetric & { start: number }) | null = null;
  private metricRolls: RollMetric[] = [];
  private inputDropped = 0;
  private cameraMovesDuringHumanInput = 0;
  private lastCameraMoving = false;
  private humanInputSince = 0;
  private pointerActiveUntil = 0;

  // VM
  private vm: ViewModel;
  private dirty = true;
  private rafPending = false;
  private subs = new Set<(vm: ViewModel) => void>();
  private lastNotified: ViewModel | null = null;
  private lastBoardSpeed = -1;

  constructor(opts: ControllerOptions) {
    this.board = opts.board;
    this.audio = opts.audio;
    this.kv = opts.storage ?? browserKV();
    this.clock = opts.clock ?? defaultClock();
    this.prefersReduced =
      opts.prefersReducedMotion ??
      (() => {
        try {
          return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
          return false;
        }
      });
    this.menuKeys = opts.menuKeys ?? false;
    this.settings = sanitizeSettings(readJson(this.kv, SETTINGS_KEY));
    const ui = readJson<UiFile>(this.kv, UI_KEY);
    if (ui?.lastSetup) this.draft = sanitizeDraft(ui.lastSetup);
    this.refreshSaveSummary();

    this.board.onTerritoryClick((info) => this.onBoardClick(info));
    this.board.onTerritoryHover((info) => this.onBoardHover(info));
    this.applySettingsToBoard();
    this.board.setAttractMode(true);
    this.vm = this.buildVM();

    const dom = opts.dom ?? typeof window !== 'undefined';
    if (dom && typeof window !== 'undefined') this.installDom();
    this.sampleCamera();
  }

  // =========================================================================
  // Timers & scheduling
  // =========================================================================

  private now(): number {
    return this.clock.now();
  }

  private timer(fn: () => void, ms: number): unknown {
    return this.clock.setTimeout(fn, Math.max(0, ms));
  }

  /** Cancellable sleep: skip() wakes every sleeper. */
  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.sleepers.delete(finish);
        resolve();
      };
      this.sleepers.add(finish);
      this.timer(finish, ms);
    });
  }

  private wakeAll(): void {
    for (const w of [...this.sleepers]) w();
  }

  invalidate(): void {
    this.dirty = true;
    if (this.rafPending) return;
    this.rafPending = true;
    this.clock.raf(() => {
      this.rafPending = false;
      this.flush();
    });
  }

  private flush(): void {
    if (this.dirty) {
      this.vm = reconcile(this.vm, this.buildVM());
      this.dirty = false;
      this.pushHighlights();
    }
    // getViewModel() may have rebuilt already this frame; subscribers still hear about it once.
    if (this.vm === this.lastNotified) return;
    this.lastNotified = this.vm;
    for (const fn of this.subs) {
      try {
        fn(this.vm);
      } catch (e) {
        console.error(e);
      }
    }
  }

  getViewModel(): ViewModel {
    if (this.dirty) {
      this.vm = reconcile(this.vm, this.buildVM());
      this.dirty = false;
      this.pushHighlights();
    }
    return this.vm;
  }

  subscribe(fn: (vm: ViewModel) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  // =========================================================================
  // Settings
  // =========================================================================

  private reducedMotion(): boolean {
    return this.settings.reduceMotion || this.prefersReduced();
  }

  private applySettingsToBoard(): void {
    const b = this.board;
    b.setShowLabels(this.settings.showLabels);
    b.setUiScale(TEXT_SCALE[this.settings.textSize]);
    b.setReducedMotion?.(this.reducedMotion());
    b.setAutoCamera?.(this.settings.autoCamera);
    this.audio.setVolume(this.settings.sfxVolume);
    this.audio.setMuted(this.settings.muted);
    this.audio.setMusic(this.settings.music);
    this.applyBoardSpeed();
  }

  private aiSpeed(): AiSpeed {
    return this.sessionAiSpeed ?? this.settings.aiSpeed;
  }

  /** Board speed follows whoever is playing: the human setting on human turns, the AI speed on AI turns. */
  private seatSpeed(): number {
    const s = this.disp;
    if (s && s.phase.kind !== 'game-over' && this.isAiDriven(s.currentPlayer)) {
      const ai = this.aiSpeed();
      return ai === 'fast' ? 2 : ai === 'instant' ? 0 : 1;
    }
    return this.settings.animationSpeed;
  }

  private setBoardSpeed(speed: number): void {
    if (speed !== this.lastBoardSpeed) {
      this.lastBoardSpeed = speed;
      this.board.setAnimationSpeed(speed);
    }
  }

  private applyBoardSpeed(): void {
    this.setBoardSpeed(this.seatSpeed());
  }

  private setSettings(patch: Partial<Settings>): void {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    writeJson(this.kv, SETTINGS_KEY, this.settings);
    if (patch.aiSpeed) this.sessionAiSpeed = null;
    this.applySettingsToBoard();
    this.invalidate();
  }

  // =========================================================================
  // Seat helpers
  // =========================================================================

  private isAiDriven(p: PlayerId): boolean {
    const s = this.state;
    if (!s) return false;
    return this.autoplayOn || s.players[p]?.kind === 'ai';
  }

  private isHumanSeat(p: PlayerId, s: GameState | null = this.disp): boolean {
    return !!s && s.players[p]?.kind === 'human';
  }

  /** The driver may act on the board now. */
  private interactive(): boolean {
    const s = this.state;
    if (!s || this.screen !== 'game' || this.handoff) return false;
    if (s.phase.kind === 'game-over') return false;
    return !this.isAiDriven(s.currentPlayer);
  }

  private humanCount(s: GameState, aliveOnly = false): number {
    return s.players.filter((p) => p.kind === 'human' && (!aliveOnly || !p.eliminated)).length;
  }

  // =========================================================================
  // Game lifecycle
  // =========================================================================

  private randomSeed(): number {
    return Math.floor(Math.random() * 0x100000000) >>> 0;
  }

  startGame(config: GameConfig): void {
    const problem = validateConfig(config);
    if (problem) {
      this.toast(problem);
      return;
    }
    const { state, events } = createGame(config);
    this.resetGameLocals();
    this.state = state;
    this.meta = freshMeta(state.id, state);
    // The deal plays from an empty board.
    const blank = cloneState(state);
    for (const t of TERRITORY_IDS) blank.territories[t] = { owner: UNCLAIMED, armies: 0 };
    blank.round = 0;
    blank.turn = 0;
    blank.currentPlayer = state.firstPlayer;
    blank.phase = { kind: 'setup-claim' };
    this.disp = blank;
    this.board.setAttractMode(false);
    this.board.syncState(blank);
    this.screen = 'game';
    this.overlay = null;
    this.victory = null;
    this.save();
    this.enqueue(
      events.map((ev, i) => ({ ev, after: state, end: i === events.length - 1 })),
      { ai: false },
    );
    this.invalidate();
  }

  private resetGameLocals(): void {
    this.epoch++;
    this.humanHasPlayed = false;
    this.queue = [];
    this.skipAll = false;
    this.skipBeat = null;
    this.pendingInputs = [];
    this.wakeAll();
    this.sel = emptySel();
    this.frozenSel = null;
    this.eng = null;
    this.banner = null;
    this.bannerQueue = [];
    this.toasts = [];
    this.toastQueue = [];
    this.turnBanner = null;
    this.rejection = null;
    this.rejectCounts.clear();
    this.handoff = null;
    this.aiCtx = null;
    this.aiHighlights = null;
    this.aiPreview = null;
    this.narration = null;
    this.confirm = null;
    this.allHumansOut = false;
    this.allHumansOutDismissed = false;
    this.seatHighlight = null;
    this.sessionAiSpeed = null;
    this.curTurn = null;
    this.kbFocus = null;
    this.nextSetValue = 0;
    this.lastBoardSpeed = -1;
  }

  private loadSave(): boolean {
    const f = readJson<SaveFile>(this.kv, SAVE_KEY);
    if (!f || !isPlausibleState(f.state) || f.state.phase.kind === 'game-over') return false;
    const s = f.state;
    this.resetGameLocals();
    this.state = s;
    this.disp = cloneState(s);
    const ui = readJson<UiFile>(this.kv, UI_KEY);
    this.meta = ui?.game && ui.game.id === s.id ? { ...freshMeta(s.id, s), ...ui.game } : freshMeta(s.id, s);
    this.sel = { ...emptySel(), ...(this.meta.sel ?? {}) };
    this.validateSel();
    if (s.phase.kind === 'occupy' && this.sel.occupyCount === null) {
      this.sel.occupyCount = occupyDefault(s, s.phase.from, s.phase.to, s.phase.min, s.phase.max).count;
    }
    this.board.setAttractMode(false);
    this.board.syncState(s);
    this.screen = 'game';
    this.overlay = null;
    this.victory = null;
    this.applyBoardSpeed();
    this.humanHasPlayed = s.round > 1 || !!this.meta.lastTurnKind;
    // A fresh turn banner so the room knows whose turn it is (the receipt only when it's still true).
    if (s.round > 0) {
      const ph = s.phase;
      const fresh = ph.kind === 'reinforce' && !ph.midTurn && Object.keys(ph.placed).length === 0;
      const step = ph.kind === 'reinforce' ? 'reinforcing' : ph.kind === 'fortify' ? 'fortifying' : 'attacking';
      this.showTurnBanner(s.currentPlayer, reinforcementsFor(s, s.currentPlayer), [], s, fresh ? null : `Round ${s.round}${SEP}back to ${step}`);
    }
    if (s.round > 0) this.openTurnMetric(s.currentPlayer);
    this.invalidate();
    this.afterSettled();
    return true;
  }

  /** Drop a restored selection that no longer makes sense for the state. */
  private validateSel(): void {
    const s = this.state;
    if (!s) return;
    const me = s.currentPlayer;
    const sel = this.sel;
    const own = (t: TerritoryId | null) => !!t && s.territories[t]?.owner === me;
    if (sel.selected && !own(sel.selected)) sel.selected = null;
    if (s.phase.kind === 'attack' && sel.target && (!sel.selected || s.territories[sel.target].owner === me)) sel.target = null;
    if (s.phase.kind === 'fortify' && sel.target && (!sel.selected || !own(sel.target))) sel.target = null;
    if (s.phase.kind !== 'setup-place') sel.staged = {};
    if (s.phase.kind !== 'reinforce' && s.phase.kind !== 'setup-place') sel.lastPlaced = null;
    if (s.phase.kind === 'setup-place') {
      for (const [t, n] of Object.entries(sel.staged)) if (!own(t as TerritoryId) || !n) delete sel.staged[t as TerritoryId];
    }
  }

  private save(): void {
    const s = this.state;
    if (!s || this.screen === 'victory') return;
    if (s.phase.kind === 'game-over') {
      this.clearSave();
      return;
    }
    const file: SaveFile = { v: 1, savedAt: Date.now(), state: s };
    writeJson(this.kv, SAVE_KEY, file);
    this.saveMeta();
    this.refreshSaveSummary();
  }

  private saveMeta(): void {
    const ui: UiFile = readJson<UiFile>(this.kv, UI_KEY) ?? { v: 1 };
    ui.v = 1;
    if (this.meta) {
      this.meta.sel = this.sel;
      ui.game = { ...this.meta, log: this.meta.log.slice(-120) };
    }
    writeJson(this.kv, UI_KEY, ui);
  }

  private clearSave(): void {
    this.kv.remove(SAVE_KEY);
    const ui = readJson<UiFile>(this.kv, UI_KEY);
    if (ui?.game) {
      delete ui.game;
      writeJson(this.kv, UI_KEY, ui);
    }
    this.refreshSaveSummary();
  }

  private refreshSaveSummary(): void {
    const f = readJson<SaveFile>(this.kv, SAVE_KEY);
    if (!f || !isPlausibleState(f.state) || f.state.phase.kind === 'game-over') {
      this.saveSummary = null;
      return;
    }
    const s = f.state;
    const humans = s.players.filter((p) => p.kind === 'human').map((p) => p.name);
    const ais = s.players.length - humans.length;
    const who =
      humans.length === 0
        ? `${ais} AI`
        : humans.length === 1
          ? `${humans[0]} vs ${ais} AI`
          : `${humans.join(' vs ')}${ais ? ` + ${ais} AI` : ''}`;
    const when = s.round > 0 ? `Round ${s.round}` : 'Setup';
    this.saveSummary = { summary: `${when}${SEP}${who}` };
  }

  private rememberDraft(): void {
    const ui: UiFile = readJson<UiFile>(this.kv, UI_KEY) ?? { v: 1 };
    ui.lastSetup = this.draft;
    writeJson(this.kv, UI_KEY, ui);
  }

  // =========================================================================
  // Applying actions
  // =========================================================================

  /** Apply to the engine state (no queueing). */
  private applyRaw(action: Action): ActionResult {
    const s = this.state;
    if (!s) return { ok: false, error: 'No game in progress.' };
    const r = applyAction(s, action);
    if (!r.ok) return r;
    this.state = r.state;
    this.save();
    return r;
  }

  /** Apply a human/hook action and queue its events. */
  private act(action: Action): ActionResult {
    const before = this.sel;
    const r = this.applyRaw(action);
    if (!r.ok) {
      console.warn('[risk] refused:', r.error);
      this.toast(r.error);
      return r;
    }
    if (!this.frozenSel && r.events.some(isBlocking)) this.frozenSel = { ...before, staged: { ...before.staged } };
    this.enqueue(
      r.events.map((ev, i) => ({ ev, after: r.state, end: i === r.events.length - 1 })),
      { ai: false, style: 'full' },
    );
    return r;
  }

  private enqueue(
    list: { ev: GameEvent; after: GameState; end: boolean }[],
    opts: { ai: boolean; style?: 'full' | 'brief'; skip?: boolean; stagger?: number; beat?: number; speed?: number },
  ): void {
    const beat = opts.beat ?? this.beat++;
    const rolls = list.filter((x) => x.ev.type === 'diceRolled').length;
    let rollIndex = 0;
    let placeIndex = 0;
    let conquered = false;
    for (const x of list) {
      // Instant batches still play the next turn's start and the finale on a freshly synced board.
      const keep = opts.skip && (x.ev.type === 'turnStarted' || x.ev.type === 'gameOver');
      const e: Entry = { ...x, beat, ai: opts.ai, skip: opts.skip && !keep };
      if (x.ev.type === 'diceRolled') {
        e.opts = { style: opts.style ?? 'full', seq: { index: rollIndex++, count: rolls } };
      } else if (opts.style) {
        e.opts = { style: opts.style };
      }
      if (x.ev.type === 'territoryConquered') conquered = true;
      if (x.ev.type === 'armiesMoved' && x.ev.reason === 'occupy' && (conquered || opts.ai)) {
        e.opts = { ...(e.opts ?? {}), inlineMarch: true };
      }
      if (opts.speed !== undefined) e.speed = opts.speed;
      if (opts.stagger && x.ev.type === 'armiesPlaced') {
        e.delayMs = placeIndex++ === 0 ? 0 : opts.stagger;
      }
      this.queue.push(e);
    }
    void this.pump();
  }

  // =========================================================================
  // Queue pump
  // =========================================================================

  private isSkipping(e: Entry): boolean {
    return !!e.skip || this.skipAll || (this.skipBeat !== null && e.beat === this.skipBeat);
  }

  /** A blocking animation is running or queued (input should click-through). */
  private busyBlocking(): boolean {
    if (this.blockingNow) return true;
    return this.queue.some((e) => isBlocking(e.ev) && !this.isSkipping(e));
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const next = this.queue[0];
        if (next.ev.type === 'turnStarted' && this.needsHandoff(next.ev.player) && !this.handoff) {
          this.handoff = { player: next.ev.player };
          this.invalidate();
        }
        if (this.handoff) {
          await new Promise<void>((resolve) => {
            const check = () => (this.handoff ? this.timer(check, 50) : resolve());
            check();
          });
        }
        const e = this.queue.shift()!;
        const epoch = this.epoch;
        this.currentBeat = e.beat;
        if (e.delayMs && !this.isSkipping(e)) await this.sleep(e.delayMs);
        if (epoch !== this.epoch || !this.disp) continue;
        const skip = this.isSkipping(e);
        const blocking = isBlocking(e.ev);
        const earlyDisplay = !blocking || e.ev.type === 'turnStarted';
        if (!skip && this.boardStale && this.disp) {
          this.boardStale = false;
          this.board.syncState(this.disp);
        }
        if (!skip) this.setBoardSpeed(e.ai && this.aiCtx?.capped && e.ev.type !== 'turnStarted' ? 0 : (e.speed ?? this.seatSpeed()));
        this.onEventStart(e, skip);
        if (earlyDisplay) this.applyDisplay(e);
        if (skip) {
          this.boardStale = true;
        } else if (!blocking) {
          this.inflight++;
          let p: Promise<void>;
          try {
            p = this.board.playEvent(e.ev, e.after, e.opts);
          } catch (err) {
            console.error(err);
            p = Promise.resolve();
          }
          this.withSafety(p).finally(() => {
            this.inflight--;
            if (this.inflight === 0) this.afterSettled();
          });
        } else {
          this.blockingNow = e;
          if (e.ev.type === 'diceRolled') this.rolling = true;
          this.invalidate();
          let p: Promise<void>;
          try {
            p = this.board.playEvent(e.ev, e.after, e.opts);
          } catch (err) {
            console.error(err);
            p = Promise.resolve();
          }
          await this.withSafety(p);
          // Instant speed still leaves a 250 ms beat after each conquest (UX.md §8.2).
          // A snapped AI-vs-AI headline (past the turn's headline point) gets a shorter beat.
          if (e.ev.type === 'territoryConquered' && this.lastBoardSpeed === 0 && !this.isSkipping(e)) await this.sleep(e.ai && e.speed === 0 ? SNAP_BEAT_MS : 250);
          this.blockingNow = null;
          this.rolling = false;
          if (epoch !== this.epoch || !this.disp) continue;
        }
        if (!earlyDisplay) this.applyDisplay(e);
        this.onEventEnd(e, skip);
        this.invalidate();
      }
    } finally {
      this.pumping = false;
    }
    this.onQueueEmpty();
  }

  private withSafety(p: Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.sleepers.delete(onSkip);
        resolve();
      };
      // After a skip the board must settle promptly; never let one event hang the queue.
      const onSkip = () => {
        this.sleepers.delete(onSkip);
        this.timer(finish, 350);
      };
      this.sleepers.add(onSkip);
      p.then(finish, (err) => {
        console.error(err);
        finish();
      });
      this.timer(finish, PLAY_SAFETY_MS);
    });
  }

  private applyDisplay(e: Entry): void {
    if (!this.disp) return;
    this.disp = applyEventToDisplay(this.disp, e.ev, e.after, e.end);
  }

  private onQueueEmpty(): void {
    if (this.queue.length || this.pumping) return;
    if (this.boardStale && this.state) {
      this.boardStale = false;
      this.board.syncState(this.state);
      this.disp = cloneState(this.state);
    }
    this.skipAll = false;
    this.skipBeat = null;
    this.frozenSel = null;
    this.applyBoardSpeed();
    const pending = this.pendingInputs;
    this.pendingInputs = [];
    const now = this.now();
    for (const p of pending) {
      // Forced wait = time an input was held beyond the 50 ms acknowledgement budget (UX.md §8.1).
      if (this.curTurn) this.curTurn.forcedWaitMs += Math.max(0, now - p.at - 50);
      try {
        p.fn();
      } catch (err) {
        console.error(err);
      }
    }
    this.invalidate();
    if (this.inflight === 0) this.afterSettled();
    else this.scheduleAi();
  }

  /** Everything has finished: consistency sync, then the next AI beat. */
  private afterSettled(): void {
    if (this.queue.length || this.pumping || this.inflight > 0) return;
    if (this.state && this.screen === 'game' && !this.aiBusy) {
      this.board.syncState(this.state);
      this.disp = cloneState(this.state);
      this.invalidate();
    }
    this.scheduleAi();
  }

  /** Click-through on your own turn: finish the running animation, then do what was clicked. */
  private clickThrough(fn: () => void): void {
    this.pendingInputs.push({ fn, at: this.now() });
    this.skipAll = true;
    this.board.skipAnimations();
    this.wakeAll();
    this.invalidate();
  }

  /** Watched turns: a click skips the current engagement only. */
  private skipWatched(): void {
    this.skipBeat = this.currentBeat;
    for (const e of this.queue) if (e.beat === this.currentBeat) e.skip = true;
    this.board.skipAnimations();
    this.wakeAll();
  }

  private needsHandoff(player: PlayerId): boolean {
    const s = this.disp;
    if (!s || !this.settings.hideCardsBetweenTurns || this.autoplayOn) return false;
    if (s.players[player]?.kind !== 'human') return false;
    if (this.humanCount(s, true) < 2) return false;
    return s.players[player].cards.length >= 1;
  }

  // =========================================================================
  // Event handlers (HUD reacts to each event as the board plays it)
  // =========================================================================

  private onEventStart(e: Entry, skip: boolean): void {
    const ev = e.ev;
    const d = this.disp!;
    const aiVol = (players: PlayerId[]) => (players.some((p) => this.isHumanSeat(p)) ? 1 : 0.6);
    switch (ev.type) {
      case 'turnStarted': {
        this.closeEngagement();
        this.closeTurnMetric();
        const human = this.isHumanSeat(ev.player) && !this.autoplayOn;
        if (human) this.humanHasPlayed = true;
        const prevKind = this.meta?.lastTurnKind ?? null;
        if (human && prevKind === 'human') this.guardUntil = this.now() + 250;
        if (this.meta) {
          this.meta.lastTurnKind = this.isAiDriven(ev.player) ? 'ai' : 'human';
          this.meta.tradedThisTurn = 0;
        }
        this.openTurnMetric(ev.player);
        this.sel = emptySel();
        this.frozenSel = null;
        this.rejectCounts.clear();
        this.narration = null;
        this.aiHighlights = null;
        this.aiPreview = null;
        let recap: string[] = [];
        if (this.meta && this.isHumanSeat(ev.player) && ev.round >= 2) {
          recap = buildRecap(this.meta.recap[ev.player], d, ev.player);
          delete this.meta.recap[ev.player];
          this.log('recap', ev.player, recap.join(SEP), []);
        }
        this.showTurnBanner(ev.player, ev.reinforcements, recap, d);
        this.log('turn', ev.player, `Round ${ev.round}${SEP}${poss(pName(d, ev.player))} turn${SEP}+${ev.reinforcements.total}`, []);
        if (human) this.play('turnStart', { variant: prevKind === 'ai' ? 'bright' : undefined });
        // Boards that implement setAutoCamera return home themselves on turnStarted.
        if (this.settings.autoCamera && !skip && !this.board.setAutoCamera) this.board.focusTerritories([]);
        this.humanInputSince = this.now() + 1200;
        const lim = d.config.turnLimit;
        if (lim && ev.round === lim && this.meta && !this.meta.finalRoundShown) {
          this.meta.finalRoundShown = true;
          this.announce({ tier: 1, title: 'FINAL ROUND', subline: `Round ${lim} of ${lim}${SEP}most territories wins`, seat: null });
        }
        break;
      }
      case 'setupTurn':
        this.sel = emptySel();
        if (this.isAiDriven(ev.player)) this.narration = `${pName(d, ev.player)} is placing armies`;
        else this.narration = null;
        break;
      case 'diceRolled':
        this.onRollStart(ev, e);
        break;
      case 'territoryConquered':
        if (this.isAiDriven(ev.player)) this.narration = `${pName(d, ev.player)} takes ${tName(ev.to)}`;
        break;
      case 'continentGained': {
        const name = pName(d, ev.player);
        const c = ev.continent;
        this.announce({
          sound: { name: 'continent', opts: { volume: aiVol([ev.player]) } },
          tier: 1,
          title: `${upper(name)} HOLDS ${upper(cName(c))}`,
          subline: `+${CONTINENTS[c].bonus} armies a turn`,
          seat: seatRef(d, ev.player),
          parts: [{ subject: upper(name), predicate: `HOLDS ${upper(cName(c))}` }],
        });
        this.log('continent', ev.player, `${name} holds ${cName(c)}${SEP}+${CONTINENTS[c].bonus} a turn`, []);
        break;
      }
      case 'continentLost': {
        const by = pName(d, ev.to);
        const victim = pName(d, ev.player);
        const c = ev.continent;
        const soleHuman = this.humanCount(d) === 1 && this.isHumanSeat(ev.player);
        const whose = soleHuman ? 'YOUR' : upper(poss(victim));
        this.announce({
          sound: {
            name: 'continent',
            opts: { volume: aiVol([ev.player, ev.to]), variant: this.isHumanSeat(ev.player) ? 'somber' : undefined },
          },
          tier: 1,
          title: `${upper(by)} BREAKS ${whose} ${upper(cName(c))}`,
          subline: `${MINUS}${CONTINENTS[c].bonus} a turn for ${victim}`,
          seat: seatRef(d, ev.to),
          parts: [{ subject: upper(by), predicate: `BREAKS ${whose} ${upper(cName(c))}` }],
        });
        this.log('continent', ev.to, `${by} broke ${poss(victim)} ${cName(c)}${SEP}${MINUS}${CONTINENTS[c].bonus} a turn for ${victim}`, []);
        break;
      }
      case 'playerEliminated': {
        this.holdUntil = this.now() + 500;
        this.audio.stopAll?.();
        this.play('eliminated', { delay: 0.15 });
        break;
      }
      case 'cardsTraded': {
        const v = ev.armies;
        const rate = v >= 20 ? 0.72 : 1 - ((Math.max(4, v) - 4) / 16) * 0.28;
        this.play('cardTrade', { rate, volume: (v > 10 ? 1.26 : 1) * aiVol([ev.player]) });
        break;
      }
      case 'cardDrawn':
        this.play('cardDraw', { volume: aiVol([ev.player]) });
        break;
      case 'gameOver': {
        this.closeEngagement();
        this.closeTurnMetric();
        this.holdUntil = this.now() + 1500;
        this.play('victory');
        this.clearSave();
        this.victory = this.buildVictory(e.after, ev.winner, null);
        this.screen = 'victory';
        this.turnBanner = null;
        this.banner = null;
        this.bannerQueue = [];
        break;
      }
      default:
        break;
    }
  }

  private onEventEnd(e: Entry, skip: boolean): void {
    const ev = e.ev;
    const d = this.disp!;
    const meta = this.meta;
    let nearNew: PlayerId[] = [];
    switch (ev.type) {
      case 'diceRolled':
        this.onRollEnd(ev);
        break;
      case 'territoryConquered': {
        const g = this.eng;
        if (g && g.from === ev.from && g.to === ev.to) {
          g.conquered = true;
          if (g.winP <= 0.3) {
            const who = pName(d, ev.player);
            this.announce({
              tier: 1,
              title: 'AGAINST THE ODDS',
              subline: `${who} takes ${tName(ev.to)} at ${pct(g.winP)}%`,
              seat: seatRef(d, ev.player),
              parts: [{ subject: upper(who), predicate: `TAKES ${upper(tName(ev.to))} AGAINST THE ODDS` }],
            });
            meta?.awards.upsets.push({ player: ev.player, kind: 'odds', pct: pct(g.winP), round: d.round });
          }
          this.finishEngagement();
        }
        nearNew = this.checkNearGoal();
        break;
      }
      case 'armiesMoved':
        if (ev.reason === 'fortify') {
          this.log('system', ev.player, `${pName(d, ev.player)} moved ${ev.count} from ${tName(ev.from)} to ${tName(ev.to)}`, []);
        }
        break;
      case 'playerEliminated': {
        const victim = pName(d, ev.player);
        const by = pName(d, ev.by);
        if (meta) meta.elimRound[ev.player] = d.round;
        this.announce({
          tier: 2,
          title: `${upper(victim)} IS OUT`,
          subline: `Knocked out by ${by}${SEP}round ${d.round}`,
          seat: seatRef(d, ev.by),
          parts: null,
          victim: ev.player,
        });
        this.log('elimination', ev.by, `${by} knocked out ${victim}`, []);
        if (meta) meta.knockout = { by: ev.by, victim, cards: 0 };
        this.checkAllHumansOut();
        break;
      }
      case 'cardsCaptured': {
        const n = ev.cards.length;
        const from = pName(d, ev.from);
        const by = pName(d, ev.player);
        if (meta?.knockout && meta.knockout.by === ev.player) meta.knockout.cards = n;
        // Fold the card count into the elimination banner's subline.
        const b = this.banner?.vm.tier === 2 ? this.banner : this.bannerQueue.find((x) => x.vm.tier === 2);
        if (b) b.vm = { ...b.vm, subline: `${b.vm.subline}${SEP}${n === 1 ? '1 card' : `${n} cards`} taken` };
        if (this.isHumanSeat(ev.player) || this.isHumanSeat(ev.from)) {
          this.toast(`${by} takes ${poss(from)} ${n === 1 ? 'card' : `${n} cards`}`, seatRef(d, ev.player));
        }
        this.log('card', ev.player, `${by} took ${poss(from)} ${n === 1 ? 'card' : `${n} cards`}`, []);
        break;
      }
      case 'cardsTraded': {
        const name = pName(d, ev.player);
        if (meta && ev.player === d.currentPlayer) meta.tradedThisTurn += ev.armies;
        this.log('card', ev.player, `${name} traded 3 cards for +${ev.armies}`, []);
        if (ev.armies >= 10) {
          const up = upcomingSetValues(d, 1);
          this.announce({
            tier: 1,
            title: `+${ev.armies} ARMIES`,
            subline: up.length ? `Set #${ev.tradeIndex}${SEP}next set is worth ${up[0]}` : `Set #${ev.tradeIndex}`,
            seat: seatRef(d, ev.player),
            parts: [{ subject: upper(name), predicate: `CASHES IN +${ev.armies}` }],
          });
        }
        if (ev.bonusTerritory && this.isHumanSeat(ev.player)) {
          this.toast(`+2 on ${tName(ev.bonusTerritory)}${SEP}you own a traded card's territory`, seatRef(d, ev.player));
        }
        break;
      }
      case 'cardDrawn':
        this.log('card', ev.player, `${pName(d, ev.player)} drew a card`, []);
        break;
      case 'gameOver':
        if (!skip) this.board.setAttractMode(true);
        break;
      case 'phaseChanged':
        if (ev.phase === 'fortify' || ev.phase === 'reinforce') this.closeEngagement();
        if (ev.phase === 'occupy' && this.state?.phase.kind === 'occupy' && this.sel.occupyCount === null) {
          const ph = this.state.phase;
          this.sel.occupyCount = occupyDefault(this.state, ph.from, ph.to, ph.min, ph.max).count;
        }
        break;
      case 'controllerChanged':
        this.checkAllHumansOut();
        break;
      default:
        break;
    }
    if (meta) {
      recordAward(meta.awards, d, ev);
      recordRecap(meta.recap, d, ev, nearNew);
    }
    // Next-set chip pulse.
    const up = upcomingSetValues(d, 1)[0] ?? 0;
    if (up !== this.nextSetValue) {
      if (up > this.nextSetValue && this.nextSetValue > 0) this.nextSetPulse++;
      this.nextSetValue = up;
    }
    if (e.end && meta && ev.type !== 'gameOver') this.saveMeta();
  }

  private checkNearGoal(): PlayerId[] {
    const d = this.disp!;
    const meta = this.meta;
    if (!meta) return [];
    const need = territoriesNeeded(d);
    const out: PlayerId[] = [];
    for (const p of d.players) {
      if (p.eliminated || meta.nearGoal.includes(p.id)) continue;
      const n = territoryCount(d, p.id);
      const left = need - n;
      if (left > 0 && left <= 5) {
        meta.nearGoal.push(p.id);
        out.push(p.id);
        this.announce({
          tier: 1,
          title: `${upper(p.name)} IS ${left} FROM VICTORY`,
          subline: `${n} of ${need} territories`,
          seat: seatRef(d, p.id),
          parts: [{ subject: upper(p.name), predicate: `IS ${left} FROM VICTORY` }],
        });
      }
    }
    return out;
  }

  private checkAllHumansOut(): void {
    const s = this.disp;
    if (!s || this.allHumansOutDismissed) return;
    const humans = s.players.filter((p) => p.kind === 'human');
    if (humans.length > 0 && humans.every((p) => p.eliminated) && s.phase.kind !== 'game-over') this.allHumansOut = true;
  }

  // --- Engagements (battle panel, log line, upsets, roll metrics) -------------

  private onRollStart(ev: Extract<GameEvent, { type: 'diceRolled' }>, e: Entry): void {
    const d = this.disp!;
    const g = this.eng;
    const same = g && !g.endedAt && g.from === ev.from && g.to === ev.to && g.turn === d.turn && !g.conquered;
    if (!same) {
      this.closeEngagement();
      const a = d.territories[ev.from].armies;
      const def = d.territories[ev.to].armies;
      this.eng = {
        attacker: ev.player,
        defender: ev.defender,
        from: ev.from,
        to: ev.to,
        startA: a,
        startD: def,
        rolls: 0,
        attLost: 0,
        defLost: 0,
        blitz: ev.blitz,
        winP: winProbability(a, def),
        style: e.opts?.style ?? 'full',
        conquered: false,
        startedAt: this.now(),
        lastRollEnd: this.now(),
        logId: 0,
        lastResult: null,
        tie: false,
        endedAt: null,
        turn: d.turn,
        details: [],
      };
    }
    if (ev.blitz && this.eng) this.eng.blitz = true;
  }

  private onRollEnd(ev: Extract<GameEvent, { type: 'diceRolled' }>): void {
    const g = this.eng;
    const d = this.disp!;
    if (!g) return;
    g.rolls++;
    g.attLost += ev.attackerLosses;
    g.defLost += ev.defenderLosses;
    g.lastRollEnd = this.now();
    const A = pName(d, ev.player);
    const D = pName(d, ev.defender);
    g.lastResult =
      ev.attackerLosses > 0 && ev.defenderLosses > 0
        ? `Each loses ${Math.min(ev.attackerLosses, ev.defenderLosses)}`
        : ev.defenderLosses > 0
          ? `${D} loses ${ev.defenderLosses}`
          : `${A} loses ${ev.attackerLosses}`;
    g.tie = ev.attackDice.some((v, i) => i < ev.defendDice.length && v === ev.defendDice[i]);
    g.details.push(`${ev.attackDice.join(' ')} vs ${ev.defendDice.join(' ')} → ${g.lastResult}`);
    this.writeEngagementLog(false);
    // Blitz stopped without taking it, or the source is down to 1: the engagement is over.
    if (d.territories[ev.to].armies > 0 && d.territories[ev.from].armies < 2) this.finishEngagement();
  }

  private engagementText(final: boolean): string {
    const g = this.eng!;
    const d = this.disp!;
    const A = pName(d, g.attacker);
    const verb = g.blitz ? 'blitzed' : 'attacked';
    const head = `${A} ${verb} ${tName(g.to)} from ${tName(g.from)}: ${g.startA} vs ${g.startD}`;
    if (g.conquered) return `${head} → took it, lost ${g.attLost}`;
    if (final) return `${head} → ${pName(d, g.defender)} held, ${A} lost ${g.attLost}`;
    return `${head} → ${d.territories[g.from].armies} vs ${d.territories[g.to].armies}`;
  }

  private writeEngagementLog(final: boolean): void {
    const g = this.eng;
    const meta = this.meta;
    if (!g || !meta) return;
    const text = this.engagementText(final);
    if (g.logId) {
      const i = meta.log.findIndex((l) => l.id === g.logId);
      if (i >= 0) {
        // Immutable update: the HUD short-circuits on the lines array's identity.
        meta.log = meta.log.map((l, j) => (j === i ? { ...l, text, detail: [...g.details] } : l));
        this.invalidate();
        return;
      }
    }
    g.logId = this.log('engagement', g.attacker, text, [...g.details]);
  }

  /** The engagement is decided (conquest, or the attacker stopped): log, upsets, metrics. */
  private finishEngagement(): void {
    const g = this.eng;
    if (!g || g.endedAt) return;
    g.endedAt = this.now();
    this.writeEngagementLog(true);
    const d = this.disp!;
    if (!g.conquered && g.winP >= 0.75 && g.rolls > 0) {
      const D = pName(d, g.defender);
      const A = pName(d, g.attacker);
      this.announce({
        tier: 1,
        title: 'HELD!',
        subline: `${D} holds ${tName(g.to)}${SEP}${A} had ${pct(g.winP)}%`,
        seat: seatRef(d, g.defender),
        parts: [{ subject: upper(D), predicate: `HOLDS ${upper(tName(g.to))}` }],
      });
      this.meta?.awards.upsets.push({ player: g.defender, kind: 'held', pct: pct(g.winP), round: d.round });
      if (this.isAiDriven(g.attacker)) this.narration = `${D} holds ${tName(g.to)}`;
    }
    this.metricRolls.push({ blitz: g.blitz, count: g.rolls, ms: Math.round(g.lastRollEnd - g.startedAt), style: g.style });
    this.timer(() => this.invalidate(), 2600);
  }

  private closeEngagement(): void {
    const g = this.eng;
    if (g && !g.endedAt) {
      // Stopped by choice (switched target, ended the phase).
      const d = this.disp!;
      const couldGoOn = d.territories[g.from].armies >= 2 && !g.blitz;
      if (couldGoOn) {
        g.endedAt = this.now();
        this.writeEngagementLog(true);
        this.metricRolls.push({ blitz: g.blitz, count: g.rolls, ms: Math.round(g.lastRollEnd - g.startedAt), style: g.style });
      } else this.finishEngagement();
    }
  }

  // =========================================================================
  // Announcements (UX.md §5.2)
  // =========================================================================

  private announce(b: {
    tier: 1 | 2 | 3;
    title: string;
    subline: string;
    seat: SeatRef | null;
    parts?: { subject: string; predicate: string }[] | null;
    victim?: PlayerId;
    sound?: { name: SfxName; opts?: PlayOptions };
  }): void {
    const now = this.now();
    const s = this.disp;
    const aiTurn = s && this.isAiDriven(s.currentPlayer) ? s.turn : null;
    const holdMs = b.tier === 2 ? 1600 : 1200;
    const item: BannerItem = {
      vm: { id: this.idSeq++, tier: b.tier, title: b.title, subline: b.subline, seat: b.seat, holdMs },
      createdAt: now,
      aiTurn,
      parts: b.parts ?? null,
      sound: b.sound ?? (b.tier === 1 ? { name: 'continent', opts: { volume: 0.7 } } : undefined),
    };
    // AI-turn tier-1 banners within 2 s merge into one line.
    if (b.tier === 1 && aiTurn !== null) {
      const target = [...this.bannerQueue].reverse().find((x) => x.vm.tier === 1 && x.aiTurn === aiTurn && now - x.createdAt < 2000)
        ?? (this.banner && this.banner.vm.tier === 1 && this.banner.aiTurn === aiTurn && now - this.banner.createdAt < 2000 ? this.banner : null);
      if (target && (target.parts?.length ?? 0) < 3) {
        const parts = [...(target.parts ?? [{ subject: target.vm.title, predicate: '' }]), ...(item.parts ?? [{ subject: b.title, predicate: '' }])];
        const title = mergeBannerTitle(parts);
        target.parts = parts;
        target.vm = { ...target.vm, title, subline: `${target.vm.subline}${SEP}${b.subline}` };
        this.invalidate();
        return;
      }
    }
    if (b.tier === 2) this.bannerQueue.unshift(item);
    else this.bannerQueue.push(item);
    this.tickBanners();
  }

  private tickBanners(): void {
    const now = this.now();
    if (this.banner && now >= this.banner.createdAt + 240 + this.banner.vm.holdMs && this.banner.createdAt <= now) {
      this.banner = null;
      this.bannerNextAt = now + 400; // 200 out + 200 gap
      this.invalidate();
    }
    const blocked = this.rolling || !!this.turnBanner;
    if (!this.banner && this.bannerQueue.length && now >= this.bannerNextAt && !blocked) {
      const next = this.bannerQueue.shift()!;
      next.createdAt = now;
      this.banner = next;
      if (next.sound) this.play(next.sound.name, next.sound.opts);
      this.invalidate();
    }
    // Toasts
    this.toasts = this.toasts.filter((t) => t.until > now);
    while (this.toasts.length < 2 && this.toastQueue.length && !this.rolling) {
      this.toasts.push({ vm: this.toastQueue.shift()!, until: now + 2700 });
      this.invalidate();
    }
    const busy = this.banner || this.bannerQueue.length || this.toasts.length || this.toastQueue.length;
    if (busy && !this.bannerTimer) {
      this.bannerTimer = this.timer(() => {
        this.bannerTimer = null;
        this.tickBanners();
      }, 100);
    }
  }

  private toast(text: string, seat: SeatRef | null = null): void {
    this.toastQueue.push({ id: this.idSeq++, text, seat });
    this.tickBanners();
  }

  private showTurnBanner(player: PlayerId, r: ReinforcementBreakdown, recap: string[], s: GameState, receiptOverride: string | null = null): void {
    const name = pName(s, player);
    const base = baseReceipt(r.territoryCount, r.base);
    const receipt =
      receiptOverride ?? [`+${r.total} armies`, base, ...r.continents.map((c) => `${cName(c.continent)} +${c.bonus}`)].join(SEP);
    const instant = this.isAiDriven(player) ? this.aiSpeed() === 'instant' : this.settings.animationSpeed === 0;
    const holdMs = instant ? 500 : recap.length ? 1900 : 1100;
    // An elimination banner (tier 2) keeps its moment: the turn banner waits for it to leave, so the
    // room never sees two banners at once (SPEC §10).
    if (this.banner && this.banner.vm.tier >= 2) {
      const wait = Math.max(0, this.banner.createdAt + 240 + this.banner.vm.holdMs + 200 - this.now());
      const turn = s.turn;
      if (this.turnBannerTimer) this.clock.clearTimeout(this.turnBannerTimer);
      this.turnBannerTimer = this.timer(() => {
        this.turnBannerTimer = null;
        if (this.disp && this.disp.turn === turn && this.screen === 'game') this.showTurnBanner(player, r, recap, s, receiptOverride);
      }, wait + 10);
      return;
    }
    // The turn banner takes the banner slot: a tier-1 banner still showing bows out.
    if (this.banner && this.banner.vm.tier === 1) {
      this.banner = null;
      this.bannerNextAt = this.now() + 200;
    }
    this.turnBanner = { id: this.idSeq++, seat: seatRef(s, player), title: `${upper(poss(name))} TURN`, receipt, recap, holdMs };
    if (this.turnBannerTimer) this.clock.clearTimeout(this.turnBannerTimer);
    const id = this.turnBanner.id;
    this.turnBannerTimer = this.timer(() => {
      if (this.turnBanner?.id === id) this.dismissTurnBanner();
    }, (instant ? 150 : 280) + holdMs);
  }

  private dismissTurnBanner(): void {
    if (!this.turnBanner) return;
    this.turnBanner = null;
    this.bannerNextAt = Math.max(this.bannerNextAt, this.now() + 200);
    this.invalidate();
    this.tickBanners();
  }

  private log(kind: LogLineVM['kind'], player: PlayerId | null, text: string, detail: string[]): number {
    const meta = this.meta;
    const d = this.disp;
    if (!meta || !d) return 0;
    const id = meta.logId++;
    // A new array every time: the HUD short-circuits on the lines array's identity.
    const next = [...meta.log, { id, round: d.round, seat: player !== null && d.players[player] ? seatRef(d, player) : null, kind, text, detail }];
    meta.log = next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
    this.invalidate();
    return id;
  }

  private play(name: SfxName, opts?: PlayOptions): void {
    if (opts?.volume === 0) return;
    try {
      this.audio.play(name, opts);
    } catch {
      /* audio is best-effort */
    }
  }

  // =========================================================================
  // Board input
  // =========================================================================

  private explainUi(): ExplainUi {
    return {
      selected: this.sel.selected,
      target: this.sel.target,
      staged: this.sel.staged,
      occupyCount: this.sel.occupyCount,
      interactive: this.interactive(),
      showWinChance: this.settings.showWinChance,
    };
  }

  explain(t: TerritoryId): Explanation {
    const s = this.state;
    if (!s) return { ok: false, text: 'No game in progress' };
    return explainTerritory(s, this.explainUi(), t);
  }

  private onBoardClick(info: TerritoryPointerInfo): void {
    this.kbFocus = null;
    if (this.turnBanner) this.dismissTurnBanner();
    if (this.seatHighlight !== null) {
      this.seatHighlight = null;
      this.invalidate();
    }
    const s = this.state;
    if (!s || this.screen !== 'game' || this.overlay || this.confirm) return;
    if (this.now() < this.holdUntil) {
      this.inputDropped++;
      return;
    }
    if (!this.interactive()) {
      this.skipWatched();
      return;
    }
    if (this.now() < this.guardUntil) {
      this.inputDropped++;
      return;
    }
    if (this.busyBlocking()) {
      this.clickThrough(() => this.handleClick(info));
      return;
    }
    this.handleClick(info);
  }

  private handleClick(info: TerritoryPointerInfo): void {
    const s = this.state;
    if (!s || !this.interactive()) return;
    const t = info.territory;
    if (info.button === 2) {
      this.rightClick(t);
      return;
    }
    const ex = explainTerritory(s, this.explainUi(), t);
    if (!ex.ok || !ex.plan) {
      if (ex.code) this.reject(ex.code, ex.text);
      return;
    }
    this.rejection = null;
    this.runPlan(ex.plan, { shift: info.shiftKey, alt: info.altKey });
    this.invalidate();
  }

  private reject(code: string, text: string): void {
    const n = (this.rejectCounts.get(code + text) ?? 0) + 1;
    this.rejectCounts.set(code + text, n);
    const hold = n >= 3 ? 4000 : 2200;
    const full = n >= 3 ? `${text}. Glowing territories are the ones you can use.` : text;
    this.lineKey++;
    this.rejection = { text: full, key: this.lineKey, until: this.now() + hold, code };
    if (this.curTurn) this.curTurn.rejected++;
    this.play('uiError', { volume: 0.25 });
    const key = this.lineKey;
    this.timer(() => {
      if (this.rejection?.key === key) {
        this.rejection = null;
        this.lineKey++;
        this.invalidate();
      }
    }, hold);
    this.invalidate();
  }

  private rightClick(t: TerritoryId): void {
    const s = this.state!;
    const me = s.currentPlayer;
    const ph = s.phase;
    if (ph.kind === 'setup-place') {
      const n = this.sel.staged[t] ?? 0;
      if (n > 0) {
        if (n === 1) delete this.sel.staged[t];
        else this.sel.staged[t] = n - 1;
        const i = this.sel.order.lastIndexOf(t);
        if (i >= 0) this.sel.order.splice(i, 1);
        this.play('unplace', { volume: 0.7 });
        this.saveMeta();
        this.invalidate();
      }
      return;
    }
    if (ph.kind === 'reinforce' && (ph.placed[t] ?? 0) > 0) {
      const r = this.act({ type: 'unreinforce', player: me, territory: t, count: 1 });
      if (r.ok) {
        const i = this.sel.order.lastIndexOf(t);
        if (i >= 0) this.sel.order.splice(i, 1);
        this.sel.lastPlaced = t;
      }
      this.invalidate();
    }
  }

  private runPlan(plan: ClickPlan, mods: { shift?: boolean; alt?: boolean } = {}): void {
    const s = this.state!;
    const me = s.currentPlayer;
    const sel = this.sel;
    switch (plan.kind) {
      case 'claim':
        this.act({ type: 'claim', player: me, territory: plan.t });
        break;
      case 'stage': {
        if (s.phase.kind !== 'setup-place') break;
        const left = s.phase.toPlace - stagedTotal(sel);
        const n = Math.max(1, Math.min(left, mods.alt ? left : mods.shift ? 5 : 1));
        sel.staged[plan.t] = (sel.staged[plan.t] ?? 0) + n;
        for (let i = 0; i < n; i++) sel.order.push(plan.t);
        sel.lastPlaced = plan.t;
        this.play('place', { volume: 0.8, rate: 1 + Math.min(0.15, 0.03 * sel.order.length) });
        this.saveMeta();
        break;
      }
      case 'reinforce': {
        if (s.phase.kind !== 'reinforce') break;
        const left = s.phase.remaining;
        const n = Math.max(1, Math.min(left, mods.alt ? left : mods.shift ? 5 : 1));
        const r = this.act({ type: 'reinforce', player: me, territory: plan.t, count: n });
        if (r.ok) {
          for (let i = 0; i < n; i++) sel.order.push(plan.t);
          sel.lastPlaced = plan.t;
        }
        break;
      }
      case 'exitReinforce': {
        const r = this.act({ type: 'endReinforce', player: me });
        if (r.ok) {
          this.sel = { ...emptySel() };
          this.runPlan(plan.then, mods);
        }
        break;
      }
      case 'selectSource':
        this.sel = { ...emptySel(), selected: plan.t };
        break;
      case 'deselect':
        this.sel = { ...emptySel() };
        break;
      case 'arm':
        this.sel = { ...emptySel(), selected: plan.from, target: plan.to, auto: plan.auto };
        break;
      case 'roll':
        this.doAttack(false);
        break;
      case 'fortifySource':
        this.sel = { ...emptySel(), selected: plan.t };
        break;
      case 'fortifyDest': {
        const max = Math.max(1, s.territories[plan.from].armies - 1);
        this.sel = { ...emptySel(), selected: plan.from, target: plan.to, fortifyCount: max };
        break;
      }
      case 'occupyThen': {
        const r = this.act({ type: 'occupy', player: me, count: plan.count });
        if (!r.ok) break;
        this.sel = { ...emptySel(), selected: plan.select };
        if (plan.then) this.runPlan(plan.then, mods);
        break;
      }
    }
    this.saveMeta();
    this.invalidate();
  }

  private doAttack(blitz: boolean): void {
    const s = this.state!;
    const me = s.currentPlayer;
    const { selected: from, target: to } = this.sel;
    if (!from || !to || s.phase.kind !== 'attack') return;
    const max = maxAttackDice(s, from);
    if (max < 1) return;
    const dice = Math.min(max, this.sel.dice ?? max) as 1 | 2 | 3;
    const r = this.act(blitz ? { type: 'blitz', player: me, from, to, stopAt: 1 } : { type: 'attack', player: me, from, to, dice });
    if (!r.ok) return;
    const after = this.state!;
    this.sel.auto = false;
    if (after.phase.kind === 'occupy') {
      const ph = after.phase;
      this.sel.occupyCount = occupyDefault(after, ph.from, ph.to, ph.min, ph.max).count;
      return;
    }
    if (after.phase.kind !== 'attack') {
      this.sel = emptySel();
      return;
    }
    if (after.territories[to].owner === me) {
      // Auto-occupied conquest: chain.
      this.sel = { ...emptySel(), selected: autoChain(after, from, to) };
      return;
    }
    if (after.territories[from].armies < 2) this.sel = emptySel();
    else if (this.sel.dice && this.sel.dice > maxAttackDice(after, from)) this.sel.dice = null;
  }

  private doOccupy(): void {
    const s = this.state!;
    if (s.phase.kind !== 'occupy') return;
    const ph = s.phase;
    const count = Math.min(ph.max, Math.max(ph.min, this.sel.occupyCount ?? ph.max));
    const r = this.act({ type: 'occupy', player: s.currentPlayer, count });
    if (!r.ok) return;
    const after = this.state!;
    this.sel = after.phase.kind === 'attack' ? { ...emptySel(), selected: autoChain(after, ph.from, ph.to) } : emptySel();
  }

  private onBoardHover(info: TerritoryPointerInfo | null): void {
    if (this.hoverTimer) {
      this.clock.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (!info) {
      this.hoverTimer = this.timer(() => {
        this.hover = null;
        this.invalidate();
      }, 120);
      return;
    }
    const wasVisible = !!this.hover?.visible;
    this.hover = { t: info.territory, x: info.clientX, y: info.clientY, visible: wasVisible };
    if (!wasVisible) {
      this.hoverTimer = this.timer(() => {
        if (this.hover) this.hover.visible = true;
        this.invalidate();
      }, 350);
    }
    this.invalidate();
  }

  // =========================================================================
  // Buttons, keyboard, intents
  // =========================================================================

  private currentBar(): GameVM['actionBar'] | null {
    return this.getViewModel().game?.actionBar ?? null;
  }

  pressButton(id: ButtonId): void {
    if (this.turnBanner) this.dismissTurnBanner();
    const s = this.state;
    if (!s || this.screen !== 'game') return;
    if (this.now() < this.holdUntil) {
      this.inputDropped++;
      return;
    }
    if (!this.interactive()) {
      this.skipWatched();
      return;
    }
    if (this.busyBlocking()) {
      this.clickThrough(() => this.pressButton(id));
      return;
    }
    const bar = this.currentBar();
    const b = bar?.buttons.find((x) => x.id === id);
    const isChipTrade = id === 'trade' && bar?.chips.some((c) => c.id === 'trade');
    if (!b && !isChipTrade) return;
    if (b && !b.enabled) {
      if (b.why) this.reject('button_disabled', b.why);
      return;
    }
    this.rejection = null;
    this.runButton(id);
    this.saveMeta();
    this.invalidate();
  }

  private runButton(id: ButtonId): void {
    const s = this.state!;
    const me = s.currentPlayer;
    const ph = s.phase;
    const sel = this.sel;
    switch (id) {
      case 'undo': {
        if (ph.kind === 'setup-place') {
          const t = sel.order.pop() ?? (Object.keys(sel.staged)[0] as TerritoryId | undefined);
          if (t && sel.staged[t]) {
            if (sel.staged[t] === 1) delete sel.staged[t];
            else sel.staged[t] = sel.staged[t]! - 1;
            this.play('unplace', { volume: 0.7 });
          }
        } else if (ph.kind === 'reinforce') {
          let t: TerritoryId | undefined;
          while (sel.order.length && !t) {
            const c = sel.order.pop()!;
            if ((ph.placed[c] ?? 0) > 0) t = c;
          }
          t ??= TERRITORY_IDS.find((x) => (ph.placed[x] ?? 0) > 0);
          if (t) this.act({ type: 'unreinforce', player: me, territory: t, count: 1 });
        }
        break;
      }
      case 'trade': {
        if (ph.kind !== 'reinforce') break;
        const hand = s.players[me].cards;
        const pick =
          sel.cardSel.length === 3 && isValidSetSymbols(sel.cardSel.map((id) => hand.find((c) => c.id === id)?.symbol ?? 'wild'))
            ? (sel.cardSel as [number, number, number])
            : bestSet(s, me)?.cardIds;
        if (pick) {
          const r = this.act({ type: 'trade', player: me, cardIds: pick });
          if (r.ok) {
            sel.cardSel = [];
            if (this.meta && !this.meta.setHintSeen.includes(me)) this.meta.setHintSeen.push(me);
          }
        }
        break;
      }
      case 'chooseCards':
        this.cardsOpen = !this.cardsOpen;
        if (this.meta && !this.meta.setHintSeen.includes(me)) this.meta.setHintSeen.push(me);
        break;
      case 'beginAttack':
        if (ph.kind === 'reinforce') {
          const r = this.act({ type: 'endReinforce', player: me });
          if (r.ok) this.sel = emptySel();
        }
        break;
      case 'roll':
        this.doAttack(false);
        break;
      case 'blitz':
        this.doAttack(true);
        break;
      case 'fortifyNext': {
        const r = this.act({ type: 'endAttack', player: me });
        if (r.ok) this.sel = emptySel();
        break;
      }
      case 'endTurn': {
        if (ph.kind === 'reinforce') break;
        this.act({ type: 'endTurn', player: me });
        break;
      }
      case 'move':
        if (ph.kind === 'occupy') this.doOccupy();
        else if (ph.kind === 'fortify' && sel.selected && sel.target) {
          const max = Math.max(1, s.territories[sel.selected].armies - 1);
          const count = Math.min(max, Math.max(1, sel.fortifyCount ?? max));
          this.act({ type: 'fortify', player: me, from: sel.selected, to: sel.target, count });
        }
        break;
      case 'min':
      case 'max':
      case 'dec':
      case 'inc':
        this.stepCounter(id);
        break;
      case 'confirmPlacement': {
        if (ph.kind !== 'setup-place') break;
        const staged = { ...sel.staged };
        this.sel = emptySel();
        for (const t of TERRITORY_IDS) {
          const n = staged[t];
          if (n) this.act({ type: 'placeSetup', player: me, territory: t, count: n });
        }
        break;
      }
      case 'cancel':
        this.backOut();
        break;
    }
  }

  private counterRange(): { min: number; max: number; value: number } | null {
    const s = this.state!;
    const ph = s.phase;
    if (ph.kind === 'occupy') {
      const v = this.sel.occupyCount ?? ph.max;
      return { min: ph.min, max: ph.max, value: v };
    }
    if (ph.kind === 'fortify' && this.sel.selected && this.sel.target) {
      const max = Math.max(1, s.territories[this.sel.selected].armies - 1);
      return { min: 1, max, value: this.sel.fortifyCount ?? max };
    }
    return null;
  }

  private setCount(v: number): void {
    const r = this.counterRange();
    if (!r) return;
    const value = Math.min(r.max, Math.max(r.min, Math.round(v)));
    if (this.state!.phase.kind === 'occupy') this.sel.occupyCount = value;
    else this.sel.fortifyCount = value;
    this.invalidate();
  }

  private stepCounter(id: 'min' | 'max' | 'dec' | 'inc'): void {
    const r = this.counterRange();
    if (!r) return;
    const v = id === 'min' ? r.min : id === 'max' ? r.max : id === 'dec' ? r.value - 1 : r.value + 1;
    this.setCount(v);
  }

  private pill(id: 'plus5' | 'all'): void {
    const s = this.state;
    if (!s || !this.interactive()) return;
    if (this.busyBlocking()) {
      this.clickThrough(() => this.pill(id));
      return;
    }
    const t = this.sel.lastPlaced;
    if (!t) return;
    const ph = s.phase;
    if (ph.kind === 'reinforce' && !ph.mustTrade && ph.remaining > 0) {
      const n = id === 'all' ? ph.remaining : Math.min(5, ph.remaining);
      const r = this.act({ type: 'reinforce', player: s.currentPlayer, territory: t, count: n });
      if (r.ok) for (let i = 0; i < n; i++) this.sel.order.push(t);
    } else if (ph.kind === 'setup-place') {
      const left = ph.toPlace - stagedTotal(this.sel);
      if (left <= 0) return;
      const n = id === 'all' ? left : Math.min(5, left);
      this.sel.staged[t] = (this.sel.staged[t] ?? 0) + n;
      for (let i = 0; i < n; i++) this.sel.order.push(t);
      this.play('place', { volume: 0.8 });
      this.saveMeta();
    }
    this.invalidate();
  }

  /** Esc / Back: one level at a time, then the pause menu. */
  private backOut(): boolean {
    const sel = this.sel;
    const ph = this.state?.phase.kind;
    if (ph === 'fortify' && sel.target) {
      this.sel = { ...emptySel(), selected: sel.selected };
      return true;
    }
    if (sel.target) {
      this.sel = { ...emptySel(), selected: sel.selected };
      return true;
    }
    if (sel.selected) {
      this.sel = emptySel();
      return true;
    }
    return false;
  }

  private primaryButton(): ButtonVM | null {
    const bar = this.currentBar();
    return bar?.buttons.find((b) => b.brass && b.enabled) ?? null;
  }

  private onKey(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.defaultPrevented) return;
    const key = e.key;
    // A keyboard-focused HUD button gets its own Enter/Space.
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if ((key === 'Enter' || key === ' ') && active && active !== document.body && (active.tagName === 'BUTTON' || active.getAttribute('role') === 'button')) return;
    const handled = this.handleKey(key, e.shiftKey, e.repeat);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Returns true when the key was consumed. Exposed for tests via the hooks-free path. */
  handleKey(key: string, shift = false, repeat = false): boolean {
    // Global toggles.
    if (key === 'm' || key === 'M') {
      this.setSettings({ muted: !this.settings.muted });
      return true;
    }
    if (key === 'l' || key === 'L') {
      this.setSettings({ showLabels: !this.settings.showLabels });
      return true;
    }
    if (!this.menuKeys && (this.confirm || this.overlay || this.screen !== 'game' || this.handoff)) {
      // src/ui owns keys on menus, overlays, confirms and the hand-off cover.
      return false;
    }
    if (key === '?') {
      this.setOverlay(this.overlay === 'rules' ? this.overlayReturn : 'rules');
      return true;
    }
    if (key === 'Escape') {
      if (this.confirm) {
        this.confirm = null;
        this.invalidate();
        return true;
      }
      if (this.overlay) {
        this.setOverlay(this.overlay === 'pause' ? null : this.overlayReturn);
        return true;
      }
      if (this.screen === 'newGame') {
        this.screen = 'title';
        this.invalidate();
        return true;
      }
      if (this.screen !== 'game') return false;
      if (this.cardsOpen || this.logOpen) {
        this.cardsOpen = false;
        this.logOpen = false;
        this.invalidate();
        return true;
      }
      if (this.interactive() && this.backOut()) {
        this.invalidate();
        return true;
      }
      this.setOverlay('pause');
      return true;
    }
    if (this.screen === 'victory') {
      if (key === 'Enter' && !repeat) {
        this.intent({ type: 'rematch' });
        return true;
      }
      return false;
    }
    if (this.screen !== 'game' || this.overlay || this.confirm) return false;
    const s = this.state;
    if (!s) return false;

    if (key === 'Enter' || key === ' ') {
      if (repeat) return true;
      if (this.turnBanner) this.dismissTurnBanner();
      if (this.handoff) {
        this.intent({ type: 'handoffAccept' });
        return true;
      }
      if (!this.interactive()) {
        this.skipWatched();
        return true;
      }
      if (key === ' ') {
        if (this.now() < this.spaceGuardUntil) return true;
        if (this.busyBlocking()) {
          // Space skips; it never also commits (UX.md §8.1).
          this.skipAll = true;
          this.board.skipAnimations();
          this.wakeAll();
          this.spaceGuardUntil = this.now() + 300;
          return true;
        }
        const commit = this.commitButton();
        if (commit) this.pressButton(commit);
        return true;
      }
      // Enter: a keyboard-focused tile, else the brass primary.
      if (this.kbFocus) {
        const t = this.kbFocus;
        this.kbFocus = null;
        this.onBoardClick({ territory: t, clientX: 0, clientY: 0, shiftKey: false, altKey: false, metaKey: false, button: 0 });
        return true;
      }
      const run = () => {
        const p = this.primaryButton();
        if (p) this.pressButton(p.id);
      };
      if (this.busyBlocking()) this.clickThrough(run);
      else run();
      return true;
    }
    if (!this.interactive()) return false;
    const lower = key.toLowerCase();
    if (lower === 'e') {
      const bar = this.currentBar();
      const ph = s.phase.kind;
      const want: ButtonId = ph === 'attack' ? 'fortifyNext' : ph === 'fortify' ? 'endTurn' : 'beginAttack';
      if (bar?.buttons.some((b) => b.id === want)) this.pressButton(want);
      return true;
    }
    if (lower === 'b') {
      if (s.phase.kind === 'attack' && this.sel.selected && this.sel.target) this.pressButton('blitz');
      return true;
    }
    if (key === '1' || key === '2' || key === '3') {
      this.setDice(Number(key) as 1 | 2 | 3);
      return true;
    }
    if (key === 'Tab') {
      const list = clickableTerritories(s, this.explainUi(), TERRITORY_IDS);
      if (!list.length) return true;
      const i = this.kbFocus ? list.indexOf(this.kbFocus) : -1;
      const n = list.length;
      this.kbFocus = list[(((shift ? i - 1 : i + 1) % n) + n) % n];
      this.invalidate();
      return true;
    }
    if (lower === 'f') {
      const ids = [this.sel.selected, this.sel.target, this.kbFocus].filter(Boolean) as TerritoryId[];
      this.board.focusTerritories(ids);
      return true;
    }
    return false;
  }

  /** The button Space commits (Blitz, confirm occupy/move/trade/placement); never a phase exit. */
  private commitButton(): ButtonId | null {
    const s = this.state!;
    const ph = s.phase;
    const bar = this.currentBar();
    const has = (id: ButtonId) => bar?.buttons.some((b) => b.id === id && b.enabled);
    if (ph.kind === 'attack' && this.sel.selected && this.sel.target && has('blitz')) return 'blitz';
    if (ph.kind === 'occupy') return 'move';
    if (ph.kind === 'fortify' && has('move')) return 'move';
    if (ph.kind === 'reinforce' && ph.mustTrade && has('trade')) return 'trade';
    if (ph.kind === 'setup-place' && has('confirmPlacement')) return 'confirmPlacement';
    return null;
  }

  private setDice(v: 1 | 2 | 3): void {
    const s = this.state;
    if (!s || !this.sel.selected || s.phase.kind !== 'attack') return;
    const max = maxAttackDice(s, this.sel.selected);
    this.sel.dice = Math.max(1, Math.min(max, v)) as 1 | 2 | 3;
    this.invalidate();
  }

  private setOverlay(o: Overlay): void {
    if (o === 'rules' || o === 'settings') this.overlayReturn = this.overlay === 'rules' || this.overlay === 'settings' ? this.overlayReturn : this.overlay;
    else this.overlayReturn = null;
    this.overlay = o;
    this.invalidate();
    if (!o) this.scheduleAi();
  }

  intent(i: UiIntent): void {
    switch (i.type) {
      case 'nav':
        this.screen = i.screen;
        this.overlay = null;
        this.board.setAttractMode(true);
        if (i.screen === 'title') this.refreshSaveSummary();
        break;
      case 'overlay':
        this.setOverlay(i.overlay);
        break;
      case 'continue':
        if (!this.loadSave()) this.toast("That save couldn't be loaded");
        break;
      case 'seat':
        this.draft = patchSeat(this.draft, i.index, i.patch);
        this.rememberDraft();
        break;
      case 'addSeat':
        this.draft = addSeat(this.draft);
        this.rememberDraft();
        break;
      case 'removeSeat':
        this.draft = removeSeat(this.draft, i.index);
        this.rememberDraft();
        break;
      case 'length':
        this.draft = { ...this.draft, length: i.value };
        this.rememberDraft();
        break;
      case 'setup':
        this.draft = { ...this.draft, setup: i.value };
        this.rememberDraft();
        break;
      case 'house':
        this.draft = sanitizeDraft({ ...this.draft, house: { ...this.draft.house, ...i.patch } });
        this.rememberDraft();
        break;
      case 'start': {
        const vm = buildNewGameVM(this.draft);
        if (!vm.canStart) break;
        this.rememberDraft();
        this.startGame(draftToConfig(this.draft, this.randomSeed()));
        break;
      }
      case 'button':
        this.pressButton(i.id);
        break;
      case 'pill':
        this.pill(i.id);
        break;
      case 'setCount':
        this.setCount(i.value);
        break;
      case 'setDice':
        this.setDice(i.value);
        break;
      case 'toggleCard': {
        const cs = this.sel.cardSel;
        const at = cs.indexOf(i.id);
        if (at >= 0) cs.splice(at, 1);
        else {
          if (cs.length >= 3) cs.shift();
          cs.push(i.id);
        }
        break;
      }
      case 'cardsPanel':
        this.cardsOpen = i.open;
        if (i.open && this.meta && this.state && !this.meta.setHintSeen.includes(this.state.currentPlayer) && this.interactive()) {
          this.meta.setHintSeen.push(this.state.currentPlayer);
        }
        break;
      case 'logPanel':
        this.logOpen = i.open;
        break;
      case 'toggleHints': {
        const s = this.state;
        if (s && this.meta) {
          const p = s.currentPlayer;
          this.meta.hints[p] = !(this.meta.hints[p] ?? true);
          this.saveMeta();
        }
        break;
      }
      case 'aiSpeed':
        this.setSettings({ aiSpeed: i.value });
        break;
      case 'highlightSeat':
        this.seatHighlight = this.seatHighlight === i.player ? null : i.player;
        break;
      case 'handoffAccept':
        if (this.handoff) {
          this.handoff = null;
          this.guardUntil = this.now() + 250;
        }
        break;
      case 'dismissTurnBanner':
        this.dismissTurnBanner();
        break;
      case 'watchAisFinish':
        this.sessionAiSpeed = 'instant';
        this.allHumansOut = false;
        this.allHumansOutDismissed = true;
        this.applyBoardSpeed();
        break;
      case 'endGameNow':
        if (this.allHumansOut) {
          this.endGameNow();
          break;
        }
        this.confirm = { kind: 'endGame', text: this.endGameText() };
        break;
      case 'restart':
        this.confirm = { kind: 'restart', text: `Restart this game?${SEP}Same seats, a new deal.` };
        break;
      case 'confirm': {
        const c = this.confirm;
        this.confirm = null;
        if (c && i.yes) {
          // Both leave the paused game behind: close the pause menu they were opened from.
          this.overlay = null;
          if (c.kind === 'endGame') this.endGameNow();
          else this.restart();
        }
        break;
      }
      case 'saveAndQuit':
        this.save();
        this.wakeAll();
        this.queue = [];
        this.screen = 'title';
        this.overlay = null;
        this.state = null;
        this.disp = null;
        this.board.setAttractMode(true);
        this.refreshSaveSummary();
        break;
      case 'rematch':
        if (this.now() < this.holdUntil) {
          this.inputDropped++;
          break;
        }
        this.rematch();
        break;
      case 'setting':
        this.setSettings(i.patch);
        break;
    }
    this.invalidate();
  }

  private standingsOrder(s: GameState): PlayerId[] {
    return [...s.players]
      .sort((a, b) => {
        const ta = territoryCount(s, a.id);
        const tb = territoryCount(s, b.id);
        if (tb !== ta) return tb - ta;
        const aa = totalArmies(s, a.id);
        const ab = totalArmies(s, b.id);
        if (ab !== aa) return ab - aa;
        if (a.eliminated && b.eliminated) return (b.eliminatedOnTurn ?? 0) - (a.eliminatedOnTurn ?? 0);
        return a.id - b.id;
      })
      .map((p) => p.id);
  }

  private endGameText(): string {
    const s = this.state;
    if (!s) return 'End the game now?';
    const leader = this.standingsOrder(s)[0];
    return `End the game now? ${pName(s, leader)} wins on territories (${territoryCount(s, leader)} of 42).`;
  }

  private endGameNow(): void {
    const s = this.state;
    if (!s) return;
    const leader = this.standingsOrder(s)[0];
    this.clearSave();
    this.wakeAll();
    this.queue = [];
    this.skipAll = true;
    this.board.skipAnimations();
    this.victory = this.buildVictory(s, leader, `Called in round ${Math.max(1, s.round)}`);
    this.screen = 'victory';
    this.allHumansOut = false;
    this.holdUntil = this.now() + 600;
    this.board.setAttractMode(true);
    this.play('victory');
    this.closeTurnMetric();
  }

  private restart(): void {
    const s = this.state;
    if (!s) return;
    this.startGame({ ...s.config, seed: this.randomSeed() });
  }

  private rematch(): void {
    const s = this.state;
    if (!s) {
      this.intent({ type: 'nav', screen: 'newGame' });
      return;
    }
    const players = s.config.players.map((p, i) => ({ ...p, kind: s.players[i]?.kind ?? p.kind }));
    this.startGame({ ...s.config, players, seed: this.randomSeed() });
  }

  // =========================================================================
  // AI highlight reel (UX.md §6.1)
  // =========================================================================

  private aiShouldAct(): boolean {
    const s = this.state;
    if (!s || this.screen !== 'game' || this.overlay || this.confirm || this.handoff) return false;
    if (s.phase.kind === 'game-over') return false;
    return this.isAiDriven(s.currentPlayer);
  }

  private scheduleAi(): void {
    if (this.aiScheduled || this.aiBusy) return;
    if (!this.aiShouldAct()) return;
    // Non-blocking drops may still be landing: the next beat's think time overlaps them.
    if (this.queue.length || this.pumping) return;
    this.aiScheduled = true;
    this.timer(() => {
      this.aiScheduled = false;
      if (this.aiBusy || !this.aiShouldAct() || this.queue.length || this.pumping) return;
      void this.aiBeat();
    }, 0);
  }

  private aiTurnKey(s: GameState): string {
    return s.turn > 0 ? `t${s.turn}` : `s${s.currentPlayer}:${s.players[s.currentPlayer].setupArmies}`;
  }

  private async aiBeat(): Promise<void> {
    this.aiBusy = true;
    const epoch = this.epoch;
    try {
      await this.aiBeatInner();
    } catch (err) {
      const s = this.state;
      if (epoch === this.epoch && s && s.phase.kind !== 'game-over') {
        console.error('[risk] AI beat failed', err);
        const r = this.applyRaw(fallbackAction(s, s.currentPlayer));
        if (r.ok) this.enqueue(r.events.map((ev, i) => ({ ev, after: r.state, end: i === r.events.length - 1 })), { ai: true, skip: true });
      }
    } finally {
      this.aiBusy = false;
    }
    if (!this.queue.length && !this.pumping) {
      if (this.inflight === 0) this.afterSettled();
      else this.scheduleAi();
    }
  }

  private chooseFor(s: GameState): Action {
    return chooseAiAction(s, s.currentPlayer);
  }

  private async aiBeatInner(): Promise<void> {
    let s = this.state!;
    const p = s.currentPlayer;
    const key = this.aiTurnKey(s);
    if (!this.aiCtx || this.aiCtx.key !== key || this.aiCtx.player !== p) {
      const opening = s.round === 1 && !this.humanHasPlayed;
      const fresh: AiTurnCtx = {
        key,
        player: p,
        startedAt: this.now(),
        first: true,
        briefCount: 0,
        capped: false,
        capMs: opening ? AI_OPENING_CAP_MS : AI_TURN_CAP_MS,
        // Round 1 is a land grab: AI-vs-AI fights are pure headline there.
        headlineMs: s.round <= 1 ? AI_OPENING_CAP_MS * 0.6 : AI_HEADLINE_MS,
        compressFrom: s.round <= 1 ? 2 : 3,
      };
      this.aiCtx = fresh;
      if (s.turn > 0) this.timer(() => this.capAiTurn(fresh), fresh.capMs);
    }
    const ctx = this.aiCtx;
    const speed = this.aiSpeed();
    const k = speed === 'fast' ? 0.4 : 1;
    const overCap = ctx.capped || (s.turn > 0 && this.now() - ctx.startedAt > ctx.capMs);
    const name = pName(s, p);
    this.applyBoardSpeed();

    if (speed === 'instant' || overCap) {
      await this.aiInstantTurn(overCap && speed !== 'instant');
      return;
    }

    const ph = s.phase.kind;
    if (ph === 'setup-claim') {
      const a = this.chooseFor(s);
      this.narration = a.type === 'claim' ? `${name} claims ${tName(a.territory)}` : `${name} is choosing`;
      const r = this.applyRaw(a);
      if (!r.ok) return this.aiFallback();
      this.enqueue(r.events.map((ev, i) => ({ ev, after: r.state, end: i === r.events.length - 1 })), { ai: true });
      await this.sleep(120 * k);
      return;
    }

    if (ph === 'setup-place' || ph === 'reinforce') {
      if (ctx.first && ph === 'reinforce') await this.sleep(THINK_TURN_START * k);
      ctx.first = false;
      if (this.state !== s) return; // something else moved the game
      const collected: { ev: GameEvent; after: GameState; end: boolean }[] = [];
      let placed = 0;
      let traded = 0;
      for (let guard = 0; guard < 200; guard++) {
        s = this.state!;
        if (s.currentPlayer !== p || (s.phase.kind !== 'reinforce' && s.phase.kind !== 'setup-place')) break;
        const a = this.chooseFor(s);
        const r = this.applyRaw(a);
        if (!r.ok) {
          const fb = this.applyRaw(fallbackAction(s, p));
          if (!fb.ok) break;
          fb.events.forEach((ev, i) => collected.push({ ev, after: fb.state, end: i === fb.events.length - 1 }));
          continue;
        }
        if (a.type === 'reinforce' || a.type === 'placeSetup') placed += a.count;
        if (a.type === 'trade') traded++;
        r.events.forEach((ev, i) => collected.push({ ev, after: r.state, end: i === r.events.length - 1 }));
        if (a.type === 'endReinforce') break;
      }
      this.narration =
        ph === 'setup-place'
          ? `${name} places ${placed === 1 ? '1 army' : `${placed} armies`}`
          : traded
            ? `${name} trades cards and reinforces`
            : `${name} is reinforcing`;
      const drops = collected.filter((x) => x.ev.type === 'armiesPlaced').length;
      const budget = ph === 'setup-place' ? 800 : 1000;
      const stagger = drops > 1 ? Math.min(50 * k, (budget - 290) / (drops - 1)) : 0;
      this.enqueue(collected, { ai: true, style: 'brief', stagger: Math.max(10, stagger) });
      return;
    }

    if (ph === 'occupy') {
      const r = this.applyRaw(this.chooseFor(s));
      if (!r.ok) return this.aiFallback();
      this.enqueue(r.events.map((ev, i) => ({ ev, after: r.state, end: i === r.events.length - 1 })), { ai: true });
      return;
    }

    if (ph === 'attack') {
      const a0 = this.chooseFor(s);
      if (isAttackAction(a0)) {
        // Once AI-vs-AI fights are compressed (2× / snapped), the pause between them shrinks too.
        const between = ctx.briefCount >= ctx.compressFrom ? THINK_BETWEEN_COMPRESSED : THINK_BETWEEN;
        await this.sleep((ctx.first ? THINK_TURN_START : between) * k);
        ctx.first = false;
        if (this.state !== s || !this.aiShouldAct()) return;
        await this.aiEngagement(a0, speed, ctx);
        return;
      }
      ctx.first = false;
      const r = this.applyRaw(a0);
      if (!r.ok) return this.aiFallback();
      if (a0.type === 'endTurn') this.narration = `${name} ends the turn`;
      this.enqueue(r.events.map((ev, i) => ({ ev, after: r.state, end: i === r.events.length - 1 })), { ai: true });
      return;
    }

    if (ph === 'fortify') {
      const a = this.chooseFor(s);
      this.narration = a.type === 'fortify' ? `${name} fortifies ${tName(a.to)}` : `${name} ends the turn`;
      if (a.type === 'fortify') {
        this.aiHighlights = { arrow: { from: a.from, to: a.to, kind: 'fortify', path: fortifyPath(s, a.from, a.to) ?? undefined } };
        this.invalidate();
      }
      const r = this.applyRaw(a);
      if (!r.ok) return this.aiFallback();
      this.enqueue(r.events.map((ev, i) => ({ ev, after: r.state, end: i === r.events.length - 1 })), { ai: true });
      return;
    }
  }

  /** 10 s into an AI turn: finish what's animating now and play the rest at instant (UX.md §6.1). */
  private capAiTurn(ctx: AiTurnCtx): void {
    const s = this.state;
    if (this.aiCtx !== ctx || !s || s.currentPlayer !== ctx.player || s.phase.kind === 'game-over' || this.aiSpeed() === 'instant') return;
    const d = this.disp;
    if (!d || d.currentPlayer !== ctx.player) return;
    ctx.capped = true;
    for (const e of this.queue) if (e.ai && e.ev.type !== 'turnStarted') e.speed = 0;
    this.setBoardSpeed(0);
    this.board.skipAnimations();
    this.wakeAll();
  }

  private aiFallback(): void {
    const s = this.state;
    if (!s) return;
    const r = this.applyRaw(fallbackAction(s, s.currentPlayer));
    if (r.ok) this.enqueue(r.events.map((ev, i) => ({ ev, after: r.state, end: i === r.events.length - 1 })), { ai: true });
  }

  private onScreenForAi(t: TerritoryId): boolean {
    const pos = this.board.getScreenPosition(t);
    if (!pos) return false;
    if (typeof window === 'undefined') return true;
    const m = 16;
    return (
      pos.x >= this.insets.left + m &&
      pos.x <= window.innerWidth - this.insets.right - m &&
      pos.y >= this.insets.top + m &&
      pos.y <= window.innerHeight - this.insets.bottom - m
    );
  }

  private async waitCamera(): Promise<void> {
    const start = this.now();
    await this.sleep(60);
    while (this.now() - start < 720) {
      const st = this.board.getStats();
      if (st.cameraMoving === undefined) {
        await this.sleep(560 - (this.now() - start));
        return;
      }
      if (!st.cameraMoving) return;
      await this.sleep(40);
    }
  }

  private async aiEngagement(first: Extract<Action, { type: 'attack' | 'blitz' }>, speed: AiSpeed, ctx: AiTurnCtx): Promise<void> {
    const s0 = this.state!;
    const p = s0.currentPlayer;
    const { from, to } = first;
    const defender = s0.territories[to].owner;
    // Fights against a human get the full show; once the turn is past its headline point, later ones
    // play brief (still visible: arrow, badge ticks, flip) instead of stalling the room.
    const pastHeadline = this.now() - ctx.startedAt > ctx.headlineMs;
    const full = speed === 'watch' && this.isHumanSeat(defender, s0) && !this.autoplayOn && !pastHeadline;
    const vsHuman = this.isHumanSeat(defender, s0) && !this.autoplayOn;
    const style: 'full' | 'brief' = full ? 'full' : 'brief';
    const collected: { ev: GameEvent; after: GameState; end: boolean }[] = [];
    let act: Action = first;
    for (let guard = 0; guard < 60; guard++) {
      const r = this.applyRaw(act);
      if (!r.ok) break;
      r.events.forEach((ev, i) => collected.push({ ev, after: r.state, end: i === r.events.length - 1 }));
      const s = this.state!;
      if (s.phase.kind === 'game-over') break;
      if (s.phase.kind === 'occupy') {
        const occ = this.chooseFor(s);
        const r2 = this.applyRaw(occ.type === 'occupy' ? occ : fallbackAction(s, p));
        if (r2.ok) r2.events.forEach((ev, i) => collected.push({ ev, after: r2.state, end: i === r2.events.length - 1 }));
        break;
      }
      if (s.territories[to].owner === p || s.phase.kind !== 'attack') break;
      const next = this.chooseFor(s);
      if (isAttackAction(next) && next.from === from && next.to === to) {
        act = next;
        continue;
      }
      break;
    }
    const d = this.disp!;
    const planned = this.state;
    this.narration = `${pName(d, p)} attacks ${tName(to)} from ${tName(from)}${SEP}${pName(d, defender)} defends`;
    // Camera: frame the fight once if it's off-screen, before the arrow (UX.md §8.3).
    if (!this.onScreenForAi(from) || !this.onScreenForAi(to)) {
      this.board.focusTerritories([from, to]);
      await this.waitCamera();
      if (this.state !== planned) return;
    }
    this.aiHighlights = { selected: from, targets: [to], arrow: { from, to, kind: 'attack' } };
    if (full) {
      this.aiPreview = { from, to };
      this.invalidate();
      await this.sleep(TELEGRAPH_MS);
    }
    if (this.state !== planned) return;
    this.invalidate();
    // Weight follows stakes: AI-vs-AI fights are headlines. From the third one in a turn they run at 2×,
    // and once the turn is past 6 s they snap (the result still lands, with a short beat).
    let boardSpeed: number | undefined;
    let snap = false;
    if (!full && !vsHuman) {
      ctx.briefCount++;
      if (ctx.briefCount >= ctx.compressFrom && speed === 'watch') boardSpeed = 2;
      if (pastHeadline) snap = true;
    }
    // (A snapped conquest still gets the instant-speed 250 ms beat in the pump.)
    this.enqueue(collected, { ai: true, style, speed: snap ? 0 : boardSpeed });
    const beat = this.beat - 1;
    // Clear the telegraph once this engagement's events have played.
    const clear = () => {
      if (this.queue.some((e) => e.beat === beat) || (this.blockingNow && this.blockingNow.beat === beat)) {
        this.timer(clear, 50);
        return;
      }
      if (this.aiPreview?.from === from && this.aiPreview.to === to) this.aiPreview = null;
      if (this.aiHighlights?.arrow?.from === from && this.aiHighlights.arrow.to === to) this.aiHighlights = null;
      this.invalidate();
    };
    this.timer(clear, 50);
  }

  /** Instant AI speed (and the 10 s cap): the rest of the turn snaps, then a 300 ms beat. */
  private async aiInstantTurn(capped: boolean): Promise<void> {
    const s0 = this.state!;
    const p = s0.currentPlayer;
    const turn = s0.turn;
    const collected: { ev: GameEvent; after: GameState; end: boolean }[] = [];
    for (let guard = 0; guard < 2000; guard++) {
      const s = this.state!;
      if (s.phase.kind === 'game-over' || s.currentPlayer !== p || s.turn !== turn) break;
      if (s.turn === 0 && collected.some((x) => x.ev.type === 'setupTurn' || x.ev.type === 'territoryClaimed')) break;
      let r = this.applyRaw(this.chooseFor(s));
      if (!r.ok) r = this.applyRaw(fallbackAction(s, p));
      if (!r.ok) break;
      const rr = r;
      rr.events.forEach((ev, i) => collected.push({ ev, after: rr.state, end: i === rr.events.length - 1 }));
    }
    this.narration = capped ? `${pName(s0, p)} finishes the turn` : `${pName(s0, p)} is playing`;
    this.aiHighlights = null;
    this.aiPreview = null;
    this.enqueue(collected, { ai: true, skip: true });
    await this.sleep(s0.turn === 0 ? 60 : 300);
  }

  // =========================================================================
  // ViewModel
  // =========================================================================

  private viewSel(): Sel {
    return this.frozenSel && this.busyBlocking() ? this.frozenSel : this.sel;
  }

  private buildVM(): ViewModel {
    return {
      screen: this.screen,
      overlay: this.overlay,
      settings: this.settings,
      reducedMotion: this.reducedMotion(),
      save: this.saveSummary,
      newGame: buildNewGameVM(this.draft),
      game: this.buildGame(),
      victory: this.victory,
    };
  }

  private buildGame(): GameVM | null {
    const d = this.disp;
    const s = this.state;
    if (!d || !s || !this.meta) return null;
    const now = this.now();
    if (this.rejection && this.rejection.until <= now) this.rejection = null;
    const cur = d.currentPlayer;
    const interactive = this.interactive() && d.currentPlayer === s.currentPlayer;
    const sel = this.viewSel();
    return {
      topBar: this.buildTopBar(d),
      roster: this.buildRoster(d),
      actionBar: this.buildBar(d, sel, interactive),
      battle: this.buildBattle(d, sel, interactive),
      cards: this.buildCards(d, interactive),
      log: { open: this.logOpen, lines: this.meta.log },
      banner: this.banner ? this.banner.vm : null,
      toasts: this.toasts.map((t) => t.vm),
      turnBanner: this.turnBanner,
      tooltip: this.buildTooltip(d),
      pills: this.buildPills(d, sel, interactive),
      handoff: this.handoff
        ? {
            seat: seatRef(d, this.handoff.player),
            subline: this.handoffSubline(this.handoff.player),
          }
        : null,
      allHumansOut: this.allHumansOut,
      confirm: this.confirm,
      house: { cardBonus: s.config.cardBonus, fortifyRule: s.config.fortifyRule },
    };
    void cur;
  }

  private handoffSubline(p: PlayerId): string {
    const s = this.state!;
    const r = reinforcementsFor(s, p);
    const n = s.players[p].cards.length;
    const parts = [`+${r.total} armies waiting`, n === 1 ? '1 card' : `${n} cards`];
    if (bestSet(s, p)) parts.push('set ready');
    return parts.join(SEP);
  }

  private buildTopBar(d: GameState): TopBarVM {
    const lim = d.config.turnLimit;
    const setup = d.round === 0;
    const finalRound = !!lim && d.round >= lim && !setup;
    const round = setup ? 'Setup' : finalRound ? 'Final round' : lim ? `Round ${d.round} of ${lim}` : `Round ${d.round}`;
    const k = d.phase.kind;
    const step =
      k === 'setup-claim' || k === 'setup-place'
        ? 'setup'
        : k === 'reinforce'
          ? 'reinforce'
          : k === 'attack' || k === 'occupy'
            ? 'attack'
            : k === 'fortify'
              ? 'fortify'
              : null;
    const up = upcomingSetValues(d, 1);
    const nextSet =
      d.config.cardBonus === 'fixed' ? { label: 'Sets 4–10', pulseKey: 0 } : up.length ? { label: `Next set +${up[0]}`, pulseKey: this.nextSetPulse } : null;
    const aiAlive = d.players.some((p) => !p.eliminated && (p.kind === 'ai' || this.autoplayOn));
    return {
      player: seatRef(d, d.currentPlayer),
      round,
      finalRound,
      step,
      nextSet,
      aiSpeed: aiAlive ? this.aiSpeed() : null,
    };
  }

  private buildRoster(d: GameState): RosterRowVM[] {
    const need = territoriesNeeded(d);
    const underAttack =
      this.eng && !this.eng.endedAt && this.eng.style === 'full' && this.isAiDriven(this.eng.attacker) && this.isHumanSeat(this.eng.defender)
        ? this.eng.defender
        : this.aiPreview
          ? d.territories[this.aiPreview.to].owner
          : null;
    return d.players.map((p) => {
      const cards = p.cards.length;
      const elimRound = this.meta?.elimRound[p.id];
      const by = p.eliminatedBy !== undefined ? pName(d, p.eliminatedBy) : null;
      return {
        seat: seatRef(d, p.id),
        current: p.id === d.currentPlayer && d.phase.kind !== 'game-over',
        eliminated: p.eliminated,
        epitaph: p.eliminated
          ? `${upper(p.name)}${SEP}out in round ${elimRound ?? Math.max(1, d.round)}${by ? `${SEP}by ${by}` : ''}`
          : null,
        territories: territoryCount(d, p.id),
        territoriesNeeded: need,
        armies: totalArmies(d, p.id),
        income: p.eliminated || d.round === 0 ? 0 : reinforcementsFor(d, p.id).total,
        continents: continentsOwned(d, p.id).map((c) => CONTINENT_ABBR[c]),
        cards,
        cardState: cards >= 5 ? 'mustTrade' : cards === 4 ? 'warn' : 'normal',
        underAttack: underAttack === p.id && p.kind === 'human',
        highlighted: this.seatHighlight === p.id,
      };
    });
  }

  private buildBar(d: GameState, sel: Sel, interactive: boolean): GameVM['actionBar'] {
    const me = d.currentPlayer;
    const meta = this.meta!;
    const hintsOn = interactive && (meta.hints[me] ?? true);
    let narration: string | null = null;
    let idle: string | null = null;
    if (!interactive) {
      if (d.phase.kind === 'game-over') {
        idle = `${pName(d, d.phase.winner)} wins`;
      } else if (this.handoff) {
        narration = `Pass to ${pName(d, this.handoff.player)}`;
      } else if (this.screen === 'victory') {
        idle = 'The game is over';
      } else {
        const name = pName(d, me);
        narration =
          this.narration ??
          (d.phase.kind === 'reinforce'
            ? `${name} is reinforcing`
            : d.phase.kind === 'setup-place'
              ? `${name} is placing armies`
              : d.phase.kind === 'setup-claim'
                ? d.config.setupMode === 'draft'
                  ? `${name} is claiming`
                  : 'Dealing territories and starting armies'
                : d.phase.kind === 'fortify'
                  ? `${name} is fortifying`
                  : `${name} is attacking`);
      }
    }
    const knock = meta.knockout && meta.knockout.by === me ? { victim: meta.knockout.victim, cards: meta.knockout.cards } : null;
    const bar = buildActionBar({
      s: d,
      sel,
      accent: d.players[me].color,
      interactive,
      narration,
      hintsOn,
      hintsToggleable: interactive,
      rejection: interactive && this.rejection ? { text: this.rejection.text, key: this.rejection.key } : null,
      showWinChance: this.settings.showWinChance,
      firstSetHint: interactive && !meta.setHintSeen.includes(me),
      tradedThisTurn: meta.tradedThisTurn,
      midTurn: knock,
      idleLine: idle,
      lineKey: this.lineKey,
    });
    if (this.now() < this.holdUntil && bar.buttons.length) {
      bar.buttons = bar.buttons.map((b) => (b.brass ? { ...b, busy: true } : b));
      this.timer(() => this.invalidate(), this.holdUntil - this.now() + 10);
    }
    return bar;
  }

  private buildBattle(d: GameState, sel: Sel, interactive: boolean): BattleVM | null {
    const g = this.eng;
    const now = this.now();
    let pair: { from: TerritoryId; to: TerritoryId } | null = null;
    let useEng = false;
    const armed =
      interactive && d.phase.kind === 'attack' && sel.selected && sel.target && d.territories[sel.selected].owner === d.currentPlayer
        ? { from: sel.selected, to: sel.target }
        : null;
    if (g && !g.endedAt && g.style === 'full') {
      pair = g;
      useEng = true;
    } else if (armed) {
      pair = armed;
      useEng = !!g && g.from === armed.from && g.to === armed.to && g.turn === d.turn && !g.conquered;
    } else if (this.aiPreview) {
      pair = this.aiPreview;
    } else if (g && g.endedAt && g.style === 'full' && now - g.endedAt < 2500) {
      pair = g;
      useEng = true;
    }
    if (!pair) return null;
    const { from, to } = pair;
    const attacker = useEng && g ? g.attacker : d.territories[from].owner;
    const defender = useEng && g ? g.defender : d.territories[to].owner;
    if (attacker < 0 || defender < 0 || !d.players[attacker] || !d.players[defender]) return null;
    const a = d.territories[from].armies;
    const def = d.territories[to].owner === defender ? d.territories[to].armies : 0;
    const live = def > 0 && a >= 2 && d.territories[to].owner !== attacker;
    const p = live ? winProbability(a, def) : null;
    const hintsOn = this.meta?.hints[d.currentPlayer] ?? true;
    const tally =
      // Only once a roll has landed: 'URAL 8 → 8 · SIBERIA 3 → 3' before any loss reads as noise.
      useEng && g && (g.blitz || g.rolls >= 2) && (a !== g.startA || def !== g.startD)
        ? `${upper(tName(from))} ${g.startA} → ${a}${SEP}${upper(tName(to))} ${g.startD} → ${def}${p !== null && this.settings.showWinChance ? `${SEP}${pct(p)}%` : ''}`
        : null;
    return {
      attacker: { seat: seatRef(d, attacker), territory: tName(from), armies: a },
      defender: { seat: seatRef(d, defender), territory: tName(to), armies: def },
      odds:
        p !== null
          ? { percent: this.settings.showWinChance ? pct(p) : null, word: oddsWord(p), label: oddsLabel(p, this.settings.showWinChance) }
          : null,
      stakes: live ? attackStakes(d, from, to) : [],
      result: useEng && g ? g.lastResult : null,
      tally,
      rolling: this.rolling && useEng,
      tieHint: hintsOn && useEng && !!g?.tie,
    };
  }

  private cardViewer(d: GameState, interactive: boolean): PlayerId | null {
    if (this.handoff) return null;
    if (interactive) return d.currentPlayer;
    const humans = d.players.filter((p) => p.kind === 'human' && !p.eliminated);
    return humans.length === 1 && !this.autoplayOn ? humans[0].id : null;
  }

  private buildCards(d: GameState, interactive: boolean): CardsVM {
    const viewer = this.cardViewer(d, interactive);
    const up = upcomingSetValues(d, 2);
    const header = d.config.cardBonus === 'fixed' ? 'Sets 4 · 6 · 8 · 10' : `Next set +${up[0]}${SEP}then +${up[1]}`;
    const hints = this.meta?.hints[d.currentPlayer] ?? true;
    if (viewer === null) {
      return {
        open: this.cardsOpen,
        hand: null,
        count: d.players[d.currentPlayer].cards.length,
        header,
        status: '',
        coach: null,
        selectionValue: null,
        canTrade: false,
        mustTrade: false,
        railBadge: null,
      };
    }
    const hand = d.players[viewer].cards;
    const best = bestSet(d, viewer);
    const cs = this.sel.cardSel.filter((id) => hand.some((c) => c.id === id));
    const csValid = cs.length === 3 && isValidSetSymbols(cs.map((id) => hand.find((c) => c.id === id)!.symbol));
    const ph = d.phase;
    const myReinforce = interactive && ph.kind === 'reinforce' && viewer === d.currentPlayer;
    return {
      open: this.cardsOpen,
      hand: hand.map((c) => ({
        id: c.id,
        symbol: c.symbol,
        territory: c.territory ? tName(c.territory) : null,
        ownedBonus: !!c.territory && d.territories[c.territory].owner === viewer,
        selected: cs.includes(c.id),
        suggested: !!best?.cardIds.includes(c.id),
      })),
      count: hand.length,
      header,
      status: best ? `Set ready${SEP}+${best.value}` : noSetStatus(hand),
      coach: hints ? `Sets: 3 alike${SEP}1 of each${SEP}any 2 + wild` : null,
      selectionValue: csValid ? setValue(d, cs) : null,
      canTrade: myReinforce && (csValid || !!best),
      mustTrade: ph.kind === 'reinforce' && ph.mustTrade && viewer === d.currentPlayer,
      railBadge: best ? `Set ready +${best.value}` : null,
    };
  }

  private buildTooltip(d: GameState): TooltipVM | null {
    let t: TerritoryId | null = null;
    let x = 0;
    let y = 0;
    if (this.kbFocus) {
      t = this.kbFocus;
      const pos = this.board.getScreenPosition(t);
      x = pos?.x ?? 0;
      y = pos?.y ?? 0;
    } else if (this.hover?.visible) {
      t = this.hover.t;
      x = this.hover.x;
      y = this.hover.y;
    }
    if (!t || this.blockingNow || this.screen !== 'game') return null;
    const s = this.state!;
    const ts = d.territories[t];
    const c = TERRITORIES[t].continent;
    const ex = explainTerritory(s, this.explainUi(), t);
    return {
      x,
      y,
      name: tName(t),
      continent: `${cName(c)}${SEP}+${CONTINENTS[c].bonus}`,
      owner: ts.owner >= 0 ? seatRef(d, ts.owner) : null,
      armies: ts.armies,
      line: ex.text,
      ok: ex.ok,
      territory: t,
    };
  }

  private buildPills(d: GameState, sel: Sel, interactive: boolean): PillsVM | null {
    if (!interactive || !sel.lastPlaced) return null;
    const ph = d.phase;
    let left = 0;
    if (ph.kind === 'reinforce' && !ph.mustTrade) left = ph.remaining;
    else if (ph.kind === 'setup-place') left = ph.toPlace - stagedTotal(sel);
    if (left <= 0) return null;
    return {
      territory: sel.lastPlaced,
      buttons: [
        { id: 'plus5', label: `+${Math.min(5, left)}`, enabled: true },
        { id: 'all', label: `All ${left}`, enabled: true },
      ],
    };
  }

  private buildHighlights(): BoardHighlights {
    const s = this.state;
    const d = this.disp;
    if (!s || !d || this.screen !== 'game') return {};
    if (this.seatHighlight !== null) {
      return { selectable: TERRITORY_IDS.filter((t) => d.territories[t].owner === this.seatHighlight), dimOthers: true };
    }
    const interactive = this.interactive() && d.currentPlayer === s.currentPlayer;
    if (!interactive) return this.aiHighlights ?? {};
    const sel = this.viewSel();
    const me = d.currentPlayer;
    const ph = d.phase;
    const own = () => TERRITORY_IDS.filter((t) => d.territories[t].owner === me);
    switch (ph.kind) {
      case 'setup-claim':
        return { selectable: TERRITORY_IDS.filter((t) => d.territories[t].owner === UNCLAIMED) };
      case 'setup-place': {
        const left = ph.toPlace - stagedTotal(sel);
        return { selectable: left > 0 ? own() : [], pending: { ...sel.staged } };
      }
      case 'reinforce': {
        const pending = { ...ph.placed };
        if (ph.mustTrade) return { pending };
        if (ph.remaining > 0) return { selectable: own(), pending };
        return { selectable: attackSources(d, me), pending };
      }
      case 'attack': {
        if (!sel.selected || d.territories[sel.selected].owner !== me) return { selectable: attackSources(d, me) };
        const targets = attackTargets(d, sel.selected);
        const armed = sel.target && targets.includes(sel.target) ? sel.target : null;
        return {
          selected: sel.selected,
          targets,
          arrow: armed ? { from: sel.selected, to: armed, kind: 'attack' } : null,
          dimOthers: true,
        };
      }
      case 'occupy':
        return { selected: ph.from, targets: [ph.to], arrow: { from: ph.from, to: ph.to, kind: 'attack' } };
      case 'fortify': {
        if (!sel.selected || d.territories[sel.selected].owner !== me) {
          return { selectable: fortifySources(d, me).filter((t) => fortifyTargets(d, t).length > 0) };
        }
        const targets = selectionTargets(d, sel);
        const dest = sel.target && targets.includes(sel.target) ? sel.target : null;
        return {
          selected: sel.selected,
          targets,
          arrow: dest ? { from: sel.selected, to: dest, kind: 'fortify', path: fortifyPath(d, sel.selected, dest) ?? undefined } : null,
          dimOthers: true,
        };
      }
      case 'game-over':
        return {};
    }
  }

  private pushHighlights(): void {
    const h = this.buildHighlights();
    const key = JSON.stringify(h);
    if (key === this.lastHighlightsKey) return;
    this.lastHighlightsKey = key;
    this.board.setHighlights(h);
  }

  private buildVictory(s: GameState, winner: PlayerId, called: string | null): VictoryVM {
    const meta = this.meta;
    const order = this.standingsOrder(s).filter((p) => p !== winner);
    const ranked = [winner, ...order];
    const reason = s.phase.kind === 'game-over' ? s.phase.reason : null;
    const pctGoal = s.config.dominationPercent;
    const subline =
      called ??
      (reason === 'turnLimit'
        ? `Round ${s.round} of ${s.config.turnLimit}${SEP}most territories`
        : reason === 'domination' && pctGoal >= 100
          ? `Round ${s.round}${SEP}the whole world`
          : `Round ${s.round}${SEP}${pctGoal}% of the world`);
    const awards = meta ? buildAwards(meta.awards, s) : [];
    const timeline = [...s.timeline];
    if (called) {
      timeline.push({
        round: s.round,
        territories: s.players.map((p) => territoryCount(s, p.id)),
        armies: s.players.map((p) => totalArmies(s, p.id)),
      });
    }
    return {
      winner: seatRef(s, winner),
      title: `${upper(pName(s, winner))} RULES THE WORLD`,
      subline,
      awards: awards.map((a) => ({ id: a.id, title: a.title, text: a.text, seat: seatRef(s, a.player) })),
      seats: s.players.map((p) => seatRef(s, p.id)),
      timeline,
      standings: ranked.map((p, i) => ({
        seat: seatRef(s, p),
        place: i + 1,
        territories: territoryCount(s, p),
        stats: s.players[p].stats,
      })),
    };
  }

  // =========================================================================
  // Metrics & hooks
  // =========================================================================

  private openTurnMetric(player: PlayerId): void {
    this.curTurn = {
      player,
      kind: this.isAiDriven(player) ? 'ai' : 'human',
      ms: 0,
      clicks: 0,
      rejected: 0,
      forcedWaitMs: 0,
      start: this.now(),
    };
  }

  private closeTurnMetric(): void {
    const c = this.curTurn;
    if (!c) return;
    const { start, ...rest } = c;
    this.metricTurns.push({ ...rest, ms: Math.round(this.now() - start), forcedWaitMs: Math.round(rest.forcedWaitMs) });
    this.curTurn = null;
  }

  private countClick(): void {
    if (this.curTurn && this.screen === 'game') this.curTurn.clicks++;
  }

  private sampleCamera(): void {
    const tick = () => {
      if (this.screen === 'game' && this.interactive()) {
        let moving = false;
        try {
          moving = !!this.board.getStats().cameraMoving;
        } catch {
          moving = false;
        }
        const t = this.now();
        if (moving && !this.lastCameraMoving && t > this.humanInputSince && t > this.pointerActiveUntil) {
          this.cameraMovesDuringHumanInput++;
        }
        this.lastCameraMoving = moving;
      } else this.lastCameraMoving = false;
      if (!this.disposed) this.timer(tick, 100);
    };
    this.timer(tick, 100);
  }

  private disposed = false;

  private installDom(): void {
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    const onClick = (e: MouseEvent) => {
      if (e.detail > 0 && e.button === 0) this.countClick();
    };
    const onCtx = () => this.countClick();
    const onPointer = () => {
      this.pointerActiveUntil = this.now() + 1000;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointerup', onPointer, true);
    window.addEventListener('wheel', onPointer, { capture: true, passive: true });
    const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMq = () => {
      this.applySettingsToBoard();
      this.invalidate();
    };
    mq?.addEventListener?.('change', onMq);
    this.disposers.push(() => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('contextmenu', onCtx, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointerup', onPointer, true);
      window.removeEventListener('wheel', onPointer, true);
      mq?.removeEventListener?.('change', onMq);
    });
  }

  isIdle(): boolean {
    return (
      !this.pumping &&
      this.queue.length === 0 &&
      this.inflight === 0 &&
      !this.aiBusy &&
      !this.aiScheduled &&
      this.pendingInputs.length === 0 &&
      !this.aiShouldAct()
    );
  }

  metrics(): Metrics {
    let maxDeg = 0;
    try {
      const st = this.board.getStats() as { maxCameraDegPerSec?: number; maxAutoDegPerSec?: number };
      maxDeg = st.maxCameraDegPerSec ?? st.maxAutoDegPerSec ?? 0;
    } catch {
      maxDeg = 0;
    }
    return {
      turns: [...this.metricTurns],
      rolls: [...this.metricRolls],
      maxCameraDegPerSec: maxDeg,
      cameraMovesDuringHumanInput: this.cameraMovesDuringHumanInput,
      inputDropped: this.inputDropped,
    };
  }

  resetMetrics(): void {
    this.metricTurns = [];
    this.metricRolls = [];
    this.inputDropped = 0;
    this.cameraMovesDuringHumanInput = 0;
    if (this.curTurn) {
      this.curTurn.start = this.now();
      this.curTurn.clicks = 0;
      this.curTurn.rejected = 0;
      this.curTurn.forcedWaitMs = 0;
    }
  }

  uiSnapshot(): UiSnapshot {
    const vm = this.getViewModel();
    const g = vm.game;
    const bar = g?.actionBar;
    const battle = g?.battle;
    const banners: string[] = [];
    if (g?.banner) banners.push(g.banner.title);
    if (g?.turnBanner) banners.push(g.turnBanner.title);
    return {
      screen: vm.screen,
      actionBarText: bar?.line1 ?? '',
      actionBarSub: bar?.line2 ?? '',
      primary: bar?.buttons.find((b) => b.brass)?.label ?? null,
      buttons: (bar?.buttons ?? []).map((b) => ({ label: b.label, enabled: b.enabled, ...(b.why ? { why: b.why } : {}) })),
      banners,
      toasts: (g?.toasts ?? []).map((t) => t.text),
      battle: battle
        ? {
            header: `${upper(battle.attacker.seat.name)} ${upper(battle.attacker.territory)} ${battle.attacker.armies} vs ${upper(battle.defender.seat.name)} ${upper(battle.defender.territory)} ${battle.defender.armies}`,
            odds: battle.odds?.label ?? null,
            stakes: battle.stakes.map((x) => x.text),
            result: battle.result,
          }
        : null,
      recap: g?.turnBanner?.recap ?? [],
      tooltip: g?.tooltip ? `${g.tooltip.name}${SEP}${g.tooltip.line}` : null,
      hints: bar?.hints.on ?? false,
    };
  }

  newGameHook(config?: Partial<GameConfig> & { players?: PlayerConfig[] }): void {
    const base = draftToConfig(this.draft, this.randomSeed());
    const players = config?.players ?? base.players;
    const n = players.length;
    const rules = lengthRules(this.draft.length, n);
    const cfg: GameConfig = {
      ...base,
      dominationPercent: rules.dominationPercent,
      turnLimit: rules.turnLimit,
      ...config,
      players,
    };
    if (config?.setupBatch === undefined && cfg.initialPlacement === 'manual' && this.draft.house.setupBatch === 'auto') {
      cfg.setupBatch = Math.max(1, Math.ceil(((cfg.startingArmies ?? ({ 2: 40, 3: 35, 4: 30 } as Record<number, number>)[n]) - Math.floor(42 / n)) / 2));
    }
    this.overlay = null;
    this.startGame(cfg);
  }

  dispatchHook(action: Action): { ok: boolean; error?: string } {
    const r = this.act(action);
    if (r.ok) {
      this.validateSel();
      const s = this.state!;
      if (s.phase.kind === 'occupy' && this.sel.occupyCount === null) {
        this.sel.occupyCount = occupyDefault(s, s.phase.from, s.phase.to, s.phase.min, s.phase.max).count;
      }
      this.invalidate();
      return { ok: true };
    }
    return { ok: false, error: r.error };
  }

  setSpeedHook(animation: number, ai?: AiSpeed): void {
    const a = animation <= 0 ? 0 : animation >= 2 ? 2 : 1;
    this.setSettings({ animationSpeed: a, ...(ai ? { aiSpeed: ai } : {}) });
  }

  autoplay(on: boolean): void {
    this.autoplayOn = on;
    this.applyBoardSpeed();
    this.invalidate();
    this.scheduleAi();
  }

  getState(): GameState | null {
    return this.state;
  }

  setViewportInsets(insets: ViewportInsets): void {
    this.insets = insets;
    this.board.setViewportInsets(insets);
  }

  screenPos(t: TerritoryId): { x: number; y: number } | null {
    return this.board.getScreenPosition(t);
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposers) d();
    this.disposers = [];
    this.wakeAll();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createController(opts: { board: BoardView; audio: AudioEngine } & Partial<ControllerOptions>): GameController {
  const c = new Controller(opts as ControllerOptions);
  const hooks: RiskHooks = {
    getState: () => c.getState(),
    newGame: (config) => c.newGameHook(config),
    dispatch: (action) => c.dispatchHook(action),
    isIdle: () => c.isIdle(),
    waitIdle: (timeoutMs = 15000) =>
      new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (c.isIdle()) resolve();
          else if (Date.now() - start > timeoutMs) reject(new Error('waitIdle timed out'));
          else setTimeout(check, 20);
        };
        check();
      }),
    setSpeed: (a, ai) => c.setSpeedHook(a, ai),
    autoplay: (on) => c.autoplay(on),
    screenPos: (t) => c.screenPos(t),
    stats: () => c.board.getStats(),
    ui: () => c.uiSnapshot(),
    explain: (t) => {
      const e = c.explain(t);
      return { ok: e.ok, ...(e.code ? { code: e.code } : {}), text: e.text };
    },
    metrics: () => c.metrics(),
    resetMetrics: () => c.resetMetrics(),
  };
  return {
    getViewModel: () => c.getViewModel(),
    subscribe: (fn) => c.subscribe(fn),
    intent: (i) => c.intent(i),
    screenPos: (t) => c.screenPos(t),
    setViewportInsets: (insets) => c.setViewportInsets(insets),
    audio: c.audio,
    hooks,
    dispose: () => c.dispose(),
  };
}

