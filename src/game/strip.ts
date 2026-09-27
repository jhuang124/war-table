// The bottom strip (docs/SIMPLIFY.md §1, §2): the step indicator, one line that says the one thing to
// do now, at most one count control and at most two buttons (one brass primary). Pure: built from the
// displayed state + the input selection.

import { attackSources, attackTargets, fortifySources, fortifyTargets, winProbability, type GameState, type TerritoryId } from '../engine';
import { SEP, armies, pName, pct, poss, seatRef, tName } from './copy';
import { bestSet, oddsWord } from './helpers';
import type { ButtonId, ButtonVM, CountVM, StepVM, StripVM } from './viewModel';

export interface Placement {
  t: TerritoryId;
  n: number;
}

export interface Sel {
  /** Place: the picked territory. Attack / fortify: the source. */
  selected: TerritoryId | null;
  /** Armed attack target / chosen fortify destination. */
  target: TerritoryId | null;
  /** Place stepper; null = all remaining. */
  placeCount: number | null;
  occupyCount: number | null;
  fortifyCount: number | null;
  /** Manual setup: armies staged locally this setup turn (committed on Done). */
  staged: Partial<Record<TerritoryId, number>>;
  /** Placements this step, newest last, for Undo (reinforce and setup). */
  placements: Placement[];
}

export function emptySel(): Sel {
  return { selected: null, target: null, placeCount: null, occupyCount: null, fortifyCount: null, staged: {}, placements: [] };
}

export function stagedTotal(sel: Sel): number {
  let n = 0;
  for (const v of Object.values(sel.staged)) n += v ?? 0;
  return n;
}

/** Armies still to place in this Place / setup step (0 outside them). */
export function placeLeft(s: GameState, sel: Sel): number {
  const ph = s.phase;
  if (ph.kind === 'setup-place') return Math.max(0, ph.toPlace - stagedTotal(sel));
  if (ph.kind === 'reinforce' && !ph.mustTrade) return ph.remaining;
  return 0;
}

/** The Place stepper's value: the picked count, clamped, or all remaining. */
export function placeValue(s: GameState, sel: Sel): number {
  const left = placeLeft(s, sel);
  return Math.max(1, Math.min(left, sel.placeCount ?? left));
}

/** Line while the opening deal plays (a random deal: nothing to click, a click only skips it). */
export function dealingLine(): string {
  return 'Dealing territories';
}

export interface StripInput {
  s: GameState;
  sel: Sel;
  /** The driver may act (a human's own turn, no cover). */
  interactive: boolean;
  /** Watching line (AI turns). */
  narration: string | null;
  /** The hand-off cover is up for this seat. */
  handoff: number | null;
  /** Every human is out: offer to watch to the end or call it. */
  humansOut: boolean;
  /** Idle line (game over, etc.). */
  idleLine: string | null;
  rejection: { text: string; key: number } | null;
  showWinChance: boolean;
  lineKey: number;
  /**
   * A conquest is on screen but the selection that armed it hasn't caught up (the flood and march are
   * still playing): the line says what happened instead of describing a half-moved board.
   */
  took?: TerritoryId | null;
}

const btn = (id: ButtonId, label: string, primary = false): ButtonVM => ({ id, label, primary });

/** 'Attack Siberia from Ural · 82%' ('· likely' when the win chance is hidden). */
export function attackLine(s: GameState, from: TerritoryId, to: TerritoryId, showWinChance: boolean): string {
  const head = `Attack ${tName(to)} from ${tName(from)}`;
  const a = s.territories[from].armies;
  const d = s.territories[to].armies;
  if (a < 2 || d < 1) return head;
  const p = winProbability(a, d);
  return `${head}${SEP}${showWinChance ? `${pct(p)}%` : oddsWord(p)}`;
}

export function canFortifyAny(s: GameState): boolean {
  return fortifySources(s, s.currentPlayer).some((t) => fortifyTargets(s, t).length > 0);
}

