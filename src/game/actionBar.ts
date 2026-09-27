// The action bar (UX.md §7.2, §8.9): line 1 always says what to do, line 2 carries the why when the
// seat's hints are on. Pure: built from the displayed state + the input selection.

import {
  attackSources,
  attackTargets,
  fortifySources,
  fortifyTargets,
  maxAttackDice,
  reinforcementsFor,
  type GameState,
  type PlayerColorId,
  type TerritoryId,
} from '../engine';
import { SEP, armies, cName, tName } from './copy';
import { bestSet, occupyDefault } from './helpers';
import type { ActionBarVM, ButtonId, ButtonVM, ChipVM } from './viewModel';

export interface Sel {
  selected: TerritoryId | null;
  target: TerritoryId | null;
  /** The source was auto-picked from a target-first click (changes line 1). */
  auto: boolean;
  /** Dice toggle; null = max. */
  dice: 1 | 2 | 3 | null;
  occupyCount: number | null;
  fortifyCount: number | null;
  /** Manual setup: locally staged placements. */
  staged: Partial<Record<TerritoryId, number>>;
  /** Order of staged / placed clicks, for Undo. */
  order: TerritoryId[];
  /** Pills anchor. */
  lastPlaced: TerritoryId | null;
  /** Manual card pick. */
  cardSel: number[];
}

export function emptySel(): Sel {
  return {
    selected: null,
    target: null,
    auto: false,
    dice: null,
    occupyCount: null,
    fortifyCount: null,
    staged: {},
    order: [],
    lastPlaced: null,
    cardSel: [],
  };
}

export interface BarInput {
  s: GameState;
  sel: Sel;
  accent: PlayerColorId;
  /** The driver may act (a human's own turn, no cover). */
  interactive: boolean;
  /** Watching line (AI turns / the hand-off). */
  narration: string | null;
  hintsOn: boolean;
  hintsToggleable: boolean;
  rejection: { text: string; key: number } | null;
  showWinChance: boolean;
  /** Show the one-time card-set coach line in line 2. */
  firstSetHint: boolean;
  /** Armies gained from trades this turn (receipt chip `Cards +8`). */
  tradedThisTurn: number;
  /** Mid-turn forced trade: who was knocked out and how many cards were taken. */
  midTurn: { victim: string; cards: number } | null;
  /** Idle line (game over, etc.). */
  idleLine: string | null;
  lineKey: number;
  /**
   * A conquest is on screen but the selection that armed it hasn't caught up (the flood and march are
   * still playing): line 1 says what happened instead of describing a half-moved board.
   */
  took?: TerritoryId | null;
}

/** Line 1 while the opening deal plays (a random deal: nothing to click, a click only skips it). */
export function dealingLine(s: GameState): string {
  return s.config.initialPlacement === 'auto' ? `Dealing territories and starting armies` : `Dealing territories`;
}

function btn(
  id: ButtonId,
  label: string,
  role: ButtonVM['role'],
  opts: { enabled?: boolean; why?: string | null; brass?: boolean; keycap?: string | null } = {},
): ButtonVM {
  const enabled = opts.enabled ?? true;
  return {
    id,
    label,
    keycap: opts.keycap ?? null,
    role,
    brass: !!opts.brass && enabled,
    enabled,
    why: enabled ? null : (opts.why ?? null),
  };
}

export function stagedTotal(sel: Sel): number {
  let n = 0;
  for (const v of Object.values(sel.staged)) n += v ?? 0;
  return n;
}

export function receiptParts(s: GameState, player: number): string[] {
  const r = reinforcementsFor(s, player);
  return [baseReceipt(r.territoryCount, r.base), ...r.continents.map((c) => `${cName(c.continent)} +${c.bonus}`)];
}

/** '14 territories → 4' / floor case '8 territories → minimum 3'. */
export function baseReceipt(territoryCount: number, base: number): string {
  const n = territoryCount === 1 ? '1 territory' : `${territoryCount} territories`;
  return base === 3 && territoryCount < 9 ? `${n} → minimum 3` : `${n} → ${base}`;
}

function endTurnLabel(s: GameState): string {
  return s.conqueredThisTurn ? `End turn${SEP}draw a card` : `End turn${SEP}no card`;
}

