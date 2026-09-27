// Label raster used to build a clean planar partition of the board.
// Pixel (i, r) covers board x ∈ [i/PX, (i+1)/PX], y ∈ [r/PX, (r+1)/PX]; row 0 is the bottom.
// Label 0 = ocean, 1..42 = territories (TERRITORY_IDS order + 1), DECOR = 43, IRELAND = 44 (a second
// Great Britain label so Ireland keeps its own coastline instead of fusing onto Britain).

export const OCEAN = 0;
export const DECOR = 43;
export const IRELAND = 44;
export const NLABELS = 45;

export class Grid {
  w: number;
  h: number;
  px: number;
  lab: Uint8Array;
  constructor(w: number, h: number, px: number) {
    this.w = w;
    this.h = h;
    this.px = px;
    this.lab = new Uint8Array(w * h);
  }
  at(i: number, r: number): number {
    if (i < 0 || r < 0 || i >= this.w || r >= this.h) return OCEAN;
    return this.lab[r * this.w + i];
  }
}

type Ring = [number, number][];

/**
 * Scanline-fill a polygon (outer + holes, even-odd) given in board units, calling `set(idx)` for each
 * covered pixel centre.
 */
export function fillPolygon(rings: Ring[], w: number, h: number, px: number, set: (idx: number) => void) {
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) for (const p of ring) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const r0 = Math.max(0, Math.floor(minY * px - 0.5));
  const r1 = Math.min(h - 1, Math.ceil(maxY * px - 0.5));
  // Build edge list in pixel units.
  const ex0: number[] = [], ey0: number[] = [], ex1: number[] = [], ey1: number[] = [];
  for (const ring of rings) {
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      if (a[1] === b[1]) continue;
      ex0.push(a[0] * px); ey0.push(a[1] * px); ex1.push(b[0] * px); ey1.push(b[1] * px);
    }
  }
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const yc = r + 0.5;
    xs.length = 0;
    for (let e = 0; e < ex0.length; e++) {
      const ya = ey0[e], yb = ey1[e];
      if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) {
        xs.push(ex0[e] + ((yc - ya) / (yb - ya)) * (ex1[e] - ex0[e]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const i1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = i0; i <= i1; i++) set(r * w + i);
    }
  }
}

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Exact squared Euclidean distance (in pixels²) from every pixel of the window [x0, x0+w) × [y0, y0+h)
 * to the nearest pixel where `feature(i, r)` is true. Returns a Float64Array indexed (r - y0) * w + (i - x0).
 */
export function edt(feature: (i: number, r: number) => boolean, x0: number, y0: number, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let r = 0; r < h; r++) for (let i = 0; i < w; i++) out[r * w + i] = feature(i + x0, r + y0) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w; i++) {
    for (let r = 0; r < h; r++) f[r] = out[r * w + i];
    edt1d(f, h, d, v, z);
    for (let r = 0; r < h; r++) out[r * w + i] = d[r];
  }
  for (let r = 0; r < h; r++) {
    for (let i = 0; i < w; i++) f[i] = out[r * w + i];
    edt1d(f, w, d, v, z);
    for (let i = 0; i < w; i++) out[r * w + i] = d[i];
  }
  return out;
}

export interface Bbox {
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number;
}

export function labelBboxes(g: Grid): (Bbox | null)[] {
  const bb: (Bbox | null)[] = new Array(NLABELS).fill(null);
  for (let r = 0; r < g.h; r++)
    for (let i = 0; i < g.w; i++) {
      const l = g.lab[r * g.w + i];
      if (l === OCEAN) continue;
      const b = bb[l];
      if (!b) bb[l] = { x0: i, y0: r, x1: i, y1: r };
      else {
        if (i < b.x0) b.x0 = i;
        if (i > b.x1) b.x1 = i;
        if (r < b.y0) b.y0 = r;
        if (r > b.y1) b.y1 = r;
      }
    }
  return bb;
}

