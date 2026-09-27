// Checks src/map/board.json against the classic board and renders previews.
//   npm run verify:map            (checks + previews)
//   npm run verify:map -- --no-preview
// Exits non-zero on any failure.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BORDERS, TERRITORY_IDS, TERRITORIES } from '../src/engine/mapData';
import type { TerritoryId } from '../src/engine/types';
import type { BoardGeometry, PolygonGeom } from '../src/map/types';
import {
  ringArea, pointInPoly, distToPolyBoundary, segmentsCross, segDist2, SegGrid, polylineLength, type P,
} from './map/geom';
import { renderPreviews } from './map/preview';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_CLEARANCE = 1.3;
const TOUCH_MIN_LEN = 0.1; // shared boundary shorter than this = point touch, not a border
const MIN_GAP = 0.25; // non-touching territories must be at least this far apart
const MAX_LANE_LEN = 14;
const MAX_FOREIGN = 0.3; // lane length allowed over land of unrelated territories

const board = JSON.parse(readFileSync(resolve(ROOT, 'src/map/board.json'), 'utf8')) as BoardGeometry;
const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ------------------------------------------------------------------ presence
const ids = Object.keys(board.territories);
for (const t of TERRITORY_IDS) if (!board.territories[t]) fail(`missing territory ${t}`);
for (const t of ids) if (!TERRITORY_IDS.includes(t as TerritoryId)) fail(`unknown territory ${t}`);
if (ids.length !== 42) fail(`expected 42 territories, got ${ids.length}`);

// ------------------------------------------------------------------ polygon validity
type Owner = { t: string; poly: number; ring: number };
const owners: Owner[] = [];
const grid = new SegGrid(1.5);
function addRings(t: string, polys: PolygonGeom[]) {
  polys.forEach((pg, pi) => {
    const rings = [pg.outer, ...pg.holes];
    rings.forEach((r, ri) => {
      const label = `${t}#${pi}${ri ? `h${ri}` : ''}`;
      if (r.length < 3) fail(`${label}: ring has ${r.length} points`);
      for (const [x, y] of r) if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`${label}: non-finite coordinate`);
      for (let k = 0; k < r.length; k++) {
        const a = r[k], b = r[(k + 1) % r.length];
        if (a[0] === b[0] && a[1] === b[1]) {
          fail(`${label}: repeated point at ${a}`);
          break;
        }
      }
      const area = ringArea(r as P[]);
      if (ri === 0 && !(area > 0)) fail(`${label}: outer ring is not counter-clockwise (area ${area.toFixed(3)})`);
      if (ri > 0 && !(area < 0)) fail(`${label}: hole is not clockwise (area ${area.toFixed(3)})`);
      const oi = owners.push({ t, poly: pi, ring: ri }) - 1;
      for (let k = 0; k < r.length; k++) grid.add({ a: r[k] as P, b: r[(k + 1) % r.length] as P, ring: oi, idx: k });
    });
  });
}
for (const t of TERRITORY_IDS) if (board.territories[t]) addRings(t, board.territories[t].polygons);
addRings('decor', board.decorativeLand);

let crossings = 0;
const ringLen = (oi: number) => {
  const o = owners[oi];
  const pg = o.t === 'decor' ? board.decorativeLand[o.poly] : board.territories[o.t as TerritoryId].polygons[o.poly];
  return (o.ring === 0 ? pg.outer : pg.holes[o.ring - 1]).length;
};
grid.pairs((s, u) => {
  if (s.ring === u.ring) {
    const n = ringLen(s.ring);
    const d = Math.abs(s.idx - u.idx);
    if (d <= 1 || d === n - 1) return;
  }
  if (segmentsCross(s.a, s.b, u.a, u.b)) {
    crossings++;
    if (crossings <= 10) {
      const A = owners[s.ring], B = owners[u.ring];
      fail(`segments cross: ${A.t}#${A.poly}/${A.ring} × ${B.t}#${B.poly}/${B.ring} near ${s.a.map((v) => v.toFixed(2))}`);
    }
  }
});
if (crossings > 10) fail(`... ${crossings} crossings in total`);

