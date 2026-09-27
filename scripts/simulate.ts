// AI-vs-AI soak: `npm run sim [games]` (default 200). Exits non-zero on any failure.
//
// Every game must end in gameOver, with every AI action legal on the first try (no fallback),
// under 500 rounds, with the invariants below holding after every action.

import { performance } from 'node:perf_hooks';
import {
  applyAction,
  chooseAiAction,
  createGame,
  TERRITORY_IDS,
  UNCLAIMED,
  validateAction,
  type AiDifficulty,
  type GameConfig,
  type GameState,
  type PlayerConfig,
} from '../src/engine';
import { decide } from '../src/engine/ai/brain';
import { hashInts, random, type RngHolder } from '../src/engine/rng';

const COLORS = ['crimson', 'cobalt', 'emerald', 'amber'] as const;
const DIFFS: AiDifficulty[] = ['easy', 'normal', 'hard'];
const MAX_ROUNDS = 500;
const MAX_ACTIONS = 200_000;

interface GameResult {
  winner: number;
  reason: string;
  rounds: number;
  actions: number;
  players: PlayerConfig[];
  /** Round in which some player first held ≥ 60 / 70 / 100 % of the board. */
  reach: Record<number, number>;
}

const THRESHOLDS = [60, 70, 100];

const decisionTimes: number[] = [];
const failures: string[] = [];

function check(s: GameState, label: string): void {
  const cards = s.deck.length + s.discard.length + s.players.reduce((a, p) => a + p.cards.length, 0);
  if (cards !== 44) throw new Error(`${label}: card count ${cards} != 44`);
  const ids = new Set<number>();
  for (const c of [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.cards)]) {
    if (ids.has(c.id)) throw new Error(`${label}: duplicate card ${c.id}`);
    ids.add(c.id);
  }
  if (!s.phase.kind.startsWith('setup')) {
    for (const t of TERRITORY_IDS) {
      const x = s.territories[t];
      if (x.owner === UNCLAIMED) throw new Error(`${label}: ${t} unclaimed in main play`);
      if (x.armies < 1 && s.phase.kind !== 'occupy') throw new Error(`${label}: ${t} has ${x.armies} armies`);
      if (s.players[x.owner].eliminated) throw new Error(`${label}: ${t} owned by eliminated player`);
    }
    if (s.players[s.currentPlayer].eliminated && s.phase.kind !== 'game-over')
      throw new Error(`${label}: current player is eliminated`);
  }
}

function playGame(config: GameConfig, label: string): GameResult {
  let { state } = createGame(config);
  check(state, label);
  let actions = 0;
  const reach: Record<number, number> = {};
  const track = () => {
    if (state.round === 0) return;
    const counts = new Array<number>(state.players.length).fill(0);
    for (const t of TERRITORY_IDS) counts[state.territories[t].owner]++;
    const top = Math.max(...counts);
    for (const pct of THRESHOLDS) if (reach[pct] === undefined && top >= Math.ceil((42 * pct) / 100)) reach[pct] = state.round;
  };
  while (state.phase.kind !== 'game-over') {
    if (++actions > MAX_ACTIONS) throw new Error(`${label}: stuck (${MAX_ACTIONS} actions, round ${state.round})`);
    if (state.round > MAX_ROUNDS) throw new Error(`${label}: exceeded ${MAX_ROUNDS} rounds`);
    const me = state.currentPlayer;
    const raw = decide(state, me);
    const rawErr = validateAction(state, raw);
    if (rawErr) throw new Error(`${label}: AI chose illegal ${JSON.stringify(raw)} in ${state.phase.kind}: ${rawErr}`);
    const t0 = performance.now();
    const action = chooseAiAction(state, me);
    decisionTimes.push(performance.now() - t0);
    const res = applyAction(state, action);
    if (!res.ok) throw new Error(`${label}: applyAction rejected ${JSON.stringify(action)}: ${res.error}`);
    if (res.events.length === 0) throw new Error(`${label}: action produced no events ${JSON.stringify(action)}`);
    state = res.state;
    check(state, label);
    track();
  }
  if (state.phase.kind !== 'game-over') throw new Error('unreachable');
  return {
    winner: state.phase.winner,
    reason: state.phase.reason,
    rounds: state.round,
    actions,
    players: config.players,
    reach,
  };
}

function makeConfig(i: number, players: PlayerConfig[], overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    players,
    setupMode: i % 2 === 0 ? 'random' : 'draft',
    initialPlacement: Math.floor(i / 2) % 2 === 0 ? 'auto' : 'manual',
    setupBatch: 5,
    cardBonus: Math.floor(i / 4) % 2 === 0 ? 'progressive' : 'fixed',
    fortifyRule: Math.floor(i / 8) % 2 === 0 ? 'connected' : 'adjacent',
    dominationPercent: i % 10 === 7 ? 70 : 100,
    turnLimit: i % 10 === 9 ? 25 : null,
    seed: hashInts(0xc0ffee, i),
    ...overrides,
  };
}

