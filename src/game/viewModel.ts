// Contract between the controller (src/game/**) and the HTML UI (src/ui/**).
//
// The controller owns all game logic, timing, and copy: it turns GameState + the event stream into a
// plain-data ViewModel (strings already written, per docs/SIMPLIFY.md) and receives UiIntents back.
// The UI owns layout, styling, and motion: it renders the ViewModel and never imports the engine.
//
// The in-game HUD is two strips and nothing else (docs/SIMPLIFY.md §1): the top strip (one chip per
// seat + the menu) and the bottom strip (step indicator, one line, at most one count control, at most
// two buttons). The dice tray header, one banner, the cards sheet and the menu sheets come and go.

import type { AudioEngine } from '../audio/types';
import type { AiDifficulty, CardSymbol, PlayerColorId, PlayerId, PlayerKind, PlayerStats, TimelinePoint } from '../engine/types';
import type { ViewportInsets } from '../render/BoardView';

// ---------------------------------------------------------------------------
// App-level
// ---------------------------------------------------------------------------

export type Screen = 'boot' | 'title' | 'newGame' | 'game' | 'victory';
/** Sheets over the board: the menu (≡ / Esc) and what it opens. */
export type Overlay = 'pause' | 'rules' | 'settings' | 'log' | null;
export type AiSpeed = 'watch' | 'fast' | 'instant';
export type TextSize = 'laptop' | 'couch' | 'tv';

export interface Settings {
  /** Board animation speed for human turns: 1×, 2×, or 0 = instant. */
  animationSpeed: 0 | 1 | 2;
  aiSpeed: AiSpeed;
  textSize: TextSize; // root font scale 1.0 / 1.25 / 1.5
  /** Territory names on every tile (off by default: the hovered and picked tiles show theirs). */
  showLabels: boolean;
  hideCardsBetweenTurns: boolean; // hand-off cover, default false
  sfxVolume: number; // 0..1
  muted: boolean;
  music: boolean; // default false
  reduceMotion: boolean; // user setting; effective value is ViewModel.reducedMotion
  showWinChance: boolean; // default true
  autoCamera: boolean; // return home at turn start if displaced, default true
}

export interface SeatRef {
  id: PlayerId;
  name: string;
  color: PlayerColorId; // emblem via PLAYER_COLORS[color].emblem
  kind: PlayerKind;
}

// ---------------------------------------------------------------------------
// New game screen
// ---------------------------------------------------------------------------

export type LengthPreset = 'quick' | 'evening' | 'full';
export type SetupPreset = 'quickDeal' | 'placeOwn';

export interface SeatDraft {
  name: string;
  color: PlayerColorId;
  kind: PlayerKind;
  difficulty: AiDifficulty;
}

export interface HouseRulesDraft {
  draft: boolean; // setupMode 'draft' instead of random deal
  cardBonus: 'progressive' | 'fixed';
  fortifyRule: 'connected' | 'adjacent';
  setupBatch: number | 'auto'; // 'auto' = two passes
  seed: number | null; // null = random
}

export interface NewGameVM {
  seats: SeatDraft[]; // 2..4
  length: LengthPreset;
  setup: SetupPreset;
  house: HouseRulesDraft;
  lengthOptions: { id: LengthPreset; label: string; detail: string; estimate: string }[];
  setupOptions: { id: SetupPreset; label: string; detail: string }[];
  /** One line above Start, e.g. 'Territories dealt at random · armies placed for you · first to 30 territories wins'. */
  summary: string;
  canStart: boolean;
  problems: string[]; // e.g. 'Two seats share Cobalt'
  canAddSeat: boolean;
  canRemoveSeat: boolean;
}

// ---------------------------------------------------------------------------
// In-game HUD (docs/SIMPLIFY.md)
// ---------------------------------------------------------------------------

/** One chip per seat in the top strip, in turn order. */
export interface SeatChipVM {
  seat: SeatRef;
  /** Filled in the seat's color. */
  current: boolean;
  /** Struck through and dimmed. */
  eliminated: boolean;
  territories: number;
  /** The hand size, only when it's 3 or more; null otherwise. */
  cards: number | null;
}