// Interior overlap: a representative interior point of each polygon must not lie inside another territory.
function interiorPoint(pg: PolygonGeom): P {
  // midpoint of the widest horizontal span through the bbox middle
  const ys = pg.outer.map((p) => p[1]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + 1e-4;
  const xs: number[] = [];
  for (const r of [pg.outer, ...pg.holes])
    for (let k = 0; k < r.length; k++) {
      const a = r[k], b = r[(k + 1) % r.length];
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  xs.sort((p, q) => p - q);
  let best: P = pg.outer[0] as P, bw = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > bw) (bw = xs[k + 1] - xs[k]), (best = [(xs[k] + xs[k + 1]) / 2, y]);
  return best;
}
for (const t of TERRITORY_IDS) {
  for (const pg of board.territories[t]?.polygons ?? []) {
    const [x, y] = interiorPoint(pg);
    for (const u of TERRITORY_IDS) {
      if (u === t) continue;
      if (board.territories[u].polygons.some((q) => pointInPoly(x, y, q))) fail(`${t} overlaps ${u} at ${x.toFixed(2)},${y.toFixed(2)}`);
    }
  }
}

// ------------------------------------------------------------------ touching pairs
const edgeOwners = new Map<string, Set<string>>();
const edgeLen = new Map<string, number>();
const ek = (a: P, b: P) => {
  const s = `${a[0]},${a[1]}`, u = `${b[0]},${b[1]}`;
  return s < u ? `${s}|${u}` : `${u}|${s}`;
};
function eachEdge(t: string, polys: PolygonGeom[], fn: (a: P, b: P) => void) {
  for (const pg of polys) for (const r of [pg.outer, ...pg.holes]) for (let k = 0; k < r.length; k++) fn(r[k] as P, r[(k + 1) % r.length] as P);
  void t;
}
for (const t of [...TERRITORY_IDS, 'decor'] as string[]) {
  const polys = t === 'decor' ? board.decorativeLand : board.territories[t as TerritoryId]?.polygons ?? [];
  eachEdge(t, polys, (a, b) => {
    const k = ek(a, b);
    const set = edgeOwners.get(k) ?? new Set<string>();
    set.add(t);
    edgeOwners.set(k, set);
    edgeLen.set(k, Math.hypot(b[0] - a[0], b[1] - a[1]));
  });
}
const shared = new Map<string, number>();
for (const [k, set] of edgeOwners) {
  if (set.size < 2) continue;
  const arr = [...set];
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++) {
      const pk = key(arr[i], arr[j]);
      shared.set(pk, (shared.get(pk) ?? 0) + edgeLen.get(k)!);
    }
}
const landPairs = new Set([...shared.entries()].filter(([, l]) => l >= TOUCH_MIN_LEN).map(([k]) => k));
for (const [k, l] of shared) if (l < TOUCH_MIN_LEN) fail(`point-like touch ${k} (shared ${l.toFixed(3)})`);
for (const k of landPairs) if (k.includes('decor')) fail(`decorative land touches a territory: ${k}`);

// near contacts between non-touching land
{
  const ownerT = (oi: number) => owners[oi].t;
  const g2 = new SegGrid(1.0);
  owners.forEach((o, oi) => {
    const pg = o.t === 'decor' ? board.decorativeLand[o.poly] : board.territories[o.t as TerritoryId].polygons[o.poly];
    const r = o.ring === 0 ? pg.outer : pg.holes[o.ring - 1];
    for (let k = 0; k < r.length; k++) g2.add({ a: r[k] as P, b: r[(k + 1) % r.length] as P, ring: oi, idx: k });
  });
  const minGap = new Map<string, number>();
  g2.pairs((s, u) => {
    const A = ownerT(s.ring), B = ownerT(u.ring);
    if (A === B) return;
    const pk = key(A, B);
    if (landPairs.has(pk)) return;
    const d = Math.sqrt(
      Math.min(
        segDist2(s.a[0], s.a[1], u.a[0], u.a[1], u.b[0], u.b[1]),
        segDist2(s.b[0], s.b[1], u.a[0], u.a[1], u.b[0], u.b[1]),
        segDist2(u.a[0], u.a[1], s.a[0], s.a[1], s.b[0], s.b[1]),
        segDist2(u.b[0], u.b[1], s.a[0], s.a[1], s.b[0], s.b[1]),
      ),
    );
    if (d < (minGap.get(pk) ?? Infinity)) minGap.set(pk, d);
  });
  for (const [pk, d] of minGap) if (d < MIN_GAP) fail(`near contact ${pk}: ${d.toFixed(3)} apart (need ≥ ${MIN_GAP} or a real shared border)`);
}

