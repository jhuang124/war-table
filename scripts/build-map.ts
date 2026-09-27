// Builds src/map/board.json from Natural Earth (world-atlas 50m).
//
//   countries → territory rules (scripts/map/assign.ts) → Miller projection + smooth lenses
//   → label raster (20 px / unit) → coast smoothing, island exaggeration, water gaps, speck removal
//   → shared-arc vectorisation (borders stay vertex-identical) → DP + Chaikin stylisation
//   → anchors (polylabel), label anchors, sea lanes, continent + ocean labels → JSON.
//
// Run: npm run build:map   (then npm run verify:map)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import polylabel from 'polylabel';

import { BORDERS, CONTINENTS, CONTINENT_IDS, TERRITORY_IDS, TERRITORIES } from '../src/engine/mapData';
import type { ContinentId, TerritoryId } from '../src/engine/types';
import type { BoardGeometry, PolygonGeom, SeaLaneGeom, TerritoryGeom, Vec2 } from '../src/map/types';
import { RULES, type Resolved, type Rule } from './map/assign';
import { BoardProjection, WIDTH, unwrapLon, LON_LEFT } from './map/projection';
import {
  AUTO_FATTEN, CONTINENT_LABEL_HINTS, GAP, LANE_GAP, ISLAND_XFORM, LENSES, MIN_CLEARANCE, OCEAN_LABELS, PX,
  SEA_LANES, TARGET_CLEARANCE, MAX_GROWTH_ROUNDS, GROWTH_REACH, PROTECTED_ISLANDS,
} from './map/config';
import { Grid, OCEAN, DECOR, IRELAND, NLABELS, fillPolygon, edt, labelBboxes, components, blur, fillFromNearest, SAT } from './map/raster';
import { extractArcs, simplifyArc, findCrossingArcs, assemble, type LabelPolygon } from './map/vectorize';
import { ringArea, pointInPoly, distToPolyBoundary, closestOnSeg, round3, bboxOf, type P } from './map/geom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------------------------------------------------------------------------------------------
// Labels
const LABEL_OF = new Map<TerritoryId, number>(TERRITORY_IDS.map((t, i) => [t, i + 1]));
const TERR_OF = (l: number): TerritoryId => (l === IRELAND ? 'great_britain' : TERRITORY_IDS[l - 1]);
const LANE_KEY = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const LANE_SET = new Set(SEA_LANES.map((l) => LANE_KEY(l.a, l.b)));
const BORDER_SET = new Set(BORDERS.map(([a, b]) => LANE_KEY(a, b)));
for (const k of LANE_SET) if (!BORDER_SET.has(k)) throw new Error(`sea lane ${k} is not a border`);

/** May these two labels share a land border? */
function mayTouch(a: number, b: number): boolean {
  if (a === b) return true;
  if (a === OCEAN || b === OCEAN) return true;
  if (a === DECOR || b === DECOR) return false;
  if (TERR_OF(a) === TERR_OF(b)) return false; // Britain vs Ireland: keep the Irish Sea
  const k = LANE_KEY(TERR_OF(a), TERR_OF(b));
  return BORDER_SET.has(k) && !LANE_SET.has(k);
}
const MAY = new Uint8Array(NLABELS * NLABELS);
for (let a = 0; a < NLABELS; a++) for (let b = 0; b < NLABELS; b++) MAY[a * NLABELS + b] = mayTouch(a, b) ? 1 : 0;
/** Required water gap (px) between two labels that may not touch. */
const GAPPX = new Float64Array(NLABELS * NLABELS);
for (let a = 1; a < NLABELS; a++)
  for (let b = 1; b < NLABELS; b++) {
    const lane = a !== DECOR && b !== DECOR && a !== b && LANE_SET.has(LANE_KEY(TERR_OF(a), TERR_OF(b)));
    GAPPX[a * NLABELS + b] = (lane ? LANE_GAP : GAP) * PX;
  }

// ---------------------------------------------------------------------------------------------
// 1. Source geometry
const topo = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/world-atlas/countries-50m.json'), 'utf8')) as Topology;
const fc = feature(topo, topo.objects.countries as GeometryCollection) as unknown as {
  features: { properties: { name: string }; geometry: { type: string; coordinates: any } | null }[];
};
const proj = new BoardProjection(LENSES);
const WIDTH_PX = WIDTH * PX;
const HEIGHT = Math.ceil(proj.height * 2) / 2; // round to 0.5 units
const HEIGHT_PX = Math.round(HEIGHT * PX);
log(`board ${WIDTH} × ${HEIGHT} units, raster ${WIDTH_PX} × ${HEIGHT_PX}`);

type Code = { label: number } | { pixel: (lon: number, lat: number) => Resolved };
const codes: Code[] = [];
const labelFor = (r: Resolved): number =>
  r === 'drop' ? -1 : r === 'decor' ? DECOR : r === 'ireland' ? IRELAND : LABEL_OF.get(r)!;

