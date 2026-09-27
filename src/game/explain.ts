// One reasoner (UX.md §7.1): what a click on a territory does right now, or why it can't.
// Built only from engine helpers + mapData. The tooltip, the rejected-click message, keyboard focus
// and the controller's click handler all read from it, so they can never disagree.

import {
  ADJACENCY,
  UNCLAIMED,
  applyAction,
  attackSources,
  fortifySources,
  fortifyTargets,
  winProbability,
  type GameState,
  type TerritoryId,
} from '../engine';
import { SEP, pName, poss, tName } from './copy';
import { autoChain, autoSource, canAttackFrom, oddsWord, ownNeighbors } from './helpers';
import { pct } from './copy';

export type ReasonCode =
  | 'not_yours'
  | 'one_army'
  | 'no_source_for_target'
  | 'no_enemy_neighbors'
  | 'not_adjacent'
  | 'own_as_target'
  | 'must_trade_first'
  | 'none_left'
  | 'fortify_unreachable'
  | 'fortify_not_adjacent'
  | 'fortify_one_army'
  | 'already_claimed';

export const REASON_CODES: ReasonCode[] = [
  'not_yours',
  'one_army',
  'no_source_for_target',
  'no_enemy_neighbors',
  'not_adjacent',
  'own_as_target',
  'must_trade_first',
  'none_left',
  'fortify_unreachable',
  'fortify_not_adjacent',
  'fortify_one_army',
  'already_claimed',
];

/** What a successful click does. The controller executes exactly this. */
export type ClickPlan =
  | { kind: 'claim'; t: TerritoryId }
  | { kind: 'stage'; t: TerritoryId }
  | { kind: 'reinforce'; t: TerritoryId }
  /** At 0 remaining: endReinforce, then run `then` as an attack click. */
  | { kind: 'exitReinforce'; then: ClickPlan }
  | { kind: 'selectSource'; t: TerritoryId }
  | { kind: 'deselect' }
  | { kind: 'arm'; from: TerritoryId; to: TerritoryId; auto: boolean }
  | { kind: 'roll'; from: TerritoryId; to: TerritoryId }
  | { kind: 'fortifySource'; t: TerritoryId }
  | { kind: 'fortifyDest'; from: TerritoryId; to: TerritoryId }
  /** Occupy with `count`, then (if play continues in attack) perform `then` with `select` as the source. */
  | { kind: 'occupyThen'; count: number; select: TerritoryId | null; then: ClickPlan | null };

export interface ExplainUi {
  /** Selected source (attack or fortify). */
  selected: TerritoryId | null;
  /** Armed attack target / chosen fortify destination. */
  target: TerritoryId | null;
  /** Manual setup: armies staged locally this setup turn. */
  staged?: Partial<Record<TerritoryId, number>>;
  /** Occupy: the count a board click would confirm. */
  occupyCount?: number | null;
  /** False during watched turns (AI, or another human behind the hand-off cover). */
  interactive: boolean;
  showWinChance?: boolean;
}

export interface Explanation {
  ok: boolean;
  /** Tooltip verb when ok ('Click: +1 army', 'Attack · 82% · likely', 'Move troops here'). */
  verb?: string;
  code?: ReasonCode;
  /** The verb when ok, the reason copy (UX.md §7.3) when not. */
  text: string;
  plan?: ClickPlan;
}

const ok = (verb: string, plan: ClickPlan): Explanation => ({ ok: true, verb, text: verb, plan });
const no = (code: ReasonCode, text: string): Explanation => ({ ok: false, code, text });

function oddsVerb(state: GameState, from: TerritoryId, to: TerritoryId, ui: ExplainUi, prefix: string): string {
  const p = winProbability(state.territories[from].armies, state.territories[to].armies);
  return ui.showWinChance === false ? `${prefix}${SEP}${oddsWord(p)}` : `${prefix}${SEP}${pct(p)}%${SEP}${oddsWord(p)}`;
}

function stagedTotal(ui: ExplainUi): number {
  let n = 0;
  for (const v of Object.values(ui.staged ?? {})) n += v ?? 0;
  return n;
}

