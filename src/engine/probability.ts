// Exact blitz odds via memoized dynamic programming.
//
// State (a, d): `a` armies in the attacking territory, `d` defending armies. The attacker rolls
// min(3, a − 1) dice, the defender min(2, d), until d = 0 (conquest) or a = 1 (stopped).
// Tables grow on demand (doubling) up to MAX; larger inputs are scaled down proportionally.

type Outcome = { attLoss: number; defLoss: number; p: number };

/** OUTCOMES[k][m] = loss distribution when the attacker rolls k dice and the defender m. */
const OUTCOMES: Outcome[][][] = (() => {
  const table: Outcome[][][] = [];
  for (let k = 0; k <= 3; k++) {
    table[k] = [];
    for (let m = 0; m <= 2; m++) {
      if (k === 0 || m === 0) {
        table[k][m] = [];
        continue;
      }
      const counts = new Map<number, number>();
      const total = 6 ** (k + m);
      const dice = new Array<number>(k + m).fill(1);
      for (let n = 0; n < total; n++) {
        let x = n;
        for (let i = 0; i < k + m; i++) {
          dice[i] = (x % 6) + 1;
          x = Math.floor(x / 6);
        }
        const a = dice.slice(0, k).sort((p, q) => q - p);
        const d = dice.slice(k).sort((p, q) => q - p);
        let attLoss = 0;
        for (let i = 0; i < Math.min(k, m); i++) if (a[i] <= d[i]) attLoss++;
        counts.set(attLoss, (counts.get(attLoss) ?? 0) + 1);
      }
      const pairs = Math.min(k, m);
      table[k][m] = [...counts.entries()].map(([attLoss, c]) => ({ attLoss, defLoss: pairs - attLoss, p: c / total }));
    }
  }
  return table;
})();

/** Probability distribution of one roll's losses for k attacker dice vs m defender dice. */
export function rollOutcomes(attackDice: number, defendDice: number): readonly Outcome[] {
  return OUTCOMES[Math.max(0, Math.min(3, attackDice))]?.[Math.max(0, Math.min(2, defendDice))] ?? [];
}

const MAX = 512;
let size = 0; // table covers a, d in [0, size]
let W: Float64Array = new Float64Array(0); // P(conquest)
let EA: Float64Array = new Float64Array(0); // E[attacker armies left in source]
let ED: Float64Array = new Float64Array(0); // E[defender armies left]
let EAW: Float64Array = new Float64Array(0); // E[attacker armies left · 1{conquest}]

function build(n: number): void {
  const s = n + 1;
  const w = new Float64Array(s * s);
  const ea = new Float64Array(s * s);
  const ed = new Float64Array(s * s);
  const eaw = new Float64Array(s * s);
  for (let a = 0; a <= n; a++) {
    for (let d = 0; d <= n; d++) {
      const i = a * s + d;
      if (d === 0) {
        w[i] = 1;
        ea[i] = a;
        eaw[i] = a;
        ed[i] = 0;
        continue;
      }
      if (a <= 1) {
        w[i] = 0;
        ea[i] = a;
        eaw[i] = 0;
        ed[i] = d;
        continue;
      }
      const outs = OUTCOMES[Math.min(3, a - 1)][Math.min(2, d)];
      let pw = 0,
        pea = 0,
        ped = 0,
        peaw = 0;
      for (const o of outs) {
        const j = (a - o.attLoss) * s + (d - o.defLoss);
        pw += o.p * w[j];
        pea += o.p * ea[j];
        ped += o.p * ed[j];
        peaw += o.p * eaw[j];
      }
      w[i] = pw;
      ea[i] = pea;
      ed[i] = ped;
      eaw[i] = peaw;
    }
  }
  size = n;
  W = w;
  EA = ea;
  ED = ed;
  EAW = eaw;
}

function lookup(attackers: number, defenders: number): number {
  let a = Math.max(0, Math.floor(attackers));
  let d = Math.max(0, Math.floor(defenders));
  if (a > MAX || d > MAX) {
    const f = MAX / Math.max(a, d);
    a = Math.max(0, Math.round(a * f));
    d = Math.max(d > 0 ? 1 : 0, Math.round(d * f));
  }
  const need = Math.max(a, d);
  if (need > size) {
    let n = Math.max(64, size);
    while (n < need) n *= 2;
    build(Math.min(MAX, n));
  }
  return a * (size + 1) + d;
}

/**
 * Probability the attacker conquers the territory by blitzing until `from` is down to 1 army.
 * `attackers` = armies in the attacking territory (not dice), `defenders` = armies defending.
 */
export function winProbability(attackers: number, defenders: number): number {
  if (defenders <= 0) return 1;
  if (attackers <= 1) return 0;
  const i = lookup(attackers, defenders); // may rebuild (and rebind) the tables — index first
  return W[i];
}

/** Win probability for a blitz that keeps `stopAt` armies home (the engine rolls min(3, armies − stopAt)). */
export function winProbabilityStopAt(attackers: number, defenders: number, stopAt = 1): number {
  return winProbability(attackers - Math.max(1, stopAt) + 1, defenders);
}

export interface BlitzOdds {
  /** P(conquest). */
  win: number;
  /** Expected armies left in the attacking territory when the blitz ends (win or lose). */
  expectedAttackersLeft: number;
  /** Expected defending armies left (0 on a win). */
  expectedDefendersLeft: number;
  /** Expected attacker losses. */
  expectedAttackerLosses: number;
  /** Expected defender losses. */
  expectedDefenderLosses: number;
  /** Expected armies left in the attacking territory given a conquest (before occupying). NaN if win = 0. */
  expectedAttackersLeftIfWin: number;
}

/** Full blitz-to-1 odds for the UI (e.g. "73% · expect to lose ~4"). */
export function blitzOdds(attackers: number, defenders: number): BlitzOdds {
  const a0 = Math.max(0, Math.floor(attackers));
  const d0 = Math.max(0, Math.floor(defenders));
  if (d0 === 0 || a0 <= 1) {
    const win = d0 === 0 ? 1 : 0;
    return {
      win,
      expectedAttackersLeft: a0,
      expectedDefendersLeft: d0,
      expectedAttackerLosses: 0,
      expectedDefenderLosses: 0,
      expectedAttackersLeftIfWin: win ? a0 : NaN,
    };
  }
  const i = lookup(a0, d0);
  // Scaled lookups (beyond MAX) return values in scaled units; rescale expectations.
  const scale = a0 > MAX || d0 > MAX ? Math.max(a0, d0) / MAX : 1;
  const win = W[i];
  const ea = EA[i] * scale;
  const ed = ED[i] * scale;
  return {
    win,
    expectedAttackersLeft: ea,
    expectedDefendersLeft: ed,
    expectedAttackerLosses: Math.max(0, a0 - ea),
    expectedDefenderLosses: Math.max(0, d0 - ed),
    expectedAttackersLeftIfWin: win > 0 ? (EAW[i] * scale) / win : NaN,
  };
}

/**
 * Expected losses for one roll of `attackDice` vs `defendDice` (e.g. 3v2 → attacker 0.921, defender 1.079).
 * For "hot dice" style stats: actual defender losses − expected, summed over a player's rolls.
 */
export function expectedRollLosses(attackDice: number, defendDice: number): { attacker: number; defender: number } {
  let attacker = 0;
  let defender = 0;
  for (const o of rollOutcomes(attackDice, defendDice)) {
    attacker += o.p * o.attLoss;
    defender += o.p * o.defLoss;
  }
  return { attacker, defender };
}