function seats(diffs: AiDifficulty[]): PlayerConfig[] {
  return diffs.map((d, k) => ({ name: `${d[0].toUpperCase()}${d.slice(1)} ${k + 1}`, color: COLORS[k], kind: 'ai', difficulty: d }));
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : '—';
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function run(label: string, n: number, mk: (i: number) => GameConfig): GameResult[] {
  const out: GameResult[] = [];
  for (let i = 0; i < n; i++) {
    const cfg = mk(i);
    try {
      out.push(playGame(cfg, `${label} #${i} (seed ${cfg.seed})`));
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

const t0 = performance.now();
const N = Math.max(1, Number(process.argv[2] ?? 200) || 200);

// --- Main soak: every rule variant, 2/3/4 players, mixed difficulties -------------------------
const rng: RngHolder = { rng: 12345 };
const soak = run('soak', N, (i) => {
  const n = 2 + (i % 3);
  const diffs = Array.from({ length: n }, () => DIFFS[Math.floor(random(rng) * 3)]);
  return makeConfig(Math.floor(i / 3) + i, seats(diffs));
});

const seatsBy: Record<string, number> = { easy: 0, normal: 0, hard: 0 };
const winsBy: Record<string, number> = { easy: 0, normal: 0, hard: 0 };
const fairBy: Record<string, number> = { easy: 0, normal: 0, hard: 0 };
const reasons: Record<string, number> = {};
for (const g of soak) {
  for (const p of g.players) {
    seatsBy[p.difficulty!]++;
    fairBy[p.difficulty!] += 1 / g.players.length;
  }
  winsBy[g.players[g.winner].difficulty!]++;
  reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
}

console.log(`\n=== Soak: ${soak.length}/${N} games finished ===`);
console.log(`end reasons: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(
  `rounds: avg ${(soak.reduce((a, g) => a + g.rounds, 0) / Math.max(1, soak.length)).toFixed(1)}, median ${median(soak.map((g) => g.rounds))}, max ${Math.max(0, ...soak.map((g) => g.rounds))}`,
);
for (const d of DIFFS) {
  console.log(
    `  ${d.padEnd(6)} seats ${String(seatsBy[d]).padStart(3)}  wins ${String(winsBy[d]).padStart(3)}  win/seat ${pct(winsBy[d], seatsBy[d]).padStart(6)}  vs fair share ${(winsBy[d] / Math.max(1e-9, fairBy[d])).toFixed(2)}×`,
  );
}

// --- Head-to-head matchups ------------------------------------------------------------------------
const M = Math.max(10, Math.round(N / 5));
function h2h(a: AiDifficulty, b: AiDifficulty): void {
  const res = run(`${a}-v-${b}`, M, (i) => makeConfig(i, seats(i % 2 === 0 ? [a, b] : [b, a])));
  const aw = res.filter((g) => g.players[g.winner].difficulty === a).length;
  console.log(
    `  2p ${a} vs ${b}: ${a} wins ${aw}/${res.length} (${pct(aw, res.length)}), avg rounds ${(res.reduce((s, g) => s + g.rounds, 0) / Math.max(1, res.length)).toFixed(1)}`,
  );
}
console.log(`\n=== Head-to-head (${M} games each, alternating seats, all rule variants) ===`);
h2h('hard', 'easy');
h2h('hard', 'normal');
h2h('normal', 'easy');

const four = run('4p-normal', M, (i) => makeConfig(i, seats(['normal', 'normal', 'normal', 'normal']), { turnLimit: null, dominationPercent: 100 }));
const r4 = four.map((g) => g.rounds);
console.log(
  `  4p normal×4 (domination): avg rounds ${(r4.reduce((a, b) => a + b, 0) / Math.max(1, r4.length)).toFixed(1)}, median ${median(r4)}, range ${Math.min(...r4)}–${Math.max(...r4)}, in 15–60: ${r4.filter((r) => r >= 15 && r <= 60).length}/${r4.length}`,
);
const mixed = run('4p-hard+3normal', M, (i) => {
  const d: AiDifficulty[] = ['normal', 'normal', 'normal', 'normal'];
  d[i % 4] = 'hard';
  return makeConfig(i, seats(d), { turnLimit: null, dominationPercent: 100 });
});
const hw = mixed.filter((g) => g.players[g.winner].difficulty === 'hard').length;
console.log(`  4p 1 hard + 3 normal: hard wins ${hw}/${mixed.length} (${pct(hw, mixed.length)}; fair share 25%)`);

// --- Game length by win condition (normal AIs, full-conquest games; humans will be slower) ----
console.log(`\n=== Rounds until someone first holds X% (normal AIs; median / p90) ===`);
for (const n of [2, 3, 4]) {
  const res = run(`len-${n}p`, M, (i) =>
    makeConfig(i, seats(Array.from({ length: n }, () => 'normal' as AiDifficulty)), { turnLimit: null, dominationPercent: 100 }),
  );
  const cells = THRESHOLDS.map((pct) => {
    const xs = res.map((g) => g.reach[pct]).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    return `${pct}%: ${median(xs)} / ${xs[Math.floor(xs.length * 0.9)] ?? '—'}`;
  });
  console.log(`  ${n}p  ${cells.join('   ')}`);
}

// --- Timing ---------------------------------------------------------------------------------------
const sorted = [...decisionTimes].sort((a, b) => a - b);
const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 0;
console.log(
  `\n=== AI decision time over ${sorted.length} decisions: mean ${(sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length)).toFixed(3)} ms, p99 ${q(0.99).toFixed(3)} ms, max ${q(1).toFixed(2)} ms ===`,
);
console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)} s`);

if (q(0.99) > 5) failures.push(`AI p99 decision time ${q(0.99).toFixed(2)} ms exceeds 5 ms`);
if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures.slice(0, 20)) console.error('  ' + f);
  process.exit(1);
}
console.log('\nPASS');
