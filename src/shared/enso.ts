// The ensō: one brushed circle, drawn from a seed (docs/INK.md B3 "The ensō"). Pure: no DOM, no
// Math.random — the same seed always draws the same brush, so a game's ensō (seed = state.config.seed)
// is the same on the title, the gold rule, the menu and the victory scroll, and never the same twice
// across games. Shared by the HUD (inline SVG) and anyone who wants it as a texture.
//
// The stroke is built the way a brush lays ink: a band of bristles swept clockwise from just past the
// gap (near 1 o'clock) all the way round. The brush lands heavy, the width breathes along the body,
// then it thins and the bristles run dry one by one — outer bristles first — leaving streaks and a
// short tail. Every bristle is its own filled strip, so the dry end breaks into real gaps.
//
// Also here: `brushMark`, the same brush along any polyline (the seat emblems in src/shared/palette.ts).

export interface EnsoOpts {
  /** Where the gap sits, in degrees clockwise from 12 o'clock. Default ~30 (1 o'clock), jittered by the seed. */
  gapAt?: number;
  /** Stroke weight multiplier (1 = the default ~9% of the diameter at its thickest). */
  weight?: number;
  /** Bristle strips across the stroke (default 7; 3–4 is plenty below ~48 px). */
  bristles?: number;
  /** Samples along the sweep (default 104; ~64 is plenty below ~48 px). */
  samples?: number;
}

export interface EnsoShape {
  /** Filled path (fill-rule nonzero, every sub-path wound the same way). */
  d: string;
  /** Always '0 0 100 100'. */
  viewBox: string;
  /** The brush's centre line, start → end: stroke it wide through a mask to draw the ensō in. */
  spine: string;
  /** Length of `spine` in viewBox units (for stroke-dasharray). */
  length: number;
}

type Pt = [number, number];

/** mulberry32: a small, good 32-bit PRNG. */
function rng(seed: number): () => number {
  let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [-1, 1], periodic-free, `freq` lattice cells over t ∈ [0, 1]. */
function noise1(r: () => number, freq: number): (t: number) => number {
  const n = Math.ceil(freq) + 2;
  const lat = Array.from({ length: n }, () => r() * 2 - 1);
  return (t: number) => {
    const x = Math.max(0, t) * freq;
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    const a = lat[Math.min(i, n - 1)];
    const b = lat[Math.min(i + 1, n - 1)];
    return a + (b - a) * s;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

function signedArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return s;
}

/** One closed sub-path, always wound the same way (so overlapping strips never cancel under nonzero). */
function poly(p: Pt[]): string {
  if (p.length < 3) return '';
  const q = signedArea(p) < 0 ? [...p].reverse() : p;
  let s = `M${f1(q[0][0])} ${f1(q[0][1])}`;
  for (let i = 1; i < q.length; i++) s += `L${f1(q[i][0])} ${f1(q[i][1])}`;
  return s + 'Z';
}

/**
 * Sweep a bristled brush along a centre line.
 *  at(t)    → [x, y] on the centre line, t ∈ [0, tMax]
 *  width(t) → full stroke width at t (0 = nothing)
 *  dryAt    → t where the outer bristles start to run dry (inner ones later)
 */
function sweep(
  r: () => number,
  at: (t: number) => Pt,
  width: (t: number) => number,
  opts: { bristles: number; samples: number; tMax: number; dryAt: number; cap: boolean },
): string {
  const { bristles: K, samples: N, tMax, dryAt } = opts;
  const ts = Array.from({ length: N + 1 }, (_, i) => (i / N) * tMax);
  const pts = ts.map(at);
  // Unit normals by central difference.
  const nrm = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l] as Pt;
  });
  const out: string[] = [];
  for (let k = 0; k < K; k++) {
    // Bristle k spans [lo, hi] across the stroke, as fractions of the width in [-0.5, 0.5].
    const lo = -0.5 + k / K;
    const hi = -0.5 + (k + 1) / K;
    const edge = Math.abs((lo + hi) / 2) * 2; // 0 at the centre, ~1 at the edges
    const jit = noise1(r, 5 + r() * 4);
    const gaps = noise1(r, 9 + r() * 10);
    // Outer bristles run dry sooner; each ends on its own (the tail is the last few streaks).
    const dry = dryAt + (1 - edge) * (tMax - dryAt) * 0.45 + (r() - 0.5) * 0.06;
    const end = tMax - edge * (tMax - dryAt) * (0.35 + r() * 0.3) - r() * 0.02;
    // Wet bristles overlap a touch so the body reads solid; dry ones narrow and leave paper between.
    const overlap = 0.18 / K;
    let run: { a: Pt[]; b: Pt[] } | null = null;
    const flush = () => {
      if (run && run.a.length > 1) out.push(poly([...run.a, ...run.b.reverse()]));
      run = null;
    };
    for (let i = 0; i <= N; i++) {
      const t = ts[i];
      const w = width(t);
      const dryK = smooth(dry, end, t);
      const present = t <= end && w > 0.05 && !(dryK > 0.05 && gaps(t) > 0.62 - dryK * 0.9);
      if (!present) {
        flush();
        continue;
      }
      const shrink = 1 - dryK * 0.55;
      const mid = (lo + hi) / 2 + jit(t) * 0.03;
      const half = ((hi - lo) / 2 + overlap) * shrink;
      const p = pts[i];
      const n = nrm[i];
      const oa = (mid - half) * w;
      const ob = (mid + half) * w;
      if (!run) run = { a: [], b: [] };
      run.a.push([p[0] + n[0] * oa, p[1] + n[1] * oa]);
      run.b.push([p[0] + n[0] * ob, p[1] + n[1] * ob]);
    }
    flush();
  }
  if (opts.cap) {
    // The brush lands: a soft round blob at the start, as wide as the stroke there.
    const p = pts[0];
    const rr = width(0) * 0.5;
    const c: Pt[] = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      return [p[0] + Math.cos(a) * rr * (1 + (r() - 0.5) * 0.12), p[1] + Math.sin(a) * rr * (1 + (r() - 0.5) * 0.12)];
    });
    out.push(poly(c));
  }
  return out.join('');
}

