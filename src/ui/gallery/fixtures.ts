// Fixture ViewModels for ui-gallery.html. Copy follows docs/UX.md §7 so the gallery shows real text.

import type {
  ActionBarVM,
  BattleVM,
  ButtonVM,
  CardsVM,
  ChipVM,
  GameVM,
  LogLineVM,
  NewGameVM,
  RosterRowVM,
  SeatRef,
  Settings,
  TooltipVM,
  TopBarVM,
  ViewModel,
  VictoryVM,
} from '../../game/viewModel';
import type { PlayerStats, TerritoryId, TimelinePoint } from '../../engine/types';

export const JOHN: SeatRef = { id: 0, name: 'John', color: 'crimson', kind: 'human' };
export const SAM: SeatRef = { id: 1, name: 'Sam', color: 'cobalt', kind: 'human' };
export const AMBER: SeatRef = { id: 2, name: 'Amber', color: 'amber', kind: 'ai' };
export const ROSE: SeatRef = { id: 3, name: 'Rose', color: 'rose', kind: 'ai' };
const SEATS = [JOHN, SAM, AMBER, ROSE];

export const SETTINGS: Settings = {
  animationSpeed: 1,
  aiSpeed: 'watch',
  textSize: 'laptop',
  showLabels: true,
  hideCardsBetweenTurns: false,
  sfxVolume: 0.8,
  muted: false,
  music: false,
  reduceMotion: false,
  showWinChance: true,
  autoCamera: true,
};

const btn = (id: ButtonVM['id'], label: string, role: ButtonVM['role'], o: Partial<ButtonVM> = {}): ButtonVM => ({
  id,
  label,
  role,
  keycap: null,
  brass: false,
  enabled: true,
  why: null,
  ...o,
});
const chip = (id: string, label: string, tone: ChipVM['tone'], intent?: ChipVM['intent']): ChipVM => ({ id, label, tone, intent });

export const NEW_GAME: NewGameVM = {
  seats: [
    { name: 'John', color: 'crimson', kind: 'human', difficulty: 'normal' },
    { name: 'Sam', color: 'cobalt', kind: 'human', difficulty: 'normal' },
  ],
  length: 'evening',
  setup: 'quickDeal',
  house: { draft: false, cardBonus: 'progressive', fortifyRule: 'connected', setupBatch: 'auto', seed: null },
  lengthOptions: [
    { id: 'quick', label: 'Quick', detail: '75% or 12 rounds', estimate: '~40 min' },
    { id: 'evening', label: 'Evening', detail: '80% of the world', estimate: '~60–90 min' },
    { id: 'full', label: 'Full conquest', detail: 'every territory', estimate: '2–3 h' },
  ],
  setupOptions: [
    { id: 'quickDeal', label: 'Quick deal', detail: 'Armies placed for you' },
    { id: 'placeOwn', label: 'Place your own', detail: 'Two passes · ~3 min' },
  ],
  summary: 'Territories dealt at random · armies placed for you · first to 34 territories wins',
  canStart: true,
  problems: [],
  canAddSeat: true,
  canRemoveSeat: false,
};

export const NEW_GAME_4: NewGameVM = {
  ...NEW_GAME,
  seats: [
    { name: 'John', color: 'crimson', kind: 'human', difficulty: 'normal' },
    { name: 'Sam', color: 'cobalt', kind: 'human', difficulty: 'normal' },
    { name: 'Amber', color: 'amber', kind: 'ai', difficulty: 'normal' },
    { name: 'Rose', color: 'rose', kind: 'ai', difficulty: 'hard' },
  ],
  lengthOptions: [
    { id: 'quick', label: 'Quick', detail: '60% or 12 rounds', estimate: '~40 min' },
    { id: 'evening', label: 'Evening', detail: '70% of the world', estimate: '~60–90 min' },
    { id: 'full', label: 'Full conquest', detail: 'every territory', estimate: '2–3 h' },
  ],
  summary: 'Territories dealt at random · armies placed for you · first to 30 territories wins',
  canAddSeat: false,
  canRemoveSeat: true,
};

export const NEW_GAME_PROBLEMS: NewGameVM = {
  ...NEW_GAME_4,
  seats: [
    { name: 'John', color: 'crimson', kind: 'human', difficulty: 'normal' },
    { name: 'Sam', color: 'cobalt', kind: 'human', difficulty: 'normal' },
    { name: '', color: 'cobalt', kind: 'ai', difficulty: 'easy' },
  ],
  canStart: false,
  canAddSeat: true,
  problems: ['Two seats share Cobalt', 'Seat 3 needs a name'],
};

const topBar = (o: Partial<TopBarVM> = {}): TopBarVM => ({
  player: JOHN,
  round: 'Round 7',
  finalRound: false,
  step: 'reinforce',
  nextSet: { label: 'Next set +10', pulseKey: 3 },
  aiSpeed: 'watch',
  ...o,
});

const ROSTER: RosterRowVM[] = [
  { seat: JOHN, current: true, eliminated: false, epitaph: null, territories: 14, territoriesNeeded: 30, armies: 41, income: 9, continents: ['SA'], cards: 3, cardState: 'normal', underAttack: false, highlighted: false },
  { seat: SAM, current: false, eliminated: false, epitaph: null, territories: 11, territoriesNeeded: 30, armies: 33, income: 3, continents: [], cards: 4, cardState: 'warn', underAttack: false, highlighted: false },
  { seat: AMBER, current: false, eliminated: false, epitaph: null, territories: 12, territoriesNeeded: 30, armies: 37, income: 6, continents: ['AU'], cards: 1, cardState: 'normal', underAttack: false, highlighted: false },
  { seat: ROSE, current: false, eliminated: false, epitaph: null, territories: 5, territoriesNeeded: 30, armies: 12, income: 3, continents: [], cards: 5, cardState: 'mustTrade', underAttack: false, highlighted: false },
];