/** Connected components (4-connected) of a single label. Returns component id per pixel (-1 elsewhere) + sizes. */
export function components(g: Grid, keep: (l: number) => boolean) {
  const { w, h, lab } = g;
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const labels: number[] = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    const l = lab[s];
    if (comp[s] !== -1 || !keep(l)) continue;
    const id = sizes.length;
    let sp = 0, count = 0;
    stack[sp++] = s;
    comp[s] = id;
    while (sp > 0) {
      const p = stack[--sp];
      count++;
      const i = p % w, r = (p - i) / w;
      if (i > 0 && comp[p - 1] === -1 && lab[p - 1] === l) (comp[p - 1] = id), (stack[sp++] = p - 1);
      if (i < w - 1 && comp[p + 1] === -1 && lab[p + 1] === l) (comp[p + 1] = id), (stack[sp++] = p + 1);
      if (r > 0 && comp[p - w] === -1 && lab[p - w] === l) (comp[p - w] = id), (stack[sp++] = p - w);
      if (r < h - 1 && comp[p + w] === -1 && lab[p + w] === l) (comp[p + w] = id), (stack[sp++] = p + w);
    }
    sizes.push(count);
    labels.push(l);
  }
  return { comp, sizes, labels };
}

/** Separable Gaussian blur of a float field. */
export function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const rad = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * rad + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) sum += k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let r = 0; r < h; r++)
    for (let i = 0; i < w; i++) {
      let acc = 0;
      for (let t = -rad; t <= rad; t++) {
        const ii = Math.min(w - 1, Math.max(0, i + t));
        acc += src[r * w + ii] * k[t + rad];
      }
      tmp[r * w + i] = acc;
    }
  for (let r = 0; r < h; r++)
    for (let i = 0; i < w; i++) {
      let acc = 0;
      for (let t = -rad; t <= rad; t++) {
        const rr = r + t;
        acc += (rr < 0 || rr >= h ? 0 : tmp[rr * w + i]) * k[t + rad];
      }
      out[r * w + i] = acc;
    }
  return out;
}

/**
 * Give every pixel with `need(idx)` the label of the nearest pixel that already has a real label,
 * propagating only through `need` pixels (multi-source BFS, 8-connected). Unreached → OCEAN.
 */
export function fillFromNearest(g: Grid, need: Uint8Array) {
  const { w, h, lab } = g;
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const done = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!need[p] && lab[p] !== OCEAN) {
      // seed only pixels adjacent to a needing pixel
      const i = p % w;
      if ((i > 0 && need[p - 1]) || (i < w - 1 && need[p + 1]) || (p >= w && need[p - w]) || (p < w * (h - 1) && need[p + w])) {
        queue[qt++] = p;
      }
      done[p] = 1;
    }
  }
  const nb = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  while (qh < qt) {
    const p = queue[qh++];
    const i = p % w;
    for (let k = 0; k < 8; k++) {
      const q = p + nb[k];
      if (q < 0 || q >= w * h) continue;
      const qi = q % w;
      if (Math.abs(qi - i) > 1) continue;
      if (done[q] || !need[q]) continue;
      done[q] = 1;
      lab[q] = lab[p];
      queue[qt++] = q;
    }
  }
  for (let p = 0; p < w * h; p++) if (need[p] && !done[p]) lab[p] = OCEAN;
}

/** Summed-area table of a boolean predicate for fast box queries. */
export class SAT {
  w: number;
  h: number;
  s: Int32Array;
  constructor(w: number, h: number, pred: (p: number) => boolean) {
    this.w = w;
    this.h = h;
    this.s = new Int32Array((w + 1) * (h + 1));
    for (let r = 0; r < h; r++) {
      let row = 0;
      for (let i = 0; i < w; i++) {
        row += pred(r * w + i) ? 1 : 0;
        this.s[(r + 1) * (w + 1) + i + 1] = this.s[r * (w + 1) + i + 1] + row;
      }
    }
  }
  /** Count in pixel box [i0, i1) × [r0, r1), clipped; outside counts as `outside` per pixel. */
  count(i0: number, r0: number, i1: number, r1: number, outside = 1): number {
    const area = (i1 - i0) * (r1 - r0);
    const a0 = Math.max(0, i0), b0 = Math.max(0, r0), a1 = Math.min(this.w, i1), b1 = Math.min(this.h, r1);
    if (a1 <= a0 || b1 <= b0) return area * outside;
    const W = this.w + 1;
    const inside = this.s[b1 * W + a1] - this.s[b0 * W + a1] - this.s[b1 * W + a0] + this.s[b0 * W + a0];
    return inside + (area - (a1 - a0) * (b1 - b0)) * outside;
  }
}
