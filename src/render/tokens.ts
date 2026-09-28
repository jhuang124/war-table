// Army pieces (docs/ROUND2.md §D): one sculpted piece per territory, standing on a low turned base in the
// owner's colour. The denomination follows physical Risk — infantry 1–4, cavalry 5–9, artillery 10+ — and
// the exact count sits on a DOM plaque at the base's front (overlay.ts reads `plaque` / `figTop`), so it
// stays crisp at any DPR.
//
// The sculpts are bevelled, extruded silhouettes (a soldier with a rifle, a horse and rider, a cannon on
// wheels), like painted wooden game pieces. At the steep home pitch a standing figure would be seen almost
// from above, so each figure leans back toward the camera until it is seen from ~30° elevation: it reads
// as a silhouette, while its base stays flat on the tile. Everything is instanced (one mesh per sculpt
// type + one for the bases), with a per-instance screen-door fade for the reduced-motion dissolves.
//
// Motion: place = a settle hop; crossing a denomination = a quick pop swap; loss = a recoil on the base's
// edge; empty = the piece topples (toward a given tile) and fades; a traveler piece carrying the moved
// count arcs along the route. Nothing moves at idle.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS } from '../engine/mapData';
import { Animator, ease, type Run } from './anim';
import { TILE_TOP, adjust, type RGB } from './util';
import type { TileSet } from './tiles';

/** 0 = infantry (1–4), 1 = cavalry (5–9), 2 = artillery (10+). */
export type Denom = 0 | 1 | 2;
export const denomOf = (n: number): Denom => (n >= 10 ? 2 : n >= 5 ? 1 : 0);
export const DENOM_NAMES = ['infantry', 'cavalry', 'artillery'] as const;

/** Base radius (board units, at UI scale 1). The tightest tile (Japan) has 1.32 units clear around its anchor. */
export const TOKEN_R = 1.06;
/** Base height (board units). */
export const TOKEN_H = 0.26;
/** Sculpt scale: figure units → board units, per denomination (infantry, cavalry, artillery). */
const FIG_SCALE = [1.42, 1.36, 1.48];
/** The figure stands a little behind the base's centre, so its feet clear the count plaque in front. */
const FIG_BACK = 0.2;
/** Figures lean back until the camera sees them from this elevation (deg). */
const VIEW_ELEV = 30;
const MAX_LEAN = 55;
const MAX_TRAVELERS = 8;
const CAP = TERRITORY_IDS.length * 2 + MAX_TRAVELERS;

export interface TokenTraveler {
  /** Count carried (drawn as the traveler's number). */
  n: number;
  /** Number color (the mover's palette ink). */
  ink: string;
  /** World position of the traveler's base top centre (updated every frame while it flies). */
  top: THREE.Vector3;
  /** World point the traveler's count plaque centres on. */
  plaque: THREE.Vector3;
  /** World point at the top of the traveler's figure. */
  figTop: THREE.Vector3;
  /** Half the piece's width, world units. */
  halfW: number;
  /** The mover's palette id (the plaque paints in its deep colour). */
  owner: string;
  alive: boolean;
}

interface Tok {
  id: TerritoryId;
  base: RGB; // base fill before dim
  fig: RGB; // figure paint before dim
  n: number;
  denom: Denom;
  /** 0..1 presence (appear / leave); 0 = not drawn. */
  scale: number;
  /** Transient size multiplier (pops). */
  pop: number;
  /** Figure-only size multiplier (the denomination swap). */
  figPop: number;
  /** While swapping: the sculpt being replaced (drawn until figSwap reaches 0.45), else -1. */
  swapFrom: Denom | -1;
  figSwap: number;
  /** Reduced-motion crossfade between sculpts: old fades out as the new fades in. */
  xfade: number;
  /** Transient height offset (hops, drops). */
  hop: number;
  /** Transient vertical squash (1 = none). */
  squash: number;
  /** Tilt on the base's edge (radians) toward (tx, tz): recoil and topple. */
  tilt: number;
  tx: number;
  tz: number;
  /** Screen-door fade 0..1. */
  fade: number;
  /** Colours frozen while the piece topples (a conquest recolours the tile under it). */
  frozen: { base: RGB; fig: RGB } | null;
  pendingColor: { base: RGB; fig: RGB } | null;
  ver: Record<string, number>;
  /** World position of the base top centre, refreshed by update(). */
  top: THREE.Vector3;
  plaque: THREE.Vector3;
  figTop: THREE.Vector3;
  halfW: number;
}

interface Traveler extends TokenTraveler {
  base: RGB;
  fig: RGB;
  pts: THREE.Vector3[];
  t: number;
  arc: number;
  denom: Denom;
}

// ---------------------------------------------------------------------------------------------------
// Sculpts
// ---------------------------------------------------------------------------------------------------

type P = [number, number];