// ------------------------------------------------------------------ borders == land ∪ lanes
const borderSet = new Set(BORDERS.map(([a, b]) => key(a, b)));
const laneSet = new Set<string>();
for (const lane of board.seaLanes) {
  const k = key(lane.a, lane.b);
  if (laneSet.has(k)) fail(`duplicate sea lane ${k}`);
  laneSet.add(k);
  if (landPairs.has(k)) fail(`sea lane ${k} duplicates a land border`);
}
const terrLand = new Set([...landPairs].filter((k) => !k.includes('decor')));
for (const k of terrLand) if (!borderSet.has(k)) fail(`extra land contact ${k} (not a Risk border)`);
for (const k of laneSet) if (!borderSet.has(k)) fail(`sea lane ${k} is not a Risk border`);
for (const k of borderSet) if (!terrLand.has(k) && !laneSet.has(k)) fail(`missing border ${k} (no land contact, no lane)`);

// ------------------------------------------------------------------ anchors
const clearance = new Map<string, number>();
for (const t of TERRITORY_IDS) {
  const tg = board.territories[t];
  if (!tg) continue;
  const main = tg.polygons[0];
  const areas = tg.polygons.map((pg) => ringArea(pg.outer as P[]));
  if (areas.some((a) => a > areas[0] + 1e-9)) fail(`${t}: polygons[0] is not the largest polygon`);
  const [x, y] = tg.anchor;
  if (!pointInPoly(x, y, main)) fail(`${t}: anchor is outside its main polygon`);
  const c = distToPolyBoundary(x, y, main);
  clearance.set(t, c);
  if (c < MIN_CLEARANCE) fail(`${t}: anchor clearance ${c.toFixed(2)} < ${MIN_CLEARANCE}`);
  const [lx, ly] = tg.labelAnchor;
  if (!(lx >= 0 && lx <= board.width && ly >= 0 && ly <= board.height)) fail(`${t}: labelAnchor off the board`);
  const bb = tg.bbox;
  for (const pg of tg.polygons) for (const [px, py] of pg.outer) if (px < bb[0] - 1e-6 || px > bb[2] + 1e-6 || py < bb[1] - 1e-6 || py > bb[3] + 1e-6) {
    fail(`${t}: bbox does not contain its polygons`);
    break;
  }
}

// ------------------------------------------------------------------ lanes
const allLand = (x: number, y: number, except: string[]): string | null => {
  for (const t of TERRITORY_IDS) {
    if (except.includes(t)) continue;
    const tg = board.territories[t];
    if (tg.bbox[0] > x || tg.bbox[2] < x || tg.bbox[1] > y || tg.bbox[3] < y) continue;
    if (tg.polygons.some((pg) => pointInPoly(x, y, pg))) return t;
  }
  for (const pg of board.decorativeLand) if (pointInPoly(x, y, pg)) return 'decor';
  return null;
};
const coastDist = (t: TerritoryId, p: P) => Math.min(...board.territories[t].polygons.map((pg) => distToPolyBoundary(p[0], p[1], pg)));
const laneRows: string[] = [];
for (const lane of board.seaLanes) {
  const k = key(lane.a, lane.b);
  const len = lane.segments.reduce((s, seg) => s + polylineLength(seg as P[]), 0);
  if (len > MAX_LANE_LEN) fail(`lane ${k} is long (${len.toFixed(1)})`);
  if (lane.wrap) {
    if (k !== key('alaska', 'kamchatka')) fail(`lane ${k} should not wrap`);
    if (lane.segments.length !== 2) fail(`wrap lane ${k} needs 2 segments`);
    const xs = lane.segments.flat().map((p) => p[0]);
    if (!(Math.min(...xs) <= 0.001 && Math.max(...xs) >= board.width - 0.001)) fail(`wrap lane ${k} must run off both edges`);
  } else if (lane.segments.length !== 1) fail(`lane ${k} should be one segment`);
  const first = lane.segments[0][0] as P, lastSeg = lane.segments[lane.segments.length - 1];
  const last = lastSeg[lastSeg.length - 1] as P;
  const endOk = (coastDist(lane.a, first) < 0.3 && coastDist(lane.b, last) < 0.3) || (coastDist(lane.b, first) < 0.3 && coastDist(lane.a, last) < 0.3);
  if (!endOk) fail(`lane ${k}: endpoints are not on the coasts of ${lane.a} and ${lane.b}`);
  let foreign = 0;
  const hits = new Set<string>();
  for (const seg of lane.segments)
    for (let i = 1; i < seg.length; i++) {
      const [x0, y0] = seg[i - 1], [x1, y1] = seg[i];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(L / 0.05));
      for (let s = 0; s < n; s++) {
        const x = x0 + ((x1 - x0) * (s + 0.5)) / n, y = y0 + ((y1 - y0) * (s + 0.5)) / n;
        const hit = allLand(x, y, [lane.a, lane.b]);
        if (hit) (foreign += L / n), hits.add(hit);
      }
    }
  if (foreign > MAX_FOREIGN) fail(`lane ${k} crosses ${foreign.toFixed(2)} units of other land (${[...hits].join(', ')})`);
  laneRows.push(`  ${k.padEnd(38)} ${len.toFixed(2).padStart(6)}${lane.wrap ? '  (wraps)' : ''}${foreign > 0 ? `  over land ${foreign.toFixed(2)}` : ''}`);
}