interface SrcPoly {
  rings: P[][]; // board coords
  code: number;
  direct: TerritoryId | null;
}
const srcPolys: SrcPoly[] = [];
const unassigned = new Set<string>();
const codeCache = new Map<string, number>();
function codeForLabel(l: number): number {
  const k = `L${l}`;
  if (!codeCache.has(k)) codeCache.set(k, codes.push({ label: l }) - 1);
  return codeCache.get(k)!;
}

for (const f of fc.features) {
  const name = f.properties.name;
  const rule: Rule | undefined = RULES[name];
  if (!f.geometry) continue;
  if (!rule) {
    unassigned.add(name);
    continue;
  }
  const polys: [number, number][][][] =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
  let pixelCode = -1;
  for (const rawPoly of polys) {
    // Make every ring continuous in longitude (rings may cross the antimeridian in one piece).
    const poly = rawPoly.map((ring) => {
      const out: [number, number][] = [];
      let prev = ring[0][0];
      let off = 0;
      for (const [lo, la] of ring) {
        let l = lo + off;
        while (l - prev > 180) (l -= 360), (off -= 360);
        while (prev - l > 180) (l += 360), (off += 360);
        out.push([l, la]);
        prev = l;
      }
      return out;
    });
    const outer = poly[0];
    let mlon = 0, mlat = 0;
    for (const [lo, la] of outer) (mlon += lo), (mlat += la);
    mlon /= outer.length;
    mlat /= outer.length;
    const shift = unwrapLon(mlon) - mlon;
    const lon = mlon + shift, lat = mlat;
    const area = Math.abs(ringArea(outer as P[]));
    let res: Resolved | 'pixel';
    if (typeof rule === 'string') res = rule;
    else {
      const r = rule.poly?.({ lon, lat, area });
      res = r ?? (rule.pixel ? 'pixel' : (rule.default ?? 'drop'));
    }
    if (res === 'drop') continue;
    let code: number;
    let direct: TerritoryId | null = null;
    if (res === 'pixel') {
      if (pixelCode < 0) pixelCode = codes.push({ pixel: (rule as { pixel: (a: number, b: number) => Resolved }).pixel }) - 1;
      code = pixelCode;
    } else {
      code = codeForLabel(labelFor(res));
      if (res !== 'decor') direct = res === 'ireland' ? 'great_britain' : res;
    }
    const rings = poly.map((ring) =>
      ring.slice(0, ring.length - 1).map(([lo, la]) => {
        const clampedLat = Math.max(-85, Math.min(85, la));
        return proj.forward(lo + shift, clampedLat) as P;
      }),
    );
    srcPolys.push({ rings, code, direct });
  }
}
if (unassigned.size) log(`dropped (no rule): ${[...unassigned].sort().join(', ')}`);

// Island exaggeration: oriented stretch about each island-territory's area-weighted centroid.
for (const [t, xf] of Object.entries(ISLAND_XFORM) as [TerritoryId, { along: number; across: number; angle: number }][]) {
  const ps = srcPolys.filter((p) => p.direct === t);
  let ax = 0, ay = 0, aw = 0;
  for (const p of ps) {
    const a = Math.abs(ringArea(p.rings[0]));
    const bb = bboxOf([p.rings[0]]);
    ax += ((bb[0] + bb[2]) / 2) * a;
    ay += ((bb[1] + bb[3]) / 2) * a;
    aw += a;
  }
  const cx = ax / aw, cy = ay / aw;
  const th = (xf.angle * Math.PI) / 180, ux = Math.cos(th), uy = Math.sin(th);
  const map = ([x, y]: P): P => {
    const dx = x - cx, dy = y - cy;
    const u = (dx * ux + dy * uy) * xf.along, v = (-dx * uy + dy * ux) * xf.across;
    return [cx + u * ux - v * uy, cy + u * uy + v * ux];
  };
  for (const p of ps) p.rings = p.rings.map((r) => r.map(map));
}

// ---------------------------------------------------------------------------------------------
// 2. Rasterise
const g = new Grid(WIDTH_PX, HEIGHT_PX, PX);
const codeGrid = new Int16Array(WIDTH_PX * HEIGHT_PX).fill(-1);
const scaled = new Set(Object.keys(ISLAND_XFORM));
for (const pass of [0, 1]) {
  for (const p of srcPolys) {
    const isScaled = p.direct !== null && scaled.has(p.direct);
    if ((pass === 0) === isScaled) continue;
    fillPolygon(p.rings, WIDTH_PX, HEIGHT_PX, PX, (idx) => {
      if (pass === 1 && codeGrid[idx] >= 0) return; // exaggerated islands never overwrite real land
      codeGrid[idx] = p.code;
    });
  }
}
for (let idx = 0; idx < codeGrid.length; idx++) {
  const c = codeGrid[idx];
  if (c < 0) continue;
  const code = codes[c];
  let l: number;
  if ('label' in code) l = code.label;
  else {
    const i = idx % WIDTH_PX, r = (idx - i) / WIDTH_PX;
    const [lon, lat] = proj.inverse((i + 0.5) / PX, (r + 0.5) / PX);
    l = labelFor(code.pixel(lon, lat));
  }
  g.lab[idx] = l < 0 ? OCEAN : l;
}
log('rasterised');

