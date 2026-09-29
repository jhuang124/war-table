// The ink layer (docs/INK.md B §3): built once at boot, sampled by the ground and by every tile top so the
// brush strokes sit on the washes.
//
// - `ink`   RGBA, 4096×~2028 (2048 on phones), board rect: R = coastlines as dry brush (multi-pass bristle
//           ribbons with noise-modulated width and dry gaps), G = interior borders (thinner; drawn at 40 %
//           by the shaders), B = sea lanes as ink dabs and the decorative (non-playable) coasts.
// - `field` RGBA, half the ink resolution: R = proximity to the territory's own border (1 at the border → 0
//           ~1.2 units inside; drives edge darkening and the selection rims), G = distance from land over
//           the sea (0 at the coast → 1 at 4 units; drives the coast feather and the mist), B = territory
//           index (1..42; over the sea: the nearest coast's, within ~1.5 units; read with texelFetch),
//           A = land coverage.
// - `noise` a small tileable fbm texture (4 channels) the shaders use for mist, mottling and breathing,
//           instead of evaluating fbm per pixel.
// - `waves` an atlas of calligraphic wave strokes (the board places 6–8 of them per game, seeded).
import * as THREE from 'three';
import type { BoardGeometry, Vec2 } from '../map/types';
import { TERRITORY_IDS, TERRITORIES, CONTINENT_IDS } from '../engine/mapData';
import type { ContinentId, TerritoryId } from '../engine/types';

export interface InkLayer {
  ink: THREE.DataTexture;
  field: THREE.DataTexture;
  noise: THREE.DataTexture;
  waves: THREE.CanvasTexture;
  /** Number of wave variants stacked vertically in `waves`. */
  waveRows: number;
  inkW: number;
  inkH: number;
  fieldW: number;
  fieldH: number;
  /** 1-based territory index as stored in field.B (TERRITORY_IDS order). */
  index: (t: TerritoryId) => number;
  /** Continent index (CONTINENT_IDS order) of a 1-based territory index. */
  continentIndex: (i: number) => number;
  /** Distance from land over the sea, board units (≥ 4 = open sea), at a board point. */
  seaDistance: (bx: number, by: number) => number;
  /** Board-space centre of each continent (the re-ink sweep turns about it). */
  continentCentre: Record<ContinentId, Vec2>;
  buildMs: number;
}

// ---------------------------------------------------------------------------
// small deterministic noise
// ---------------------------------------------------------------------------