const HAND = (suggest: number[], selected: number[] = []): CardsVM['hand'] => [
  { id: 4, symbol: 'infantry', territory: 'Ontario', ownedBonus: false, selected: selected.includes(4), suggested: suggest.includes(4) },
  { id: 11, symbol: 'cavalry', territory: 'Brazil', ownedBonus: true, selected: selected.includes(11), suggested: suggest.includes(11) },
  { id: 30, symbol: 'artillery', territory: 'Mongolia', ownedBonus: false, selected: selected.includes(30), suggested: suggest.includes(30) },
];

const CARDS: CardsVM = {
  open: false,
  hand: HAND([4, 11, 30]),
  count: 3,
  header: 'Next set +10 · then +12',
  status: 'Set ready · +10',
  coach: 'Sets: 3 alike · 1 of each · any 2 + wild',
  selectionValue: null,
  canTrade: false,
  mustTrade: false,
  railBadge: 'Set ready +10',
};

const LOG: LogLineVM[] = [
  { id: 1, round: 6, seat: AMBER, kind: 'engagement', text: 'Amber blitzed Siam from India: 9 vs 3 → took it, lost 2', detail: ['3 v 2 · 6 5 4 v 5 2 · Sam loses 2', '3 v 1 · 6 3 1 v 6 · Amber loses 1', '3 v 1 · 5 4 2 v 1 · Sam loses 1', 'Amber took Siam · moved 6 in'] },
  { id: 2, round: 6, seat: AMBER, kind: 'continent', text: 'Amber holds Australia · +2 a turn', detail: [] },
  { id: 3, round: 6, seat: ROSE, kind: 'engagement', text: 'Rose attacked Ukraine from Ural: 4 vs 2 → held, lost 3', detail: ['3 v 2 · 5 3 2 v 6 3 · Rose loses 2', '2 v 2 · 4 1 v 4 2 · Rose loses 1'] },
  { id: 4, round: 6, seat: SAM, kind: 'card', text: 'Sam traded a set for +8', detail: [] },
  { id: 5, round: 7, seat: JOHN, kind: 'recap', text: 'Since your last turn: Amber took Siam from you', detail: [] },
  { id: 6, round: 7, seat: JOHN, kind: 'turn', text: 'John: +9 armies · 14 territories → 4 · South America +2 · cards +3', detail: [] },
  { id: 7, round: 7, seat: JOHN, kind: 'engagement', text: 'John blitzed Venezuela from Central America: 8 vs 3 → took it, lost 1', detail: ['3 v 2 · 6 6 2 v 4 1 · Sam loses 2', '3 v 1 · 5 3 3 v 5 · John loses 1', '3 v 1 · 6 2 1 v 3 · Sam loses 1'] },
];

const bar = (o: Partial<ActionBarVM>): ActionBarVM => ({
  mode: 'reinforce',
  accent: 'crimson',
  line1: '',
  line1Kind: 'normal',
  line1Key: 0,
  line2: '',
  hints: { on: true, toggleable: true },
  chips: [],
  dice: null,
  counter: null,
  buttons: [],
  ...o,
});

export const BASE_GAME: GameVM = {
  topBar: topBar(),
  roster: ROSTER,
  actionBar: bar({}),
  battle: null,
  cards: CARDS,
  log: { open: false, lines: LOG },
  banner: null,
  toasts: [],
  turnBanner: null,
  tooltip: null,
  pills: null,
  handoff: null,
  allHumansOut: false,
  confirm: null,
};

// ---- action bars ----------------------------------------------------------

const RECEIPTS = [chip('r1', '14 territories → 4', 'receipt'), chip('r2', 'South America +2', 'receipt')];
const endTurn = (o: Partial<ButtonVM> = {}) => btn('endTurn', 'End turn · draw a card', 'exit', o);
const endTurnNo = (o: Partial<ButtonVM> = {}) => btn('endTurn', 'End turn · no card', 'exit', o);