function shapeOf(pts: P[], holes: P[][] = []): THREE.Shape {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

function circlePts(cx: number, cy: number, r: number, n = 18, a0 = 0, a1 = Math.PI * 2, rev = false): P[] {
  const out: P[] = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const m = full ? n : n + 1;
  for (let i = 0; i < m; i++) {
    const t = rev ? 1 - i / n : i / n;
    const a = a0 + (a1 - a0) * t;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** A bar from a to b with widths wa → wb (a tapered stick: rifle, leg, barrel, sabre). */
function bar(a: P, b: P, wa: number, wb = wa): P[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  return [
    [a[0] + (nx * wa) / 2, a[1] + (ny * wa) / 2],
    [a[0] - (nx * wa) / 2, a[1] - (ny * wa) / 2],
    [b[0] - (nx * wb) / 2, b[1] - (ny * wb) / 2],
    [b[0] + (nx * wb) / 2, b[1] + (ny * wb) / 2],
  ];
}

interface Part {
  shape: THREE.Shape;
  depth: number;
  /** z of the part's centre plane (front = +z, toward the camera). */
  z: number;
  bevel: number;
  /** Paint tone: 1 = owner colour, < 1 darker shade, > 1 lighter. */
  tone: number;
  /** Part of the sculpt's outer silhouette: gets the dark contour behind the figure. */
  outline?: boolean;
}

/** Contour width (figure units): a dark owner-shade rim around the silhouette, so it reads on its own tile. */
const OUTLINE = 0.075;
const OUTLINE_TONE = 0.26;

/**
 * Extrude the parts, paint them by facet (front 1, bevel = light edge, sides = darker shade, back 0.8),
 * merge, and put the feet at the origin.
 */
function sculpt(parts: Part[]): THREE.BufferGeometry {
  const all = [...parts];
  for (const p of parts) {
    if (!p.outline) continue;
    // Grown copy of the shape (the bevel spreads it by OUTLINE), flat, just behind its own part: close
    // enough that the contour doesn't slide off the part when the camera orbits.
    all.push({ shape: p.shape, depth: 0.004, z: p.z - p.depth / 2 - p.bevel - 0.014, bevel: -1, tone: OUTLINE_TONE });
  }
  const geos = all.map((p) => {
    if (p.bevel < 0) {
      const g = new THREE.ExtrudeGeometry(p.shape, {
        depth: p.depth,
        bevelEnabled: true,
        bevelThickness: 0.004,
        bevelSize: OUTLINE,
        bevelOffset: 0,
        bevelSegments: 1,
        curveSegments: 6,
      });
      g.translate(0, 0, p.z - p.depth / 2);
      const ng = g.index ? g.toNonIndexed() : g;
      ng.computeVertexNormals();
      const n = ng.attributes.position.count;
      ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(p.tone), 3));
      ng.deleteAttribute('uv');
      return ng;
    }
    const g = new THREE.ExtrudeGeometry(p.shape, {
      depth: p.depth,
      bevelEnabled: p.bevel > 0,
      bevelThickness: p.bevel,
      bevelSize: p.bevel * 0.85,
      bevelOffset: -p.bevel * 0.85,
      bevelSegments: 2,
      curveSegments: 6,
    });
    g.translate(0, 0, p.z - p.depth / 2);
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    const nrm = ng.attributes.normal as THREE.BufferAttribute;
    const pos = ng.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(nrm.count * 3);
    for (let i = 0; i < nrm.count; i++) {
      const nz = nrm.getZ(i);
      const ny = nrm.getY(i);
      // painted shade: a touch deeper at the feet, where the figure meets its base
      const ao = 0.8 + 0.2 * Math.min(1, pos.getY(i) / 0.9);
      let k: number;
      if (nz > 0.93) k = 0.9;
      else if (nz < -0.93) k = 0.7;
      else if (Math.abs(nz) > 0.2) k = 1.2 + 0.25 * Math.max(0, ny); // bevel: the light edge
      else k = 0.55 + 0.15 * Math.max(0, ny); // extrusion walls: the darker shade
      k *= p.tone * ao;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ng.deleteAttribute('uv');
    return ng;
  });
  const g = mergeGeometries(geos, false)!;
  geos.forEach((x) => x.dispose());
  g.computeBoundingBox();
  return g;
}

/** Infantry: a toy soldier in profile, helmet and pack, rifle upright at his side, bayonet over the helmet. */
function infantry(): THREE.BufferGeometry {
  const body: P[] = [
    [-0.46, 0.0], // rear boot heel
    [-0.2, 0.0],
    [-0.04, 0.5], // crotch
    [0.1, 0.0],
    [0.38, 0.0], // front boot toe
    [0.38, 0.1],
    [0.22, 0.14],
    [0.19, 0.6],
    [0.23, 0.98], // hip
    [0.27, 1.08],
    [0.28, 1.44], // chest
    [0.2, 1.56],
    [0.14, 1.6], // neck
    [0.21, 1.7], // chin
    [0.22, 1.8], // face
    [0.34, 1.83], // helmet brim, front
    [0.3, 1.94],
    [0.17, 2.05],
    [0.0, 2.09],
    [-0.16, 2.05],
    [-0.27, 1.94],
    [-0.33, 1.82], // brim, back
    [-0.17, 1.77],
    [-0.13, 1.61], // nape
    [-0.26, 1.54],
    [-0.38, 1.44], // pack
    [-0.39, 1.12],
    [-0.23, 1.04],
    [-0.24, 0.92], // seat
    [-0.32, 0.5],
    [-0.46, 0.08],
  ];
  const wide = (pts: P[]): P[] => pts.map(([x, y]) => [x * 1.12, y]);
  const rx = 0.5;
  return sculpt([
    { shape: shapeOf(wide(body)), depth: 0.3, z: 0, bevel: 0.07, tone: 1, outline: true },
    // rifle, upright at his side: stock, barrel, bayonet — the darker shade
    { shape: shapeOf(bar([rx, 0.06], [rx - 0.01, 0.62], 0.17, 0.12)), depth: 0.08, z: 0.22, bevel: 0.03, tone: 0.42, outline: true },
    { shape: shapeOf(bar([rx - 0.01, 0.6], [rx - 0.03, 2.2], 0.095, 0.08)), depth: 0.08, z: 0.22, bevel: 0.025, tone: 0.42, outline: true },
    { shape: shapeOf(bar([rx - 0.03, 2.18], [rx - 0.04, 2.5], 0.06, 0.02)), depth: 0.04, z: 0.22, bevel: 0.012, tone: 1.3, outline: true },
    // near arm: shoulder down to the hand on the rifle
    { shape: shapeOf(bar([0.06, 1.5], [rx - 0.02, 1.12], 0.19, 0.16)), depth: 0.08, z: 0.3, bevel: 0.04, tone: 0.95 },
  ]);
}

/** Cavalry: a horse in profile with a rider, sabre forward. */
function cavalry(): THREE.BufferGeometry {
  const horse: P[] = [
    [-0.92, 0.8],
    [-0.6, 0.7],
    [0.4, 0.7],
    [0.66, 0.84],
    [0.8, 1.08],
    [0.98, 1.34],
    [1.18, 1.16],
    [1.32, 1.2],
    [1.28, 1.36],
    [1.08, 1.6],
    [1.04, 1.74],
    [0.95, 1.63],
    [0.78, 1.56],
    [0.52, 1.25],
    [-0.6, 1.23],
    [-0.88, 1.2],
    [-1.0, 1.06],
  ];
  const tail: P[] = [
    [-0.9, 1.18],
    [-1.12, 1.06],
    [-1.24, 0.64],
    [-1.1, 0.66],
    [-0.98, 0.96],
  ];
  const rider: P[] = [
    [-0.3, 1.18],
    [0.16, 1.18],
    [0.2, 1.36],
    [0.12, 1.74],
    [-0.14, 1.76],
    [-0.28, 1.48],
  ];
  const head = circlePts(-0.01, 1.9, 0.14, 14);
  const cap: P[] = [
    [-0.16, 1.96],
    [0.14, 1.96],
    [0.12, 2.12],
    [-0.14, 2.14],
  ];
  return sculpt([
    { shape: shapeOf(horse), depth: 0.36, z: 0, bevel: 0.07, tone: 0.95, outline: true },
    { shape: shapeOf(tail), depth: 0.1, z: -0.06, bevel: 0.035, tone: 0.62, outline: true },
    // far legs (darker), one raised
    { shape: shapeOf(bar([0.56, 0.82], [0.84, 0.46], 0.16, 0.14)), depth: 0.1, z: -0.16, bevel: 0.03, tone: 0.62, outline: true },
    { shape: shapeOf(bar([0.84, 0.5], [0.74, 0.12], 0.14, 0.13)), depth: 0.1, z: -0.16, bevel: 0.03, tone: 0.62, outline: true },
    { shape: shapeOf(bar([-0.5, 0.82], [-0.46, 0.0], 0.16, 0.13)), depth: 0.1, z: -0.16, bevel: 0.03, tone: 0.62, outline: true },
    // near legs
    { shape: shapeOf(bar([0.44, 0.84], [0.5, 0.0], 0.18, 0.15)), depth: 0.1, z: 0.17, bevel: 0.035, tone: 0.95, outline: true },
    { shape: shapeOf(bar([-0.68, 0.86], [-0.74, 0.0], 0.2, 0.15)), depth: 0.1, z: 0.17, bevel: 0.035, tone: 0.95, outline: true },
    // rider: torso, boot down the flank, head and cap, sword arm, sabre
    { shape: shapeOf(rider), depth: 0.24, z: 0.05, bevel: 0.05, tone: 1.08, outline: true },
    { shape: shapeOf(bar([0.0, 1.32], [0.1, 0.9], 0.17, 0.14)), depth: 0.08, z: 0.26, bevel: 0.035, tone: 1.08 },
    { shape: shapeOf(head), depth: 0.2, z: 0.05, bevel: 0.04, tone: 1.08, outline: true },
    { shape: shapeOf(cap), depth: 0.2, z: 0.05, bevel: 0.035, tone: 0.45, outline: true },
    { shape: shapeOf(bar([0.06, 1.64], [0.4, 1.86], 0.13, 0.11)), depth: 0.08, z: 0.24, bevel: 0.03, tone: 1.08, outline: true },
    { shape: shapeOf(bar([0.38, 1.85], [0.98, 2.2], 0.085, 0.035)), depth: 0.04, z: 0.28, bevel: 0.018, tone: 1.4, outline: true },
  ]);
}

/** Artillery: a field gun in profile, spoked wheel in front, barrel angled up, trail to the ground. */
function artillery(): THREE.BufferGeometry {
  const wc: P = [-0.08, 0.62];
  const wr = 0.62;
  const holes: P[][] = [];
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + 0.2;
    const a1 = a0 + (Math.PI * 2) / 6 - 0.36;
    holes.push([...circlePts(wc[0], wc[1], 0.17, 3, a0, a1), ...circlePts(wc[0], wc[1], 0.46, 5, a0, a1, true)]);
  }
  const wheel = shapeOf(circlePts(wc[0], wc[1], wr, 28), holes);
  // barrel: breech knob → muzzle swell, axis angled ~14° up
  const B: P = [-0.62, 0.98];
  const M: P = [1.06, 1.42];
  const ax = M[0] - B[0];
  const ay = M[1] - B[1];
  const L = Math.hypot(ax, ay);
  const ux = ax / L;
  const uy = ay / L;
  const at = (u: number, v: number): P => [B[0] + ux * u - uy * v, B[1] + uy * u + ux * v];
  const barrel: P[] = [
    at(-0.16, 0.13),
    at(-0.24, 0.0),
    at(-0.16, -0.13),
    at(0.0, -0.25),
    at(L - 0.22, -0.16),
    at(L - 0.22, -0.21),
    at(L, -0.21),
    at(L, 0.21),
    at(L - 0.22, 0.21),
    at(L - 0.22, 0.16),
    at(0.0, 0.25),
  ];
  const cheek: P[] = [
    [-0.56, 0.5],
    [0.36, 0.5],
    [0.3, 1.08],
    [-0.5, 0.92],
  ];
  return sculpt([
    { shape: shapeOf(bar([-0.2, 0.56], [-1.08, 0.07], 0.28, 0.18)), depth: 0.22, z: -0.02, bevel: 0.05, tone: 0.78, outline: true },
    { shape: shapeOf(cheek), depth: 0.28, z: -0.02, bevel: 0.05, tone: 0.82, outline: true },
    { shape: shapeOf(barrel), depth: 0.4, z: 0.0, bevel: 0.08, tone: 0.5, outline: true },
    { shape: wheel, depth: 0.14, z: 0.27, bevel: 0.045, tone: 1.05, outline: true },
    { shape: shapeOf(circlePts(wc[0], wc[1], 0.15, 12)), depth: 0.1, z: 0.36, bevel: 0.035, tone: 0.55 },
  ]);
}

function baseGeometry(): THREE.BufferGeometry {
  // A low turned base at unit radius and unit height: a bevelled foot, a step, a flat top.
  const prof: [number, number][] = [
    [0, 0],
    [0.93, 0],
    [0.985, 0.04],
    [1.0, 0.14],
    [1.0, 0.42],
    [0.975, 0.52],
    [0.9, 0.58],
    [0.88, 0.7],
    [0.86, 0.9],
    [0.83, 0.98],
    [0.78, 1.0],
    [0, 1.0],
  ];
  const geo = new THREE.LatheGeometry(
    prof.map(([x, y]) => new THREE.Vector2(x, y)),
    40,
  );
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const k = y >= 1 - 1e-4 ? 1 : r < 0.5 ? 0.5 : y > 0.55 ? 1.12 : 0.74 + 0.2 * (y / 0.55);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Screen-door fade: fragments whose Bayer threshold exceeds the instance's fade are dropped. */
function fadeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0, envMapIntensity: 0.55 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vFade;
        float pc_b2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float pc_b4(vec2 a) { return pc_b2(0.5 * a) * 0.25 + pc_b2(a); }`,
      )
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade < 0.999 && pc_b4(gl_FragCoord.xy) + 0.03 > vFade) discard;');
  };
  mat.customProgramCacheKey = () => 'piece-fade-v1';
  return mat;
}

class PieceMesh {
  mesh: THREE.InstancedMesh;
  fade: THREE.InstancedBufferAttribute;
  k = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(CAP).fill(1), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }
  push(m: THREE.Matrix4, c: THREE.Color, fade: number): void {
    if (this.k >= CAP) return;
    this.mesh.setMatrixAt(this.k, m);
    this.mesh.setColorAt(this.k, c);
    this.fade.setX(this.k, fade);
    this.k++;
  }
  commit(): void {
    this.mesh.count = this.k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.fade.needsUpdate = true;
    this.k = 0;
  }
}

// ---------------------------------------------------------------------------------------------------

export class TokenSystem {
  group = new THREE.Group();
  private baseMesh: PieceMesh;
  private figMeshes: PieceMesh[];
  /** Figure height / half-width (board units, at FIG_SCALE 1) per denomination. */
  readonly figH: number[];
  readonly figHalfW: number[];
  private toks = new Map<TerritoryId, Tok>();
  private list: Tok[] = [];
  private movers: Traveler[] = [];
  private dirty = true;
  materials: THREE.Material[] = [];
  /** Size multiplier from the UI text size (bigger numbers need a bigger piece). */
  sizeScale = 1;
  /** Reduced motion: counts change in place (no hops, pops or topples) — pieces dissolve instead. */
  reduced = false;
  /** Camera azimuth / pitch the figures face (deg). */
  private camAz = 0;
  private camPitch = 70;
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private axis = new THREE.Vector3();
  private last = new Float32Array(0);
  /** Called when a dropped piece touches down (dust, number pop, sound). */
  onContact: ((id: TerritoryId) => void) | null = null;

  constructor(
    private anim: Animator,
    private tiles: TileSet,
  ) {
    const mat = fadeMaterial();
    this.materials.push(mat);
    this.baseMesh = new PieceMesh(baseGeometry(), mat);
    const figs = [infantry(), cavalry(), artillery()];
    this.figH = figs.map((g) => g.boundingBox!.max.y);
    this.figHalfW = figs.map((g) => Math.max(-g.boundingBox!.min.x, g.boundingBox!.max.x));
    this.figMeshes = figs.map((g) => new PieceMesh(g, mat));
    // A leaned figure's long shadow reads as a second silhouette on the tile: only the base casts one.
    for (const f of this.figMeshes) f.mesh.castShadow = false;
    this.group.add(this.baseMesh.mesh, ...this.figMeshes.map((f) => f.mesh));
    for (const id of TERRITORY_IDS) {
      const a = tiles.get(id).anchorW;
      const t: Tok = {
        id,
        base: [0.8, 0.75, 0.65],
        fig: [0.9, 0.85, 0.75],
        n: 0,
        denom: 0,
        scale: 0,
        pop: 1,
        figPop: 1,
        swapFrom: -1,
        figSwap: 1,
        xfade: 1,
        hop: 0,
        squash: 1,
        tilt: 0,
        tx: 0,
        tz: 1,
        fade: 1,
        frozen: null,
        pendingColor: null,
        ver: {},
        top: a.clone(),
        plaque: a.clone(),
        figTop: a.clone(),
        halfW: TOKEN_R,
      };
      this.toks.set(id, t);
      this.list.push(t);
    }
    this.last = new Float32Array(this.list.length * 4);
  }

  /** Base radius (board units) at the current UI scale. */
  get radius(): number {
    return TOKEN_R * this.sizeScale;
  }

  get travelers(): readonly TokenTraveler[] {
    return this.movers;
  }

  get animating(): boolean {
    return this.movers.length > 0;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Instance data waits for the next update() (the render-on-demand loop must draw). */
  get needsUpdate(): boolean {
    return this.dirty;
  }

  /** The figures turn and lean to face this camera pose (deg). Cheap; only re-lays out on change. */
  setView(azDeg: number, pitchDeg: number): void {
    if (Math.abs(azDeg - this.camAz) < 0.01 && Math.abs(pitchDeg - this.camPitch) < 0.01) return;
    this.camAz = azDeg;
    this.camPitch = pitchDeg;
    this.dirty = true;
  }

  /** Base fill for an owner's tile colour: a touch deeper and richer than the tile, so it reads on it. */
  static fill(tile: RGB): RGB {
    return adjust(tile, 1.14, 0.8);
  }
  /** Figure paint: the owner colour, brighter than the tile, so the sculpt stands off its own ground. */
  static paint(tile: RGB): RGB {
    return adjust(tile, 1.24, 0.93);
  }

  setColor(id: TerritoryId, tileColor: RGB): void {
    const t = this.toks.get(id)!;
    const c = { base: TokenSystem.fill(tileColor), fig: TokenSystem.paint(tileColor) };
    if (t.frozen) t.pendingColor = c;
    else {
      t.base = c.base;
      t.fig = c.fig;
    }
    this.dirty = true;
  }

  /** Base-top centre (world), refreshed each frame. */
  top(id: TerritoryId): THREE.Vector3 {
    return this.toks.get(id)!.top;
  }
  /** Where the count plaque centres (world): the base's front rim, toward the camera. */
  plaquePoint(id: TerritoryId): THREE.Vector3 {
    return this.toks.get(id)!.plaque;
  }
  /** Top of the figure (world). */
  figTop(id: TerritoryId): THREE.Vector3 {
    return this.toks.get(id)!.figTop;
  }
  /** Half the piece's width (world units, at rest). */
  halfWidth(id: TerritoryId): number {
    return this.toks.get(id)!.halfW;
  }
  denom(id: TerritoryId): Denom {
    return this.toks.get(id)!.denom;
  }
  /** Drawn size multiplier (presence × pop × fade); 0 = hidden. */
  visual(id: TerritoryId): number {
    const t = this.toks.get(id)!;
    return t.scale * t.pop * Math.min(1, t.fade * 1.4) * (t.tilt > 0.6 ? Math.max(0, 1 - (t.tilt - 0.6) * 1.5) : 1);
  }
  /** Fresh base-top centre (not last frame's), for getScreenPosition: always on the tile. */
  freshTop(id: TerritoryId, out: THREE.Vector3): THREE.Vector3 {
    const t = this.toks.get(id)!;
    const tile = this.tiles.get(id);
    return out.set(tile.anchorW.x, tile.pivot.position.y + TILE_TOP + t.hop + TOKEN_H * this.sizeScale * t.squash, tile.anchorW.z);
  }

  /**
   * World points bounding every piece at a camera pitch (figure tops, the base's sides and front, and a
   * plaque's depth below it), for the home-view fit. `plaqueUnits` = the plaque's reach below the base
   * front in board units at the home scale.
   */
  extentPoints(pitchDeg: number, plaqueUnits: number, denom: Denom | null = null): number[][] {
    const lean = Math.min(MAX_LEAN, Math.max(0, pitchDeg - VIEW_ELEV)) * (Math.PI / 180);
    const R = this.radius;
    const out: number[][] = [];
    const tallest = denom ?? 0; // infantry is the tallest sculpt; cavalry the widest
    const h = this.figH[tallest] * FIG_SCALE[tallest] * this.sizeScale;
    const hw = Math.max(R, this.figHalfW[1] * FIG_SCALE[1] * this.sizeScale);
    for (const t of this.list) {
      const a = this.tiles.get(t.id).anchorW;
      const y0 = TILE_TOP + TOKEN_H * this.sizeScale;
      out.push([a.x, y0 + h * Math.cos(lean), a.z - h * Math.sin(lean) - R * FIG_BACK]);
      out.push([a.x - hw, y0, a.z], [a.x + hw, y0, a.z]);
      out.push([a.x, TILE_TOP, a.z + R + plaqueUnits]);
    }
    return out;
  }

  private tw(t: Tok, key: string, o: { ms: number; ease?: (v: number) => number; run?: Run | null; update: (v: number) => void; done?: () => void }): Promise<void> {
    const ver = (t.ver[key] = (t.ver[key] ?? 0) + 1);
    return this.anim.tween({
      ms: o.ms,
      ease: o.ease ?? ease.linear,
      run: o.run ?? null,
      update: (v) => {
        if (t.ver[key] !== ver) return;
        o.update(v);
        this.dirty = true;
      },
      done: () => {
        if (t.ver[key] === ver) o.done?.();
        this.dirty = true;
      },
    });
  }

  private cancel(t: Tok, keys: string[]): void {
    for (const k of keys) t.ver[k] = (t.ver[k] ?? 0) + 1;
  }

  private rest(t: Tok): void {
    t.pop = 1;
    t.figPop = 1;
    t.hop = 0;
    t.squash = 1;
    t.tilt = 0;
    t.fade = 1;
    t.swapFrom = -1;
    t.figSwap = 1;
    t.xfade = 1;
    this.unfreeze(t);
  }

  private unfreeze(t: Tok): void {
    t.frozen = null;
    if (t.pendingColor) {
      t.base = t.pendingColor.base;
      t.fig = t.pendingColor.fig;
      t.pendingColor = null;
    }
  }

  /** Direction (world xz, unit) from territory a toward b; falls back to the camera's front. */
  private dirTo(from: TerritoryId, to: TerritoryId | null | undefined, away: boolean): [number, number] {
    if (to && to !== from) {
      const a = this.tiles.get(from).anchorW;
      const b = this.tiles.get(to).anchorW;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) return away ? [-dx / d, -dz / d] : [dx / d, dz / d];
    }
    return [0, away ? -1 : 1];
  }

  /**
   * Change a territory's count. mode:
   * - 'snap'  no motion (sync, deal)
   * - 'drop'  placement: an empty tile's piece drops in, an existing one hops; onContact on touchdown
   * - 'lift'  armies leave (march start / unplace): a small lift, or it lifts away if it empties
   * - 'hit'   dice losses: a recoil away from `other`; if it empties, it topples toward `other`
   * - 'land'  a traveler arrived: settle (appears at once if the tile was empty)
   * - 'out'   leave the board (conquered)
   */
  setArmies(
    id: TerritoryId,
    n: number,
    mode: 'snap' | 'drop' | 'lift' | 'hit' | 'land' | 'out',
    run: Run | null = null,
    other: TerritoryId | null = null,
  ): void {
    const t = this.toks.get(id)!;
    const wasShown = t.scale > 0.5 && t.n > 0;
    const prevDenom = t.denom;
    t.n = n;
    const nextDenom = n > 0 ? denomOf(n) : prevDenom;
    this.dirty = true;
    const instant = this.anim.instant || (run && run.skipped);
    if (mode === 'snap' || instant) {
      this.cancel(t, ['scale', 'pop', 'hop', 'squash', 'tilt', 'fade', 'swap']);
      this.rest(t);
      t.scale = n > 0 ? 1 : 0;
      t.denom = nextDenom;
      if (mode === 'drop' && instant) this.onContact?.(id);
      return;
    }
    if (this.reduced) {
      // Steady: the piece dissolves in / out, and a new sculpt crossfades over the old one. No motion.
      if (mode === 'drop') this.onContact?.(id);
      this.cancel(t, ['pop', 'hop', 'squash', 'tilt']);
      t.pop = 1;
      t.figPop = 1;
      t.hop = 0;
      t.squash = 1;
      t.tilt = 0;
      if (n <= 0 || mode === 'out') {
        if (t.scale <= 0.001) return;
        t.frozen = { base: t.base, fig: t.fig };
        const from = t.fade;
        this.tw(t, 'fade', {
          ms: 160,
          run,
          update: (v) => (t.fade = from * (1 - v)),
          done: () => {
            t.scale = 0;
            t.fade = 1;
            this.unfreeze(t);
          },
        });
        return;
      }
      if (!wasShown) {
        this.cancel(t, ['swap']);
        t.swapFrom = -1;
        t.denom = nextDenom;
        t.scale = 1;
        t.fade = 0;
        this.unfreeze(t);
        this.tw(t, 'fade', { ms: 160, run, update: (v) => (t.fade = v), done: () => (t.fade = 1) });
        return;
      }
      if (nextDenom !== prevDenom) {
        t.swapFrom = prevDenom;
        t.denom = nextDenom;
        t.xfade = 0;
        this.tw(t, 'swap', {
          ms: 160,
          run,
          update: (v) => (t.xfade = v),
          done: () => {
            t.xfade = 1;
            t.swapFrom = -1;
          },
        });
      }
      return;
    }
    if (n <= 0 || mode === 'out') {
      if (!wasShown && t.scale <= 0.001) {
        t.scale = 0;
        return;
      }
      this.cancel(t, ['pop', 'swap']);
      t.pop = 1;
      t.figPop = 1;
      t.swapFrom = -1;
      t.frozen = t.frozen ?? { base: t.base, fig: t.fig };
      if (mode === 'hit' || mode === 'out') {
        // Topple: the piece tips over its base edge (toward `other`), then fades where it lies.
        const [dx, dz] = this.dirTo(id, other, false);
        t.tx = dx;
        t.tz = dz;
        const from = t.tilt;
        this.tw(t, 'tilt', {
          ms: 300,
          run,
          update: (v) => {
            const a = v < 0.78 ? ease.inQuad(v / 0.78) : 1 - 0.08 * Math.sin(((v - 0.78) / 0.22) * Math.PI);
            t.tilt = from + (1.45 - from) * a;
          },
        });
        this.cancel(t, ['fade']);
        this.tw(t, 'scale', {
          ms: 460,
          run,
          update: (v) => {
            // it lies still for a beat once down (~260 ms), then dissolves where it fell
            t.fade = v < 0.56 ? 1 : 1 - (v - 0.56) / 0.44;
          },
          done: () => {
            this.cancel(t, ['tilt', 'fade']);
            t.scale = 0;
            t.tilt = 0;
            t.fade = 1;
            this.unfreeze(t);
          },
        });
        return;
      }
      // lift away (unplace / everything marched out)
      const from = t.scale;
      this.tw(t, 'scale', {
        ms: 170,
        ease: ease.inQuad,
        run,
        update: (v) => {
          t.scale = from * (1 - v * 0.3);
          t.fade = 1 - v;
          t.hop = 0.6 * v;
        },
        done: () => {
          t.scale = 0;
          t.hop = 0;
          t.fade = 1;
          this.unfreeze(t);
        },
      });
      return;
    }
    // n > 0 from here
    if (!wasShown) {
      // Appear: drop in from above (placement) or settle in place (a landed traveler).
      this.cancel(t, ['scale', 'tilt', 'fade', 'swap']);
      this.rest(t);
      t.denom = nextDenom;
      t.scale = 1;
      if (mode === 'drop') {
        this.tw(t, 'hop', {
          ms: 160,
          ease: ease.inQuad,
          run,
          update: (v) => (t.hop = 1.4 * (1 - v)),
          done: () => {
            t.hop = 0;
            this.onContact?.(id);
            this.settle(t, run, 0.2);
          },
        });
      } else this.settle(t, run, mode === 'land' ? 0.16 : 0.1);
      return;
    }
    this.cancel(t, ['scale']);
    t.scale = 1;
    if (t.frozen && t.tilt > 0.3) {
      // a piece mid-topple came back (a drift correction): stand it up
      this.cancel(t, ['tilt', 'fade']);
      t.tilt = 0;
      t.fade = 1;
      this.unfreeze(t);
    }
    if (nextDenom !== prevDenom) this.swap(t, prevDenom, nextDenom, run);
    switch (mode) {
      case 'drop': {
        // settle hop: up and down with a thunk (160 ms)
        this.tw(t, 'hop', {
          ms: 160,
          ease: ease.linear,
          run,
          update: (v) => (t.hop = v < 0.4 ? 0.36 * ease.outQuad(v / 0.4) : 0.36 * (1 - ease.inQuad((v - 0.4) / 0.6))),
          done: () => {
            t.hop = 0;
            this.onContact?.(id);
            this.settle(t, run, 0.14);
          },
        });
        break;
      }
      case 'lift': {
        this.tw(t, 'hop', {
          ms: 180,
          ease: ease.linear,
          run,
          update: (v) => (t.hop = 0.24 * Math.sin(v * Math.PI)),
          done: () => (t.hop = 0),
        });
        break;
      }
      case 'hit': {
        // recoil: rock back on the base's edge, away from the blow, and settle
        const [dx, dz] = this.dirTo(id, other, true);
        t.tx = dx;
        t.tz = dz;
        this.tw(t, 'tilt', {
          ms: 260,
          ease: ease.linear,
          run,
          update: (v) => {
            t.tilt = 0.3 * Math.sin(Math.min(1, v * 1.6) * Math.PI) * (1 - v * 0.5) + 0.05 * Math.sin(v * Math.PI * 3) * (1 - v);
            t.squash = 1 - 0.14 * Math.sin(Math.min(1, v * 2.4) * Math.PI);
          },
          done: () => {
            t.tilt = 0;
            t.squash = 1;
          },
        });
        break;
      }
      case 'land':
        this.settle(t, run, 0.14);
        break;
    }
  }

  /** Denomination change: the old sculpt ducks out and the new one pops in (160 ms). */
  private swap(t: Tok, from: Denom, to: Denom, run: Run | null): void {
    t.swapFrom = from;
    t.denom = to;
    t.figSwap = 0;
    this.tw(t, 'swap', {
      ms: 170,
      ease: ease.linear,
      run,
      update: (v) => {
        t.figSwap = v;
        if (v < 0.4) t.figPop = 1 - 0.75 * ease.inQuad(v / 0.4);
        else {
          t.swapFrom = -1;
          const u = (v - 0.4) / 0.6;
          t.figPop = 0.25 + 0.75 * ease.outBack(2.2)(u);
        }
      },
      done: () => {
        t.swapFrom = -1;
        t.figPop = 1;
        t.figSwap = 1;
      },
    });
  }

  /** Squash-and-recover on touchdown. */
  private settle(t: Tok, run: Run | null, amt: number): void {
    this.tw(t, 'squash', {
      ms: 150,
      ease: ease.linear,
      run,
      update: (v) => (t.squash = 1 - amt * Math.sin(v * Math.PI) * (1 - v * 0.4)),
      done: () => (t.squash = 1),
    });
  }

  /** Brief size pop (a count changed without motion). */
  pop(id: TerritoryId, amt = 0.12): void {
    const t = this.toks.get(id)!;
    if (this.anim.instant || this.reduced || t.scale <= 0) return;
    this.tw(t, 'pop', {
      ms: 160,
      ease: ease.linear,
      update: (v) => (t.pop = 1 + amt * Math.sin(v * Math.PI)),
      done: () => (t.pop = 1),
    });
  }

  /** A traveler piece carrying `count` flies from a to b (via optional waypoints). Resolves on landing. */
  march(
    from: TerritoryId,
    to: TerritoryId,
    count: number,
    tileColor: RGB,
    ink: string,
    ms: number,
    run: Run | null,
    viaIds: TerritoryId[] = [],
    arc = 1.1,
    owner = '',
  ): Promise<void> {
    if (this.anim.instant || (run && run.skipped) || this.movers.length >= MAX_TRAVELERS) return Promise.resolve();
    const a = this.tiles.get(from).anchorW.clone();
    a.y = TILE_TOP + this.tiles.get(from).pivot.position.y + TOKEN_H * this.sizeScale * 0.6;
    const b = this.tiles.get(to).anchorW.clone();
    b.y = TILE_TOP + this.tiles.get(to).pivot.position.y;
    const first = viaIds.length ? this.tiles.get(viaIds[0]).anchorW : b;
    // ...it lifts off the source's base toward where it's going, so it never sits on the source piece.
    const dx = first.x - a.x;
    const dz = first.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const off = Math.min(this.radius * 1.3, d * 0.35);
      a.x += (dx / d) * off;
      a.z += (dz / d) * off;
    }
    const pts = [a, ...viaIds.map((v) => this.tiles.get(v).anchorW.clone().setY(TILE_TOP)), b];
    const tr: Traveler = {
      n: count,
      ink,
      owner,
      top: a.clone(),
      plaque: a.clone(),
      figTop: a.clone(),
      halfW: this.radius,
      alive: true,
      base: TokenSystem.fill(tileColor),
      fig: TokenSystem.paint(tileColor),
      pts,
      t: 0,
      arc,
      denom: denomOf(count),
    };
    this.movers.push(tr);
    this.dirty = true;
    return this.anim
      .tween({
        ms,
        ease: viaIds.length ? ease.inOutSine : ease.inOutQuad,
        run,
        update: (v) => {
          tr.t = v;
          this.dirty = true;
        },
      })
      .then(() => {
        tr.alive = false;
        this.movers = this.movers.filter((x) => x !== tr);
        this.dirty = true;
      });
  }

  /** World position on the tile top at a piece (for dust). */
  dustPoint(id: TerritoryId, out: THREE.Vector3): THREE.Vector3 {
    const tile = this.tiles.get(id);
    return out.set(tile.anchorW.x, TILE_TOP + tile.pivot.position.y + 0.02, tile.anchorW.z + this.radius * 0.7);
  }

  // --- per frame ----------------------------------------------------------------------------------

  private col(c: RGB, dim: number): THREE.Color {
    if (dim > 0) c = adjust(c, 1 - 0.15 * dim, 1 - 0.2 * dim);
    return this.c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  }

  /**
   * Compose one piece: base at `pos` (bottom centre), figure of `denom` on it, tipped by `tilt` toward
   * (tx, tz) about the base edge. Writes the plaque / figure-top points into the out vectors.
   */
  private drawPiece(
    pos: THREE.Vector3,
    R: number,
    sy: number,
    tilt: number,
    tx: number,
    tz: number,
    figs: { denom: Denom; scale: number; fade: number; color: RGB }[],
    base: RGB,
    dim: number,
    fade: number,
    flipX: number,
    outTop: THREE.Vector3,
    outPlaque: THREE.Vector3,
    outFigTop: THREE.Vector3,
  ): void {
    const az = (this.camAz * Math.PI) / 180;
    const lean = (Math.min(MAX_LEAN, Math.max(0, this.camPitch - VIEW_ELEV)) * Math.PI) / 180;
    const bh = TOKEN_H * this.sizeScale * sy;
    // topple / recoil: rotate about the base edge in the tilt direction
    const tiltM = this.m2.identity();
    if (tilt > 1e-4) {
      this.axis.set(tz, 0, -tx).normalize();
      const px = pos.x + tx * R;
      const pz = pos.z + tz * R;
      tiltM.makeTranslation(px, pos.y, pz);
      tiltM.multiply(new THREE.Matrix4().makeRotationAxis(this.axis, tilt));
      tiltM.multiply(new THREE.Matrix4().makeTranslation(-px, -pos.y, -pz));
    }
    // base
    this.q.identity();
    this.p.copy(pos);
    this.s.set(R * Math.max(0.001, flipX), bh, R);
    this.m.compose(this.p, this.q, this.s);
    if (tilt > 1e-4) this.m.premultiply(tiltM);
    this.baseMesh.push(this.m, this.col(base, dim), fade);
    // figure(s)
    this.q.setFromEuler(new THREE.Euler(-lean, az, 0, 'YXZ'));
    let figH = 0;
    for (const f of figs) {
      if (f.scale <= 0.001 || f.fade <= 0.001) continue;
      const k = FIG_SCALE[f.denom] * this.sizeScale * f.scale;
      this.p.set(pos.x - Math.sin(az) * R * FIG_BACK, pos.y + bh * 0.96, pos.z - Math.cos(az) * R * FIG_BACK);
      this.s.set(k * Math.max(0.001, flipX), k * sy, k);
      this.m.compose(this.p, this.q, this.s);
      if (tilt > 1e-4) this.m.premultiply(tiltM);
      this.figMeshes[f.denom].push(this.m, this.col(f.color, dim), Math.min(fade, f.fade));
      figH = Math.max(figH, this.figH[f.denom] * k);
    }
    // anchor points for the DOM plaque and the layout boxes (at rest orientation; tilt ignored)
    outTop.set(pos.x, pos.y + bh, pos.z);
    outPlaque.set(pos.x + Math.sin(az) * R * 0.94, pos.y + bh * 0.45, pos.z + Math.cos(az) * R * 0.94);
    const h = Math.max(figH, 0.3);
    // up axis leaned back away from the camera
    const back = R * FIG_BACK + Math.sin(lean) * h;
    outFigTop.set(pos.x - Math.sin(az) * back, pos.y + bh + Math.cos(lean) * h, pos.z - Math.cos(az) * back);
  }

  /** Write instance matrices/colors. Cheap; uploads only when something changed. */
  update(): void {
    const R = this.radius;
    const L = this.last;
    // Tile lifts, flips and dims move pieces without a piece tween: compare against last frame.
    for (let i = 0; i < this.list.length; i++) {
      const tile = this.tiles.get(this.list[i].id);
      const y = tile.pivot.position.y;
      const fx = tile.pivot.scale.x;
      const d = tile.dim;
      const o = i * 4;
      if (L[o] !== y || L[o + 1] !== fx || L[o + 2] !== d) {
        L[o] = y;
        L[o + 1] = fx;
        L[o + 2] = d;
        this.dirty = true;
      }
    }
    if (!this.dirty && !this.movers.length) return;
    this.dirty = false;
    const figs: { denom: Denom; scale: number; fade: number; color: RGB }[] = [];
    for (const t of this.list) {
      const tile = this.tiles.get(t.id);
      const y0 = tile.pivot.position.y + TILE_TOP;
      this.p.set(tile.anchorW.x, y0 + t.hop, tile.anchorW.z);
      const drawn = t.scale > 0.001;
      const pos = this.p.clone();
      const colors = t.frozen ?? { base: t.base, fig: t.fig };
      figs.length = 0;
      if (drawn) {
        if (t.swapFrom !== -1 && t.xfade < 1) {
          // reduced-motion crossfade
          figs.push({ denom: t.swapFrom, scale: 1, fade: 1 - t.xfade, color: colors.fig });
          figs.push({ denom: t.denom, scale: 1, fade: t.xfade, color: colors.fig });
        } else figs.push({ denom: t.swapFrom !== -1 ? t.swapFrom : t.denom, scale: t.figPop * t.pop, fade: 1, color: colors.fig });
      }
      const sc = R * Math.max(0.001, t.scale) * t.pop;
      if (drawn) {
        this.drawPiece(pos, sc, t.squash * Math.max(0.2, t.scale), t.tilt, t.tx, t.tz, figs, colors.base, tile.dim, t.fade, tile.pivot.scale.x, t.top, t.plaque, t.figTop);
      } else {
        // keep the layout points current for an empty tile (labels, getScreenPosition)
        const bh = TOKEN_H * this.sizeScale;
        t.top.set(pos.x, pos.y + bh, pos.z);
        t.plaque.copy(t.top);
        t.figTop.copy(t.top);
      }
      t.halfW = Math.max(R, this.figHalfW[t.denom] * FIG_SCALE[t.denom] * this.sizeScale);
    }
    for (const tr of this.movers) {
      const pts = tr.pts;
      const segs = pts.length - 1;
      const u = tr.t * segs;
      const j = Math.min(segs - 1, Math.floor(u));
      const lt = u - j;
      this.p.lerpVectors(pts[j], pts[j + 1], lt);
      const hopH = this.reduced ? 0 : segs > 1 ? 0.45 : tr.arc;
      this.p.y += Math.sin(lt * Math.PI) * hopH;
      figs.length = 0;
      figs.push({ denom: tr.denom, scale: 1, fade: 1, color: tr.fig });
      this.drawPiece(this.p.clone(), R, 1, 0, 0, 1, figs, tr.base, 0, 1, 1, tr.top, tr.plaque, tr.figTop);
      tr.halfW = Math.max(R, this.figHalfW[tr.denom] * FIG_SCALE[tr.denom] * this.sizeScale);
    }
    this.baseMesh.commit();
    for (const f of this.figMeshes) f.commit();
  }

  dispose(): void {
    this.baseMesh.mesh.geometry.dispose();
    this.baseMesh.mesh.dispose();
    for (const f of this.figMeshes) {
      f.mesh.geometry.dispose();
      f.mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