export type TurnStep = 'place' | 'attack' | 'fortify';

/** Left end of the bottom strip. */
export interface StepVM {
  /** 'turn' = Place · Attack · Fortify with `current` lit; 'setup' = 'Setup'; 'watching' = "Cobalt's turn". */
  kind: 'turn' | 'setup' | 'watching';
  current: TurnStep | null;
  seat: SeatRef;
  /** 'Setup' / "Cobalt's turn" / '' (the three steps are drawn by the UI). */
  label: string;
}

export type ButtonId =
  | 'place' // 'Place 9'
  | 'undo'
  | 'trade' // 'Trade cards +8'
  | 'cards' // 'Cards 3': opens the read-only hand sheet
  | 'attack' // 'Attack →' (leave Place)
  | 'done' // setup: 'Done' commits the placement
  | 'blitz'
  | 'roll'
  | 'fortify' // 'Fortify →' (leave Attack)
  | 'endTurn'
  | 'move' // 'Move 8' (occupy) / 'Move 5 · end turn' (fortify)
  | 'watchAis' // all humans out: 'Watch to the end'
  | 'callGame'; // all humans out: 'End game'

export interface ButtonVM {
  id: ButtonId;
  label: string; // exact copy
  /** Brass fill. At most one per state. */
  primary: boolean;
  /** A short hold (a knockout, the game ending): a brass underline sweeps and clicks are ignored. */
  busy?: boolean;
}

/** The one count control: a − N + stepper (Place) or a slider (Occupy, Fortify). */
export interface CountVM {
  control: 'stepper' | 'slider';
  value: number;
  min: number;
  max: number;
}

export interface StripVM {
  mode: 'setup' | 'place' | 'attack' | 'occupy' | 'fortify' | 'watching' | 'idle';
  step: StepVM;
  /** 3 px top edge. */
  accent: PlayerColorId;
  /** The one line: ≤ ~50 characters, real names and numbers. */
  line: string;
  /** 'rejection' while a refused-click reason is swapped in (2 s); 'narration' during AI turns. */
  lineKind: 'normal' | 'rejection' | 'narration';
  /** Bumps on every rejection so the UI can re-run the swap even for identical copy. */
  lineKey: number;
  count: CountVM | null;
  /** ≤ 2, in reading order: the secondary (if any), then the primary. */
  buttons: ButtonVM[];
}

export interface BattleSideVM {
  seat: SeatRef;
  territory: string; // display name
  armies: number; // displayed (follows the board, not the state)
}

/** The dice tray's header line, 'URAL 12  vs  SIBERIA 5'. The dice are drawn by the renderer. */
export interface BattleVM {
  attacker: BattleSideVM;
  defender: BattleSideVM;
  rolling: boolean;
}

export interface CardVM {
  id: number;
  symbol: CardSymbol;
  territory: string | null; // display name, null for wild
  /** You own the pictured territory: trading it puts +2 there. */
  ownedBonus: boolean;
  /** Part of the best set (the one a trade uses). */
  inSet: boolean;
}

/** The read-only hand sheet behind `Cards N`. */
export interface CardsVM {
  open: boolean;
  hand: CardVM[];
  /** 'Set ready · +8' / 'Need 1 artillery, or a third match'. */
  status: string;
  /** 'Trade for +8' when a trade is allowed right now; null otherwise. */
  trade: { label: string } | null;
}

export interface LogLineVM {
  id: number;
  round: number;
  seat: SeatRef | null;
  kind: 'engagement' | 'turn' | 'recap' | 'card' | 'continent' | 'elimination' | 'system';
  text: string; // 'Cobalt blitzed Siam from India: 9 vs 3 → took it, lost 2'
}

/** The one banner slot (docs/SIMPLIFY.md §5). */
export interface BannerVM {
  id: number;
  kind: 'turn' | 'continent' | 'elimination';
  /** "JOHN'S TURN" / 'JOHN HOLDS ASIA · +7' / 'SAM IS OUT'. */
  title: string;
  /** Turn banner: '+9 armies' ('' on a resumed mid-turn). Others: ''. */
  sub: string;
  /** Turn banner from round 2, only if you lost territory: 'Cobalt took 2 of yours'. */
  recap: string | null;
  seat: SeatRef | null;
  /** Hold time in ms; the controller removes the banner after it. The UI animates in and out. */
  holdMs: number;
}