// ---------------------------------------------------------------------------------------------
// 3. Raster clean-up
function smoothCoast(sigma: number) {
  const n = g.w * g.h;
  const land = new Float32Array(n);
  for (let p = 0; p < n; p++) land[p] = g.lab[p] !== OCEAN ? 1 : 0;
  const b = blur(land, g.w, g.h, sigma);
  const need = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const isLand = b[p] >= 0.5;
    if (!isLand && g.lab[p] !== OCEAN) g.lab[p] = OCEAN;
    else if (isLand && g.lab[p] === OCEAN) need[p] = 1;
  }
  fillFromNearest(g, need);
}

function dropSpecks(minTerrPx: number, minDecorPx: number) {
  const { comp, sizes, labels } = components(g, (l) => l !== OCEAN);
  const biggest = new Map<number, number>();
  sizes.forEach((s, id) => {
    const l = labels[id];
    if (!biggest.has(l) || sizes[biggest.get(l)!] < s) biggest.set(l, id);
  });
  for (let p = 0; p < comp.length; p++) {
    const id = comp[p];
    if (id < 0) continue;
    const l = labels[id];
    const min = l === DECOR ? minDecorPx : minTerrPx;
    if (sizes[id] < min && biggest.get(l) !== id) g.lab[p] = OCEAN;
  }
}

function fillSmallLakes(maxPx: number) {
  const { comp, sizes } = components(g, (l) => l === OCEAN);
  const touchesEdge = new Uint8Array(sizes.length);
  for (let i = 0; i < g.w; i++) {
    touchesEdge[comp[i]] = 1;
    touchesEdge[comp[(g.h - 1) * g.w + i]] = 1;
  }
  for (let r = 0; r < g.h; r++) {
    touchesEdge[comp[r * g.w]] = 1;
    touchesEdge[comp[r * g.w + g.w - 1]] = 1;
  }
  const need = new Uint8Array(g.w * g.h);
  for (let p = 0; p < comp.length; p++) {
    const id = comp[p];
    if (id >= 0 && !touchesEdge[id] && sizes[id] <= maxPx) need[p] = 1;
  }
  fillFromNearest(g, need);
}