export const BARS: Record<string, ActionBarVM> = {
  'setup-claim': bar({
    mode: 'setup-claim',
    line1: 'Claim a territory · click any parchment tile',
    line2: 'Take turns until all 42 are claimed.',
    buttons: [],
  }),
  'setup-place': bar({
    mode: 'setup-place',
    line1: 'Place 10 armies · 4 left',
    line2: "Stack them where you'll fight first. Right-click takes one back.",
    buttons: [
      btn('undo', 'Undo', 'secondary', { keycap: 'Z' }),
      btn('confirmPlacement', 'Confirm placement', 'primary', { keycap: 'Enter', enabled: false, why: 'Place 4 more' }),
    ],
  }),
  reinforce: bar({
    mode: 'reinforce',
    line1: 'Place 9 armies · click your territories',
    line2: '1 army per 3 territories, plus whole continents. Right-click takes one back.',
    chips: [...RECEIPTS, chip('trade', 'Trade 3 cards · +10', 'brass', { type: 'button', id: 'trade' })],
    buttons: [
      btn('undo', 'Undo', 'secondary', { enabled: false, why: 'Nothing placed yet' }),
      btn('chooseCards', 'Choose cards', 'secondary'),
      btn('beginAttack', 'Begin attack →', 'exit', { keycap: 'E', enabled: false, why: 'Place 9 more' }),
    ],
  }),
  'reinforce-live': bar({
    mode: 'reinforce',
    line1: 'Place 4 more',
    line2: '1 army per 3 territories, plus whole continents. Right-click takes one back.',
    chips: [...RECEIPTS, chip('c', 'Cards +10', 'receipt')],
    buttons: [
      btn('undo', 'Undo', 'secondary'),
      btn('chooseCards', 'Choose cards', 'secondary', { enabled: false, why: 'No set in your hand' }),
      btn('beginAttack', 'Begin attack →', 'exit', { keycap: 'E', enabled: false, why: 'Place 4 more' }),
    ],
  }),
  'reinforce-forced': bar({
    mode: 'reinforce',
    line1: 'Trade a card set first · you hold 5 cards',
    line2: 'At 5 cards you must trade. Your best set gives +10.',
    chips: RECEIPTS,
    buttons: [
      btn('chooseCards', 'Choose cards', 'secondary'),
      btn('trade', 'Trade for +10', 'primary', { keycap: 'Enter', brass: true }),
      btn('beginAttack', 'Begin attack →', 'exit', { keycap: 'E', enabled: false, why: 'Trade a set first' }),
    ],
  }),
  'reinforce-midturn': bar({
    mode: 'reinforce',
    line1: 'You knocked out Rose and took 4 cards · trade down to 4, then keep attacking',
    line2: '',
    buttons: [btn('chooseCards', 'Choose cards', 'secondary'), btn('trade', 'Trade for +12', 'primary', { keycap: 'Enter', brass: true })],
  }),
  'reinforce-done': bar({
    mode: 'reinforce',
    line1: 'All placed · click an enemy to attack',
    line2: 'Or Begin attack →. Right-click still takes one back.',
    chips: RECEIPTS,
    buttons: [
      btn('undo', 'Undo', 'secondary'),
      btn('chooseCards', 'Choose cards', 'secondary', { enabled: false, why: 'No set in your hand' }),
      btn('beginAttack', 'Begin attack →', 'primary', { keycap: 'Enter', brass: true }),
    ],
  }),
  'attack-idle': bar({
    mode: 'attack',
    line1: 'Attack · click an enemy territory next to yours',
    line2: 'You need 2+ armies to attack, because 1 always stays behind.',
    chips: [chip('card', 'No card yet · take 1 territory to earn one', 'status')],
    buttons: [
      btn('roll', 'Roll', 'secondary', { enabled: false, why: 'Pick a target first' }),
      btn('blitz', 'Blitz', 'primary', { keycap: 'Space', enabled: false, why: 'Pick a target first' }),
      btn('fortifyNext', 'Fortify →', 'exit', { keycap: 'E' }),
      endTurnNo(),
    ],
  }),
  'attack-auto': bar({
    mode: 'attack',
    line1: 'Attack Brazil from Venezuela',
    line2: 'Click another of yours to switch.',
    chips: [chip('card', 'No card yet · take 1 territory to earn one', 'status')],
    dice: { value: 3, max: 3 },
    buttons: [
      btn('roll', 'Roll', 'secondary'),
      btn('blitz', 'Blitz', 'primary', { keycap: 'Space', brass: true }),
      btn('fortifyNext', 'Fortify →', 'exit', { keycap: 'E' }),
      endTurnNo(),
    ],
  }),
  'attack-armed': bar({
    mode: 'attack',
    line1: 'Attack Siberia from Ural',
    line2: "Blitz rolls until they fall or you're down to 1.",
    chips: [chip('card', 'Card earned ✓', 'success')],
    dice: { value: 3, max: 3 },
    buttons: [
      btn('roll', 'Roll', 'secondary'),
      btn('blitz', 'Blitz', 'primary', { keycap: 'Space', brass: true }),
      btn('fortifyNext', 'Fortify →', 'exit', { keycap: 'E' }),
      endTurn(),
    ],
  }),
  'attack-dice2': bar({
    mode: 'attack',
    line1: 'Attack Kamchatka from Yakutsk',
    line2: "Blitz rolls until they fall or you're down to 1.",
    chips: [chip('card', 'Card earned ✓', 'success')],
    dice: { value: 2, max: 2 },
    buttons: [
      btn('roll', 'Roll', 'secondary'),
      btn('blitz', 'Blitz', 'primary', { keycap: 'Space', brass: true }),
      btn('fortifyNext', 'Fortify →', 'exit', { keycap: 'E' }),
      endTurn(),
    ],
  }),
  'attack-source': bar({
    mode: 'attack',
    line1: 'Attacking from Ural (8) · click a glowing enemy',
    line2: '',
    chips: [chip('card', 'Card earned ✓', 'success')],
    buttons: [
      btn('roll', 'Roll', 'secondary', { enabled: false, why: 'Pick a target first' }),
      btn('blitz', 'Blitz', 'primary', { keycap: 'Space', enabled: false, why: 'Pick a target first' }),
      btn('fortifyNext', 'Fortify →', 'exit', { keycap: 'E' }),
      endTurn(),
    ],
  }),
  'attack-none': bar({
    mode: 'attack',
    line1: 'No attacks left · every border army is down to 1',
    line2: '',
    chips: [chip('card', 'Card earned ✓', 'success')],
    buttons: [
      btn('roll', 'Roll', 'secondary', { enabled: false, why: 'No territory can attack' }),
      btn('fortifyNext', 'Fortify →', 'primary', { keycap: 'Enter', brass: true }),
      endTurn(),
    ],
  }),
  occupy: bar({
    mode: 'occupy',
    line1: 'You took Siberia · move armies in',
    line2: 'At least 3, one per die you rolled. 1 stays in Ural.',
    counter: { value: 7, min: 3, max: 7, note: 'Ural keeps 1 · still borders Mongolia' },
    buttons: [
      btn('min', 'Min 3', 'secondary'),
      btn('dec', '−', 'secondary'),
      btn('inc', '+', 'secondary', { enabled: false, why: 'Ural keeps 1' }),
      btn('max', 'Max 7', 'secondary', { enabled: false, why: 'Already at max' }),
      btn('move', 'Move 7', 'primary', { keycap: 'Enter', brass: true }),
    ],
  }),
  'fortify-idle': bar({
    mode: 'fortify',
    line1: 'Fortify · one move, then your turn ends',
    line2: 'Troops travel only through your own territories.',
    buttons: [btn('endTurn', 'End turn · draw a card', 'primary', { keycap: 'Enter', brass: true })],
  }),
  'fortify-move': bar({
    mode: 'fortify',
    line1: 'Move from Ural to Afghanistan',
    line2: 'Troops travel only through your own territories.',
    counter: { value: 7, min: 1, max: 7, note: null },
    buttons: [
      btn('min', 'Min 1', 'secondary'),
      btn('dec', '−', 'secondary'),
      btn('inc', '+', 'secondary', { enabled: false, why: 'Ural keeps 1' }),
      btn('max', 'Max 7', 'secondary', { enabled: false, why: 'Already at max' }),
      btn('move', 'Move 7 · ends turn', 'primary', { keycap: 'Enter', brass: true }),
      btn('cancel', 'Cancel', 'exit', { keycap: 'Esc' }),
    ],
  }),
  'fortify-none': bar({
    mode: 'fortify',
    line1: 'Nothing to move · End turn',
    line2: '',
    buttons: [btn('endTurn', 'End turn · draw a card', 'primary', { keycap: 'Enter', brass: true })],
  }),
  watching: bar({
    mode: 'watching',
    accent: 'amber',
    line1: 'Amber attacks Siam from India · Sam defends',
    line1Kind: 'narration',
    line2: '',
    hints: { on: true, toggleable: false },
    buttons: [],
  }),
  rejection: bar({
    mode: 'attack',
    line1: "Peru doesn't border Ural · attack next door (dashed sea lanes count)",
    line1Kind: 'rejection',
    line1Key: 4,
    line2: 'You need 2+ armies to attack, because 1 always stays behind.',
    chips: [chip('card', 'No card yet · take 1 territory to earn one', 'status')],
    buttons: [
      btn('roll', 'Roll', 'secondary', { enabled: false, why: 'Pick a target first' }),
      btn('blitz', 'Blitz', 'primary', { keycap: 'Space', enabled: false, why: 'Pick a target first' }),
      btn('fortifyNext', 'Fortify →', 'exit', { keycap: 'E' }),
      endTurnNo(),
    ],
  }),
  'hints-off': bar({
    mode: 'reinforce',
    line1: 'Place 9 armies · click your territories',
    line2: '',
    hints: { on: false, toggleable: true },
    chips: [...RECEIPTS, chip('trade', 'Trade 3 cards · +10', 'brass', { type: 'button', id: 'trade' })],
    buttons: [
      btn('undo', 'Undo', 'secondary', { enabled: false, why: 'Nothing placed yet' }),
      btn('chooseCards', 'Choose cards', 'secondary'),
      btn('beginAttack', 'Begin attack →', 'exit', { keycap: 'E', enabled: false, why: 'Place 9 more' }),
    ],
  }),
};