function hash1(n: number, seed: number): number {
  let h = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
/** Smooth 1-D value noise in [0, 1]. */
function n1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u;
}
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise2(x: number, y: number, seed: number, wx: number, wy: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (v: number, m: number) => ((v % m) + m) % m;
  const a = hash2(w(xi, wx), w(yi, wy), seed);
  const b = hash2(w(xi + 1, wx), w(yi, wy), seed);
  const c = hash2(w(xi, wx), w(yi + 1, wy), seed);
  const d = hash2(w(xi + 1, wx), w(yi + 1, wy), seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Tileable fbm: `cx`×`cy` cells across the tile at the first octave. */
function fbmTile(u: number, v: number, cx: number, cy: number, seed: number, oct: number): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = cx;
  let fy = cy;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise2(u * fx, v * fy, seed + o * 31, fx, fy);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return s / norm;
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// dry brush
// ---------------------------------------------------------------------------

export interface BrushOpts {
  /** Full stroke width, px. */
  width: number;
  /** Bristle passes (the first ~third are the loaded core, the rest thinner dry bristles). */
  passes: number;
  /** Alpha of each pass (the core; bristles get less). */
  alpha: number;
  /** Lateral wander of each pass, ± px. */
  jitter: number;
  /** 0..1: how often the dry bristles lift off (0 = never). */
  dry: number;
  seed: number;
  /** Resample spacing, px. */
  spacing: number;
  /** Taper the two ends of an open stroke (px); 0 = butt ends (coast runs meeting borders). */
  endTaper: number;
  /** Width falloff along an open stroke: 0 = even, 1 = thick → thin (wave strokes, the arrow). */
  thin?: number;
}

/**
 * Stroke a polyline (canvas px, flat [x0,y0,x1,y1,…]) as a dry brush: several bristle ribbons, each
 * wandering a little across the stroke, with noise-modulated width and, for the outer bristles, dry gaps
 * where the brush lifted (their ends taper, so the gaps feather).
 */
export function dryBrush(ctx: CanvasRenderingContext2D, flat: number[], closed: boolean, o: BrushOpts): void {
  const n0 = flat.length / 2;
  if (n0 < 2) return;
  // Resample at an even spacing.
  const X: number[] = [];
  const Y: number[] = [];
  const S: number[] = [];
  const segs = closed ? n0 : n0 - 1;
  let acc = 0;
  let carry = 0;
  for (let i = 0; i < segs; i++) {
    const ax = flat[i * 2];
    const ay = flat[i * 2 + 1];
    const j = (i + 1) % n0;
    const bx = flat[j * 2];
    const by = flat[j * 2 + 1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    let d = carry;
    while (d < L) {
      const t = d / L;
      X.push(ax + (bx - ax) * t);
      Y.push(ay + (by - ay) * t);
      S.push(acc + d);
      d += o.spacing;
    }
    carry = d - L;
    acc += L;
  }
  if (!closed) {
    X.push(flat[(n0 - 1) * 2]);
    Y.push(flat[(n0 - 1) * 2 + 1]);
    S.push(acc);
  }
  const n = X.length;
  if (n < 2) return;
  const total = acc;
  // Normals (central differences over ±2 samples: smooths the polygon's corners a little).
  const NX = new Float32Array(n);
  const NY = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 2 + n) % n : Math.max(0, i - 2);
    const b = closed ? (i + 2) % n : Math.min(n - 1, i + 2);
    const dx = X[b] - X[a];
    const dy = Y[b] - Y[a];
    const l = Math.hypot(dx, dy) || 1;
    NX[i] = -dy / l;
    NY[i] = dx / l;
  }
  const core = Math.max(1, Math.round(o.passes / 4));
  for (let k = 0; k < o.passes; k++) {
    const isCore = k < core;
    const sd = o.seed * 101 + k * 17;
    // The loaded core runs down the middle; the bristles are thin ribbons spread across (and a little past)
    // the stroke's width, each drier than the core, so the edges break up and feather.
    const wFrac = isCore ? 0.48 + 0.1 * hash1(k, sd) : 0.09 + 0.2 * hash1(k, sd);
    const alpha = isCore ? o.alpha : o.alpha * (0.45 + 0.55 * hash1(k + 9, sd));
    const side = isCore ? (hash1(k + 5, sd) * 2 - 1) * o.width * 0.08 : (hash1(k + 5, sd) * 2 - 1) * o.width * 0.62;
    const dry = isCore ? o.dry * 0.3 : Math.min(0.95, o.dry * (0.7 + 0.6 * hash1(k + 13, sd)));
    const on = new Uint8Array(n);
    for (let i = 0; i < n; i++) on[i] = dry <= 0 || n1(S[i] * 0.07 + sd * 0.37, sd) * 0.75 + n1(S[i] * 0.23 + 3.3, sd + 5) * 0.25 > dry * 0.66 ? 1 : 0;
    // Runs of "on" samples. A closed ring starts at a gap (so no run straddles the seam); if it has none,
    // it is one closed ribbon.
    let start = 0;
    let full = false;
    if (closed) {
      let g = -1;
      for (let i = 0; i < n; i++)
        if (!on[i]) {
          g = i;
          break;
        }
      if (g < 0) full = true;
      else start = g;
    }
    const path = new Path2D();
    const W = new Float32Array(n);
    const OF = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let w = o.width * wFrac * (0.5 + 1.0 * n1(S[i] * 0.035 + 11.3, sd + 1)) * (0.85 + 0.3 * n1(S[i] * 0.2, sd + 7));
      if (o.thin) {
        const u = total > 0 ? S[i] / total : 0;
        w *= 1 - o.thin * 0.78 * u * u;
      }
      W[i] = w;
      OF[i] = side + o.jitter * (n1(S[i] * 0.02 + 4.1, sd + 2) * 2 - 1);
    }
    const ribbon = (idx: number[], taperA: boolean, taperB: boolean, close: boolean) => {
      if (idx.length < 2) return;
      const m = idx.length;
      const s0 = S[idx[0]];
      let s1 = S[idx[m - 1]];
      if (s1 < s0) s1 += total;
      const tl = Math.max(o.spacing * 2, Math.min(o.width * 3, (s1 - s0) / 2));
      const wAt = (q: number) => {
        const i = idx[q];
        let s = S[i];
        if (s < s0) s += total;
        let f = 1;
        if (taperA) f = Math.min(f, (s - s0) / tl);
        if (taperB) f = Math.min(f, (s1 - s) / tl);
        f = Math.max(0, Math.min(1, f));
        f = f * f * (3 - 2 * f);
        return W[i] * f;
      };
      for (let q = 0; q < m; q++) {
        const i = idx[q];
        const hw = wAt(q) / 2;
        const x = X[i] + NX[i] * (OF[i] + hw);
        const y = Y[i] + NY[i] * (OF[i] + hw);
        if (q === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      if (close) {
        path.closePath();
        for (let q = m - 1; q >= 0; q--) {
          const i = idx[q];
          const hw = wAt(q) / 2;
          const x = X[i] + NX[i] * (OF[i] - hw);
          const y = Y[i] + NY[i] * (OF[i] - hw);
          if (q === m - 1) path.moveTo(x, y);
          else path.lineTo(x, y);
        }
        path.closePath();
        return;
      }
      for (let q = m - 1; q >= 0; q--) {
        const i = idx[q];
        const hw = wAt(q) / 2;
        path.lineTo(X[i] + NX[i] * (OF[i] - hw), Y[i] + NY[i] * (OF[i] - hw));
      }
      path.closePath();
    };
    if (full) {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) idx.push(i);
      ribbon(idx, false, false, true);
    } else {
      let run: number[] = [];
      let runStartsAtEnd = true;
      for (let q = 0; q < n; q++) {
        const i = (start + q) % n;
        if (on[i]) {
          if (!run.length) runStartsAtEnd = !closed && i === 0;
          run.push(i);
        } else if (run.length) {
          ribbon(run, runStartsAtEnd ? o.endTaper > 0 : true, true, false);
          run = [];
        }
      }
      if (run.length) {
        const endsAtEnd = !closed && run[run.length - 1] === n - 1;
        ribbon(run, runStartsAtEnd ? o.endTaper > 0 : true, endsAtEnd ? o.endTaper > 0 : true, false);
      }
    }
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.fill(path, 'nonzero');
  }
}

// ---------------------------------------------------------------------------
// rasterising the territories (id map) and the distance field
// ---------------------------------------------------------------------------

/** Scanline-fill rings (board coords) into `out` with `value` (even–odd per call). */
function fillRings(out: Uint8Array, FW: number, FH: number, rings: Vec2[][], s: number, BH: number, value: number): void {
  const rows = new Map<number, number[]>();
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % m];
      const ax = a[0] * s;
      const ay = (BH - a[1]) * s;
      const bx = b[0] * s;
      const by = (BH - b[1]) * s;
      if (ay === by) continue;
      const y0 = Math.min(ay, by);
      const y1 = Math.max(ay, by);
      const r0 = Math.max(0, Math.ceil(y0 - 0.5));
      const r1 = Math.min(FH - 1, Math.ceil(y1 - 0.5) - 1);
      for (let r = r0; r <= r1; r++) {
        const yc = r + 0.5;
        const x = ax + ((yc - ay) / (by - ay)) * (bx - ax);
        let list = rows.get(r);
        if (!list) rows.set(r, (list = []));
        list.push(x);
      }
    }
  }
  for (const [r, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(FW - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      const base = r * FW;
      for (let c = c0; c <= c1; c++) out[base + c] = value;
    }
  }
}

