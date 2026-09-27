// Contract between the controller (src/game/**) and the HTML UI (src/ui/**).
//
// The controller owns all game logic, timing, and copy: it turns GameState + the event stream into a
// plain-data ViewModel (strings already written per docs/UX.md §7) and receives UiIntents back.
// The UI owns layout, styling, and motion: it renders the ViewModel and never imports the engine.
// Additive optional fields are fine; renames and removals need the lead.

import type { AudioEngine } from '../audio/types';
import type {
  AiDifficulty,
  CardSymbol,
  PlayerColorId,
  PlayerId,
  PlayerKind,
  PlayerStats,
  TerritoryId,
  TimelinePoint,
} from '../engine/types';
import type { ViewportInsets } from '../render/BoardView';

// ---------------------------------------------------------------------------
// App-level
// ---------------------------------------------------------------------------

export type Screen = 'boot' | 'title' | 'newGame' | 'game' | 'victory';
export type Overlay = 'pause' | 'rules' | 'settings' | null;
export type AiSpeed = 'watch' | 'fast' | 'instant';
export type TextSize = 'laptop' | 'couch' | 'tv';

export interface Settings {
  /** Board animation speed for human turns: 1×, 2×, or 0 = instant. */
  animationSpeed: 0 | 1 | 2;
  aiSpeed: AiSpeed;
  textSize: TextSize; // root font scale 1.0 / 1.25 / 1.5
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
// New game screen (UX.md §4.1)
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
  setupBatch: number | 'auto'; // 'auto' = two passes (UX.md §4.2)
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
// In-game HUD (UX.md §3, §5, §6, §7, §9)
// ---------------------------------------------------------------------------

export type PhaseStep = 'setup' | 'reinforce' | 'attack' | 'fortify';

export interface TopBarVM {
  player: SeatRef;
  round: string; // 'Round 7' | 'Round 7 of 12' | 'Final round' | 'Setup'
  finalRound: boolean;
  step: PhaseStep | null;
  /** 'Next set +10'. `pulseKey` increments when the value steps up (pulse once). */
  nextSet: { label: string; pulseKey: number } | null;
  /** null = hide the toggle (no AI seat alive). */
  aiSpeed: AiSpeed | null;
}

export interface RosterRowVM {
  seat: SeatRef;
  current: boolean;
  eliminated: boolean;
  epitaph: string | null; // 'SAM · out in round 7 · by John'
  territories: number;
  territoriesNeeded: number;
  armies: number;
  income: number;
  continents: string[]; // ['NA', 'AU']
  cards: number;
  cardState: 'normal' | 'warn' | 'mustTrade'; // warn at 4, mustTrade at 5+
  underAttack: boolean; // glow while an AI attacks this human
  highlighted: boolean; // this row was clicked; its territories are highlighted on the board
}

export interface ChipVM {
  id: string;
  label: string; // '14 territories → 4', 'North America +5', 'Cards +8', 'Hints on', 'Card earned ✓'
  tone: 'receipt' | 'status' | 'brass' | 'success' | 'toggle';
  /** Clickable chips send this intent (e.g. the trade chip, the hints chip). */
  intent?: UiIntent;
}

export type ButtonId =
  | 'undo'
  | 'trade'
  | 'chooseCards'
  | 'beginAttack'
  | 'roll'
  | 'blitz'
  | 'fortifyNext'
  | 'endTurn'
  | 'move'
  | 'min'
  | 'dec'
  | 'inc'
  | 'max'
  | 'confirmPlacement'
  | 'cancel';

export interface ButtonVM {
  id: ButtonId;
  label: string; // exact copy, e.g. 'Move 7 · ends turn', 'End turn · draw a card'
  keycap: string | null; // 'Space' | 'Enter' | 'E' | 'B' | null
  role: 'primary' | 'secondary' | 'exit';
  /** At most one button per state has brass === true (UX.md §8.5). */
  brass: boolean;
  enabled: boolean;
  why: string | null; // disabled reason shown on hover, e.g. 'Place 3 more'
}

export interface ActionBarVM {
  mode:
    | 'setup-claim'
    | 'setup-place'
    | 'reinforce'
    | 'attack'
    | 'occupy'
    | 'fortify'
    | 'watching'
    | 'idle';
  accent: PlayerColorId; // 3 px top edge
  line1: string;
  /** 'rejection' while a refused-click reason is swapped in (UX.md §7.1); 'narration' during AI turns. */
  line1Kind: 'normal' | 'rejection' | 'narration';
  /** Bumps on every rejection so the UI can re-run the swap fade even for identical copy. */
  line1Key: number;
  line2: string; // '' when empty
  hints: { on: boolean; toggleable: boolean };
  chips: ChipVM[];
  /** Dice toggle '3 · 2 · 1' beside Roll when an attack is armed. */
  dice: { value: 1 | 2 | 3; max: 1 | 2 | 3 } | null;
  /** Occupy / fortify count stepper. */
  counter: { value: number; min: number; max: number; note: string | null } | null;
  buttons: ButtonVM[];
}

export interface BattleSideVM {
  seat: SeatRef;
  territory: string; // display name
  armies: number; // displayed (follows the board, not the state)
}

export interface BattleVM {
  attacker: BattleSideVM;
  defender: BattleSideVM;
  /** percent is null when 'show win chance' is off; word always present: almost sure/likely/coin flip/long shot. */
  odds: { percent: number | null; word: string; label: string } | null; // label 'Blitz · 82% · likely'
  stakes: { text: string; priority: boolean }[]; // ≤ 2, priority lines are brass + 20% larger
  result: string | null; // 'Sam loses 2' / 'Each loses 1'
  tally: string | null; // 'URAL 8 → 5 · SIBERIA 3 → 0 · 58%'
  rolling: boolean;
  tieHint: boolean; // show 'tie → defender' micro-labels (hints on)
  /** The dice themselves are drawn by the renderer in the tray band. */
}

export interface CardVM {
  id: number;
  symbol: CardSymbol;
  territory: string | null; // display name, null for wild
  ownedBonus: boolean; // 'yours +2'
  selected: boolean;
  suggested: boolean;
}

export interface CardsVM {
  open: boolean;
  /** null = hidden (hand-off cover up, or not a human's turn). */
  hand: CardVM[] | null;
  count: number;
  header: string; // 'Next set +8 · then +10'
  status: string; // 'Need 1 more of any kind, or a third match' / 'Set ready · +8'
  coach: string | null; // 'Sets: 3 alike · 1 of each · any 2 + wild' (hints on)
  selectionValue: number | null; // value of the currently selected 3, if valid
  canTrade: boolean;
  mustTrade: boolean;
  railBadge: string | null; // 'Set ready +8'
}

export interface LogLineVM {
  id: number;
  round: number;
  seat: SeatRef | null;
  kind: 'engagement' | 'turn' | 'recap' | 'card' | 'continent' | 'elimination' | 'system';
  text: string; // 'Cobalt blitzed Siam from India: 9 vs 3 → took it, lost 2'
  detail: string[]; // per-roll lines, shown when the line is expanded
}

export interface BannerVM {
  id: number;
  tier: 1 | 2 | 3;
  title: string; // 'JOHN HOLDS SOUTH AMERICA'
  subline: string; // '+2 armies a turn'
  seat: SeatRef | null;
  /** Hold time in ms; the controller removes the banner after it. The UI animates in/out. */
  holdMs: number;
}

export interface ToastVM {
  id: number;
  text: string;
  seat: SeatRef | null;
}

export interface TurnBannerVM {
  id: number;
  seat: SeatRef;
  title: string; // "SAM'S TURN"
  receipt: string; // '+9 armies · 14 territories → 4 · North America +5'
  recap: string[]; // ≤ 2 lines (UX.md §6.2)
  holdMs: number;
}

export interface TooltipVM {
  /** Client px of the pointer; the UI offsets 18 px up-right and flips to stay in the viewport. */
  x: number;
  y: number;
  name: string;
  continent: string; // 'Europe · +5'
  owner: SeatRef | null;
  armies: number;
  line: string; // from explainTerritory: a verb or the reason
  ok: boolean;
}

export interface PillsVM {
  /** Anchor: the UI positions the cluster under this tile's badge each frame via ControllerApi.screenPos. */
  territory: TerritoryId;
  buttons: { id: 'plus5' | 'all'; label: string; enabled: boolean }[]; // '+5', 'All 8'
}

export interface GameVM {
  topBar: TopBarVM;
  roster: RosterRowVM[];
  actionBar: ActionBarVM;
  battle: BattleVM | null;
  cards: CardsVM;
  log: { open: boolean; lines: LogLineVM[] };
  banner: BannerVM | null;
  toasts: ToastVM[]; // ≤ 2
  turnBanner: TurnBannerVM | null;
  tooltip: TooltipVM | null;
  pills: PillsVM | null;
  handoff: { seat: SeatRef; subline: string } | null; // 'Pass to Sam' cover
  allHumansOut: boolean; // non-modal card with Watch / End game
  confirm: { kind: 'endGame' | 'restart'; text: string } | null;
}

// ---------------------------------------------------------------------------
// Victory (UX.md §4.6)
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
  | { type: 'pill'; id: 'plus5' | 'all' }
  | { type: 'setCount'; value: number }
  | { type: 'setDice'; value: 1 | 2 | 3 }
  | { type: 'toggleCard'; id: number }
  | { type: 'cardsPanel'; open: boolean }
  | { type: 'logPanel'; open: boolean }
  | { type: 'toggleHints' }
  | { type: 'aiSpeed'; value: AiSpeed }
  | { type: 'highlightSeat'; player: PlayerId | null }
  | { type: 'handoffAccept' }
  | { type: 'dismissTurnBanner' }
  | { type: 'watchAisFinish' }
  | { type: 'endGameNow' } // opens the confirm
  | { type: 'restart' } // opens the confirm
  | { type: 'confirm'; yes: boolean }
  | { type: 'saveAndQuit' }
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
  /** Client-px position of a territory's badge anchor (for the reinforce pills), or null off-screen. */
  screenPos(t: TerritoryId): { x: number; y: number } | null;
  /** The UI reports HUD-covered edges on resize, text-size change, and drawer open/close. */
  setViewportInsets(insets: ViewportInsets): void;
  /** For button/UI sounds: 'uiClick', 'uiHover' (throttled), 'uiError'. */
  audio: AudioEngine;
}

/** The UI's entry point, implemented in src/ui/index.ts. */
export type MountUi = (root: HTMLElement, api: ControllerApi) => { dispose(): void };