/** Grow `label` into the sea by up to radPx, but only within maxDist px of (ci, cr). */
function fatten(label: number, radPx: number, ci: number, cr: number, maxDist: number) {
  const bb = labelBboxes(g)[label];
  if (!bb) return;
  const x0 = Math.max(0, bb.x0 - radPx - 1), y0 = Math.max(0, bb.y0 - radPx - 1);
  const x1 = Math.min(g.w - 1, bb.x1 + radPx + 1), y1 = Math.min(g.h - 1, bb.y1 + radPx + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const d = edt((i, r) => g.lab[r * g.w + i] === label, x0, y0, w, h);
  const r2 = radPx * radPx, m2 = maxDist * maxDist;
  for (let r = 0; r < h; r++)
    for (let i = 0; i < w; i++) {
      const p = (r + y0) * g.w + i + x0;
      const di = i + x0 - ci, dr = r + y0 - cr;
      if (g.lab[p] === OCEAN && d[r * w + i] <= r2 && di * di + dr * dr <= m2) g.lab[p] = label;
    }
}

const PROTECTED = new Set<number>([...PROTECTED_ISLANDS.map((t) => LABEL_OF.get(t)!), IRELAND]);
/** Carve water gaps of at least `gapPx` between land that must not touch. */
function separate(gapPx: number, symmetric: boolean): number {
  const { comp, sizes, labels } = components(g, (l) => l !== OCEAN);
  const n = sizes.length;
  // component bboxes
  const bx0 = new Int32Array(n).fill(1e9), by0 = new Int32Array(n).fill(1e9), bx1 = new Int32Array(n).fill(-1), by1 = new Int32Array(n).fill(-1);
  for (let p = 0; p < comp.length; p++) {
    const id = comp[p];
    if (id < 0) continue;
    const i = p % g.w, r = (p - i) / g.w;
    if (i < bx0[id]) bx0[id] = i;
    if (i > bx1[id]) bx1[id] = i;
    if (r < by0[id]) by0[id] = r;
    if (r > by1[id]) by1[id] = r;
  }
  const carve = new Uint8Array(comp.length);
  const G = Math.ceil(gapPx);
  let landContacts = 0;
  const contactPairs = new Map<string, number>();
  for (let c = 0; c < n; c++) {
    const lc = labels[c];
    if (lc === DECOR) continue;
    const x0 = Math.max(0, bx0[c] - G - 1), y0 = Math.max(0, by0[c] - G - 1);
    const x1 = Math.min(g.w - 1, bx1[c] + G + 1), y1 = Math.min(g.h - 1, by1[c] + G + 1);
    // Is any must-separate pixel in the window at all? (cheap pre-check)
    let any = false;
    for (let r = y0; r <= y1 && !any; r++)
      for (let i = x0; i <= x1; i++) {
        const l = g.lab[r * g.w + i];
        if (l !== OCEAN && !MAY[lc * NLABELS + l]) {
          any = true;
          break;
        }
      }
    if (!any) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const d = edt((i, r) => comp[r * g.w + i] === c, x0, y0, w, h);
    for (let r = 0; r < h; r++)
      for (let i = 0; i < w; i++) {
        const p = (r + y0) * g.w + i + x0;
        const l = g.lab[p];
        if (l === OCEAN || MAY[lc * NLABELS + l]) continue;
        const dd = d[r * w + i];
        const gp = GAPPX[lc * NLABELS + l];
        if (dd >= gp * gp) continue;
        const H2 = (gp / 2) * (gp / 2);
        if (dd <= 1) {
          landContacts++;
          const k = l === DECOR ? `${TERR_OF(lc)}|decor` : LANE_KEY(TERR_OF(lc), TERR_OF(l));
          contactPairs.set(k, (contactPairs.get(k) ?? 0) + 1);
        }
        const other = comp[p];
        // Exaggerated islands are protected: they never lose the whole gap to a mainland.
        const pc = PROTECTED.has(lc), po = PROTECTED.has(l);
        const ratio = (sizes[c] * (pc ? 1e6 : 1)) / (sizes[other] * (po ? 1e6 : 1));
        if (l === DECOR) carve[p] = 1;
        else if (symmetric && ((pc || po) || (ratio < 5 && ratio > 0.2))) {
          if (dd < H2) carve[p] = 1;
        } else if (ratio > 1 || (ratio === 1 && c < other)) carve[p] = 1;
      }
  }
  let count = 0;
  for (let p = 0; p < carve.length; p++) if (carve[p]) (g.lab[p] = OCEAN), count++;
  if (contactPairs.size) {
    const list = [...contactPairs.entries()].map(([k, v]) => `${k}(${v})`).join(', ');
    log(`  note: direct contacts carved apart: ${list}`);
  }
  void landContacts;
  return count;
}

function removeDiagonals() {
  let changed = true, rounds = 0;
  while (changed && rounds++ < 20) {
    changed = false;
    for (let r = 0; r + 1 < g.h; r++)
      for (let i = 0; i + 1 < g.w; i++) {
        const pa = r * g.w + i, pb = pa + 1, pc = pa + g.w, pd = pc + 1;
        const a = g.lab[pa], b = g.lab[pb], c = g.lab[pc], d = g.lab[pd];
        if (a === d && a !== OCEAN && b !== a && c !== a) {
          const target = b === OCEAN ? pb : c === OCEAN ? pc : pb;
          g.lab[target] = a;
          changed = true;
        } else if (b === c && b !== OCEAN && a !== b && d !== b) {
          const target = a === OCEAN ? pa : d === OCEAN ? pd : pa;
          g.lab[target] = b;
          changed = true;
        }
      }
  }
}

/** Max distance (px) from the main component of each territory to its edge. */
const POLE = new Map<number, [number, number]>();
function rasterClearance(): Map<number, number> {
  const res = new Map<number, number>();
  const { comp, sizes, labels } = components(g, (l) => l !== OCEAN && l !== DECOR);
  const main = new Map<number, number>();
  sizes.forEach((s, id) => {
    const l = labels[id];
    if (!main.has(l) || sizes[main.get(l)!] < s) main.set(l, id);
  });
  const bbs = labelBboxes(g);
  for (const [l, id] of main) {
    const bb = bbs[l]!;
    const x0 = bb.x0 - 1, y0 = bb.y0 - 1, w = bb.x1 - bb.x0 + 3, h = bb.y1 - bb.y0 + 3;
    const d = edt((i, r) => i < 0 || r < 0 || i >= g.w || r >= g.h || comp[r * g.w + i] !== id, x0, y0, w, h);
    let best = 0, bk = 0;
    for (let k = 0; k < d.length; k++) if (d[k] > best) (best = d[k]), (bk = k);
    res.set(l, Math.sqrt(best));
    POLE.set(l, [x0 + (bk % w), y0 + Math.floor(bk / w)]);
  }
  return res;
}

const gapPx = Math.max(GAP, LANE_GAP) * PX;
smoothCoast(1.1);
dropSpecks(Math.round(0.12 * PX * PX), Math.round(0.4 * PX * PX));
log('coast smoothed, specks dropped');

// Island / small-territory growth loop: a small, broad buffer (never a lollipop). The real size
// comes from the lenses and island stretches in config.ts; this only tops up the last few pixels.
const target = TARGET_CLEARANCE * PX;
{
  const cl = rasterClearance();
  log('pre-growth clearance (tight):', TERRITORY_IDS.map((t) => [t, (cl.get(LABEL_OF.get(t)!) ?? 0) / PX] as const)
    .filter(([, c]) => c < TARGET_CLEARANCE + 0.2).map(([t, c]) => `${t}=${c.toFixed(2)}`).join(' '));
}
for (let round = 0; round < MAX_GROWTH_ROUNDS; round++) {
  const cl = rasterClearance();
  const short = AUTO_FATTEN.filter((t) => (cl.get(LABEL_OF.get(t)!) ?? 0) < target);
  if (!short.length) break;
  for (const t of short) {
    const l = LABEL_OF.get(t)!;
    const [ci, cr] = POLE.get(l)!;
    fatten(l, 2, ci, cr, target * GROWTH_REACH);
  }
  separate(gapPx, true);
  separate(gapPx, false);
  dropSpecks(Math.round(0.12 * PX * PX), Math.round(0.4 * PX * PX));
  log(`  fatten round ${round}: ${short.join(', ')}`);
}
separate(gapPx, true);
separate(gapPx, false);
smoothCoast(0.9);
separate(gapPx, false);
dropSpecks(Math.round(0.15 * PX * PX), Math.round(0.4 * PX * PX));
fillSmallLakes(Math.round(1.2 * PX * PX));
removeDiagonals();
separate(gapPx, false);
removeDiagonals();
log('raster cleaned');

{
  const cl = rasterClearance();
  const rows = TERRITORY_IDS.map((t) => [t, ((cl.get(LABEL_OF.get(t)!) ?? 0) / PX).toFixed(2)] as const)
    .filter(([, c]) => Number(c) < TARGET_CLEARANCE + 0.3);
  if (rows.length) log('raster clearance (tight ones):', rows.map(([t, c]) => `${t}=${c}`).join(' '));
}

// ---------------------------------------------------------------------------------------------
// 4. Vectorise with shared arcs
const arcs = extractArcs(g);
log(`arcs: ${arcs.length}`);
const TOL = 1.35, SMOOTH = 2, TOL2 = 0.22;
for (const a of arcs) simplifyArc(a, TOL, SMOOTH, TOL2);
for (let round = 0; round < 6; round++) {
  const bad = findCrossingArcs(arcs);
  if (!bad.size) break;
  for (const ai of bad) {
    const a = arcs[ai];
    const tol = round >= 4 ? 0 : a.tol * 0.5;
    simplifyArc(a, tol, round >= 3 ? 0 : 1, round >= 3 ? 0 : TOL2 * 0.5);
  }
  log(`  crossing repair round ${round}: ${bad.size} arcs`);
}
const allLabels = [...TERRITORY_IDS.map((t) => LABEL_OF.get(t)!), DECOR, IRELAND];
const polys = assemble(arcs, allLabels, PX);
{
  const gb = LABEL_OF.get('great_britain')!;
  const merged = [...(polys.get(gb) ?? []), ...(polys.get(IRELAND) ?? [])].sort((p, q) => q.area - p.area);
  polys.set(gb, merged);
  polys.delete(IRELAND);
}
log('assembled polygons');

// ---------------------------------------------------------------------------------------------
// 5. Anchors + labels
const r3 = (p: P): Vec2 => [round3(p[0]), round3(p[1])];
const toGeom = (lp: LabelPolygon): PolygonGeom => ({ outer: lp.outer.map(r3), holes: lp.holes.map((h) => h.map(r3)) });

const territories = {} as Record<TerritoryId, TerritoryGeom>;
const landSat = new SAT(g.w, g.h, (p) => g.lab[p] !== OCEAN);
const labelAt = (x: number, y: number) => g.at(Math.floor(x * PX), Math.floor(y * PX));

for (const t of TERRITORY_IDS) {
  const lps = polys.get(LABEL_OF.get(t)!) ?? [];
  if (!lps.length) throw new Error(`territory ${t} has no geometry`);
  const geoms = lps.map(toGeom);
  const main = geoms[0];
  const pl = polylabel([main.outer, ...main.holes] as [number, number][][], 0.005);
  const anchor: Vec2 = [round3(pl[0]), round3(pl[1])];
  const area = geoms.reduce((s, gm) => s + ringArea(gm.outer) + gm.holes.reduce((q, h) => q + ringArea(h), 0), 0);
  territories[t] = {
    id: t,
    polygons: geoms,
    anchor,
    labelAnchor: anchor,
    area: round3(area),
    bbox: bboxOf(geoms.map((gm) => gm.outer)).map(round3) as [number, number, number, number],
  };
  if (pl.distance < MIN_CLEARANCE) log(`  WARN ${t}: anchor clearance ${pl.distance.toFixed(2)} < ${MIN_CLEARANCE}`);
}

// Territory name anchors: greedy, smallest territories first. A name box (assumed cap height ~0.55,
// 0.36 units/char) should sit on its own tile, clear of every badge disc (r = MIN_CLEARANCE) and of
// names already placed; hanging over water is tolerated, over a neighbour is not.
{
  const placed: [number, number, number, number][] = [];
  const order = [...TERRITORY_IDS].sort((p, q) => territories[p].area - territories[q].area);
  const anchors = TERRITORY_IDS.map((t) => territories[t].anchor);
  for (const t of order) {
    const L = LABEL_OF.get(t)!;
    const [ax, ay] = territories[t].anchor;
    const name = TERRITORIES[t].name;
    const bw = 0.36 * name.length + 0.3, bh = 0.72;
    const cands: [number, number][] = [];
    for (const dy of [-1.85, 1.85, -2.25, 2.25, -2.7, 2.7, -3.2, 3.2])
      for (const dx of [0, -0.8, 0.8, -1.6, 1.6, -2.6, 2.6]) cands.push([dx, dy]);
    for (const dx of [1, -1]) cands.push([dx * (MIN_CLEARANCE + 0.25 + bw / 2), 0]);
    let best: [number, number] = [ax, ay - 1.85], bestScore = -Infinity;
    for (const [dx, dy] of cands) {
      const cx = ax + dx, cy = ay + dy;
      let score = -0.08 * Math.hypot(dx, dy);
      for (let sx = 0; sx <= 8; sx++)
        for (let sy = 0; sy <= 2; sy++) {
          const x = cx - bw / 2 + (bw * sx) / 8, y = cy - bh / 2 + (bh * sy) / 2;
          const l = labelAt(x, y);
          const lt = l === IRELAND ? LABEL_OF.get('great_britain')! : l;
          score += lt === L ? 1 : l === OCEAN ? 0.2 : -1.6;
          for (const [px, py] of anchors) if (Math.hypot(x - px, y - py) < MIN_CLEARANCE) score -= 2.5;
          for (const [x0, y0, x1, y1] of placed) if (x > x0 && x < x1 && y > y0 && y < y1) score -= 3;
          if (x < 0.3 || x > WIDTH - 0.3 || y < 0.3 || y > HEIGHT - 0.3) score -= 3;
        }
      if (score > bestScore) (bestScore = score), (best = [cx, cy]);
    }
    placed.push([best[0] - bw / 2 - 0.1, best[1] - bh / 2 - 0.05, best[0] + bw / 2 + 0.1, best[1] + bh / 2 + 0.05]);
    territories[t].labelAnchor = [round3(best[0]), round3(best[1])];
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Sea lanes
function coastPoints(t: TerritoryId): P[][] {
  return territories[t].polygons.map((pg) => pg.outer as P[]);
}
function closestPair(a: TerritoryId, b: TerritoryId): [P, P, number] {
  let best: [P, P, number] = [[0, 0], [0, 0], Infinity];
  const A = coastPoints(a), B = coastPoints(b);
  const test = (from: P[][], to: P[][], flip: boolean) => {
    for (const ra of from)
      for (const p of ra)
        for (const rb of to) {
          for (let k = 0; k < rb.length; k++) {
            const q0 = rb[k], q1 = rb[(k + 1) % rb.length];
            // quick reject by bbox distance
            const mx = Math.max(Math.min(q0[0], q1[0]) - p[0], p[0] - Math.max(q0[0], q1[0]), 0);
            const my = Math.max(Math.min(q0[1], q1[1]) - p[1], p[1] - Math.max(q0[1], q1[1]), 0);
            if (mx * mx + my * my >= best[2] * best[2]) continue;
            const c = closestOnSeg(p[0], p[1], q0[0], q0[1], q1[0], q1[1]);
            const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
            if (d < best[2]) best = flip ? [c, p, d] : [p, c, d];
          }
        }
  };
  test(A, B, false);
  test(B, A, true);
  return best;
}
function nearestCoast(t: TerritoryId, x: number, y: number): P {
  let best: P = [x, y], bd = Infinity;
  for (const ring of coastPoints(t))
    for (let k = 0; k < ring.length; k++) {
      const q0 = ring[k], q1 = ring[(k + 1) % ring.length];
      const c = closestOnSeg(x, y, q0[0], q0[1], q1[0], q1[1]);
      const d = Math.hypot(c[0] - x, c[1] - y);
      if (d < bd) (bd = d), (best = c);
    }
  return best;
}
function foreignLand(pts: P[], a: TerritoryId, b: TerritoryId): number {
  const la = LABEL_OF.get(a)!, lb = LABEL_OF.get(b)!;
  let bad = 0;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    const L = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(L / 0.05));
    for (let s = 0; s < n; s++) {
      const x = x0 + ((x1 - x0) * (s + 0.5)) / n, y = y0 + ((y1 - y0) * (s + 0.5)) / n;
      const l = g.at(Math.floor(x * PX), Math.floor(y * PX));
      if (l !== OCEAN && l !== la && l !== lb) bad += L / n;
    }
  }
  return bad;
}
function arcPts(p: P, q: P, bulge: number): P[] {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const L = Math.hypot(dx, dy);
  const nx = -dy / L, ny = dx / L;
  const c: P = [(p[0] + q[0]) / 2 + nx * bulge, (p[1] + q[1]) / 2 + ny * bulge];
  const n = Math.max(8, Math.min(24, Math.round(L * 2.5)));
  const out: P[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * p[0] + 2 * u * t * c[0] + t * t * q[0], u * u * p[1] + 2 * u * t * c[1] + t * t * q[1]]);
  }
  return out;
}

