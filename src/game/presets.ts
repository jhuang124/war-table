// New game screen (UX.md §4.1): the draft the menu edits, its GameConfig mapping, the length/setup
// presets with honest time estimates, the summary line, and the problems that block Start.

import { PLAYER_COLORS, PLAYER_COLOR_IDS, DEFAULT_SEAT_COLORS } from '../shared/palette';
import { STARTING_ARMIES, type GameConfig, type PlayerColorId } from '../engine';
import { SEP } from './copy';
import type { HouseRulesDraft, LengthPreset, NewGameVM, SeatDraft, SetupPreset } from './viewModel';

export interface NewGameDraft {
  seats: SeatDraft[];
  length: LengthPreset;
  setup: SetupPreset;
  house: HouseRulesDraft;
}

export function defaultDraft(): NewGameDraft {
  return {
    seats: [
      { name: 'Player 1', color: DEFAULT_SEAT_COLORS[0], kind: 'human', difficulty: 'normal' },
      { name: PLAYER_COLORS[DEFAULT_SEAT_COLORS[1]].name, color: DEFAULT_SEAT_COLORS[1], kind: 'ai', difficulty: 'normal' },
      { name: PLAYER_COLORS[DEFAULT_SEAT_COLORS[2]].name, color: DEFAULT_SEAT_COLORS[2], kind: 'ai', difficulty: 'normal' },
      { name: PLAYER_COLORS[DEFAULT_SEAT_COLORS[3]].name, color: DEFAULT_SEAT_COLORS[3], kind: 'ai', difficulty: 'normal' },
    ],
    length: 'evening',
    setup: 'quickDeal',
    house: { draft: false, cardBonus: 'progressive', fortifyRule: 'connected', setupBatch: 'auto', seed: null },
  };
}

/** Sanitize a remembered draft (from localStorage) into a valid one. */
export function sanitizeDraft(x: unknown): NewGameDraft {
  const d = defaultDraft();
  if (!x || typeof x !== 'object') return d;
  const o = x as Partial<NewGameDraft>;
  const seats = Array.isArray(o.seats)
    ? o.seats
        .filter((s) => s && typeof s === 'object' && PLAYER_COLOR_IDS.includes(s.color))
        .slice(0, 4)
        .map((s) => ({
          name: typeof s.name === 'string' ? s.name.slice(0, 24) : '',
          color: s.color,
          kind: s.kind === 'ai' ? ('ai' as const) : ('human' as const),
          difficulty: s.difficulty === 'easy' || s.difficulty === 'hard' ? s.difficulty : ('normal' as const),
        }))
    : d.seats;
  return {
    seats: seats.length >= 2 ? seats : d.seats,
    length: o.length === 'quick' || o.length === 'full' ? o.length : 'evening',
    setup: o.setup === 'placeOwn' ? 'placeOwn' : 'quickDeal',
    house: {
      draft: !!o.house?.draft,
      cardBonus: o.house?.cardBonus === 'fixed' ? 'fixed' : 'progressive',
      fortifyRule: o.house?.fortifyRule === 'adjacent' ? 'adjacent' : 'connected',
      setupBatch:
        typeof o.house?.setupBatch === 'number' && o.house.setupBatch >= 1 ? Math.floor(o.house.setupBatch) : 'auto',
      seed: typeof o.house?.seed === 'number' && Number.isFinite(o.house.seed) ? o.house.seed >>> 0 : null,
    },
  };
}

/** Win rules per length preset. 2 players are dealt 50% each, so their thresholds sit higher (lead notes). */
export function lengthRules(length: LengthPreset, players: number): { dominationPercent: number; turnLimit: number | null } {
  const two = players === 2;
  switch (length) {
    case 'quick':
      return { dominationPercent: two ? 75 : 60, turnLimit: 12 };
    case 'evening':
      return { dominationPercent: two ? 80 : 70, turnLimit: null };
    case 'full':
      return { dominationPercent: 100, turnLimit: null };
  }
}

