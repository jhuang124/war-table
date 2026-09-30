// Army figures (docs/INK.md A8, B §3 "Units", B §4 motion): one ivory brush figure per territory,
// standing on a small wash blot in the owner's deep ink. The denomination follows physical Risk —
// infantry 1–4, cavalry 5–9, artillery 10+ — and the exact count sits beside the figure in a brushed
// ensō ring (DOM, overlay.ts), so it stays crisp at any DPR.
//
// The figures are the chosen sprites (public/units/atlas.webp, built by scripts/units.ts), drawn as
// instanced camera-facing quads anchored at the feet: at the flat ~80° home pitch they read upright, the
// way a painted figure stands on a scroll. The sprite's dark ink is re-tinted to the owner's deep colour
// and its light ink stays ivory, so a figure reads on every wash; the blot under it gives it ground.
//
// All motion is shader work and small transforms, never scale pops:
//   place     N ink dots fall onto the blot and soak in; the figure re-inks (a brief deepening) and hops
//   denom     the old figure dries out in patches, the new one is drawn in, feet → head
//   attack    a slight lean toward the target (both figures turn to face each other)
//   loss      a recoil away from the blow and a tiny ink splash; at the verdict a puff (INK2 §2.2): a little
//             ink lifts off the figure as smoke and settles back
//   fall      at 0 the figure dissolves upward as ink smoke (the `smoke` pigment map, public/tex)
//   traveller a figure walks the arrow (or the fortify route) with a light step
// Nothing moves at idle: the calm belongs to the paper (index.ts), not the figures.
import * as THREE from 'three';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS } from '../engine/mapData';
import { Animator, ease, type Run } from './anim';
import { IVORY, TILE_TOP, hexToRgb, type RGB } from './util';
import { deepOf, type TileSet } from './tiles';
import { loadInkMap } from './textures';
import ATLAS from './unitsAtlas.json';

/** 0 = infantry (1–4), 1 = cavalry (5–9), 2 = artillery (10+). */
export type Denom = 0 | 1 | 2;
export const denomOf = (n: number): Denom => (n >= 10 ? 2 : n >= 5 ? 1 : 0);
export const DENOM_NAMES = ['infantry', 'cavalry', 'artillery'] as const;

/** Blot radius (board units, at UI scale 1): the figure's ground. Also the piece's nominal radius. */
export const TOKEN_R = 1.06;
/** Kept for callers of the old API (the piece has no base any more). */
export const TOKEN_H = 0;
/**
 * Figure height per denomination (board units at size scale 1). At the 1440×900 home (~12.7 px/unit):
 * soldier ~41 px tall, rider ~39×29 px, cannon ~22×40 px — the ~34×40 px of docs/INK.md B §3.
 */
const FIG_H = [3.45, 3.3, 1.9];
const SPRITES = [ATLAS.sprites.soldier, ATLAS.sprites.rider, ATLAS.sprites.cannon];
const ASPECT = SPRITES.map((s) => s.w / s.h);
/** The figure stands a little left of the anchor, so figure + ring sit centred on the territory. */
const FIG_SHIFT = 0.75;
const MAX_TRAVELERS = 8;
const MAX_DOTS = 64;
/** Placement ink dots alive at once (B §4: ≤ 12). */
const MAX_PLACE_DOTS = 12;
const FIG_CAP = TERRITORY_IDS.length * 2 + MAX_TRAVELERS;
const BLOT_CAP = TERRITORY_IDS.length + MAX_TRAVELERS + MAX_DOTS;
const IVORY_RGB = hexToRgb(IVORY);

export interface TokenTraveler {
  /** Count carried (drawn as the traveller's number). */
  n: number;
  /** Number color (the mover's palette ink). */
  ink: string;
  /** World position of the traveller's feet (updated every frame while it walks). */
  top: THREE.Vector3;
  /** Kept for the overlay: the feet again (the ring is placed beside the figure in screen space). */
  plaque: THREE.Vector3;
  /** World point at the top of the traveller's figure. */
  figTop: THREE.Vector3;
  /** Half the figure's width, world units. */
  halfW: number;
  /** The mover's palette id (the ring paints in its colours). */
  owner: string;
  /** The figure it walks as. */
  denom: Denom;
  alive: boolean;
}

interface Tok {
  id: TerritoryId;
  blot: RGB;
  deep: RGB;
  n: number;
  denom: Denom;
  /** 0..1 presence (0 = not drawn). */
  scale: number;
  /** Stroke reveal of the current figure, feet → head (1 = fully drawn). */
  reveal: number;
  /** The figure being replaced (denomination change), drying out; null = none. */
  old: { denom: Denom; dry: number } | null;
  /** Ink smoke dissolve 0..1 (the fall). */
  smoke: number;
  /** The verdict's puff (0 → 0.3 → 0): the smoke's look, but the figure stays (INK2 §2.2). */
  puff: number;
  /** Overall alpha 0..1. */
  fade: number;
  /** Screen-plane offset (world units along the camera's right / up): hops, recoil. */
  offX: number;
  offY: number;
  /** Lean in the screen plane (radians, + = the top toward screen right). */
  lean: number;
  /** Facing: 1 = as drawn (right), −1 = mirrored. */
  flip: number;
  /** Re-ink pulse 0..1 (placement). */
  ink: number;
  /** Colours frozen while the figure smokes away (a conquest recolours the tile under it). */
  frozen: { blot: RGB; deep: RGB } | null;
  pendingColor: { blot: RGB; deep: RGB } | null;
  ver: Record<string, number>;
  seed: number;
  /** World position of the feet, refreshed by update(). */
  top: THREE.Vector3;
  plaque: THREE.Vector3;
  figTop: THREE.Vector3;
  halfW: number;
}

interface Traveler extends TokenTraveler {
  blotC: RGB;
  deep: RGB;
  pts: THREE.Vector3[];
  cum: number[];
  t: number;
  steps: number;
  flip: number;
  seed: number;
}

interface Dot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Fall height (world y above the paper at t = 0). */
  h: number;
  r: number;
  t: number;
  ms: number;
  delay: number;
  kind: 'place' | 'splash';
  color: RGB;
  alive: boolean;
}

// ---------------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------------