/** The seeded ensō as a filled SVG path in a 100×100 box. */
export function ensoPath(seed: number, opts: EnsoOpts = {}): EnsoShape {
  const r = rng(seed * 7919 + 17);
  const weight = opts.weight ?? 1;
  const K = Math.max(2, Math.round(opts.bristles ?? 7));
  const N = Math.max(24, Math.round(opts.samples ?? 104));
  const gapAt = ((opts.gapAt ?? 30 + (r() - 0.5) * 16) * Math.PI) / 180;
  const gap = ((22 + r() * 12) * Math.PI) / 180;
  const start = gapAt + gap / 2;
  const span = Math.PI * 2 - gap;
  const R = 36.5;
  const wob = noise1(r, 3 + r() * 2);
  const wob2 = noise1(r, 7 + r() * 3);
  const breath = noise1(r, 4 + r() * 3);
  const spiral = 1.2 + r() * 1.8; // the end rides a little outside the start
  const flick = (r() < 0.5 ? -1 : 1) * (1.5 + r() * 2);
  const tMax = 1;
  const at = (t: number): Pt => {
    const a = start + span * t;
    const rad = R + wob(t) * 1.4 + wob2(t) * 0.45 + spiral * t + flick * smooth(0.9, 1, t);
    return [50 + Math.sin(a) * rad, 50 - Math.cos(a) * rad];
  };
  const Wmax = 9.2 * weight;
  const width = (t: number) => {
    const land = 0.72 + 0.28 * smooth(0, 0.05, t);
    const body = 1 + breath(t) * 0.16;
    const taper = 1 - 0.86 * Math.pow(smooth(0.5, 1, t), 1.35);
    return Wmax * land * body * taper;
  };
  const d = sweep(r, at, width, { bristles: K, samples: N, tMax, dryAt: 0.62 + r() * 0.12, cap: true });
  // The spine, for the self-drawing reveal.
  const S = 48;
  let spine = '';
  let length = 0;
  let prev: Pt | null = null;
  for (let i = 0; i <= S; i++) {
    const p = at((i / S) * tMax);
    spine += `${i ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`;
    if (prev) length += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return { d, viewBox: '0 0 100 100', spine, length: Math.ceil(length) };
}

/** Markup for an inline ensō: `<svg class viewBox><path d/></svg>`, filled with currentColor. */
export function ensoSvg(seed: number, className?: string, opts?: EnsoOpts): string {
  const e = ensoPath(seed, opts);
  return `<svg ${className ? `class="${className}" ` : ''}viewBox="${e.viewBox}" aria-hidden="true"><path d="${e.d}" fill="currentColor"/></svg>`;
}

/**
 * The same brush along a polyline (used for the seat emblems, 24×24): `points` in order, `closed` to
 * come back round (the stroke stops a little short, like the ensō's gap). Deterministic per seed.
 */
export function brushMark(points: Pt[], opts: { seed: number; width: number; closed?: boolean; samples?: number; bristles?: number }): string {
  const r = rng(opts.seed * 104729 + 3);
  const pts = opts.closed ? [...points, points[0]] : points;
  // Arc-length parametrisation of the polyline.
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = seg[seg.length - 1];
  const stopShort = opts.closed ? 0.93 : 1;
  const at = (t: number): Pt => {
    const s = Math.min(L, Math.max(0, t * L * stopShort));
    let i = 1;
    while (i < seg.length - 1 && seg[i] < s) i++;
    const k = (s - seg[i - 1]) / Math.max(1e-6, seg[i] - seg[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
  };
  const breath = noise1(r, 3);
  const width = (t: number) => opts.width * (0.8 + 0.2 * smooth(0, 0.06, t)) * (1 + breath(t) * 0.12) * (1 - 0.6 * Math.pow(smooth(0.6, 1, t), 1.5));
  return sweep(r, at, width, { bristles: opts.bristles ?? 3, samples: opts.samples ?? 72, tMax: 1, dryAt: 0.78, cap: true });
}