/** Attack-step click with the given selection (also used for the implicit reinforce exit and after occupy). */
function explainAttack(state: GameState, ui: ExplainUi, t: TerritoryId): Explanation {
  const me = state.currentPlayer;
  const ts = state.territories[t];
  const sel = ui.selected;
  if (ts.owner !== me) {
    if (sel && ui.target === t && canAttackFrom(state, sel, me) && ADJACENCY[sel].includes(t)) {
      return ok(oddsVerb(state, sel, t, ui, 'Click: roll'), { kind: 'roll', from: sel, to: t });
    }
    if (sel && ADJACENCY[sel].includes(t) && state.territories[sel].armies >= 2 && state.territories[sel].owner === me) {
      return ok(oddsVerb(state, sel, t, ui, 'Attack'), { kind: 'arm', from: sel, to: t, auto: false });
    }
    const src = autoSource(state, t, me);
    if (src) return ok(oddsVerb(state, src, t, ui, 'Attack'), { kind: 'arm', from: src, to: t, auto: true });
    if (ownNeighbors(state, t, me).length === 0) {
      return no(
        'not_adjacent',
        sel
          ? `${tName(t)} doesn't border ${tName(sel)}${SEP}attack next door (dashed sea lanes count)`
          : `${tName(t)} doesn't border any of yours${SEP}attack next door (dashed sea lanes count)`,
      );
    }
    return no('no_source_for_target', `None of your territories next to ${tName(t)} has 2+ armies`);
  }
  // Own tile.
  if (sel === t) return ok('Click: deselect', { kind: 'deselect' });
  if (canAttackFrom(state, t, me)) {
    const n = state.territories[t] && ADJACENCY[t].filter((x) => state.territories[x].owner !== me && state.territories[x].owner >= 0).length;
    const verb = `Attack from here${SEP}${n === 1 ? '1 target' : `${n} targets`}`;
    if (ui.target && ADJACENCY[t].includes(ui.target) && state.territories[ui.target].owner !== me) {
      return ok(verb, { kind: 'arm', from: t, to: ui.target, auto: false });
    }
    return ok(verb, { kind: 'selectSource', t });
  }
  if (sel) return no('own_as_target', `That's yours${SEP}click an enemy next to ${tName(sel)}`);
  if (ts.armies < 2) return no('one_army', `${tName(t)} has 1 army${SEP}attacking needs 2, because 1 stays behind`);
  return no('no_enemy_neighbors', `Everything next to ${tName(t)} is already yours`);
}

/**
 * explainTerritory(state, ui, t): what clicking `t` does now ({ ok, verb, plan }), or why it can't
 * ({ ok: false, code, text }). Pure.
 */
