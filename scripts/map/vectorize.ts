// Label raster → polygons with shared borders.
//
// Boundaries between pixels of different labels form a planar graph on pixel corners. We cut it at
// junctions (corners where 3+ boundary edges meet) into arcs; each arc separates exactly two labels.
// Every arc is simplified + smoothed ONCE and reused by both neighbours, so shared borders stay
// vertex-identical (no slivers, no gaps) no matter how much we stylize the outline.

import { Grid, OCEAN } from './raster';
import { ringArea, pointInRing, segmentsCross, SegGrid, type P } from './geom';

export interface Arc {
  /** raw pixel-corner path */
  raw: P[];
  left: number;
  right: number;
  closed: boolean;
  startV: number;
  endV: number;
  /** simplified path in pixel units */
  pts: P[];
  tol: number;
  smooth: number;
}

export function extractArcs(g: Grid): Arc[] {
  const { w, h } = g;
  const W1 = w + 1;
  const at = (i: number, r: number) => g.at(i, r);
  // boundary flags
  const hB = new Uint8Array((h + 1) * w); // horizontal edge (i,r)-(i+1,r): pixels (i,r-1)|(i,r)
  const vB = new Uint8Array(h * (w + 1)); // vertical edge (i,r)-(i,r+1): pixels (i-1,r)|(i,r)
  for (let r = 0; r <= h; r++) for (let i = 0; i < w; i++) hB[r * w + i] = at(i, r - 1) !== at(i, r) ? 1 : 0;
  for (let r = 0; r < h; r++) for (let i = 0; i <= w; i++) vB[r * W1 + i] = at(i - 1, r) !== at(i, r) ? 1 : 0;
  const hV = new Uint8Array(hB.length), vV = new Uint8Array(vB.length);

  const E = (i: number, r: number) => i < w && r >= 0 && r <= h && hB[r * w + i] === 1;
  const Wd = (i: number, r: number) => i > 0 && r >= 0 && r <= h && hB[r * w + i - 1] === 1;
  const N = (i: number, r: number) => r < h && i >= 0 && i <= w && vB[r * W1 + i] === 1;
  const S = (i: number, r: number) => r > 0 && i >= 0 && i <= w && vB[(r - 1) * W1 + i] === 1;
  const deg = (i: number, r: number) => (E(i, r) ? 1 : 0) + (Wd(i, r) ? 1 : 0) + (N(i, r) ? 1 : 0) + (S(i, r) ? 1 : 0);

  // Try to take an unvisited edge from (i,r) in direction d (0=E,1=W,2=N,3=S). Returns next vertex or null.
  const take = (i: number, r: number, d: number): [number, number] | null => {
    if (d === 0 && E(i, r) && !hV[r * w + i]) return (hV[r * w + i] = 1), [i + 1, r];
    if (d === 1 && Wd(i, r) && !hV[r * w + i - 1]) return (hV[r * w + i - 1] = 1), [i - 1, r];
    if (d === 2 && N(i, r) && !vV[r * W1 + i]) return (vV[r * W1 + i] = 1), [i, r + 1];
    if (d === 3 && S(i, r) && !vV[(r - 1) * W1 + i]) return (vV[(r - 1) * W1 + i] = 1), [i, r - 1];
    return null;
  };
  const sides = (a: P, b: P): [number, number] => {
    const [i, r] = a;
    if (b[0] === i + 1) return [at(i, r), at(i, r - 1)];
    if (b[0] === i - 1) return [at(i - 1, r - 1), at(i - 1, r)];
    if (b[1] === r + 1) return [at(i - 1, r), at(i, r)];
    return [at(i, r - 1), at(i - 1, r - 1)];
  };

  const arcs: Arc[] = [];
  const isJ = (i: number, r: number) => deg(i, r) >= 3;
  const walk = (i0: number, r0: number, first: [number, number], closedLoop: boolean) => {
    const raw: P[] = [[i0, r0]];
    let cur = first;
    for (;;) {
      raw.push(cur);
      if (closedLoop) {
        if (cur[0] === i0 && cur[1] === r0) break;
      } else if (isJ(cur[0], cur[1])) break;
      let nxt: [number, number] | null = null;
      for (let d = 0; d < 4 && !nxt; d++) nxt = take(cur[0], cur[1], d);
      if (!nxt) throw new Error(`dead end while tracing at ${cur}`);
      cur = nxt;
    }
    const [left, right] = sides(raw[0], raw[1]);
    if (closedLoop) raw.pop(); // drop repeated start
    arcs.push({
      raw,
      left,
      right,
      closed: closedLoop,
      startV: closedLoop ? -1 : r0 * W1 + i0,
      endV: closedLoop ? -1 : raw[raw.length - 1][1] * W1 + raw[raw.length - 1][0],
      pts: [],
      tol: 0,
      smooth: 0,
    });
  };
  for (let r = 0; r <= h; r++)
    for (let i = 0; i <= w; i++) {
      if (!isJ(i, r)) continue;
      for (let d = 0; d < 4; d++) {
        const nx = take(i, r, d);
        if (nx) walk(i, r, nx, false);
      }
    }
  // closed loops (no junction on them)
  for (let r = 0; r <= h; r++)
    for (let i = 0; i < w; i++) {
      if (hB[r * w + i] && !hV[r * w + i]) {
        hV[r * w + i] = 1;
        walk(i, r, [i + 1, r], true);
      }
    }
  for (let r = 0; r < h; r++)
    for (let i = 0; i <= w; i++) {
      if (vB[r * W1 + i] && !vV[r * W1 + i]) {
        vV[r * W1 + i] = 1;
        walk(i, r, [i, r + 1], true);
      }
    }
  return arcs;
}