export function buildActionBar(inp: BarInput): ActionBarVM {
  const { s, sel } = inp;
  const me = s.currentPlayer;
  const hints = { on: inp.hintsOn, toggleable: inp.hintsToggleable };
  const hintChip: ChipVM | null = inp.hintsToggleable
    ? { id: 'hints', label: inp.hintsOn ? 'Hints on' : 'Hints off', tone: 'toggle', intent: { type: 'toggleHints' } }
    : null;
  const base = (mode: ActionBarVM['mode'], line1: string, hint: string, extra: Partial<ActionBarVM> = {}): ActionBarVM => {
    const out: ActionBarVM = {
      mode,
      accent: inp.accent,
      line1: inp.rejection ? inp.rejection.text : line1,
      line1Kind: inp.rejection ? 'rejection' : 'normal',
      line1Key: inp.rejection ? inp.rejection.key : inp.lineKey,
      line2: inp.hintsOn ? hint : '',
      hints,
      chips: [],
      dice: null,
      counter: null,
      buttons: [],
      ...extra,
    };
    if (hintChip) out.chips = [...out.chips, hintChip];
    return out;
  };

  if (!inp.interactive) {
    const line = inp.narration ?? inp.idleLine ?? `${s.players[me]?.name ?? 'Next player'} is up`;
    return {
      mode: inp.idleLine && !inp.narration ? 'idle' : 'watching',
      accent: inp.accent,
      line1: line,
      line1Kind: inp.narration ? 'narration' : 'normal',
      line1Key: inp.lineKey,
      line2: '',
      hints,
      chips: [],
      dice: null,
      counter: null,
      buttons: [],
    };
  }

  const ph = s.phase;
  switch (ph.kind) {
    case 'setup-claim':
      if (s.config.setupMode !== 'draft') return base('setup-claim', dealingLine(s), 'Territories are dealt at random.');
      return base('setup-claim', `Claim a territory${SEP}click any parchment tile`, 'Take turns until all 42 are claimed.');
    case 'setup-place': {
      const staged = stagedTotal(sel);
      const left = Math.max(0, ph.toPlace - staged);
      const line1 =
        left === 0
          ? `All ${ph.toPlace} placed${SEP}Confirm placement`
          : `Place ${armies(ph.toPlace)}${SEP}${left} left`;
      return base('setup-place', line1, "Stack them where you'll fight first. Right-click takes one back.", {
        buttons: [
          btn('undo', 'Undo', 'secondary', { enabled: staged > 0, why: 'Nothing placed yet' }),
          btn('confirmPlacement', 'Confirm placement', 'primary', {
            enabled: left === 0,
            why: `Place ${left} more`,
            brass: true,
            keycap: 'Enter',
          }),
        ],
      });
    }
    case 'reinforce': {
      const hand = s.players[me].cards;
      const best = bestSet(s, me);
      const placedAny = Object.values(ph.placed).some((v) => (v ?? 0) > 0);
      const receipt: ChipVM[] = ph.midTurn
        ? []
        : receiptParts(s, me).map((label, i) => ({ id: `receipt${i}`, label, tone: 'receipt' as const }));
      if (inp.tradedThisTurn > 0) receipt.push({ id: 'receiptCards', label: `Cards +${inp.tradedThisTurn}`, tone: 'receipt' });
      const undo = btn('undo', 'Undo', 'secondary', { enabled: placedAny, why: 'Nothing placed yet' });
      const choose = btn('chooseCards', 'Choose cards', 'secondary', { enabled: hand.length > 0, why: 'No cards yet' });
      const exitLabel = ph.midTurn ? 'Keep attacking →' : 'Begin attack →';
      if (ph.mustTrade) {
        const v = best ? best.value : 0;
        const line1 = ph.midTurn && inp.midTurn
          ? `You knocked out ${inp.midTurn.victim} and took ${inp.midTurn.cards} cards${SEP}trade down to 4, then keep attacking`
          : `Trade a card set first${SEP}you hold ${hand.length} cards`;
        const hint = ph.midTurn ? '' : `At 5 cards you must trade. Your best set gives +${v}.`;
        return base('reinforce', line1, hint, {
          chips: receipt,
          buttons: [
            undo,
            choose,
            btn('trade', `Trade for +${v}`, 'primary', { enabled: !!best, why: 'No valid set', brass: true, keycap: 'Enter' }),
            btn('beginAttack', exitLabel, 'exit', { enabled: false, why: 'Trade a set first', keycap: 'E' }),
          ],
        });
      }
      const chips = [...receipt];
      if (best) {
        chips.push({
          id: 'trade',
          label: `Trade 3 cards${SEP}+${best.value}`,
          tone: 'brass',
          intent: { type: 'button', id: 'trade' },
        });
      }
      const setHint = inp.firstSetHint && best
        ? 'Three of a kind, or one of each, trades for free armies. Sets grow every time anyone trades.'
        : null;
      if (ph.remaining > 0) {
        const line1 = placedAny
          ? `Place ${ph.remaining} more`
          : `Place ${armies(ph.remaining)}${SEP}click your territories`;
        return base('reinforce', line1, setHint ?? '1 army per 3 territories, plus whole continents. Right-click takes one back.', {
          chips,
          buttons: [
            undo,
            choose,
            btn('beginAttack', exitLabel, 'exit', { enabled: false, why: `Place ${ph.remaining} more`, keycap: 'E' }),
          ],
        });
      }
      const line1 = ph.midTurn ? `All placed${SEP}click an enemy to keep attacking` : `All placed${SEP}click an enemy to attack`;
      return base('reinforce', line1, setHint ?? 'Or Begin attack →. Right-click still takes one back.', {
        chips,
        buttons: [undo, choose, btn('beginAttack', exitLabel, 'exit', { brass: true, keycap: 'Enter' })],
      });
    }
    case 'attack': {
      const cardChip: ChipVM = s.conqueredThisTurn
        ? { id: 'card', label: 'Card earned ✓', tone: 'success' }
        : { id: 'card', label: `No card yet${SEP}take 1 territory to earn one`, tone: 'status' };
      const sources = attackSources(s, me);
      const canFortify = fortifySources(s, me).some((t) => fortifyTargets(s, t).length > 0);
      const exits = (brassExit: boolean) => [
        btn('fortifyNext', 'Fortify →', 'exit', { keycap: brassExit && canFortify ? 'Enter' : 'E', brass: brassExit && canFortify }),
        btn('endTurn', endTurnLabel(s), 'exit', { brass: brassExit && !canFortify, keycap: brassExit && !canFortify ? 'Enter' : null }),
      ];
      const armed = sel.selected && sel.target && s.territories[sel.selected].owner === me && s.territories[sel.target].owner !== me;
      if (armed) {
        const from = sel.selected!;
        const to = sel.target!;
        const max = maxAttackDice(s, from);
        const ok = max > 0;
        const dice = (Math.min(max || 1, sel.dice ?? max) || 1) as 1 | 2 | 3;
        // Auto-picked (target-first): line 2 says how to switch.
        // (The battle panel carries both counts, so line 1 stays short enough for the longest names.)
        const line1 = `Attack ${tName(to)} from ${tName(from)}`;
        const hint = sel.auto
          ? `Click another of yours to switch.`
          : `Blitz rolls until they fall or you're down to 1.`;
        return base('attack', line1, hint, {
          chips: [cardChip],
          dice: ok ? { value: dice, max: max as 1 | 2 | 3 } : null,
          buttons: [
            btn('cancel', 'Back', 'secondary', { keycap: 'Esc' }),
            btn('roll', 'Roll', 'secondary', { enabled: ok, why: `${tName(from)} has 1 army` }),
            btn('blitz', 'Blitz', 'primary', { enabled: ok, why: `${tName(from)} has 1 army`, brass: true, keycap: 'Space' }),
            ...exits(false),
          ],
        });
      }
      const disabledFight = (why: string) => [
        btn('cancel', 'Back', 'secondary', { enabled: !!sel.selected, why: 'Nothing selected', keycap: 'Esc' }),
        btn('roll', 'Roll', 'secondary', { enabled: false, why }),
        btn('blitz', 'Blitz', 'primary', { enabled: false, why, keycap: 'Space' }),
      ];
      if (inp.took && s.territories[inp.took].owner === me) {
        return base('attack', `You took ${tName(inp.took)}`, '', {
          chips: [cardChip],
          buttons: [...disabledFight('Pick a target first'), ...exits(false)],
        });
      }
      if (sel.selected && s.territories[sel.selected].owner === me) {
        const from = sel.selected;
        return base('attack', `Attacking from ${tName(from)} (${s.territories[from].armies})${SEP}click a glowing enemy`, '', {
          chips: [cardChip],
          buttons: [...disabledFight('Pick a target first'), ...exits(false)],
        });
      }
      if (sources.length === 0) {
        return base('attack', `No attacks left${SEP}every border army is down to 1`, '', {
          chips: [cardChip],
          buttons: [...disabledFight('No attacks left'), ...exits(true)],
        });
      }
      return base('attack', `Attack${SEP}click an enemy territory next to yours`, 'You need 2+ armies to attack, because 1 always stays behind.', {
        chips: [cardChip],
        buttons: [...disabledFight('Pick a target first'), ...exits(false)],
      });
    }
    case 'occupy': {
      const d = occupyDefault(s, ph.from, ph.to, ph.min, ph.max);
      const value = Math.min(ph.max, Math.max(ph.min, sel.occupyCount ?? d.count));
      const minWord = ph.min === 1 ? 'At least 1, for the die you rolled.' : `At least ${ph.min}, one per die you rolled.`;
      return base('occupy', `You took ${tName(ph.to)}${SEP}move armies in`, `${minWord} 1 stays in ${tName(ph.from)}.`, {
        // Card status stays on screen through the whole attack phase (UX.md §3.3).
        chips: [{ id: 'card', label: 'Card earned ✓', tone: 'success' }],
        counter: { value, min: ph.min, max: ph.max, note: d.note },
        buttons: [
          btn('min', `Min ${ph.min}`, 'secondary', { enabled: value > ph.min, why: 'Already at the minimum' }),
          btn('dec', '−', 'secondary', { enabled: value > ph.min, why: 'Already at the minimum' }),
          btn('inc', '+', 'secondary', { enabled: value < ph.max, why: 'Already at the maximum' }),
          btn('max', `Max ${ph.max}`, 'secondary', { enabled: value < ph.max, why: 'Already at the maximum' }),
          btn('move', `Move ${value}`, 'primary', { brass: true, keycap: 'Enter' }),
        ],
      });
    }
    case 'fortify': {
      const endLabel = endTurnLabel(s);
      const anyMove = fortifySources(s, me).some((t) => fortifyTargets(s, t).length > 0);
      const hint =
        s.config.fortifyRule === 'adjacent'
          ? 'House rule: troops move only to a neighbor.'
          : 'Troops travel only through your own territories.';
      if (sel.selected && sel.target && s.territories[sel.selected].owner === me) {
        const from = sel.selected;
        const to = sel.target;
        const max = Math.max(1, s.territories[from].armies - 1);
        const value = Math.min(max, Math.max(1, sel.fortifyCount ?? max));
        return base('fortify', `Move from ${tName(from)} to ${tName(to)}${SEP}pick how many`, `1 stays in ${tName(from)}. Moving ends your turn.`, {
          counter: { value, min: 1, max, note: null },
          buttons: [
            btn('cancel', 'Back', 'secondary', { keycap: 'Esc' }),
            btn('min', 'Min 1', 'secondary', { enabled: value > 1, why: 'Already at the minimum' }),
            btn('dec', '−', 'secondary', { enabled: value > 1, why: 'Already at the minimum' }),
            btn('inc', '+', 'secondary', { enabled: value < max, why: 'Already at the maximum' }),
            btn('max', `Max ${max}`, 'secondary', { enabled: value < max, why: 'Already at the maximum' }),
            btn('move', `Move ${value}${SEP}ends turn`, 'primary', { brass: true, keycap: 'Enter' }),
            btn('endTurn', endLabel, 'exit', { keycap: 'E' }),
          ],
        });
      }
      if (sel.selected && s.territories[sel.selected].owner === me) {
        return base('fortify', `Move from ${tName(sel.selected)}${SEP}click a glowing territory`, '', {
          buttons: [
            btn('cancel', 'Back', 'secondary', { keycap: 'Esc' }),
            btn('move', 'Move', 'primary', { enabled: false, why: 'Pick where to move' }),
            btn('endTurn', endLabel, 'exit', { brass: true, keycap: 'Enter' }),
          ],
        });
      }
      if (!anyMove) {
        return base('fortify', `Nothing to move${SEP}End turn`, '', {
          buttons: [
            btn('cancel', 'Back', 'secondary', { enabled: false, why: 'Nothing selected', keycap: 'Esc' }),
            btn('move', 'Move', 'primary', { enabled: false, why: 'Nothing to move' }),
            btn('endTurn', endLabel, 'exit', { brass: true, keycap: 'Enter' }),
          ],
        });
      }
      return base('fortify', `Fortify${SEP}one move, then your turn ends`, hint, {
        buttons: [
          btn('cancel', 'Back', 'secondary', { enabled: false, why: 'Nothing selected', keycap: 'Esc' }),
          btn('move', 'Move', 'primary', { enabled: false, why: 'Pick a territory to move from' }),
          btn('endTurn', endLabel, 'exit', { brass: true, keycap: 'Enter' }),
        ],
      });
    }
    case 'game-over':
      return {
        mode: 'idle',
        accent: inp.accent,
        line1: inp.idleLine ?? 'The game is over',
        line1Kind: 'normal',
        line1Key: inp.lineKey,
        line2: '',
        hints,
        chips: [],
        dice: null,
        counter: null,
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