/** Two passes of manual placement: ceil((startingArmies − floor(42 / n)) / 2) → 10 for 2p/4p, 11 for 3p. */
export function autoSetupBatch(players: number, startingArmies = STARTING_ARMIES[players] ?? 30): number {
  return Math.max(1, Math.ceil((startingArmies - Math.floor(42 / players)) / 2));
}

export function territoriesToWin(percent: number): number {
  return Math.ceil((42 * percent) / 100);
}

export function draftToConfig(d: NewGameDraft, seed: number): GameConfig {
  const n = d.seats.length;
  const { dominationPercent, turnLimit } = lengthRules(d.length, n);
  const players = d.seats.map((s, i) => ({
    name: s.name.trim() || (s.kind === 'ai' ? PLAYER_COLORS[s.color].name : `Player ${i + 1}`),
    color: s.color,
    kind: s.kind,
    ...(s.kind === 'ai' ? { difficulty: s.difficulty } : {}),
  }));
  return {
    players,
    setupMode: d.house.draft ? 'draft' : 'random',
    initialPlacement: d.setup === 'placeOwn' ? 'manual' : 'auto',
    setupBatch: d.house.setupBatch === 'auto' ? autoSetupBatch(n) : d.house.setupBatch,
    cardBonus: d.house.cardBonus,
    fortifyRule: d.house.fortifyRule,
    dominationPercent,
    turnLimit,
    seed: d.house.seed ?? seed,
  };
}

// Rounds until someone first holds X% of the board: [median, p90] for normal AIs, from
// `npm run sim -- 200` (SPEC §11.1; 100 games per player count, 2026-09-27). Re-run and paste if the AI
// or the rules change.
const ROUNDS: Record<number, Record<number, [number, number]>> = {
  2: { 60: [1, 3], 70: [4, 7], 75: [4, 8], 80: [5, 9], 100: [8, 11] },
  3: { 60: [6, 11], 70: [8, 15], 75: [9, 18], 80: [10, 18], 100: [13, 22] },
  4: { 60: [8, 14], 70: [11, 19], 75: [12, 21], 80: [13, 26], 100: [15, 31] },
};
/** Humans attack less eagerly than the sim's AIs, so real games run a few more rounds. */
const HUMAN_ROUND_FACTOR = 1.3;
/** Seconds per human turn: UX.md §4.3 puts early turns at 60–90 s; later turns carry more fights. */
const HUMAN_TURN_S = 80;
/** Seconds per AI turn at `watch`: measured in the real app (tests/e2e/round.e2e.ts, median ≈ 5 s). */
const AI_TURN_S = 5;

function fmtRange(loMin: number, hiMin: number): string {
  const r5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);
  if (hiMin <= 100) {
    const a = r5(loMin);
    const b = r5(hiMin);
    return a === b ? `~${a} min` : `~${a}–${b} min`;
  }
  const h = (m: number) => Math.max(1, Math.round((m / 60) * 2) / 2);
  const a = h(loMin);
  const b = h(hiMin);
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return a === b ? `~${fmt(a)} h` : `~${fmt(a)}–${fmt(b)} h`;
}

export function lengthEstimate(length: LengthPreset, seats: SeatDraft[]): string {
  const n = Math.min(4, Math.max(2, seats.length));
  const { dominationPercent, turnLimit } = lengthRules(length, n);
  const row = ROUNDS[n][dominationPercent] ?? ROUNDS[n][70];
  const humans = seats.filter((s) => s.kind === 'human').length;
  const perRound = humans * HUMAN_TURN_S + (n - humans) * AI_TURN_S;
  const cap = (r: number) => (turnLimit ? Math.min(turnLimit, r) : r);
  // Centre on the median; the sim's p90 tail is long, so cap the top at 1.6× the median.
  const lo = (cap(row[0] * 0.8 * HUMAN_ROUND_FACTOR) * perRound) / 60;
  const hi = (cap(Math.min(row[1], row[0] * 1.6) * HUMAN_ROUND_FACTOR) * perRound) / 60;
  return fmtRange(lo, hi);
}