function dropCollinear(pts: P[], closed: boolean): P[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: P[] = [];
  for (let k = 0; k < n; k++) {
    if (!closed && (k === 0 || k === n - 1)) {
      out.push(pts[k]);
      continue;
    }
    const a = pts[(k - 1 + n) % n], b = pts[k], c = pts[(k + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out;
}

function dp(pts: P[], tol: number): P[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    for (let k = a + 1; k < b; k++) {
      const [px, py] = pts[k];
      let d: number;
      if (l2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        let t = ((px - ax) * dx + (py - ay) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        d = (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
      }
      if (d > best) (best = d), (bi = k);
    }
    if (best > t2) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

function dpClosed(pts: P[], tol: number): P[] {
  if (pts.length <= 4) return pts.slice();
  // split at start and the farthest point from it
  let far = 0, fd = -1;
  for (let k = 1; k < pts.length; k++) {
    const d = (pts[k][0] - pts[0][0]) ** 2 + (pts[k][1] - pts[0][1]) ** 2;
    if (d > fd) (fd = d), (far = k);
  }
  const a = dp(pts.slice(0, far + 1), tol);
  const b = dp([...pts.slice(far), pts[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : pts.slice();
}

function chaikinOpen(pts: P[]): P[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: P[] = [pts[0]];
  for (let k = 0; k < n - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const Q: P = [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]];
    const R: P = [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]];
    if (k > 0) out.push(Q);
    if (k < n - 2) out.push(R);
  }
  out.push(pts[n - 1]);
  return out;
}

function chaikinClosed(pts: P[]): P[] {
  const n = pts.length;
  const out: P[] = [];
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
    out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  return out;
}

export function simplifyArc(a: Arc, tol: number, smooth: number, tol2: number) {
  a.tol = tol;
  a.smooth = smooth;
  let p = dropCollinear(a.raw, a.closed);
  if (tol <= 0) {
    a.pts = p;
    return;
  }
  p = a.closed ? dpClosed(p, tol) : dp(p, tol);
  if (a.closed && p.length < 3) p = dropCollinear(a.raw, true);
  for (let s = 0; s < smooth; s++) p = a.closed ? chaikinClosed(p) : chaikinOpen(p);
  if (tol2 > 0) p = a.closed ? dpClosed(p, tol2) : dp(p, tol2);
  a.pts = p;
}

/** Find arcs whose simplified geometry crosses another arc or itself. */
export function findCrossingArcs(arcs: Arc[]): Set<number> {
  const grid = new SegGrid(8);
  arcs.forEach((a, ai) => {
    const n = a.pts.length;
    const segs = a.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) grid.add({ a: a.pts[k], b: a.pts[(k + 1) % n], ring: ai, idx: k });
  });
  const bad = new Set<number>();
  grid.pairs((s, t) => {
    if (s.ring === t.ring) {
      const n = arcs[s.ring].pts.length;
      const segs = arcs[s.ring].closed ? n : n - 1;
      const d = Math.abs(s.idx - t.idx);
      if (d <= 1 || (arcs[s.ring].closed && d === segs - 1)) return;
    }
    if (segmentsCross(s.a, s.b, t.a, t.b)) {
      bad.add(s.ring);
      bad.add(t.ring);
    }
  });
  return bad;
}

export interface LabelPolygon {
  outer: P[];
  holes: P[][];
  area: number;
}

/** Assemble each label's rings from the (simplified) arcs, scale to board units. */
export function assemble(arcs: Arc[], labels: number[], px: number): Map<number, LabelPolygon[]> {
  const result = new Map<number, LabelPolygon[]>();
  for (const L of labels) {
    const rings: P[][] = [];
    const byStart = new Map<number, { pts: P[]; end: number; used: boolean }[]>();
    for (const a of arcs) {
      if (a.left !== L && a.right !== L) continue;
      const fwd = a.left === L;
      const pts = fwd ? a.pts : a.pts.slice().reverse();
      if (a.closed) {
        rings.push(pts);
        continue;
      }
      const s = fwd ? a.startV : a.endV, e = fwd ? a.endV : a.startV;
      const list = byStart.get(s) ?? [];
      list.push({ pts, end: e, used: false });
      byStart.set(s, list);
    }
    for (const [s0, list] of byStart) {
      for (const first of list) {
        if (first.used) continue;
        first.used = true;
        const ring: P[] = first.pts.slice(0, -1);
        let end = first.end;
        let guard = 0;
        while (end !== s0) {
          const nxt = (byStart.get(end) ?? []).find((d) => !d.used);
          if (!nxt) throw new Error(`label ${L}: ring does not close at vertex ${end}`);
          nxt.used = true;
          ring.push(...nxt.pts.slice(0, -1));
          end = nxt.end;
          if (++guard > 1e6) throw new Error('ring chaining runaway');
        }
        rings.push(ring);
      }
    }
    const scaled = rings.map((r) => r.map(([x, y]) => [x / px, y / px] as P));
    const outers: LabelPolygon[] = [];
    const holes: P[][] = [];
    for (const r of scaled) {
      if (r.length < 3) continue;
      const a = ringArea(r);
      if (a > 0) outers.push({ outer: r, holes: [], area: a });
      else if (a < 0) holes.push(r);
    }
    for (const hRing of holes) {
      const [x, y] = hRing[0];
      // smallest containing outer
      let best: LabelPolygon | null = null;
      for (const o of outers) if (pointInRing(x, y, o.outer) && (!best || o.area < best.area)) best = o;
      if (best) {
        best.holes.push(hRing);
        best.area += ringArea(hRing);
      }
    }
    outers.sort((p, q) => q.area - p.area);
    result.set(L, outers);
  }
  return result;
}

export { OCEAN };