export interface GameVM {
  seats: SeatChipVM[];
  strip: StripVM;
  battle: BattleVM | null;
  /** null = not your Place step (or the hand-off cover is up). */
  cards: CardsVM | null;
  /** Oldest first; the Log sheet shows it newest first. */
  log: LogLineVM[];
  banner: BannerVM | null;
  handoff: { seat: SeatRef; subline: string } | null; // 'Pass to Sam' cover
  confirm: { kind: 'endGame' | 'restart'; text: string } | null;
  /** Settings → Seats: hand a human seat to the AI (and back). Empty when there's nothing to offer. */
  seatActions: { seat: SeatRef; label: string; intent: UiIntent }[];
}

// ---------------------------------------------------------------------------
// Victory
// ---------------------------------------------------------------------------

export interface VictoryVM {
  winner: SeatRef;
  title: string; // 'CRIMSON RULES THE WORLD'
  subline: string; // 'Round 23 · 70% of the world' / 'Called in round 14'
  awards: { id: 'nemesis' | 'hotDice' | 'cursedDice' | 'cashIn'; title: string; text: string; seat: SeatRef }[];
  seats: SeatRef[];
  timeline: TimelinePoint[];
  standings: { seat: SeatRef; place: number; territories: number; stats: PlayerStats }[];
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface ViewModel {
  screen: Screen;
  overlay: Overlay;
  settings: Settings;
  /** settings.reduceMotion || prefers-reduced-motion. */
  reducedMotion: boolean;
  /** Continue button: null = no save. */
  save: { summary: string } | null; // 'Round 7 · John vs Sam + 2 AI'
  newGame: NewGameVM;
  game: GameVM | null;
  victory: VictoryVM | null;
  /** Rules sheet, 'This game': the goal, the round limit, card sets, the fortify rule. */
  rulesNotes: string[];
}

export type UiIntent =
  // navigation
  | { type: 'nav'; screen: 'title' | 'newGame' }
  | { type: 'overlay'; overlay: Overlay }
  | { type: 'continue' }
  // new game
  | { type: 'seat'; index: number; patch: Partial<SeatDraft> }
  | { type: 'addSeat' }
  | { type: 'removeSeat'; index: number }
  | { type: 'length'; value: LengthPreset }
  | { type: 'setup'; value: SetupPreset }
  | { type: 'house'; patch: Partial<HouseRulesDraft> }
  | { type: 'start' }
  // in game
  | { type: 'button'; id: ButtonId }
  | { type: 'setCount'; value: number }
  | { type: 'cardsPanel'; open: boolean }
  | { type: 'handoffAccept' }
  | { type: 'dismissTurnBanner' }
  | { type: 'endGameNow' } // opens the confirm
  | { type: 'restart' } // opens the confirm
  | { type: 'confirm'; yes: boolean }
  | { type: 'saveAndQuit' }
  /** Hand a seat to the AI or back, applied at the next safe point. */
  | { type: 'setController'; player: PlayerId; kind: PlayerKind; difficulty?: AiDifficulty }
  // victory
  | { type: 'rematch' }
  // settings
  | { type: 'setting'; patch: Partial<Settings> };

/** What the controller hands the UI. Created in src/main.ts. */
export interface ControllerApi {
  getViewModel(): ViewModel;
  /** Called with a fresh ViewModel at most once per animation frame. Unchanged subtrees keep identity. */
  subscribe(fn: (vm: ViewModel) => void): () => void;
  intent(i: UiIntent): void;
  /** The UI reports HUD-covered edges on resize and text-size change (top strip, bottom strip, tray band). */
  setViewportInsets(insets: ViewportInsets): void;
  /** For button/UI sounds: 'uiClick', 'uiHover' (throttled), 'uiError'. */
  audio: AudioEngine;
}

/** The UI's entry point, implemented in src/ui/index.ts. */
export type MountUi = (root: HTMLElement, api: ControllerApi) => { dispose(): void };