const seaLanes: SeaLaneGeom[] = [];
for (const spec of SEA_LANES) {
  if (spec.a === 'alaska' && spec.b === 'kamchatka') {
    // Wrap: Alaska's westernmost coast → left edge; right edge → Kamchatka's (Chukotka's) easternmost coast.
    let pa: P = [Infinity, 0], pb: P = [-Infinity, 0];
    for (const ring of coastPoints('alaska')) for (const p of ring) if (p[0] < pa[0]) pa = p;
    for (const ring of coastPoints('kamchatka')) for (const p of ring) if (p[0] > pb[0]) pb = p;
    const yEdge = (pa[1] + pb[1]) / 2;
    const seg = (from: P, to: P): P[] => {
      const n = 8;
      const out: P[] = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        // ease the y so the lane leaves the coast and meets the edge smoothly
        const e = t * t * (3 - 2 * t);
        out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * e]);
      }
      return out;
    };
    seaLanes.push({
      a: 'alaska',
      b: 'kamchatka',
      segments: [seg(pa, [0, yEdge]).map(r3), seg([WIDTH, yEdge], pb).map(r3)],
      wrap: true,
    });
    continue;
  }
  let pa: P, pb: P;
  if (spec.ha || spec.hb) {
    const [p0, q0] = closestPair(spec.a, spec.b);
    pa = spec.ha ? nearestCoast(spec.a, ...proj.forward(unwrapLon(spec.ha[0]), spec.ha[1])) : p0;
    pb = spec.hb ? nearestCoast(spec.b, ...proj.forward(unwrapLon(spec.hb[0]), spec.hb[1])) : q0;
  } else {
    [pa, pb] = closestPair(spec.a, spec.b);
  }
  const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  const bulge = Math.min(1.1, Math.max(0.08, L * 0.12));
  let bestPts = arcPts(pa, pb, bulge), bestBad = foreignLand(bestPts, spec.a, spec.b);
  for (const bb of [-bulge, bulge * 0.4, -bulge * 0.4, 0]) {
    const pts = arcPts(pa, pb, bb);
    const bad = foreignLand(pts, spec.a, spec.b);
    if (bad < bestBad - 1e-6) (bestBad = bad), (bestPts = pts);
  }
  if (bestBad > 0.05) log(`  lane ${spec.a}–${spec.b} crosses ${bestBad.toFixed(2)} units of other land`);
  seaLanes.push({ a: spec.a, b: spec.b, segments: [bestPts.map(r3)], wrap: false });
}
log(`sea lanes: ${seaLanes.length}`);