// continents / ocean labels sit on water
for (const [c, cg] of Object.entries(board.continents)) {
  const [x, y] = cg.labelAnchor;
  const hit = allLand(x, y, []);
  if (hit) fail(`continent label ${c} sits on land (${hit})`);
}
if (Object.keys(board.continents).length !== 6) fail('expected 6 continent entries');
for (const o of board.oceanLabels) if (allLand(o.at[0], o.at[1], [])) fail(`ocean label ${o.text} sits on land`);

// ------------------------------------------------------------------ report
const nbrs = new Map<string, { land: string[]; sea: string[] }>();
for (const t of TERRITORY_IDS) nbrs.set(t, { land: [], sea: [] });
for (const k of terrLand) {
  const [a, b] = k.split('|');
  nbrs.get(a)!.land.push(b);
  nbrs.get(b)!.land.push(a);
}
for (const k of laneSet) {
  const [a, b] = k.split('|');
  nbrs.get(a)?.sea.push(b);
  nbrs.get(b)?.sea.push(a);
}
console.log(`\nboard ${board.width} × ${board.height}  ·  ${board.seaLanes.length} lanes  ·  ${board.decorativeLand.length} decorative polygons`);
console.log('territory              polys  verts   area  clear  land sea');
let totalV = 0;
for (const t of TERRITORY_IDS) {
  const tg = board.territories[t];
  if (!tg) continue;
  const v = tg.polygons.reduce((s, pg) => s + pg.outer.length + pg.holes.reduce((q, h) => q + h.length, 0), 0);
  totalV += v;
  const c = clearance.get(t) ?? 0;
  const n = nbrs.get(t)!;
  console.log(
    `${t.padEnd(22)} ${String(tg.polygons.length).padStart(5)} ${String(v).padStart(6)} ${tg.area.toFixed(1).padStart(6)} ${c.toFixed(2).padStart(6)}${c < MIN_CLEARANCE ? '!' : ' '} ${String(n.land.length).padStart(4)} ${String(n.sea.length).padStart(3)}  ${TERRITORIES[t].name}`,
  );
}
console.log(`total territory vertices: ${totalV}`);
console.log(`land borders: ${terrLand.size}, sea lanes: ${laneSet.size}, Risk borders: ${borderSet.size}`);
console.log('sea lanes (length in board units):');
for (const r of laneRows) console.log(r);

if (!process.argv.includes('--no-preview')) {
  const files = await renderPreviews(board, resolve(ROOT, 'artifacts/map'), MIN_CLEARANCE);
  console.log(`previews: ${files.join(', ')}`);
}

if (failures.length) {
  console.log(`\nFAIL (${failures.length})`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log('\nPASS: geometry valid, adjacency == BORDERS, anchors clear, lanes plausible');
}