/** 1-D squared distance transform (Felzenszwalb) with the arg-min site. */
function edt1d(f: Float64Array, n: number, d: Float64Array, arg: Int32Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -1e30;
  z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    arg[q] = v[k];
  }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export interface InkOptions {
  /** Phones: the half-size canvas (2048). */
  small: boolean;
  maxTextureSize: number;
}

export async function buildInk(g: BoardGeometry, opt: InkOptions): Promise<InkLayer> {
  const t0 = performance.now();
  const BW = g.width;
  const BH = g.height;
  const inkW = Math.min(opt.small ? 2048 : 4096, opt.maxTextureSize || 4096);
  const inkH = Math.round((inkW * BH) / BW);
  const fieldW = inkW / 2;
  const fieldH = Math.round((fieldW * BH) / BW);
  const sF = fieldW / BW;
  const index = (t: TerritoryId) => TERRITORY_IDS.indexOf(t) + 1;
  const contOf = new Uint8Array(64).fill(255);
  TERRITORY_IDS.forEach((t, i) => (contOf[i + 1] = CONTINENT_IDS.indexOf(TERRITORIES[t].continent)));

  // --- id map (field resolution) ------------------------------------------------------------
  const DECOR = 250;
  const ids = new Uint8Array(fieldW * fieldH);
  for (const p of g.decorativeLand) fillRings(ids, fieldW, fieldH, [p.outer, ...p.holes], sF, BH, DECOR);
  TERRITORY_IDS.forEach((t, i) => {
    const rings: Vec2[][] = [];
    for (const p of g.territories[t].polygons) rings.push(p.outer, ...p.holes);
    fillRings(ids, fieldW, fieldH, rings, sF, BH, i + 1);
  });
  await yieldFrame();

  // --- distance to the nearest border pixel (land pixels that touch a different id) -------------------
  const N = fieldW * fieldH;
  const feature = new Uint8Array(N);
  for (let y = 0; y < fieldH; y++)
    for (let x = 0; x < fieldW; x++) {
      const i = y * fieldW + x;
      const v = ids[i];
      if (!v) continue;
      if (
        (x > 0 && ids[i - 1] !== v) ||
        (x < fieldW - 1 && ids[i + 1] !== v) ||
        (y > 0 && ids[i - fieldW] !== v) ||
        (y < fieldH - 1 && ids[i + fieldW] !== v)
      )
        feature[i] = 1;
    }
  const d1 = new Float64Array(N);
  const ny = new Int32Array(N);
  {
    const n = fieldH;
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const arg = new Int32Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let x = 0; x < fieldW; x++) {
      for (let y = 0; y < n; y++) f[y] = feature[y * fieldW + x] ? 0 : 1e20;
      edt1d(f, n, d, arg, v, z);
      for (let y = 0; y < n; y++) {
        d1[y * fieldW + x] = d[y];
        ny[y * fieldW + x] = arg[y];
      }
    }
  }
  await yieldFrame();
  const dist = new Float32Array(N);
  const near = new Int32Array(N);
  {
    const n = fieldW;
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const arg = new Int32Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let y = 0; y < fieldH; y++) {
      const base = y * fieldW;
      for (let x = 0; x < n; x++) f[x] = d1[base + x];
      edt1d(f, n, d, arg, v, z);
      for (let x = 0; x < n; x++) {
        dist[base + x] = Math.sqrt(d[x]);
        const ax = arg[x];
        near[base + x] = ny[base + ax] * fieldW + ax;
      }
    }
  }
  await yieldFrame();

  // --- field texture --------------------------------------------------------------------------------
  const field = new Uint8Array(N * 4);
  const inR = 1.2 * sF; // edge proximity ramp, px
  const seaR = 4 * sF; // sea distance ramp, px
  const nearR = 1.5 * sF;
  const seaDist = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const v = ids[i];
    const o = i * 4;
    const d = dist[i];
    if (v) {
      field[o] = Math.round(255 * Math.max(0, Math.min(1, 1 - d / inR)));
      field[o + 1] = 0;
      field[o + 2] = v === DECOR ? 0 : v;
      field[o + 3] = 255;
    } else {
      const sd = Math.max(0, d - 0.5);
      const g8 = Math.round(255 * Math.min(1, sd / seaR));
      // Past the coast the proximity ramp stays at 1 for a texel or two, so it doesn't sag at the tile's edge.
      field[o] = d <= 2 ? 255 : 0;
      field[o + 1] = g8;
      seaDist[i] = g8;
      const nv = ids[near[i]];
      field[o + 2] = sd < nearR && nv !== DECOR ? nv : 0;
      field[o + 3] = 0;
    }
  }
  const fieldTex = new THREE.DataTexture(field, fieldW, fieldH, THREE.RGBAFormat, THREE.UnsignedByteType);
  fieldTex.magFilter = THREE.LinearFilter;
  fieldTex.minFilter = THREE.LinearFilter;
  fieldTex.generateMipmaps = false;
  fieldTex.flipY = false;
  fieldTex.needsUpdate = true;
  await yieldFrame();

  // --- ink canvas -------------------------------------------------------------------------------------
  const s = inkW / BW;
  const canvas = document.createElement('canvas');
  canvas.width = inkW;
  canvas.height = inkH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const px = (p: Vec2): [number, number] => [p[0] * s, (BH - p[1]) * s];
  const inkData = new Uint8Array(inkW * inkH * 4);
  const grab = (ch: number) => {
    const img = ctx.getImageData(0, 0, inkW, inkH).data;
    // canvas row 0 = north; the texture's v = 1 − by/H, so row 0 stays row 0 (flipY off).
    for (let i = 0, j = ch; i < img.length; i += 4, j += 4) inkData[j] = img[i];
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, inkW, inkH);
  };
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, inkW, inkH);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Classify each ring edge: interior (shared with another territory) or coast.
  const key = (p: Vec2) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const owners = new Map<string, number[]>();
  TERRITORY_IDS.forEach((t, i) => {
    for (const p of g.territories[t].polygons)
      for (const ring of [p.outer, ...p.holes])
        for (const v of ring) {
          const k = key(v);
          const l = owners.get(k);
          if (!l) owners.set(k, [i]);
          else if (!l.includes(i)) l.push(i);
        }
  });
  type Run = { pts: Vec2[]; closed: boolean };
  const coastRuns: Run[] = [];
  const borderRuns: Run[] = [];
  TERRITORY_IDS.forEach((t, ti) => {
    for (const p of g.territories[t].polygons)
      for (const ring of [p.outer, ...p.holes]) {
        const m = ring.length;
        // edge i: ring[i] → ring[i+1]; its neighbour (−1 = coast)
        const nb = new Int32Array(m);
        for (let i = 0; i < m; i++) {
          const a = owners.get(key(ring[i]))!;
          const b = owners.get(key(ring[(i + 1) % m]))!;
          let n = -1;
          for (const x of a) if (x !== ti && b.includes(x)) n = x;
          nb[i] = n;
        }
        let allSame = true;
        for (let i = 1; i < m; i++) if (nb[i] !== nb[0]) allSame = false;
        if (allSame) {
          if (nb[0] < 0) coastRuns.push({ pts: ring.slice(), closed: true });
          else if (ti < nb[0]) borderRuns.push({ pts: ring.slice(), closed: true });
          continue;
        }
        // start at an edge-class change
        let st = 0;
        for (let i = 0; i < m; i++)
          if (nb[i] !== nb[(i - 1 + m) % m]) {
            st = i;
            break;
          }
        let cur: Vec2[] = [ring[st]];
        let cls = nb[st];
        for (let q = 0; q < m; q++) {
          const i = (st + q) % m;
          if (nb[i] !== cls) {
            if (cls < 0) coastRuns.push({ pts: cur, closed: false });
            else if (ti < cls) borderRuns.push({ pts: cur, closed: false });
            cur = [ring[i]];
            cls = nb[i];
          }
          cur.push(ring[(i + 1) % m]);
        }
        if (cls < 0) coastRuns.push({ pts: cur, closed: false });
        else if (ti < cls) borderRuns.push({ pts: cur, closed: false });
      }
  });
  const flatOf = (pts: Vec2[]) => {
    const f: number[] = [];
    for (const p of pts) {
      const [x, y] = px(p);
      f.push(x, y);
    }
    return f;
  };
  // Island specks: a stroke wider than the island scribbles; their brush is finer.
  const ringLen = (pts: Vec2[]) => {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
  };
  const u = s; // px per board unit
  const spacing = opt.small ? 1.1 : 1.6;

  // R: coasts. A soft underlayer (the wet feather), then the dry brush.
  let seed = 1;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.34 * u;
  for (const r of coastRuns) {
    ctx.beginPath();
    const f = flatOf(r.pts);
    ctx.moveTo(f[0], f[1]);
    for (let i = 2; i < f.length; i += 2) ctx.lineTo(f[i], f[i + 1]);
    if (r.closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  for (const r of coastRuns) {
    const len = ringLen(r.pts);
    const small = r.closed && len < 3;
    dryBrush(ctx, flatOf(r.pts), r.closed, {
      width: (small ? 0.13 : 0.2) * u,
      passes: small ? 5 : 10,
      alpha: 0.6,
      jitter: 0.03 * u,
      dry: small ? 0.2 : 0.55,
      seed: seed++,
      spacing,
      endTaper: 0,
    });
  }
  grab(0);
  await yieldFrame();

  // G: interior borders (thinner; the shaders draw them at 40 %).
  for (const r of borderRuns) {
    dryBrush(ctx, flatOf(r.pts), r.closed, {
      width: 0.13 * u,
      passes: 6,
      alpha: 0.65,
      jitter: 0.02 * u,
      dry: 0.4,
      seed: seed++,
      spacing,
      endTaper: 0,
    });
  }
  grab(1);
  await yieldFrame();

  // B: sea lanes as ink dabs, and the decorative (non-playable) coasts, finer.
  for (const p of g.decorativeLand) {
    dryBrush(ctx, flatOf(p.outer), true, { width: 0.1 * u, passes: 4, alpha: 0.55, jitter: 0.02 * u, dry: 0.35, seed: seed++, spacing, endTaper: 0 });
  }
  let dabSeed = 7;
  for (const lane of g.seaLanes) {
    for (const seg of lane.segments) {
      // walk the polyline, a dab every ~0.62 units, each a short tapered brush mark along the lane
      const pts = seg.map(px);
      let total = 0;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        cum.push(total);
      }
      const step = 0.62 * u;
      const count = Math.max(2, Math.round(total / step));
      const at = (d: number): [number, number, number] => {
        let k = 1;
        while (k < cum.length - 1 && cum[k] < d) k++;
        const a = pts[k - 1];
        const b = pts[k];
        const t = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
      };
      for (let i = 0; i < count; i++) {
        const d = ((i + 0.5) / count) * total;
        const [x, y, ang] = at(d);
        const L = (0.2 + 0.08 * hash1(i, dabSeed)) * u;
        const Wd = (0.06 + 0.025 * hash1(i + 3, dabSeed)) * u;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        const f: number[] = [];
        const bend = (hash1(i + 7, dabSeed) - 0.5) * 0.35 * Wd;
        for (let q = 0; q <= 6; q++) {
          const t = q / 6 - 0.5;
          const off = bend * (1 - 4 * t * t);
          f.push(x + dx * L * t - dy * off, y + dy * L * t + dx * off);
        }
        dryBrush(ctx, f, false, { width: Wd, passes: 3, alpha: 0.75, jitter: 0.004 * u, dry: 0, seed: dabSeed * 31 + i, spacing: Math.max(0.8, spacing * 0.7), endTaper: 1, thin: 0.6 });
      }
      dabSeed++;
    }
  }
  grab(2);
  for (let j = 3; j < inkData.length; j += 4) inkData[j] = 255;
  canvas.width = canvas.height = 1;
  await yieldFrame();

  const inkTex = new THREE.DataTexture(inkData, inkW, inkH, THREE.RGBAFormat, THREE.UnsignedByteType);
  inkTex.flipY = false;
  inkTex.generateMipmaps = true;
  inkTex.minFilter = THREE.LinearMipmapLinearFilter;
  inkTex.magFilter = THREE.LinearFilter;
  inkTex.anisotropy = 8;
  inkTex.needsUpdate = true;

  // --- noise (tileable, 4 channels) -----------------------------------------------------------------
  const NS = 256;
  const nd = new Uint8Array(NS * NS * 4);
  for (let y = 0; y < NS; y++)
    for (let x = 0; x < NS; x++) {
      const uu = x / NS;
      const vv = y / NS;
      const o = (y * NS + x) * 4;
      nd[o] = Math.round(255 * fbmTile(uu, vv, 4, 4, 3, 5)); // broad clouds (mist, mottling)
      nd[o + 1] = Math.round(255 * fbmTile(uu, vv, 8, 8, 11, 4)); // medium (blotches, breath)
      nd[o + 2] = Math.round(255 * fbmTile(uu, vv, 6, 36, 23, 3)); // fibres, 6:1
      nd[o + 3] = Math.round(255 * fbmTile(uu, vv, 32, 32, 41, 2)); // fine grain
    }
  const noise = new THREE.DataTexture(nd, NS, NS, THREE.RGBAFormat, THREE.UnsignedByteType);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.generateMipmaps = true;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.magFilter = THREE.LinearFilter;
  noise.needsUpdate = true;
  await yieldFrame();

  // --- wave strokes atlas ---------------------------------------------------------------------------
  const waveRows = 4;
  const AW = opt.small ? 512 : 1024;
  const AH = (AW / 4) * waveRows;
  const wc = document.createElement('canvas');
  wc.width = AW;
  wc.height = AH;
  const wctx = wc.getContext('2d')!;
  const rowH = AH / waveRows;
  for (let r = 0; r < waveRows; r++) {
    // a swell: two to four parallel strokes, rising left to right and curling at the crest
    const lines = 2 + (r % 3);
    const amp = rowH * (0.12 + 0.05 * hash1(r, 13));
    const rise = rowH * (0.12 + 0.08 * hash1(r, 19));
    for (let l = 0; l < lines; l++) {
      const f: number[] = [];
      const x0 = AW * (0.05 + 0.07 * l + 0.04 * hash1(r * 7 + l, 5));
      const x1 = AW * (0.95 - 0.09 * l - 0.05 * hash1(r * 5 + l, 9));
      const yc = rowH * (r + 0.58) + (l - (lines - 1) / 2) * rowH * 0.13;
      const ph = 0.1 + hash1(r * 3 + l, 17) * 0.15;
      for (let q = 0; q <= 64; q++) {
        const t = q / 64;
        const x = x0 + (x1 - x0) * t;
        const y = yc - amp * Math.sin(Math.PI * 2 * (t * 0.85 + ph)) * (0.5 + 0.5 * t) - rise * t * t;
        f.push(x, y);
      }
      dryBrush(wctx, f, false, {
        width: rowH * (0.068 - 0.008 * l),
        passes: 7,
        alpha: 0.72,
        jitter: rowH * 0.006,
        dry: 0.55,
        seed: 900 + r * 10 + l,
        spacing: 1,
        endTaper: 1,
        thin: 0.55,
      });
    }
  }
  const waves = new THREE.CanvasTexture(wc);
  waves.flipY = false;
  waves.generateMipmaps = true;
  waves.minFilter = THREE.LinearMipmapLinearFilter;
  waves.needsUpdate = true;

  // --- queries ----------------------------------------------------------------------------------------
  const seaDistance = (bx: number, by: number): number => {
    const x = Math.floor(bx * sF);
    const y = Math.floor((BH - by) * sF);
    if (x < 0 || y < 0 || x >= fieldW || y >= fieldH) return 4;
    if (ids[y * fieldW + x]) return 0;
    return (seaDist[y * fieldW + x] / 255) * 4;
  };
  const continentCentre = {} as Record<ContinentId, Vec2>;
  for (const c of CONTINENT_IDS) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const t of TERRITORY_IDS) {
      if (TERRITORIES[t].continent !== c) continue;
      const b = g.territories[t].bbox;
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[2]);
      y1 = Math.max(y1, b[3]);
    }
    continentCentre[c] = [(x0 + x1) / 2, (y0 + y1) / 2];
  }

  return {
    ink: inkTex,
    field: fieldTex,
    noise,
    waves,
    waveRows,
    inkW,
    inkH,
    fieldW,
    fieldH,
    index,
    continentIndex: (i: number) => contOf[i] ?? 255,
    seaDistance,
    continentCentre,
    buildMs: Math.round(performance.now() - t0),
  };
}
