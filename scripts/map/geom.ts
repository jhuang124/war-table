// Small, dependency-free planar geometry helpers shared by build-map and verify-map.

export type P = [number, number];

/** Signed area (positive = counter-clockwise in a y-up frame). Ring has no closing duplicate. */
export function ringArea(ring: P[]): number {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

export function pointInRing(x: number, y: number, ring: P[]): boolean {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface PolyLike {
  outer: P[];
  holes: P[][];
}

export function pointInPoly(x: number, y: number, poly: PolyLike): boolean {
  if (!pointInRing(x, y, poly.outer)) return false;
  for (const h of poly.holes) if (pointInRing(x, y, h)) return false;
  return true;
}

export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Closest point on segment ab to p. */
export function closestOnSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): P {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + t * dx, ay + t * dy];
}

/** Distance from a point to the boundary of a polygon (outer + holes). */
export function distToPolyBoundary(x: number, y: number, poly: PolyLike): number {
  let best = Infinity;
  for (const ring of [poly.outer, ...poly.holes]) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const d = segDist2(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * True if segments ab and cd cross at a point interior to both (a proper crossing), or overlap
 * collinearly beyond a shared endpoint. Touching at shared endpoints is not an intersection.
 */
export function segmentsCross(a: P, b: P, c: P, d: P, eps = 1e-9): boolean {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  const sameP = (p: P, q: P) => Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12;
  const shared = sameP(a, c) || sameP(a, d) || sameP(b, c) || sameP(b, d);
  // The same edge used by two neighbours (shared border) is not an intersection.
  if ((sameP(a, c) && sameP(b, d)) || (sameP(a, d) && sameP(b, c))) return false;
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) {
    return !shared;
  }
  // collinear overlap
  if (Math.abs(o1) <= eps && Math.abs(o2) <= eps) {
    const ux = b[0] - a[0], uy = b[1] - a[1];
    const l2 = ux * ux + uy * uy;
    if (l2 === 0) return false;
    const t1 = ((c[0] - a[0]) * ux + (c[1] - a[1]) * uy) / l2;
    const t2 = ((d[0] - a[0]) * ux + (d[1] - a[1]) * uy) / l2;
    const lo = Math.max(0, Math.min(t1, t2));
    const hi = Math.min(1, Math.max(t1, t2));
    return hi - lo > 1e-6;
  }
  return false;
}

export interface Seg {
  a: P;
  b: P;
  /** caller-defined owner tags */
  ring: number;
  idx: number;
}

/** Uniform grid spatial hash over segments for pairwise tests. */
export class SegGrid {
  cell: number;
  map = new Map<number, Seg[]>();
  constructor(cell: number) {
    this.cell = cell;
  }
  private key(ix: number, iy: number) {
    return (ix + 4096) * 8192 + (iy + 4096);
  }
  add(s: Seg) {
    const c = this.cell;
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / c), x1 = Math.floor(Math.max(s.a[0], s.b[0]) / c);
    const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / c), y1 = Math.floor(Math.max(s.a[1], s.b[1]) / c);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const k = this.key(ix, iy);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(s);
      }
  }
  /** Calls fn once per unordered candidate pair sharing a cell (deduped). */
  pairs(fn: (s: Seg, t: Seg) => void) {
    const seen = new Set<string>();
    for (const arr of this.map.values()) {
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) {
          const s = arr[i], t = arr[j];
          const k = s.ring < t.ring || (s.ring === t.ring && s.idx < t.idx)
            ? `${s.ring}:${s.idx}|${t.ring}:${t.idx}`
            : `${t.ring}:${t.idx}|${s.ring}:${s.idx}`;
          if (seen.has(k)) continue;
          seen.add(k);
          fn(s, t);
        }
    }
  }
  near(x0: number, y0: number, x1: number, y1: number, fn: (s: Seg) => void) {
    const c = this.cell;
    const seen = new Set<Seg>();
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
      for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) {
        const arr = this.map.get(this.key(ix, iy));
        if (!arr) continue;
        for (const s of arr) if (!seen.has(s)) (seen.add(s), fn(s));
      }
  }
}

export function bboxOf(rings: P[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return [x0, y0, x1, y1];
}

export function polylineLength(pts: P[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;