// ---- battle ---------------------------------------------------------------

const ARMED: BattleVM = {
  attacker: { seat: JOHN, territory: 'Ural', armies: 8 },
  defender: { seat: SAM, territory: 'Siberia', armies: 3 },
  odds: { percent: 82, word: 'likely', label: 'Blitz · 82% · likely' },
  stakes: [
    { text: 'COMPLETES ASIA · +7 a turn', priority: false },
    { text: 'First conquest this turn · earns a card', priority: false },
  ],
  result: null,
  tally: null,
  rolling: false,
  tieHint: true,
};

export const BATTLES: Record<string, BattleVM> = {
  armed: ARMED,
  'armed-priority': {
    ...ARMED,
    defender: { seat: ROSE, territory: 'Siberia', armies: 2 },
    odds: { percent: 91, word: 'almost sure', label: 'Blitz · 91% · almost sure' },
    stakes: [
      { text: 'KNOCKS OUT ROSE · takes her 5 cards', priority: true },
      { text: 'COMPLETES ASIA · +7 a turn', priority: false },
    ],
  },
  'armed-nochance': { ...ARMED, odds: { percent: null, word: 'likely', label: 'Blitz · likely' }, stakes: [] },
  rolling: { ...ARMED, rolling: true },
  result: { ...ARMED, attacker: { ...ARMED.attacker, armies: 8 }, defender: { ...ARMED.defender, armies: 1 }, result: 'Sam loses 2', odds: { percent: 96, word: 'almost sure', label: 'Blitz · 96% · almost sure' } },
  blitz: {
    ...ARMED,
    attacker: { ...ARMED.attacker, armies: 5 },
    defender: { ...ARMED.defender, armies: 0 },
    result: 'Sam loses 1',
    tally: 'URAL 8 → 5 · SIBERIA 3 → 0 · 58%',
    stakes: [{ text: 'COMPLETES ASIA · +7 a turn', priority: false }],
  },
  'ai-on-human': {
    attacker: { seat: AMBER, territory: 'India', armies: 9 },
    defender: { seat: SAM, territory: 'Siam', armies: 3 },
    odds: { percent: 88, word: 'almost sure', label: 'Blitz · 88% · almost sure' },
    stakes: [{ text: "BREAKS SAM'S AUSTRALIA · −2 a turn for Sam", priority: false }],
    result: null,
    tally: null,
    rolling: false,
    tieHint: false,
  },
};