// ---------------------------------------------------------------------------------------------
// 7. Continent + ocean labels (placed on clear water, avoiding lanes and each other)
const obstacle = new Uint8Array(g.w * g.h);
for (let p = 0; p < obstacle.length; p++) obstacle[p] = g.lab[p] !== OCEAN ? 1 : 0;
const stamp = (x: number, y: number, rad: number) => {
  const R = Math.ceil(rad * PX);
  const ci = Math.floor(x * PX), cr = Math.floor(y * PX);
  for (let dr = -R; dr <= R; dr++)
    for (let di = -R; di <= R; di++) {
      if (di * di + dr * dr > R * R) continue;
      const i = ci + di, r = cr + dr;
      if (i >= 0 && r >= 0 && i < g.w && r < g.h) obstacle[r * g.w + i] = 1;
    }
};
for (const lane of seaLanes) for (const seg of lane.segments) for (let k = 1; k < seg.length; k++) {
  const [x0, y0] = seg[k - 1], [x1, y1] = seg[k];
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.1);
  for (let s = 0; s <= n; s++) stamp(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, 0.25);
}
function placeBox(hint: [number, number], w: number, h: number, margin: number): { at: Vec2; room: number } {
  const [hx, hy] = proj.forward(unwrapLon(hint[0]), hint[1]);
  const sat = new SAT(g.w, g.h, (p) => obstacle[p] === 1);
  const clear = (cx: number, cy: number, ww: number) => {
    const i0 = Math.floor((cx - ww / 2 - margin) * PX), i1 = Math.ceil((cx + ww / 2 + margin) * PX);
    const r0 = Math.floor((cy - h / 2 - margin) * PX), r1 = Math.ceil((cy + h / 2 + margin) * PX);
    return sat.count(i0, r0, i1, r1, 1) === 0;
  };
  let best: [number, number] | null = null, bd = Infinity;
  for (let ww = w; ww >= w * 0.55 && !best; ww *= 0.9) {
    for (let dx = -16; dx <= 16; dx += 0.25)
      for (let dy = -10; dy <= 10; dy += 0.25) {
        const d = Math.hypot(dx, dy * 1.3);
        if (d >= bd) continue;
        const cx = hx + dx, cy = hy + dy;
        if (clear(cx, cy, ww)) (bd = d), (best = [cx, cy]);
      }
  }
  if (!best) best = [hx, hy];
  let room = 0;
  for (let ww = 0.5; ww <= 30; ww += 0.25) {
    if (!clear(best[0], best[1], ww)) break;
    room = ww;
  }
  return { at: r3(best), room: round3(room) };
}
const markBox = (at: Vec2, w: number, h: number) => {
  for (let x = at[0] - w / 2; x <= at[0] + w / 2; x += 0.2)
    for (let y = at[1] - h / 2; y <= at[1] + h / 2; y += 0.2) stamp(x, y, 0.35);
};