export function explainTerritory(state: GameState, ui: ExplainUi, t: TerritoryId): Explanation {
  const ph = state.phase;
  if (ph.kind === 'game-over') return { ok: false, text: 'The game is over' };
  const me = state.currentPlayer;
  if (!ui.interactive) return { ok: false, text: `${poss(pName(state, me))} turn` };
  const ts = state.territories[t];
  if (!ts) return { ok: false, text: '' };
  const enemyName = ts.owner >= 0 ? pName(state, ts.owner) : '';
  const notYours = () => no('not_yours', `That's ${poss(enemyName)}${SEP}click one of your territories`);

  switch (ph.kind) {
    case 'setup-claim': {
      if (ts.owner === UNCLAIMED) return ok('Click: claim it', { kind: 'claim', t });
      return no(
        'already_claimed',
        ts.owner === me ? `You already claimed that${SEP}pick a parchment tile` : `${enemyName} already claimed that${SEP}pick a parchment tile`,
      );
    }
    case 'setup-place': {
      if (ts.owner !== me) return notYours();
      if (stagedTotal(ui) >= ph.toPlace) return no('none_left', `All ${ph.toPlace} placed${SEP}Confirm placement`);
      return ok('Click: +1 army', { kind: 'stage', t });
    }
    case 'reinforce': {
      if (ph.mustTrade) {
        const n = state.players[me].cards.length;
        return no('must_trade_first', `You hold ${n} cards${SEP}trade a set first`);
      }
      if (ph.remaining > 0) {
        if (ts.owner !== me) return notYours();
        return ok('Click: +1 army', { kind: 'reinforce', t });
      }
      // 0 left: implicit exit into attack (UX.md §3.2).
      const inner = explainAttack({ ...state, phase: { kind: 'attack' } }, { ...ui, selected: null, target: null }, t);
      if (inner.ok && inner.plan && inner.plan.kind !== 'deselect') {
        return { ...inner, plan: { kind: 'exitReinforce', then: inner.plan } };
      }
      if (ts.owner === me) return no('none_left', `All armies placed${SEP}click an enemy to attack`);
      return inner.ok ? no('none_left', `All armies placed${SEP}click an enemy to attack`) : inner;
    }
    case 'attack':
      return explainAttack(state, ui, t);
    case 'occupy': {
      const count = Math.min(ph.max, Math.max(ph.min, ui.occupyCount ?? ph.max));
      const r = applyAction(state, { type: 'occupy', player: me, count });
      if (!r.ok) return { ok: false, text: '' };
      const post = r.state;
      if (post.phase.kind !== 'attack') {
        return ok(`Click: move ${count} in`, { kind: 'occupyThen', count, select: null, then: null });
      }
      const select = autoChain(post, ph.from, ph.to);
      const inner = explainAttack(post, { ...ui, selected: select, target: null }, t);
      if (!inner.ok) {
        // The click is about `from` (an enemy next to it, or `from` itself) and the pending count
        // would strip it to 1. Keep the stack at home: move only the minimum, then act from `from`.
        const aboutFrom = t === ph.from || (ts.owner !== me && ADJACENCY[ph.from].includes(t));
        if (aboutFrom && count > ph.min) {
          const lo = applyAction(state, { type: 'occupy', player: me, count: ph.min });
          if (lo.ok && lo.state.phase.kind === 'attack' && canAttackFrom(lo.state, ph.from, me)) {
            const alt = explainAttack(lo.state, { ...ui, selected: ph.from, target: null }, t);
            if (alt.ok && alt.plan) {
              const keep = `Click: move ${ph.min} in${SEP}`;
              if (alt.plan.kind === 'deselect') {
                const v = `${keep}keep attacking from ${tName(ph.from)}`;
                return ok(v, { kind: 'occupyThen', count: ph.min, select: ph.from, then: null });
              }
              const v = oddsVerb(lo.state, ph.from, t, ui, `${keep}attack from ${tName(ph.from)}`);
              return { ...alt, verb: v, text: v, plan: { kind: 'occupyThen', count: ph.min, select: ph.from, then: alt.plan } };
            }
          }
        }
        if (aboutFrom && ts.owner !== me) {
          return no(
            'no_source_for_target',
            `Moving ${count} into ${tName(ph.to)} leaves ${tName(ph.from)} with 1${SEP}lower the move to attack ${tName(t)}`,
          );
        }
        return inner;
      }
      // Clicking the chained source itself just confirms the move (it stays selected).
      if (inner.plan?.kind === 'deselect') {
        return ok(`Click: move ${count} in`, { kind: 'occupyThen', count, select, then: null });
      }
      return { ...inner, plan: { kind: 'occupyThen', count, select, then: inner.plan ?? null } };
    }
    case 'fortify': {
      if (ts.owner !== me) return notYours();
      const sel = ui.selected;
      if (sel === t) return ok('Click: deselect', { kind: 'deselect' });
      if (sel) {
        if (fortifyTargets(state, sel).includes(t)) return ok('Move troops here', { kind: 'fortifyDest', from: sel, to: t });
        if (fortifySources(state, me).includes(t) && fortifyTargets(state, t).length > 0) {
          return ok('Move troops from here', { kind: 'fortifySource', t });
        }
        if (state.config.fortifyRule === 'adjacent') return no('fortify_not_adjacent', 'House rule: fortify only to a neighbor');
        return no('fortify_unreachable', `Can't reach ${tName(t)}${SEP}troops travel only through your own territories`);
      }
      if (ts.armies < 2) return no('fortify_one_army', `${tName(t)} has 1 army${SEP}1 has to stay to hold it`);
      if (fortifyTargets(state, t).length === 0) {
        return no('fortify_unreachable', `Nowhere to go from ${tName(t)}${SEP}troops travel only through your own territories`);
      }
      return ok('Move troops from here', { kind: 'fortifySource', t });
    }
  }
  return { ok: false, text: '' };
}

/** Territories a click would do something useful on right now (Tab cycling, 'selectable' rims). */
export function clickableTerritories(state: GameState, ui: ExplainUi, ids: readonly TerritoryId[]): TerritoryId[] {
  if (!ui.interactive) return [];
  const ph = state.phase;
  if (ph.kind === 'attack' && !ui.selected) return attackSources(state, state.currentPlayer);
  return ids.filter((t) => {
    const e = explainTerritory(state, ui, t);
    return e.ok && e.plan?.kind !== 'deselect';
  });
}