export function draftProblems(d: NewGameDraft): string[] {
  const out: string[] = [];
  const colors = new Map<PlayerColorId, number>();
  for (const s of d.seats) colors.set(s.color, (colors.get(s.color) ?? 0) + 1);
  for (const [c, n] of colors) if (n > 1) out.push(`Two seats share ${PLAYER_COLORS[c].name}`);
  const names = new Map<string, number>();
  for (const s of d.seats) {
    const k = s.name.trim().toLowerCase();
    if (k) names.set(k, (names.get(k) ?? 0) + 1);
  }
  for (const [k, n] of names) {
    if (n > 1) out.push(`Two seats are called ${d.seats.find((s) => s.name.trim().toLowerCase() === k)!.name.trim()}`);
  }
  if (d.seats.length < 2) out.push('Risk needs at least 2 seats');
  return out;
}

export function draftSummary(d: NewGameDraft): string {
  const n = d.seats.length;
  const { dominationPercent, turnLimit } = lengthRules(d.length, n);
  const deal = d.house.draft ? 'Territories claimed in turn' : 'Territories dealt at random';
  const place = d.setup === 'quickDeal' ? 'armies placed for you' : 'you place your own armies';
  const need = territoriesToWin(dominationPercent);
  const goal =
    dominationPercent >= 100
      ? 'take every territory to win'
      : turnLimit
        ? `first to ${need} territories, or most after ${turnLimit} rounds`
        : `first to ${need} territories wins`;
  return [deal, place, goal].join(SEP);
}

export function buildNewGameVM(d: NewGameDraft): NewGameVM {
  const n = d.seats.length;
  const q = lengthRules('quick', n);
  const e = lengthRules('evening', n);
  const problems = draftProblems(d);
  return {
    seats: d.seats,
    length: d.length,
    setup: d.setup,
    house: d.house,
    lengthOptions: [
      { id: 'quick', label: 'Quick', detail: `${q.dominationPercent}% or ${q.turnLimit} rounds`, estimate: lengthEstimate('quick', d.seats) },
      { id: 'evening', label: 'Evening', detail: `${e.dominationPercent}% of the world`, estimate: lengthEstimate('evening', d.seats) },
      { id: 'full', label: 'Full conquest', detail: 'every territory', estimate: lengthEstimate('full', d.seats) },
    ],
    setupOptions: [
      { id: 'quickDeal', label: 'Quick deal', detail: 'armies placed for you' },
      { id: 'placeOwn', label: 'Place your own', detail: '~3 min' },
    ],
    summary: draftSummary(d),
    canStart: problems.length === 0 && n >= 2 && n <= 4,
    problems,
    canAddSeat: n < 4,
    canRemoveSeat: n > 2,
  };
}

/** Apply a seat patch with the naming conventions: AI seats default to their color's name. */
export function patchSeat(d: NewGameDraft, index: number, patch: Partial<SeatDraft>): NewGameDraft {
  const seats = d.seats.map((s) => ({ ...s }));
  const s = seats[index];
  if (!s) return d;
  const wasDefaultName =
    !s.name.trim() || /^Player \d$/.test(s.name.trim()) || s.name === PLAYER_COLORS[s.color].name;
  const next = { ...s, ...patch };
  if (patch.name === undefined && wasDefaultName) {
    if (next.kind === 'ai') next.name = PLAYER_COLORS[next.color].name;
    else if (patch.kind === 'human' || s.name === PLAYER_COLORS[s.color].name) next.name = `Player ${index + 1}`;
  }
  seats[index] = next;
  return { ...d, seats };
}

export function addSeat(d: NewGameDraft): NewGameDraft {
  if (d.seats.length >= 4) return d;
  const used = new Set(d.seats.map((s) => s.color));
  const color = [...DEFAULT_SEAT_COLORS, ...PLAYER_COLOR_IDS].find((c) => !used.has(c)) ?? 'emerald';
  return {
    ...d,
    seats: [...d.seats, { name: PLAYER_COLORS[color].name, color, kind: 'ai', difficulty: 'normal' }],
  };
}

export function removeSeat(d: NewGameDraft, index: number): NewGameDraft {
  if (d.seats.length <= 2) return d;
  return { ...d, seats: d.seats.filter((_, i) => i !== index) };
}