// Territory names that hang over the water also block labels.
for (const t of TERRITORY_IDS) {
  const [lx, ly] = territories[t].labelAnchor;
  const bw = 0.36 * TERRITORIES[t].name.length + 0.3;
  for (let x = lx - bw / 2; x <= lx + bw / 2; x += 0.2) stamp(x, ly, 0.4);
}
const continents = {} as BoardGeometry['continents'];
for (const c of CONTINENT_IDS) {
  const text = `${CONTINENTS[c].name.toUpperCase()} · +${CONTINENTS[c].bonus}`;
  const w = text.length * 0.62, h = 1.3;
  const { at, room } = placeBox(CONTINENT_LABEL_HINTS[c], w, h, 0.35);
  continents[c] = { id: c, labelAnchor: at, labelRoom: room };
  markBox(at, Math.min(room, w), h);
}
const oceanLabels: BoardGeometry['oceanLabels'] = [];
for (const o of OCEAN_LABELS) {
  const w = o.text.length * o.size * 0.62, h = o.size * 1.2;
  const { at } = placeBox(o.hint, w, h, 0.3);
  oceanLabels.push({ text: o.text, at, size: o.size });
  markBox(at, w, h);
}

// ---------------------------------------------------------------------------------------------
// 8. Write
const decorativeLand = (polys.get(DECOR) ?? []).map(toGeom);
const board: BoardGeometry = {
  version: 1,
  width: WIDTH,
  height: HEIGHT,
  projection:
    `Miller cylindrical, Pacific seam: lon ${LON_LEFT}°…${LON_LEFT + 360}° squeezed into x∈[2.4, ${WIDTH - 2.4}] ` +
    `(so the Bering Strait sits just inside both edges), lat ≈56°S…84°N. Smooth monotone lenses enlarge ` +
    LENSES.map((l) => `${l.name} ×${l.m}`).join(', ') +
    `; islands stretched (${Object.entries(ISLAND_XFORM).map(([t, x]) => `${t} ×${x!.along}/${x!.across}`).join(', ')}) and locally grown ` +
    `to fit an army badge. Rasterised at ${PX} px/unit, borders are shared arcs (DP + Chaikin). ` +
    `Origin bottom-left, +y north.`,
  territories,
  seaLanes,
  continents,
  decorativeLand,
  oceanLabels,
};
const out = resolve(ROOT, 'src/map/board.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(board));
const verts = Object.values(territories).reduce(
  (s, t) => s + t.polygons.reduce((q, pg) => q + pg.outer.length + pg.holes.reduce((u, h) => u + h.length, 0), 0), 0);
log(`wrote ${out} (${(JSON.stringify(board).length / 1024).toFixed(0)} KB, ${verts} territory vertices)`);

// Keep a raster dump for debugging / previews.
mkdirSync(resolve(ROOT, 'artifacts/map'), { recursive: true });
void ((): ContinentId[] => CONTINENT_IDS)();