// ---- victory --------------------------------------------------------------

const series = (vals: number[][]): TimelinePoint[] =>
  vals[0].map((_, i) => ({
    round: i + 1,
    territories: vals.map((v) => v[i]),
    armies: vals.map((v) => v[i] * 3),
  }));
const TL = series([
  [11, 12, 13, 14, 14, 16, 18, 19, 22, 24, 26, 29, 31, 31],
  [10, 11, 11, 10, 12, 11, 10, 9, 8, 8, 7, 6, 5, 5],
  [11, 10, 11, 12, 11, 11, 12, 12, 11, 10, 9, 7, 6, 6],
  [10, 9, 7, 6, 5, 4, 2, 2, 1, 0, 0, 0, 0, 0],
]);
TL[TL.length - 1].round = 13; // the final point repeats the last round

const stats = (a: Partial<PlayerStats>): PlayerStats => ({
  territoriesConquered: 0,
  battlesWon: 0,
  battlesLost: 0,
  armiesDestroyed: 0,
  armiesLost: 0,
  cardsTraded: 0,
  reinforcementsReceived: 0,
  peakTerritories: 0,
  ...a,
});

export const VICTORY: VictoryVM = {
  winner: JOHN,
  title: 'CRIMSON RULES THE WORLD',
  subline: 'Round 13 · 70% of the world',
  awards: [
    { id: 'nemesis', title: 'Nemesis', text: 'John took 11 territories from Sam', seat: JOHN },
    { id: 'cursedDice', title: 'Cursed dice', text: 'Amber: −5 armies of pure bad luck', seat: AMBER },
    { id: 'cashIn', title: 'Biggest cash-in', text: '+20 · round 11', seat: SAM },
  ],
  seats: SEATS,
  timeline: TL,
  standings: [
    { seat: JOHN, place: 1, territories: 31, stats: stats({ territoriesConquered: 29, battlesWon: 61, battlesLost: 38, armiesDestroyed: 142, armiesLost: 97, cardsTraded: 4, reinforcementsReceived: 138, peakTerritories: 31 }) },
    { seat: AMBER, place: 2, territories: 6, stats: stats({ territoriesConquered: 14, battlesWon: 33, battlesLost: 41, armiesDestroyed: 71, armiesLost: 90, cardsTraded: 3, reinforcementsReceived: 96, peakTerritories: 13 }) },
    { seat: SAM, place: 3, territories: 5, stats: stats({ territoriesConquered: 12, battlesWon: 29, battlesLost: 44, armiesDestroyed: 63, armiesLost: 101, cardsTraded: 3, reinforcementsReceived: 88, peakTerritories: 12 }) },
    { seat: ROSE, place: 4, territories: 0, stats: stats({ territoriesConquered: 6, battlesWon: 12, battlesLost: 25, armiesDestroyed: 30, armiesLost: 58, cardsTraded: 1, reinforcementsReceived: 51, peakTerritories: 10 }) },
  ],
};

// ---- assemble -------------------------------------------------------------

export interface Fixture {
  id: string;
  group: string;
  label: string;
  vm: ViewModel;
  /** Post-mount pokes at local UI state. */
  after?: 'openHouse' | 'expandLog' | 'skipVictoryIntro';
  /** Territories the fake dice tray should show (attacker, defender counts). */
  dice?: [number[], number[]] | null;
}

const root = (o: Partial<ViewModel>): ViewModel => ({
  screen: 'game',
  overlay: null,
  settings: SETTINGS,
  reducedMotion: false,
  save: null,
  newGame: NEW_GAME_4,
  game: BASE_GAME,
  victory: null,
  ...o,
});
const game = (o: Partial<GameVM>, r: Partial<ViewModel> = {}): ViewModel => root({ game: { ...BASE_GAME, ...o }, ...r });

const rosterWith = (patch: (r: RosterRowVM, i: number) => Partial<RosterRowVM>): RosterRowVM[] =>
  ROSTER.map((r, i) => ({ ...r, ...patch(r, i) }));

const tip = (x: number, y: number, territory: TerritoryId, extra: Partial<TooltipVM> = {}): TooltipVM => ({
  x,
  y,
  territory,
  name: 'Ukraine',
  continent: 'Europe · +5',
  owner: SAM,
  armies: 4,
  line: 'Attack · 71% · likely',
  ok: true,
  ...extra,
});