const FIG_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUV;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec2 iOff;
varying vec2 vSt;
varying vec4 vUV;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float smoke = iA.z;
  float grow = 1.0 + 1.3 * smoke;
  float widen = 1.0 + 0.6 * smoke;
  vSt = vec2(position.x + 0.5, position.y * grow);
  vec2 p = vec2(position.x * iSize.x * widen, position.y * grow * iSize.y);
  float c = cos(iB.x);
  float s = sin(iB.x);
  p = vec2(p.x * c + p.y * s, -p.x * s + p.y * c);
  vec3 w = iPos + right * (p.x + iOff.x) + up * (p.y + iOff.y);
  vUV = iUV;
  vA = iA;
  vB = iB;
  vC = iC;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const FIG_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform sampler2D uNoise;
uniform sampler2D uSmoke;
uniform float uSmokeOn;
uniform vec3 uIvory;
varying vec2 vSt;
varying vec4 vUV;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;
float nrm(float v) { return clamp((v - 0.22) * 1.8, 0.0, 1.0); }
void main() {
  float smoke = vA.z;
  float seed = vB.w;
  vec2 sp = vec2((vSt.x - 0.5) * (1.0 + 0.6 * smoke) + 0.5, vSt.y);
  vec2 sc = vec2(sp.x * 0.5 + seed, sp.y * 0.4 - smoke * 0.45 + seed * 0.37);
  vec4 nz = texture2D(uNoise, sc);
  if (smoke > 0.0 && uSmokeOn > 0.5) {
    // real ink in water (the smoke map): rise, curl and the thinning edge from three taps of it
    nz.r = texture2D(uSmoke, sc).r;
    nz.g = texture2D(uSmoke, sc * vec2(1.0, 0.8) + vec2(0.37, 0.61)).r;
    nz.b = texture2D(uSmoke, sc * 1.6 + vec2(0.71, 0.13)).r;
  }
  if (smoke > 0.0) {
    // the ink lifts off the paper as smoke: every part rises (the top most), curling as it goes
    float rise = smoke * (0.4 + 0.95 * nrm(nz.r)) * (0.3 + 0.7 * clamp(sp.y, 0.0, 1.3));
    sp.y -= rise;
    sp.x += (nrm(nz.g) - 0.5) * 0.9 * smoke * (0.15 + sp.y);
  }
  if (sp.x < 0.0 || sp.x > 1.0 || sp.y < 0.0 || sp.y > 1.0) discard;
  float fx = vB.y < 0.0 ? 1.0 - sp.x : sp.x;
  vec2 uv = vec2(mix(vUV.x, vUV.z, fx), mix(vUV.y, vUV.w, sp.y));
  vec4 tex = texture2D(uAtlas, uv);
  float a = tex.a;
  if (a < 0.02) discard;
  vec3 rgb = tex.rgb / max(a, 0.001);
  float L = dot(rgb, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(0.2, 0.8, L);
  vec3 deep = vC.rgb * 0.38 + vec3(0.012, 0.016, 0.03);
  vec3 ivory = uIvory * (1.0 + 0.07 * vB.z);
  deep *= 1.0 - 0.35 * vB.z;
  vec3 col = mix(deep, ivory, k);
  // drawn in, feet → head, with a bristled front
  float rv = vA.y;
  if (rv < 0.999) {
    float rn = texture2D(uNoise, vec2(sp.x * 1.3 + seed * 3.1, sp.y * 0.35 + seed)).b;
    float front = rv * 1.2 - 0.1;
    a *= 1.0 - smoothstep(front - 0.07, front, sp.y + (nrm(rn) - 0.5) * 0.18);
  }
  // dries out in patches (the figure being replaced)
  float dry = vA.w;
  if (dry > 0.0) {
    float dn = nrm(texture2D(uNoise, vec2(sp.x * 0.9 + seed * 1.7, sp.y * 0.8)).a);
    a *= smoothstep(dry * 1.15 - 0.15, dry * 1.15, dn * 0.8 + 0.2 * (1.0 - sp.y)) * (1.0 - 0.35 * dry);
  }
  // smoke thins and pales as it lifts
  if (smoke > 0.0) {
    float e = nrm(nz.b);
    a *= smoothstep(smoke * 0.95 - 0.3, smoke * 0.95, e * 0.7 + 0.3 * (1.0 - vSt.y / (1.0 + 1.3 * smoke)));
    a *= 1.0 - smoke * smoke * 0.75;
    col = mix(col, vec3(0.8, 0.79, 0.76), min(1.0, smoke * 1.3) * 0.85);
  }
  float dim = min(vC.w, 1.0);
  a *= vA.x * (1.0 - 0.12 * dim);
  col *= 1.0 - 0.15 * dim;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

/** The blot under a figure and the ink dots (placement, splash): flat soft ink on the paper. */
const BLOT_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iR;
attribute vec4 iCol;
attribute vec2 iK;
varying vec2 vP;
varying vec4 vCol;
varying vec2 vK;
void main() {
  vP = position.xy * 2.0;
  vCol = iCol;
  vK = iK;
  vec3 w = iPos + vec3(position.x * 2.0 * iR.x, 0.0, -position.y * 2.0 * iR.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const BLOT_FRAG = /* glsl */ `
uniform sampler2D uNoise;
varying vec2 vP;
varying vec4 vCol;
varying vec2 vK;
float nrm(float v) { return clamp((v - 0.22) * 1.8, 0.0, 1.0); }
void main() {
  float seed = vK.y;
  float d = length(vP);
  float a;
  if (vK.x < 0.5) {
    // a blot: a soft pool, ragged at the edge, pigment gathered toward the back (behind the feet)
    vec4 n = texture2D(uNoise, vP * 0.22 + seed);
    float edge = d + (nrm(n.g) - 0.5) * 0.42 + (nrm(n.a) - 0.5) * 0.14;
    a = 1.0 - smoothstep(0.52, 0.98, edge);
    a *= 0.72 + 0.28 * nrm(n.r);
    a *= 0.85 + 0.15 * smoothstep(-0.9, 0.4, vP.y);
  } else {
    // an ink dot: round, a slightly darker rim as it soaks
    vec4 n = texture2D(uNoise, vP * 0.35 + seed);
    float edge = d + (nrm(n.a) - 0.5) * 0.3;
    a = 1.0 - smoothstep(0.7, 1.0, edge);
    a *= 0.8 + 0.2 * smoothstep(0.4, 0.9, edge);
  }
  a *= vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * a, a);
}
`;

class Instanced {
  geo: THREE.InstancedBufferGeometry;
  attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  mesh: THREE.Mesh;
  k = 0;
  constructor(
    base: THREE.BufferGeometry,
    spec: Record<string, number>,
    private cap: number,
    mat: THREE.Material,
  ) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    for (const [name, size] of Object.entries(spec)) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.attrs[name] = a;
      this.geo.setAttribute(name, a);
    }
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }
  /** Start writing instance `k` (returns false when full). */
  next(): boolean {
    return this.k < this.cap;
  }
  set(name: string, ...v: number[]): void {
    const a = this.attrs[name];
    const arr = a.array as Float32Array;
    const o = this.k * a.itemSize;
    for (let i = 0; i < v.length; i++) arr[o + i] = v[i];
  }
  push(): void {
    this.k++;
  }
  commit(): void {
    this.geo.instanceCount = this.k;
    for (const a of Object.values(this.attrs)) {
      a.needsUpdate = true;
      a.addUpdateRange(0, this.k * a.itemSize);
    }
    this.k = 0;
  }
  dispose(): void {
    this.geo.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};

/** A gentle bow between two points (to the stroke's left), as the attack arrow draws it (fx.ts `bow`). */
function bowPts(a: THREE.Vector3, b: THREE.Vector3, k: number, n = 24): THREE.Vector3[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const cx = (a.x + b.x) / 2 - (dz / len) * len * k;
  const cz = (a.z + b.z) / 2 + (dx / len) * len * k;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    out.push(new THREE.Vector3(m * m * a.x + 2 * m * t * cx + t * t * b.x, a.y + (b.y - a.y) * t, m * m * a.z + 2 * m * t * cz + t * t * b.z));
  }
  return out;
}

export class TokenSystem {
  group = new THREE.Group();
  private figs: Instanced;
  private blots: Instanced;
  private figMat: THREE.ShaderMaterial;
  private blotMat: THREE.ShaderMaterial;
  private atlas: THREE.Texture | null = null;
  /** Resolves once the sprite atlas has loaded (the board waits for it before its first frame). */
  ready: Promise<void>;
  /** Figure height / half-width (board units, at size scale 1) per denomination. */
  readonly figH = FIG_H;
  readonly figHalfW = FIG_H.map((h, i) => (h * ASPECT[i]) / 2);
  private toks = new Map<TerritoryId, Tok>();
  private list: Tok[] = [];
  private movers: Traveler[] = [];
  private dots: Dot[] = [];
  private dirty = true;
  materials: THREE.Material[] = [];
  /** Size multiplier from the UI text size (bigger numbers need a bigger figure). */
  sizeScale = 1;
  /** Phones: figures a little larger than their share of the map, so they stay legible. */
  figBoost = 1;
  /** Reduced motion: counts change in place — figures fade in / out, no hops, leans, smoke or dots. */
  reduced = false;
  /** Camera azimuth / pitch (deg): the figures face the camera; this orders them and places the rings. */
  private camAz = 0;
  private camPitch = 80;
  private right = new THREE.Vector3(1, 0, 0);
  private up = new THREE.Vector3(0, 0.17, -0.98);
  private p = new THREE.Vector3();
  private last = new Float32Array(0);
  private order: Tok[] = [];
  /** Called when placed ink first touches the blot (number re-ink, sound). */
  onContact: ((id: TerritoryId) => void) | null = null;

  constructor(
    private anim: Animator,
    private tiles: TileSet,
    noise?: THREE.Texture,
  ) {
    this.figMat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: null },
        uNoise: { value: noise ?? null },
        uSmoke: { value: null },
        uSmokeOn: { value: 0 },
        uIvory: { value: new THREE.Vector3(IVORY_RGB[0], IVORY_RGB[1], IVORY_RGB[2]) },
      },
      vertexShader: FIG_VERT,
      fragmentShader: FIG_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blotMat = new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: noise ?? null } },
      vertexShader: BLOT_VERT,
      fragmentShader: BLOT_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(this.figMat, this.blotMat);
    // The smoke pigment (Phase 0); until it lands (or if it fails) the smoke curls with the value noise.
    if (typeof document !== 'undefined')
      loadInkMap('smoke-512.webp', { repeat: true }, (t) => {
        this.figMat.uniforms.uSmoke.value = t;
        this.figMat.uniforms.uSmokeOn.value = 1;
        this.dirty = true;
      });
    const figQuad = new THREE.PlaneGeometry(1, 1);
    figQuad.translate(0, 0.5, 0);
    this.figs = new Instanced(figQuad, { iPos: 3, iSize: 2, iUV: 4, iA: 4, iB: 4, iC: 4, iOff: 2 }, FIG_CAP, this.figMat);
    const blotQuad = new THREE.PlaneGeometry(1, 1);
    this.blots = new Instanced(blotQuad, { iPos: 3, iR: 3, iCol: 4, iK: 2 }, BLOT_CAP, this.blotMat);
    // Drawn over the paper and the washes (depth test off: the board is flat), the figures after their
    // blots and before the gold stroke (renderOrder 20).
    this.blots.mesh.renderOrder = 8;
    this.figs.mesh.renderOrder = 9;
    this.group.add(this.blots.mesh, this.figs.mesh);

    this.ready = new Promise<void>((resolve) => {
      const base = (import.meta.env?.BASE_URL as string | undefined) ?? './';
      new THREE.TextureLoader().load(
        `${base}units/atlas.webp`,
        (tex) => {
          tex.colorSpace = THREE.NoColorSpace;
          tex.premultiplyAlpha = true;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = 4;
          tex.flipY = true;
          tex.needsUpdate = true;
          this.atlas = tex;
          this.figMat.uniforms.uAtlas.value = tex;
          this.dirty = true;
          resolve();
        },
        undefined,
        () => {
          console.warn('[render] unit atlas failed to load');
          resolve();
        },
      );
    });

    for (const id of TERRITORY_IDS) {
      const a = tiles.get(id).anchorW;
      const t: Tok = {
        id,
        blot: [0.4, 0.4, 0.4],
        deep: [0.3, 0.3, 0.3],
        n: 0,
        denom: 0,
        scale: 0,
        reveal: 1,
        old: null,
        smoke: 0,
        puff: 0,
        fade: 1,
        offX: 0,
        offY: 0,
        lean: 0,
        flip: 1,
        ink: 0,
        frozen: null,
        pendingColor: null,
        ver: {},
        seed: hash(id),
        top: a.clone(),
        plaque: a.clone(),
        figTop: a.clone(),
        halfW: TOKEN_R,
      };
      this.toks.set(id, t);
      this.list.push(t);
    }
    this.order = [...this.list];
    this.last = new Float32Array(this.list.length * 4);
  }

  /** Blot radius (board units) at the current UI scale — the piece's nominal radius. */
  get radius(): number {
    return TOKEN_R * this.sizeScale;
  }
  private get figScale(): number {
    return this.sizeScale * this.figBoost;
  }

  get travelers(): readonly TokenTraveler[] {
    return this.movers;
  }

  get animating(): boolean {
    return this.movers.length > 0 || this.dots.length > 0;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Instance data waits for the next update() (the render-on-demand loop must draw). */
  get needsUpdate(): boolean {
    return this.dirty;
  }

  /** The camera pose the figures face (deg). Cheap; only re-lays out on change. */
  setView(azDeg: number, pitchDeg: number): void {
    if (Math.abs(azDeg - this.camAz) < 0.01 && Math.abs(pitchDeg - this.camPitch) < 0.01) return;
    this.camAz = azDeg;
    this.camPitch = pitchDeg;
    const az = (azDeg * Math.PI) / 180;
    const pr = (pitchDeg * Math.PI) / 180;
    this.right.set(Math.cos(az), 0, -Math.sin(az));
    this.up.set(-Math.sin(az) * Math.sin(pr), Math.cos(pr), -Math.cos(az) * Math.sin(pr));
    this.dirty = true;
  }

  /** The blot: the owner's wash, deepened, so the ivory figure has ground on its own tile. */
  static fill(tile: RGB): RGB {
    return deepOf(tile);
  }
  /** Kept for callers of the old API: the figure's dark ink is the owner's deep colour. */
  static paint(tile: RGB): RGB {
    return deepOf(tile);
  }

  setColor(id: TerritoryId, tileColor: RGB): void {
    const t = this.toks.get(id)!;
    const d = deepOf(tileColor);
    const c = { blot: d, deep: d };
    if (t.frozen) t.pendingColor = c;
    else {
      t.blot = c.blot;
      t.deep = c.deep;
    }
    this.dirty = true;
  }

  /** Where a territory's figure stands on the paper (world, un-lifted): the strokes run between these. */
  feet(id: TerritoryId, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.tiles.get(id).anchorW;
    return out.set(a.x - FIG_SHIFT * this.figScale, TILE_TOP, a.z);
  }

  /** The figure's feet (world), refreshed each frame. */
  top(id: TerritoryId): THREE.Vector3 {
    return this.toks.get(id)!.top;
  }
  /** Where the count ring hangs from (world): the feet; the overlay sets it beside the figure on screen. */
  plaquePoint(id: TerritoryId): THREE.Vector3 {
    return this.toks.get(id)!.plaque;
  }
  /** Top of the figure (world). */
  figTop(id: TerritoryId): THREE.Vector3 {
    return this.toks.get(id)!.figTop;
  }
  /** Half the figure's width (world units, at rest). */
  halfWidth(id: TerritoryId): number {
    return this.toks.get(id)!.halfW;
  }
  denom(id: TerritoryId): Denom {
    return this.toks.get(id)!.denom;
  }
  /** Facing (1 = right, −1 = left). */
  facing(id: TerritoryId): number {
    return this.toks.get(id)!.flip;
  }
  /** Drawn presence (for the ring): 0 = hidden. The ring stays while the figure smokes, then goes. */
  visual(id: TerritoryId): number {
    const t = this.toks.get(id)!;
    return t.scale * Math.min(1, t.fade * 1.4) * (t.smoke > 0.5 ? Math.max(0, 1 - (t.smoke - 0.5) * 2) : 1);
  }
  /** Fresh anchor on the tile (not last frame's), for getScreenPosition: always on the territory's own tile. */
  freshTop(id: TerritoryId, out: THREE.Vector3): THREE.Vector3 {
    const tile = this.tiles.get(id);
    return out.set(tile.anchorW.x, tile.pivot.position.y + TILE_TOP, tile.anchorW.z);
  }

  /**
   * World points bounding every piece at the home camera (azimuth 0, `pitchDeg`), four per piece — the
   * figure's top first (camera.ts gives figures their own clearance), then its left and right, then the
   * lowest point of the piece (`plaqueUnits` below the feet: the ring and the blot). For the home fit.
   */
  extentPoints(pitchDeg: number, plaqueUnits: number, denom: Denom | null = null, ringUnits = 2.4 * this.sizeScale): number[][] {
    const pr = (pitchDeg * Math.PI) / 180;
    const ux = 0;
    const uy = Math.cos(pr);
    const uz = -Math.sin(pr);
    const k = this.figScale;
    const tallest = denom ?? 0; // the soldier is the tallest figure, the cannon the widest
    const h = FIG_H[tallest] * k;
    const hw = FIG_H[2] * ASPECT[2] * 0.5 * k;
    const ring = ringUnits; // the ring beside the figure (~30 px at the 1440 home)
    const out: number[][] = [];
    for (const t of this.list) {
      const a = this.tiles.get(t.id).anchorW;
      const fx = a.x - FIG_SHIFT * k;
      const y0 = TILE_TOP;
      out.push([fx + ux * h, y0 + uy * h, a.z + uz * h]);
      out.push([fx - hw, y0, a.z], [fx + hw + ring, y0, a.z]);
      out.push([a.x, y0 - uy * plaqueUnits, a.z - uz * plaqueUnits]);
    }
    return out;
  }

  private tw(t: Tok, key: string, o: { ms: number; ease?: (v: number) => number; run?: Run | null; delay?: number; update: (v: number) => void; done?: () => void }): Promise<void> {
    const ver = (t.ver[key] = (t.ver[key] ?? 0) + 1);
    return this.anim.tween({
      ms: o.ms,
      ease: o.ease ?? ease.linear,
      run: o.run ?? null,
      delay: o.delay,
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
    t.reveal = 1;
    t.old = null;
    t.smoke = 0;
    t.puff = 0;
    t.fade = 1;
    t.offX = 0;
    t.offY = 0;
    t.ink = 0;
    this.unfreeze(t);
  }

  private unfreeze(t: Tok): void {
    t.frozen = null;
    if (t.pendingColor) {
      t.blot = t.pendingColor.blot;
      t.deep = t.pendingColor.deep;
      t.pendingColor = null;
    }
  }

  /** Screen-plane direction (right, up components, unit) from territory a toward b. */
  private screenDir(from: TerritoryId, to: TerritoryId | null | undefined): [number, number] {
    if (to && to !== from) {
      const a = this.tiles.get(from).anchorW;
      const b = this.tiles.get(to).anchorW;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const r = dx * this.right.x + dz * this.right.z;
      const u = dx * this.up.x + dz * this.up.z;
      const d = Math.hypot(r, u);
      if (d > 1e-3) return [r / d, u / d];
    }
    return [1, 0];
  }

  /** Turn a figure to face another territory (its last target, or its attacker). */
  face(id: TerritoryId, other: TerritoryId | null): void {
    if (!other) return;
    const t = this.toks.get(id)!;
    const [r] = this.screenDir(id, other);
    if (Math.abs(r) < 0.08) return;
    const f = r < 0 ? -1 : 1;
    if (f !== t.flip) {
      t.flip = f;
      this.dirty = true;
    }
  }

  /**
   * The attack's lean (B §4): both figures turn to face each other and the attacker leans a little toward
   * its target while the dice roll; `on = false` straightens it (140 ms).
   */
  lean(from: TerritoryId, to: TerritoryId, on: boolean): void {
    const t = this.toks.get(from)!;
    this.face(from, to);
    this.face(to, from);
    if (this.reduced || this.anim.instant) {
      t.lean = 0;
      this.dirty = true;
      return;
    }
    const [r] = this.screenDir(from, to);
    const goal = on ? Math.sign(r || 1) * 0.12 : 0;
    const from0 = t.lean;
    this.tw(t, 'lean', { ms: on ? 180 : 140, ease: on ? ease.outCubic : ease.inOutQuad, update: (v) => (t.lean = from0 + (goal - from0) * v) });
  }

  // --- ink dots ------------------------------------------------------------------------------------

  private placeDots(t: Tok, count: number, run: Run | null): number {
    if (this.reduced || this.anim.instant) return 0;
    const alive = this.dots.filter((d) => d.kind === 'place').length;
    const n = Math.max(0, Math.min(count, MAX_PLACE_DOTS - alive, 6));
    const a = this.tiles.get(t.id).anchorW;
    const k = this.figScale;
    const fx = a.x - FIG_SHIFT * k;
    for (let i = 0; i < n; i++) {
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + t.seed * 6.28 + Math.random() * 0.6;
      const rr = (0.25 + Math.random() * 0.55) * TOKEN_R * k;
      this.spawn({
        x: fx + Math.cos(ang) * rr,
        z: a.z + Math.sin(ang) * rr * 0.6,
        y: TILE_TOP,
        vx: 0,
        vz: 0,
        h: 2.6 + Math.random() * 1.2,
        r: (0.2 + Math.random() * 0.1) * k,
        t: 0,
        ms: 300,
        delay: i * 40,
        kind: 'place',
        color: t.deep,
        alive: true,
      });
    }
    void run;
    return n;
  }

  private splash(t: Tok, away: [number, number]): void {
    if (this.reduced || this.anim.instant) return;
    const a = this.tiles.get(t.id).anchorW;
    const k = this.figScale;
    const fx = a.x - FIG_SHIFT * k;
    // world direction of the blow's far side
    const wx = away[0] * this.right.x + away[1] * this.up.x;
    const wz = away[0] * this.right.z + away[1] * this.up.z;
    const wl = Math.hypot(wx, wz) || 1;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const spread = (i / (n - 1) - 0.5) * 1.6 + (Math.random() - 0.5) * 0.4;
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const dx = (wx / wl) * c - (wz / wl) * s;
      const dz = (wx / wl) * s + (wz / wl) * c;
      const sp = (1.1 + Math.random() * 1.2) * k;
      this.spawn({
        x: fx + dx * 0.25 * k,
        z: a.z + dz * 0.25 * k + FIG_H[t.denom] * k * 0.12,
        y: TILE_TOP,
        vx: dx * sp,
        vz: dz * sp,
        h: 0,
        r: (0.07 + Math.random() * 0.09) * k,
        t: 0,
        ms: 300,
        delay: 0,
        kind: 'splash',
        color: [t.deep[0] * 0.55, t.deep[1] * 0.55, t.deep[2] * 0.6],
        alive: true,
      });
    }
  }

  private spawn(d: Dot): void {
    if (this.dots.length >= MAX_DOTS) return;
    this.dots.push(d);
    this.dirty = true;
    void this.anim.tween({
      ms: d.ms + d.delay,
      ease: ease.linear,
      update: (_v, raw) => {
        const tms = raw * (d.ms + d.delay);
        d.t = Math.max(0, (tms - d.delay) / d.ms);
        this.dirty = true;
      },
      done: () => {
        d.alive = false;
        this.dots = this.dots.filter((x) => x !== d);
        this.dirty = true;
      },
    });
  }

  /**
   * Change a territory's count. mode:
   * - 'snap'  no motion (sync, deal)
   * - 'drop'  placement: ink dots fall and soak; a new figure is drawn in, an existing one re-inks and hops
   * - 'lift'  armies leave (march start / unplace): a small lift, or it dries away if it empties
   * - 'hit'   dice losses: a recoil away from `other` and a tiny splash; at 0 it dissolves as smoke
   * - 'land'  a traveller arrived: a settle step (appears at once if the tile was empty)
   * - 'out'   leave the board (conquered): smoke, if the figure is still standing
   */
  setArmies(
    id: TerritoryId,
    n: number,
    mode: 'snap' | 'drop' | 'lift' | 'hit' | 'land' | 'out',
    run: Run | null = null,
    other: TerritoryId | null = null,
  ): void {
    const t = this.toks.get(id)!;
    const wasShown = t.scale > 0.5 && t.n > 0 && t.smoke < 0.05;
    const prevN = t.n;
    const prevDenom = t.denom;
    t.n = n;
    const nextDenom = n > 0 ? denomOf(n) : prevDenom;
    this.dirty = true;
    const instant = this.anim.instant || (run && run.skipped);
    if (mode === 'snap' || instant) {
      this.cancel(t, ['scale', 'reveal', 'old', 'smoke', 'fade', 'off', 'ink', 'lean', 'puff']);
      this.rest(t);
      t.lean = 0;
      t.scale = n > 0 ? 1 : 0;
      t.denom = nextDenom;
      if (mode === 'drop' && instant) this.onContact?.(id);
      return;
    }
    if (this.reduced) {
      // Steady: the figure fades in / out, and a new denomination crossfades over the old. No motion.
      if (mode === 'drop') this.onContact?.(id);
      this.cancel(t, ['off', 'ink', 'lean', 'smoke', 'reveal']);
      t.offX = t.offY = t.lean = t.ink = t.smoke = 0;
      t.reveal = 1;
      if (n <= 0 || mode === 'out') {
        if (t.scale <= 0.001) return;
        t.frozen = t.frozen ?? { blot: t.blot, deep: t.deep };
        const from = t.fade;
        this.tw(t, 'fade', {
          ms: 150,
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
        this.cancel(t, ['old']);
        t.old = null;
        t.denom = nextDenom;
        t.scale = 1;
        t.fade = 0;
        this.unfreeze(t);
        this.tw(t, 'fade', { ms: 150, run, update: (v) => (t.fade = v), done: () => (t.fade = 1) });
        return;
      }
      if (nextDenom !== prevDenom) {
        t.old = { denom: prevDenom, dry: 0 };
        t.denom = nextDenom;
        t.reveal = 0;
        this.tw(t, 'old', {
          ms: 150,
          run,
          update: (v) => {
            if (t.old) t.old.dry = v;
            t.reveal = v;
          },
          done: () => {
            t.old = null;
            t.reveal = 1;
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
      this.cancel(t, ['old', 'ink', 'puff']);
      t.puff = 0;
      t.old = null;
      t.ink = 0;
      t.frozen = t.frozen ?? { blot: t.blot, deep: t.deep };
      if (mode === 'hit' || mode === 'out') {
        if (t.smoke > 0) return; // already smoking
        // The fall (B §4 "defender falls", 320 ms): a last recoil, then the figure lifts off as ink smoke.
        if (mode === 'hit' && other) this.splash(t, this.screenDir(other, id));
        this.cancel(t, ['fade', 'reveal']);
        t.reveal = 1;
        t.fade = 1;
        this.tw(t, 'smoke', {
          ms: 420,
          ease: ease.outQuad,
          run,
          update: (v) => (t.smoke = v * 1.02),
          done: () => {
            this.cancel(t, ['off', 'lean']);
            t.scale = 0;
            t.smoke = 0;
            t.offX = t.offY = t.lean = 0;
            this.unfreeze(t);
          },
        });
        return;
      }
      // lift away (unplace / everything marched out): the figure dries off the paper
      const from = t.fade;
      this.tw(t, 'fade', {
        ms: 170,
        ease: ease.inQuad,
        run,
        update: (v) => {
          t.fade = from * (1 - v);
          t.offY = 0.3 * v;
        },
        done: () => {
          t.scale = 0;
          t.offY = 0;
          t.fade = 1;
          this.unfreeze(t);
        },
      });
      return;
    }
    // n > 0 from here
    if (!wasShown) {
      // Appear: drawn in feet → head (placement), or at once (a traveller became it).
      this.cancel(t, ['scale', 'smoke', 'fade', 'old', 'reveal', 'off', 'lean', 'puff']);
      this.rest(t);
      t.lean = 0;
      t.denom = nextDenom;
      t.scale = 1;
      if (mode === 'drop') {
        const dots = this.placeDots(t, Math.max(1, n - prevN), run);
        t.reveal = 0;
        this.tw(t, 'reveal', { ms: 280, delay: dots ? 90 : 0, ease: (x) => 1 - Math.pow(1 - x, 1.6), run, update: (v) => (t.reveal = v) });
        const touch = () => this.onContact?.(id);
        if (dots) void this.anim.wait(120, run).then(touch);
        else touch();
      } else if (mode === 'land') this.step(t, run, 0.22);
      return;
    }
    this.cancel(t, ['scale']);
    t.scale = 1;
    if (t.smoke > 0) {
      // a figure mid-fall came back (a drift correction): stand it up
      this.cancel(t, ['smoke', 'fade']);
      t.smoke = 0;
      t.fade = 1;
      this.unfreeze(t);
    }
    if (nextDenom !== prevDenom) this.swap(t, prevDenom, nextDenom, run);
    switch (mode) {
      case 'drop': {
        const dots = this.placeDots(t, Math.max(1, n - prevN), run);
        const reink = () => {
          this.onContact?.(id);
          this.tw(t, 'ink', { ms: 300, update: (v) => (t.ink = Math.sin(v * Math.PI) * (1 - v * 0.3)), done: () => (t.ink = 0) });
          if (nextDenom === prevDenom) this.step(t, run, 0.24);
        };
        if (dots) void this.anim.wait(120, run).then(reink);
        else reink();
        break;
      }
      case 'lift':
        this.step(t, run, 0.2);
        break;
      case 'hit': {
        // recoil: knocked back away from the blow, a tiny splash, and back
        const [r, u] = this.screenDir(other ?? id, id);
        this.splash(t, [r, u]);
        const k = this.figScale;
        this.tw(t, 'off', {
          ms: 260,
          ease: ease.linear,
          update: (v) => {
            const e = v < 0.25 ? ease.outQuad(v / 0.25) : 1 - ease.inOutQuad((v - 0.25) / 0.75);
            t.offX = r * 0.32 * k * e;
            t.offY = u * 0.2 * k * e;
          },
          done: () => {
            t.offX = 0;
            t.offY = 0;
          },
        });
        const l0 = t.lean;
        const back = (r >= 0 ? 1 : -1) * 0.16;
        this.tw(t, 'lean', {
          ms: 260,
          update: (v) => (t.lean = l0 * (1 - v) + back * Math.sin(Math.min(1, v * 1.4) * Math.PI) * (1 - v * 0.4)),
          done: () => (t.lean = 0),
        });
        break;
      }
      case 'land':
        this.step(t, run, 0.18);
        break;
    }
  }

  /**
   * The verdict's puff (INK2 §2.2): a side that lost a die breathes out a little ink smoke over the
   * verdict's `ms` (0 → 0.3 → 0) and settles. A figure that is falling (or gone) keeps its dissolve.
   * Reduced motion: none.
   */
  puff(id: TerritoryId, ms: number, run: Run | null = null): void {
    const t = this.toks.get(id);
    if (!t || this.reduced || this.anim.instant || (run && run.skipped)) return;
    if (t.n <= 0 || t.scale <= 0.001 || t.smoke > 0) return;
    this.tw(t, 'puff', {
      ms,
      ease: ease.linear,
      run,
      update: (v) => (t.puff = 0.3 * Math.sin(Math.PI * Math.min(1, v)) * (v < 0.5 ? 1 : 1 - 0.15 * (v - 0.5))),
      done: () => (t.puff = 0),
    });
  }

  /** Denomination change: the old figure dries out (160) as the new one is drawn in, feet → head (280). */
  private swap(t: Tok, from: Denom, to: Denom, run: Run | null): void {
    t.old = { denom: from, dry: 0 };
    t.denom = to;
    t.reveal = 0;
    this.tw(t, 'old', {
      ms: 160,
      ease: ease.inQuad,
      run,
      update: (v) => {
        if (t.old) t.old.dry = v;
      },
      done: () => (t.old = null),
    });
    this.tw(t, 'reveal', { ms: 280, delay: 90, ease: (x) => 1 - Math.pow(1 - x, 1.6), run, update: (v) => (t.reveal = v), done: () => (t.reveal = 1) });
  }

  /** A small hop (screen up and back). */
  private step(t: Tok, run: Run | null, amt: number): void {
    const k = this.figScale;
    this.tw(t, 'off', {
      ms: 180,
      run,
      update: (v) => {
        t.offY = amt * k * Math.sin(v * Math.PI) * (1 - 0.2 * v);
        t.offX = 0;
      },
      done: () => (t.offY = 0),
    });
  }

  /** A count changed with no motion of its own: the figure re-inks briefly. */
  pop(id: TerritoryId, amt = 0.12): void {
    const t = this.toks.get(id)!;
    if (this.anim.instant || this.reduced || t.scale <= 0) return;
    void amt;
    this.tw(t, 'ink', { ms: 240, update: (v) => (t.ink = 0.8 * Math.sin(v * Math.PI)), done: () => (t.ink = 0) });
  }

  /**
   * A traveller figure carrying `count` walks from a to b — along the attack arrow's bow for a conquest,
   * through `viaIds` for a fortify route. Resolves on arrival. (`arc` < 1 = a route walk, else the arrow.)
   */
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
    const k = this.figScale;
    const at = (id: TerritoryId) => {
      const v = this.tiles.get(id).anchorW.clone();
      v.x -= FIG_SHIFT * k;
      v.y = TILE_TOP;
      return v;
    };
    const a = at(from);
    const b = at(to);
    let pts: THREE.Vector3[];
    if (viaIds.length) pts = [a, ...viaIds.map(at), b];
    else if (arc >= 1) {
      // the conquest walks the arrow: step off the source's figure and walk its bow
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const a2 = a.clone().lerp(b, Math.min(0.3, (0.9 * k) / Math.max(d, 0.001)));
      pts = bowPts(a2, b, 0.14);
    } else pts = [a, b];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const L = cum[cum.length - 1] || 1;
    const denom = denomOf(count);
    const d = deepOf(tileColor);
    const tr: Traveler = {
      n: count,
      ink,
      owner,
      top: a.clone(),
      plaque: a.clone(),
      figTop: a.clone(),
      halfW: this.figHalfW[denom] * k,
      alive: true,
      blotC: d,
      deep: d,
      pts,
      cum,
      t: 0,
      denom,
      steps: Math.max(2, Math.round(L / (0.9 * k))),
      flip: 1,
      seed: Math.random(),
    };
    // it faces where it walks
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    tr.flip = dx * this.right.x + dz * this.right.z < 0 ? -1 : 1;
    this.face(from, to);
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
        const tt = this.toks.get(to)!;
        tt.flip = tr.flip;
        this.dirty = true;
      });
  }

  /** The point `f` (0..1) of the way along the running traveller from `from`, if one is walking. */
  travelerProgress(): number {
    return this.movers.length ? this.movers[this.movers.length - 1].t : 1;
  }

  /** World position on the paper at a figure's feet (for effects). */
  dustPoint(id: TerritoryId, out: THREE.Vector3): THREE.Vector3 {
    const t = this.toks.get(id)!;
    return out.copy(t.top);
  }

  // --- per frame ----------------------------------------------------------------------------------

  private writeFig(pos: THREE.Vector3, denom: Denom, k: number, alpha: number, reveal: number, smoke: number, dry: number, lean: number, flip: number, ink: number, seed: number, deep: RGB, dim: number, offX: number, offY: number): void {
    const f = this.figs;
    if (!f.next() || alpha <= 0.002) return;
    const s = SPRITES[denom];
    const h = FIG_H[denom] * k;
    f.set('iPos', pos.x, pos.y, pos.z);
    f.set('iSize', h * ASPECT[denom], h);
    // texture v runs bottom → top (flipY): the sprite's feet are at its rect's bottom edge
    f.set('iUV', s.x / ATLAS.width, 1 - (s.y + s.h) / ATLAS.height, (s.x + s.w) / ATLAS.width, 1 - s.y / ATLAS.height);
    f.set('iA', alpha, reveal, smoke, dry);
    f.set('iB', lean, flip, ink, seed);
    f.set('iC', deep[0], deep[1], deep[2], dim);
    f.set('iOff', offX, offY);
    f.push();
  }

  private writeBlot(pos: THREE.Vector3, rx: number, rz: number, col: RGB, alpha: number, kind: number, seed: number): void {
    const b = this.blots;
    if (!b.next() || alpha <= 0.002) return;
    b.set('iPos', pos.x, pos.y, pos.z);
    b.set('iR', rx, rz, 0);
    b.set('iCol', col[0], col[1], col[2], alpha);
    b.set('iK', kind, seed);
    b.push();
  }

  /** Write instance data. Cheap; uploads only when something changed. */
  update(): void {
    const L = this.last;
    // Tile lifts and dims move figures without a figure tween: compare against last frame.
    for (let i = 0; i < this.list.length; i++) {
      const tile = this.tiles.get(this.list[i].id);
      const y = tile.pivot.position.y;
      const d = tile.dim;
      const o = i * 4;
      if (L[o] !== y || L[o + 2] !== d) {
        L[o] = y;
        L[o + 2] = d;
        this.dirty = true;
      }
    }
    if (!this.dirty && !this.movers.length && !this.dots.length) return;
    this.dirty = false;
    const k = this.figScale;
    const R = this.radius * this.figBoost;
    const up = this.up;
    // back to front: the far side of the board first (the camera looks toward −(sin az, cos az))
    const az = (this.camAz * Math.PI) / 180;
    const sa = Math.sin(az);
    const ca = Math.cos(az);
    this.order.sort((a, b) => {
      const pa = this.tiles.get(a.id).anchorW;
      const pb = this.tiles.get(b.id).anchorW;
      return pa.x * sa + pa.z * ca - (pb.x * sa + pb.z * ca);
    });
    for (const t of this.order) {
      const tile = this.tiles.get(t.id);
      const a = tile.anchorW;
      const y0 = tile.pivot.position.y + TILE_TOP;
      this.p.set(a.x - FIG_SHIFT * k, y0, a.z);
      const drawn = t.scale > 0.001;
      const colors = t.frozen ?? { blot: t.blot, deep: t.deep };
      const h = FIG_H[t.denom] * k;
      t.top.copy(this.p);
      t.plaque.copy(this.p);
      t.figTop.copy(this.p).addScaledVector(up, drawn ? h : 0.3);
      t.halfW = this.figHalfW[t.denom] * k;
      if (!drawn) continue;
      const dim = tile.dim;
      // the blot: wider for the wider figures, a touch behind the feet; it dries with the smoke
      const bw = Math.max(R * 0.95, t.halfW * 1.15);
      const blotA = 0.62 * t.fade * t.scale * (1 - 0.7 * t.smoke) * (1 - 0.1 * Math.min(1, dim));
      this.writeBlot(this.p, bw, R * 0.62, colors.blot, blotA, 0, t.seed);
      if (t.old) this.writeFig(this.p, t.old.denom, k, t.fade, 1, 0, t.old.dry, t.lean, t.flip, 0, t.seed, colors.deep, dim, t.offX, t.offY);
      this.writeFig(this.p, t.denom, k, t.fade * t.scale, t.reveal, Math.max(t.smoke, t.puff), 0, t.lean, t.flip, t.ink, t.seed, colors.deep, dim, t.offX, t.offY);
    }
    for (const tr of this.movers) {
      const pts = tr.pts;
      const Lt = tr.cum[tr.cum.length - 1] || 1;
      const s = tr.t * Lt;
      let j = 0;
      while (j < pts.length - 2 && tr.cum[j + 1] < s) j++;
      const seg = tr.cum[j + 1] - tr.cum[j] || 1;
      const lt = Math.min(1, Math.max(0, (s - tr.cum[j]) / seg));
      this.p.lerpVectors(pts[j], pts[j + 1], lt);
      this.p.y = TILE_TOP;
      // a light step: a small bob per stride and a lean into the walk
      const ph = tr.t * tr.steps;
      const bob = this.reduced ? 0 : Math.abs(Math.sin(ph * Math.PI)) * 0.16 * k;
      const lean = this.reduced ? 0 : tr.flip * 0.07 * Math.sin(Math.min(1, tr.t * 4) * Math.PI * 0.5) * (1 - tr.t * 0.5);
      tr.top.copy(this.p);
      tr.plaque.copy(this.p);
      tr.figTop.copy(this.p).addScaledVector(up, FIG_H[tr.denom] * k);
      const fadeIn = Math.min(1, tr.t * 8) * Math.min(1, (1 - tr.t) * 12 + 0.4);
      this.writeBlot(this.p, Math.max(R * 0.8, tr.halfW), R * 0.5, tr.blotC, 0.5 * fadeIn, 0, tr.seed);
      this.writeFig(this.p, tr.denom, k, Math.min(1, tr.t * 8), 1, 0, 0, lean, tr.flip, 0, tr.seed, tr.deep, 0, 0, bob);
    }
    for (const d of this.dots) {
      if (d.t <= 0 && d.delay > 0) continue;
      const u = d.t;
      if (d.kind === 'place') {
        // falls (first 40 %: from above, growing sharper as it nears the paper), then soaks and spreads
        const fall = Math.min(1, u / 0.4);
        const soak = Math.max(0, (u - 0.4) / 0.6);
        // it drops from above the figure (screen up) onto the blot
        this.p.set(d.x, d.y, d.z).addScaledVector(this.up, d.h * (1 - ease.inQuad(fall)));
        const r = d.r * (fall < 1 ? 0.85 + 0.15 * fall : 1 + 1.2 * ease.outCubic(soak));
        const alpha = (fall < 1 ? 0.35 + 0.55 * fall : 0.9 * (1 - ease.inQuad(soak))) * 0.95;
        this.writeBlot(this.p, r, r, [d.color[0] * 0.8, d.color[1] * 0.8, d.color[2] * 0.85], alpha, 1, d.x * 0.13);
      } else {
        const e = ease.outCubic(u);
        this.p.set(d.x + d.vx * e * 0.5, d.y, d.z + d.vz * e * 0.5);
        const r = d.r * (1 - 0.3 * u);
        this.writeBlot(this.p, r, r, d.color, 0.9 * (1 - ease.inQuad(u)), 1, d.z * 0.17);
      }
    }
    this.blots.commit();
    this.figs.commit();
  }

  dispose(): void {
    this.figs.dispose();
    this.blots.dispose();
    this.atlas?.dispose();
    for (const m of this.materials) m.dispose();
  }
}