export function buildStrip(inp: StripInput): StripVM {
  const { s, sel } = inp;
  const me = s.currentPlayer;
  const seat = seatRef(s, me);
  const accent = s.players[me].color;
  const turnStep = (current: StepVM['current']): StepVM => ({ kind: 'turn', current, seat, label: '' });
  const setupStep: StepVM = { kind: 'setup', current: null, seat, label: 'Setup' };
  const make = (mode: StripVM['mode'], step: StepVM, line: string, extra: { count?: CountVM | null; buttons?: ButtonVM[] } = {}): StripVM => ({
    mode,
    step,
    accent,
    line: inp.rejection ? inp.rejection.text : line,
    lineKind: inp.rejection ? 'rejection' : 'normal',
    lineKey: inp.rejection ? inp.rejection.key : inp.lineKey,
    count: extra.count ?? null,
    buttons: extra.buttons ?? [],
  });

  if (!inp.interactive) {
    if (inp.humansOut) {
      return {
        mode: 'watching',
        step: { kind: 'watching', current: null, seat, label: `${poss(pName(s, me))} turn` },
        accent,
        line: 'All humans are out',
        lineKind: 'normal',
        lineKey: inp.lineKey,
        count: null,
        buttons: [btn('callGame', 'End game'), btn('watchAis', 'Watch to the end', true)],
      };
    }
    const who = inp.handoff ?? me;
    const whoSeat = s.players[who] ? seatRef(s, who) : seat;
    // The opening deal belongs to nobody: it reads 'Setup', not "Cobalt's turn".
    const dealing = s.phase.kind === 'setup-claim' && s.config.setupMode !== 'draft' && inp.handoff === null;
    const line = inp.handoff !== null ? `Pass to ${pName(s, inp.handoff)}` : (inp.narration ?? inp.idleLine ?? `${poss(pName(s, me))} turn`);
    return {
      mode: inp.idleLine && !inp.narration ? 'idle' : 'watching',
      step: dealing ? setupStep : { kind: 'watching', current: null, seat: whoSeat, label: `${poss(whoSeat.name)} turn` },
      accent: s.players[who]?.color ?? accent,
      line,
      lineKind: inp.narration && inp.handoff === null ? 'narration' : 'normal',
      lineKey: inp.lineKey,
      count: null,
      buttons: [],
    };
  }

  const ph = s.phase;
  switch (ph.kind) {
    case 'setup-claim':
      if (s.config.setupMode !== 'draft') return make('setup', setupStep, dealingLine());
      return make('setup', setupStep, `Claim a territory${SEP}click an open tile`);
    case 'setup-place': {
      const staged = stagedTotal(sel);
      const left = Math.max(0, ph.toPlace - staged);
      const undo = sel.placements.length > 0 ? [btn('undo', 'Undo')] : [];
      if (left === 0) return make('setup', setupStep, `All ${ph.toPlace} placed`, { buttons: [...undo, btn('done', 'Done', true)] });
      if (sel.selected && s.territories[sel.selected].owner === me) {
        const n = placeValue(s, sel);
        return make('setup', setupStep, `Place on ${tName(sel.selected)}`, {
          count: { control: 'stepper', value: n, min: 1, max: left },
          buttons: [...undo, btn('place', `Place ${n}`, true)],
        });
      }
      const line = staged > 0 ? `Place ${left} more${SEP}click a territory` : `Place ${armies(left)}${SEP}click a territory`;
      return make('setup', setupStep, line, { buttons: undo });
    }
    case 'reinforce': {
      const step = turnStep('place');
      const hand = s.players[me].cards;
      const best = bestSet(s, me);
      const placedAny = Object.values(ph.placed).some((v) => (v ?? 0) > 0);
      const trade = best ? btn('trade', `Trade cards +${best.value}`) : null;
      if (ph.mustTrade) {
        return make('place', step, `Trade cards first${SEP}you hold ${hand.length}`, {
          buttons: trade ? [{ ...trade, primary: true }] : [],
        });
      }
      const undo = placedAny ? btn('undo', 'Undo') : null;
      const cards = hand.length > 0 ? btn('cards', `Cards ${hand.length}`) : null;
      if (ph.remaining === 0) {
        return make('place', step, ph.midTurn ? `All placed${SEP}keep attacking` : `All placed${SEP}attack next`, {
          buttons: [...(undo ? [undo] : []), btn('attack', 'Attack →', true)],
        });
      }
      if (sel.selected && s.territories[sel.selected].owner === me) {
        const n = placeValue(s, sel);
        const second = undo ?? trade;
        return make('place', step, `Place on ${tName(sel.selected)}`, {
          count: { control: 'stepper', value: n, min: 1, max: ph.remaining },
          buttons: [...(second ? [second] : []), btn('place', `Place ${n}`, true)],
        });
      }
      const line = placedAny ? `Place ${ph.remaining} more${SEP}click a territory` : `Place ${armies(ph.remaining)}${SEP}click a territory`;
      // Trading is the primary until you place anything; after that the sheet still offers it.
      const buttons = !placedAny && trade ? [...(cards ? [cards] : []), { ...trade, primary: true }] : [...(cards ? [cards] : []), ...(undo ? [undo] : [])];
      return make('place', step, line, { buttons });
    }
    case 'attack': {
      const step = turnStep('attack');
      const exits = [...(canFortifyAny(s) ? [btn('fortify', 'Fortify →')] : []), btn('endTurn', 'End turn', true)];
      if (inp.took && s.territories[inp.took].owner === me) return make('attack', step, `You took ${tName(inp.took)}`);
      const armed = sel.selected && sel.target && s.territories[sel.selected].owner === me && s.territories[sel.target].owner !== me;
      if (armed) {
        return make('attack', step, attackLine(s, sel.selected!, sel.target!, inp.showWinChance), {
          buttons: [btn('roll', 'Roll'), btn('blitz', 'Blitz', true)],
        });
      }
      if (sel.selected && s.territories[sel.selected].owner === me) {
        return make('attack', step, `Attack from ${tName(sel.selected)}${SEP}click an enemy`, { buttons: exits });
      }
      if (attackSources(s, me).length === 0) return make('attack', step, 'No attacks left', { buttons: exits });
      return make('attack', step, 'Click an enemy territory to attack', { buttons: exits });
    }
    case 'occupy': {
      const value = Math.min(ph.max, Math.max(ph.min, sel.occupyCount ?? ph.max));
      return make('occupy', turnStep('attack'), `Move armies into ${tName(ph.to)}`, {
        count: ph.max > ph.min ? { control: 'slider', value, min: ph.min, max: ph.max } : null,
        buttons: [btn('move', `Move ${value}`, true)],
      });
    }
    case 'fortify': {
      const step = turnStep('fortify');
      const end = btn('endTurn', 'End turn', true);
      if (sel.selected && sel.target && s.territories[sel.selected].owner === me) {
        const max = Math.max(1, s.territories[sel.selected].armies - 1);
        const value = Math.min(max, Math.max(1, sel.fortifyCount ?? max));
        return make('fortify', step, `Move from ${tName(sel.selected)} to ${tName(sel.target)}`, {
          count: max > 1 ? { control: 'slider', value, min: 1, max } : null,
          buttons: [btn('move', `Move ${value}${SEP}end turn`, true)],
        });
      }
      if (sel.selected && s.territories[sel.selected].owner === me) {
        return make('fortify', step, `Move from ${tName(sel.selected)}${SEP}click where to`, { buttons: [end] });
      }
      if (!canFortifyAny(s)) return make('fortify', step, `Nothing to move${SEP}end your turn`, { buttons: [end] });
      return make('fortify', step, 'Move armies once, or end your turn', { buttons: [end] });
    }
    case 'game-over':
      return {
        mode: 'idle',
        step: { kind: 'watching', current: null, seat, label: '' },
        accent,
        line: inp.idleLine ?? 'The game is over',
        lineKind: 'normal',
        lineKey: inp.lineKey,
        count: null,
        buttons: [],
      };
  }
}

/** Territories to pulse for the current selection (exported for highlights). */
export function selectionTargets(s: GameState, sel: Sel): TerritoryId[] {
  if (!sel.selected) return [];
  if (s.phase.kind === 'attack') return attackTargets(s, sel.selected);
  if (s.phase.kind === 'fortify') return fortifyTargets(s, sel.selected);
  return [];
}