export function fixtures(W: number, H: number): Fixture[] {
  const F: Fixture[] = [];
  const add = (id: string, group: string, label: string, vm: ViewModel, extra: Partial<Fixture> = {}) => F.push({ id, group, label, vm, ...extra });

  // Screens
  add('boot', 'Screens', 'Boot', root({ screen: 'boot', game: null }));
  add('title', 'Screens', 'Title, no save', root({ screen: 'title', game: null }));
  add('title-save', 'Screens', 'Title with a save', root({ screen: 'title', game: null, save: { summary: 'Round 7 · John vs Sam + 2 AI' } }));
  add('newgame-2', 'Screens', 'New game, 2 seats', root({ screen: 'newGame', game: null, newGame: NEW_GAME }));
  add('newgame-4', 'Screens', 'New game, 4 seats', root({ screen: 'newGame', game: null, newGame: { ...NEW_GAME_4, setup: 'placeOwn', summary: 'Territories dealt at random · you place armies in two passes · first to 30 territories wins' } }));
  add('newgame-problems', 'Screens', 'New game, problems', root({ screen: 'newGame', game: null, newGame: NEW_GAME_PROBLEMS }));
  add('newgame-house', 'Screens', 'New game, house rules open', root({ screen: 'newGame', game: null, newGame: { ...NEW_GAME_4, house: { draft: true, cardBonus: 'fixed', fortifyRule: 'adjacent', setupBatch: 5, seed: 1234 } } }), { after: 'openHouse' });
  add('victory', 'Screens', 'Victory (intro banner)', root({ screen: 'victory', game: null, victory: VICTORY }));
  add('victory-full', 'Screens', 'Victory: awards + chart', root({ screen: 'victory', game: null, victory: VICTORY }), { after: 'skipVictoryIntro' });

  // Action bar modes
  const setupTop = topBar({ round: 'Setup', step: 'setup', nextSet: null });
  add('setup-claim', 'Action bar', 'Setup · claim', game({ topBar: setupTop, actionBar: BARS['setup-claim'] }));
  add('setup-place', 'Action bar', 'Setup · place (staged)', game({ topBar: setupTop, actionBar: BARS['setup-place'], pills: { territory: 'ural', buttons: [{ id: 'plus5', label: '+5', enabled: false }, { id: 'all', label: 'All 4', enabled: true }] } }));
  add('reinforce', 'Action bar', 'Reinforce · receipts + trade chip', game({ actionBar: BARS.reinforce, cards: { ...CARDS } }));
  add('reinforce-live', 'Action bar', 'Reinforce · placing, pills', game({ actionBar: BARS['reinforce-live'], pills: { territory: 'ukraine', buttons: [{ id: 'plus5', label: '+5', enabled: false }, { id: 'all', label: 'All 4', enabled: true }] } }));
  add('reinforce-forced', 'Action bar', 'Reinforce · forced trade', game({ actionBar: BARS['reinforce-forced'], roster: rosterWith((r, i) => (i === 0 ? { cards: 5, cardState: 'mustTrade' } : {})), cards: { ...CARDS, count: 5, mustTrade: true, railBadge: 'Must trade · +10' } }));
  add('reinforce-midturn', 'Action bar', 'Reinforce · mid-turn trade', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['reinforce-midturn'] }));
  add('reinforce-done', 'Action bar', 'Reinforce · 0 left', game({ actionBar: BARS['reinforce-done'] }));
  add('hints-off', 'Action bar', 'Reinforce · hints off', game({ actionBar: BARS['hints-off'] }));
  add('attack-idle', 'Action bar', 'Attack · nothing selected', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-idle'] }));
  add('attack-source', 'Action bar', 'Attack · source picked', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-source'] }));
  add('attack-auto', 'Action bar', 'Attack · auto-picked source', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-auto'], battle: { ...ARMED, attacker: { seat: JOHN, territory: 'Venezuela', armies: 6 }, defender: { seat: SAM, territory: 'Brazil', armies: 4 }, odds: { percent: 64, word: 'likely', label: 'Blitz · 64% · likely' }, stakes: [{ text: 'COMPLETES SOUTH AMERICA · +2 a turn', priority: false }, { text: 'First conquest this turn · earns a card', priority: false }] } }, {}), { dice: null });
  add('attack-armed', 'Action bar', 'Attack · armed + dice toggle', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-armed'], battle: ARMED }), { dice: null });
  add('attack-dice2', 'Action bar', 'Attack · dice capped at 2', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-dice2'], battle: { ...ARMED, attacker: { seat: JOHN, territory: 'Yakutsk', armies: 3 }, defender: { seat: ROSE, territory: 'Kamchatka', armies: 2 }, odds: { percent: 36, word: 'long shot', label: 'Blitz · 36% · long shot' }, stakes: [] } }), { dice: null });
  add('attack-none', 'Action bar', 'Attack · no sources', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-none'] }));
  add('occupy', 'Action bar', 'Occupy · counter + note', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS.occupy }));
  add('fortify-idle', 'Action bar', 'Fortify · nothing selected', game({ topBar: topBar({ step: 'fortify' }), actionBar: BARS['fortify-idle'] }));
  add('fortify-move', 'Action bar', 'Fortify · source + destination', game({ topBar: topBar({ step: 'fortify' }), actionBar: BARS['fortify-move'] }));
  add('fortify-none', 'Action bar', 'Fortify · none possible', game({ topBar: topBar({ step: 'fortify' }), actionBar: BARS['fortify-none'] }));
  add('watching', 'Action bar', 'Watching an AI turn', game({ topBar: topBar({ player: AMBER, step: 'attack' }), roster: rosterWith((r, i) => ({ current: i === 2, underAttack: i === 1 })), actionBar: BARS.watching, battle: BATTLES['ai-on-human'] }), { dice: null });
  add('rejection', 'Action bar', 'Rejection swap', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS.rejection }));

  // Battle panel
  add('battle-armed', 'Battle', 'Armed with stakes', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-armed'], battle: ARMED }), { dice: null });
  add('battle-priority', 'Battle', 'Armed, priority stakes', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-armed'], battle: BATTLES['armed-priority'] }), { dice: null });
  add('battle-nochance', 'Battle', 'Win chance off', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-armed'], battle: BATTLES['armed-nochance'] }), { dice: null });
  add('battle-rolling', 'Battle', 'Rolling', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-armed'], battle: BATTLES.rolling }), { dice: [[5, 3, 2], [4, 3]] });
  add('battle-result', 'Battle', 'Result', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-armed'], battle: BATTLES.result }), { dice: [[6, 5, 2], [4, 3]] });
  add('battle-blitz', 'Battle', 'Blitz tally', game({ topBar: topBar({ step: 'attack' }), actionBar: BARS.occupy, battle: BATTLES.blitz }), { dice: [[6, 4, 1], [3]] });

  // Cards
  add('cards-set', 'Cards', 'Cards open · set suggested', game({ actionBar: BARS.reinforce, cards: { ...CARDS, open: true } }));
  add('cards-selected', 'Cards', 'Cards open · 3 selected', game({ actionBar: BARS.reinforce, cards: { ...CARDS, open: true, hand: HAND([4, 11, 30], [4, 11, 30]), selectionValue: 10, canTrade: true, status: 'Set ready · +10 · +2 on Brazil' } }));
  add('cards-forced', 'Cards', 'Cards open · forced', game({
    actionBar: BARS['reinforce-forced'],
    roster: rosterWith((r, i) => (i === 0 ? { cards: 5, cardState: 'mustTrade' } : {})),
    cards: {
      ...CARDS,
      open: true,
      count: 5,
      mustTrade: true,
      status: 'You hold 5 · trade a set first',
      railBadge: 'Must trade · +10',
      hand: [
        ...HAND([4, 11, 30])!,
        { id: 42, symbol: 'wild', territory: null, ownedBonus: false, selected: false, suggested: false },
        { id: 19, symbol: 'infantry', territory: 'Egypt', ownedBonus: false, selected: false, suggested: false },
      ],
    },
  }));
  add('cards-none', 'Cards', 'Cards open · no set', game({
    actionBar: BARS['reinforce-done'],
    cards: {
      ...CARDS,
      open: true,
      count: 2,
      hand: [
        { id: 4, symbol: 'infantry', territory: 'Ontario', ownedBonus: false, selected: false, suggested: false },
        { id: 5, symbol: 'infantry', territory: 'Quebec', ownedBonus: true, selected: false, suggested: false },
      ],
      header: 'Next set +10 · then +12',
      status: 'Need 1 more of any kind, or a third match',
      railBadge: null,
    },
  }));
  add('cards-empty', 'Cards', 'Cards open · empty hand', game({ actionBar: BARS['attack-idle'], cards: { ...CARDS, open: true, count: 0, hand: [], status: 'No set yet', railBadge: null } }));

  // Log
  add('log', 'Log', 'Log open, engagement expanded', game({ actionBar: BARS['attack-idle'], topBar: topBar({ step: 'attack' }), log: { open: true, lines: LOG } }), { after: 'expandLog' });

  // Announcements
  add('turn-banner', 'Announce', 'Turn banner with recap', game({ turnBanner: { id: 1, seat: JOHN, title: "JOHN'S TURN", receipt: '+9 armies · 14 territories → 4 · South America +2', recap: ['Amber took Siam and India from you', 'You lost Asia · −7 a turn'], holdMs: 1900 }, actionBar: BARS.reinforce }));
  add('turn-banner-quiet', 'Announce', 'Turn banner, quiet round', game({ turnBanner: { id: 2, seat: SAM, title: "SAM'S TURN", receipt: '+3 armies · 8 territories → minimum 3', recap: ['Quiet round · nobody touched you'], holdMs: 1900 }, topBar: topBar({ player: SAM }), actionBar: { ...BARS.reinforce, accent: 'cobalt', line1: 'Place 3 armies · click your territories' } }));
  add('turn-banner-ai', 'Announce', 'Turn banner, AI (no recap)', game({ turnBanner: { id: 3, seat: ROSE, title: "ROSE'S TURN", receipt: '+3 armies · 5 territories → minimum 3', recap: [], holdMs: 1100 }, topBar: topBar({ player: ROSE }), actionBar: { ...BARS.watching, accent: 'rose', line1: 'Rose is reinforcing' } }));
  add('banner-1', 'Announce', 'Tier 1 banner', game({ banner: { id: 1, tier: 1, title: 'JOHN HOLDS SOUTH AMERICA', subline: '+2 armies a turn', seat: JOHN, holdMs: 1200 }, actionBar: BARS['attack-idle'], topBar: topBar({ step: 'attack' }) }));
  add('banner-merged', 'Announce', 'Tier 1 merged (AI turn)', game({ banner: { id: 4, tier: 1, title: 'AMBER TAKES ASIA · AND BREAKS YOUR AUSTRALIA', subline: '+7 a turn for Amber · −2 a turn for you', seat: AMBER, holdMs: 1200 }, actionBar: BARS.watching, topBar: topBar({ player: AMBER, step: 'attack' }) }));
  add('banner-held', 'Announce', 'Tier 1 upset: HELD!', game({ banner: { id: 5, tier: 1, title: 'HELD!', subline: 'Sam holds Argentina · John had 84%', seat: SAM, holdMs: 1200 }, actionBar: BARS['attack-idle'], topBar: topBar({ step: 'attack' }) }));
  add('banner-cash', 'Announce', 'Tier 1 big trade (numerals)', game({ banner: { id: 7, tier: 1, title: '+15 ARMIES', subline: 'Set #6 · next set is worth 20', seat: SAM, holdMs: 1200 }, actionBar: BARS['attack-idle'], topBar: topBar({ step: 'attack' }) }));
  add('turn-banner-instant', 'Announce', 'Turn banner at instant AI speed', game({ turnBanner: { id: 9, seat: AMBER, title: "AMBER'S TURN", receipt: '+6 armies · 12 territories → 4 · Australia +2', recap: [], holdMs: 500 }, topBar: topBar({ player: AMBER }), actionBar: { ...BARS.watching, line1: 'Amber is reinforcing' } }));
  add('banner-2', 'Announce', 'Tier 2 elimination', game({ banner: { id: 2, tier: 2, title: 'ROSE IS OUT', subline: 'Knocked out by John · round 9 · 4 cards taken', seat: JOHN, holdMs: 1600 }, roster: rosterWith((r, i) => (i === 3 ? { eliminated: true, epitaph: 'ROSE · out in round 9 · by John', territories: 0, armies: 0, cards: 0, cardState: 'normal' } : {})), actionBar: BARS['reinforce-midturn'] }));
  add('toasts', 'Announce', 'Two toasts', game({ toasts: [{ id: 1, text: '+2 on Brazil · you own a traded card’s territory', seat: JOHN }, { id: 2, text: 'John took 4 cards from Rose', seat: JOHN }], actionBar: BARS['reinforce-live'] }));
  add('final-round', 'Announce', 'Final round (turn limit)', game({ topBar: topBar({ round: 'Final round', finalRound: true }), banner: { id: 6, tier: 1, title: 'FINAL ROUND', subline: 'Most territories after this round wins', seat: null, holdMs: 1200 }, actionBar: BARS.reinforce }));

  // Tooltip near each edge
  const t = (id: string, label: string, x: number, y: number, terr: TerritoryId, extra: Partial<TooltipVM> = {}) =>
    add(id, 'Tooltip', label, game({ tooltip: tip(x, y, terr, extra), topBar: topBar({ step: 'attack' }), actionBar: BARS['attack-source'] }));
  t('tooltip', 'Tooltip, mid-board', Math.round(W * 0.55), Math.round(H * 0.4), 'ukraine');
  t('tooltip-tr', 'Tooltip, near top-right', W - 90, 140, 'kamchatka', { name: 'Kamchatka', continent: 'Asia · +7', owner: ROSE, armies: 2, line: 'Kamchatka has only 1 neighbor of yours with 2+ armies', ok: false });
  t('tooltip-tl', 'Tooltip, near top-left', 250, 110, 'alaska', { name: 'Alaska', continent: 'North America · +5', owner: JOHN, armies: 6, line: 'Attack from here · 2 targets' });
  t('tooltip-bl', 'Tooltip, near bottom-left', 260, H - 330, 'argentina', { name: 'Argentina', continent: 'South America · +2', owner: JOHN, armies: 1, line: 'Argentina has 1 army · attacking needs 2, because 1 stays behind', ok: false });
  t('tooltip-br', 'Tooltip, near bottom-right', W - 110, H - 320, 'eastern_australia', { name: 'Eastern Australia', continent: 'Australia · +2', owner: AMBER, armies: 5, line: 'Attack · 22% · long shot' });

  // Modal-ish
  add('handoff', 'Layers', 'Hand-off cover', game({ handoff: { seat: SAM, subline: '+9 armies waiting · 3 cards · set ready' }, cards: { ...CARDS, hand: null }, topBar: topBar({ player: SAM }), actionBar: { ...BARS.reinforce, accent: 'cobalt' } }));
  add('humans-out', 'Layers', 'All humans out', game({ allHumansOut: true, topBar: topBar({ player: AMBER, step: 'attack' }), roster: rosterWith((r, i) => (i < 2 ? { eliminated: true, epitaph: i === 0 ? 'JOHN · out in round 11 · by Amber' : 'SAM · out in round 9 · by Rose', territories: 0, armies: 0, cards: 0, cardState: 'normal', current: false } : { current: i === 2 })), actionBar: { ...BARS.watching, line1: 'Amber attacks Ural from Siberia · Rose defends' } }));
  add('confirm-end', 'Layers', 'Confirm: End game now', game({ confirm: { kind: 'endGame', text: 'End the game now? Crimson wins on territories (24 of 42).' }, actionBar: BARS['attack-idle'] }));
  add('confirm-restart', 'Layers', 'Confirm: Restart', game({ confirm: { kind: 'restart', text: 'Restart with the same seats? This game’s progress is lost.' }, actionBar: BARS['attack-idle'] }));
  add('pause', 'Layers', 'Pause menu', game({ actionBar: BARS['attack-idle'] }, { overlay: 'pause' }));
  add('rules', 'Layers', 'Rules card', game({ actionBar: BARS['attack-idle'], topBar: topBar({ round: 'Round 7 of 12' }) }, { overlay: 'rules' }));
  add('settings', 'Layers', 'Settings', game({ actionBar: BARS['attack-idle'] }, { overlay: 'settings' }));
  add('title-rules', 'Layers', 'Rules from the title', root({ screen: 'title', game: null, overlay: 'rules' }));
  add('roster-highlight', 'Layers', 'Roster row highlighted', game({ roster: rosterWith((r, i) => ({ highlighted: i === 2 })), actionBar: BARS['attack-idle'], topBar: topBar({ step: 'attack' }) }));

  // Reduced motion (static view looks identical; included so the flag is exercised)
  add('reduced', 'Layers', 'Reduced motion on', game({ actionBar: BARS['attack-armed'], battle: ARMED, topBar: topBar({ step: 'attack' }) }, { reducedMotion: true, settings: { ...SETTINGS, reduceMotion: true } }), { dice: null });
  return F;
}
