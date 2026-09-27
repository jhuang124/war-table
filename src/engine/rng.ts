// Seeded PRNG (mulberry32). The whole PRNG state is one uint32 stored in `GameState.rng`,
// so a saved game resumes with exactly the same future dice.

/** Advance a mulberry32 state. Returns [float in [0,1), next state]. */
export function nextRandom(seed: number): [number, number] {
  const a = (seed + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Anything carrying a uint32 PRNG state (a GameState draft, or a local AI generator). */
export interface RngHolder {
  rng: number;
}

/** Float in [0,1); advances `h.rng`. */
export function random(h: RngHolder): number {
  const [v, next] = nextRandom(h.rng);
  h.rng = next;
  return v;
}

/** Integer in [0, n). */
export function randInt(h: RngHolder, n: number): number {
  return Math.floor(random(h) * n);
}

/** One fair six-sided die. */
export function rollDie(h: RngHolder): number {
  return 1 + randInt(h, 6);
}

/** Fisher–Yates, in place; returns the same array. */
export function shuffleInPlace<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Normalize any number to a uint32 seed. */
export function toSeed(n: number): number {
  if (!Number.isFinite(n)) return 0x9e3779b9;
  return Math.floor(Math.abs(n)) >>> 0;
}

/** Stable 32-bit mix of several integers (used to seed side generators without touching state.rng). */
export function hashInts(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
  }
  return (h ^ (h >>> 15)) >>> 0;
}
