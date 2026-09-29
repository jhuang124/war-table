// Brush strokes on the board (docs/INK.md B §4, A2): the attack arrow as one gold dry-brush stroke (tip
// first, thick → thin, a brushed wedge for a head), the live stroke that follows a finger or mouse in
// draw-to-attack, and the fortify route as a dotted ink line. They lie flat on the paper; nothing glows.
// (Sea lanes are ink dabs in the ink layer now; dust and ripple rings are cut.)
import * as THREE from 'three';
import type { TerritoryId } from '../engine/types';
import { seaLaneBetween } from '../map';
import { Animator, ease, type Run } from './anim';
import { GOLD, IVORY, TILE_TOP, hexToRgb, toWorld, type RGB } from './util';
import type { TileSet } from './tiles';

const STROKE_Y = TILE_TOP + 0.34;

const BRUSH_VERT = /* glsl */ `
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BRUSH_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uProgress;
uniform float uTail;
uniform float uLen;
uniform float uDots;
uniform float uSeed;
uniform float uDry;
uniform float uDryK;
varying vec2 vUV;
void main() {
  float u = vUV.x;
  float v = vUV.y;
  float s = u * uLen;
  // reveal (tip first): a soft brush front
  float rev = 1.0 - smoothstep(uProgress - 0.012, uProgress + 0.002, u);
  vec4 n = texture2D(uNoise, vec2(s / 7.5 + uSeed, v * 0.17 + 0.5));
  vec4 e = texture2D(uNoise, vec2(s / 2.6 + uSeed * 1.3, 0.21 + v * 0.015));
  float bristle = n.b;
  // ragged, feathered edges
  float halfW = 1.0 - 0.3 * e.g;
  float a = 1.0 - smoothstep(halfW - 0.22, halfW, abs(v));
  // dry streaks: more toward the thin end, and wherever the brush is running out
  float dryness = clamp((0.3 + 0.45 * u + uDry * (1.0 - u)) * uDryK, 0.0, 1.0);
  a *= mix(1.0, smoothstep(0.24, 0.56, bristle), dryness * 0.65);
  // the tail dries first
  if (uTail > 0.0) a *= smoothstep(uTail, uTail + 0.14, u + 0.14 * (bristle - 0.5));
  if (uDots > 0.5) {
    float d = abs(fract(s / 0.46) - 0.5) * 2.0;
    a *= 1.0 - smoothstep(0.38, 0.62, d);
  }
  a *= rev * uOpacity;
  if (a < 0.004) discard;
  vec3 col = uColor * (0.86 + 0.26 * bristle);
  gl_FragColor = vec4(col, a);
}
`;

/** A flat ribbon along a world-space path, drawn by the brush shader. */
class BrushRibbon {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private uv: Float32Array;
  private geo: THREE.BufferGeometry;
  constructor(
    noise: THREE.Texture,
    color: RGB,
    private max = 200,
    dots = false,
  ) {
    this.pos = new Float32Array(max * 2 * 3);
    this.uv = new Float32Array(max * 2 * 2);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aUV', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: noise },
        uColor: { value: new THREE.Vector3(color[0], color[1], color[2]) },
        uOpacity: { value: 1 },
        uProgress: { value: 1 },
        uTail: { value: 0 },
        uLen: { value: 1 },
        uDots: { value: dots ? 1 : 0 },
        uSeed: { value: Math.random() },
        uDry: { value: 0 },
        uDryK: { value: 1 },
      },
      vertexShader: BRUSH_VERT,
      fragmentShader: BRUSH_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  get u(): Record<string, THREE.IUniform> {
    return this.mat.uniforms;
  }

  /** Lay the ribbon along `pts` (world; y ignored → STROKE_Y) with half-width `w(u)` in board units. */
  set(pts: THREE.Vector3[], w: (u: number) => number): number {
    const n = Math.min(this.max, pts.length);
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return 0;
    }
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const L = cum[n - 1] || 1;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const u = cum[i] / L;
      const hw = w(u);
      const nx = -tz * hw;
      const nz = tx * hw;
      const o = i * 6;
      this.pos[o] = pts[i].x + nx;
      this.pos[o + 1] = STROKE_Y;
      this.pos[o + 2] = pts[i].z + nz;
      this.pos[o + 3] = pts[i].x - nx;
      this.pos[o + 4] = STROKE_Y;
      this.pos[o + 5] = pts[i].z - nz;
      const q = i * 4;
      this.uv[q] = u;
      this.uv[q + 1] = 1;
      this.uv[q + 2] = u;
      this.uv[q + 3] = -1;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aUV as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.mat.uniforms.uLen.value = L;
    return L;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    out.push(new THREE.Vector3(m * m * a.x + 2 * m * t * c.x + t * t * b.x, STROKE_Y, m * m * a.z + 2 * m * t * c.z + t * t * b.z));
  }
  return out;
}

/** A gentle bow between two board points (always to the stroke's left), as a brush would arc. */
function bow(a: THREE.Vector3, b: THREE.Vector3, k: number, n = 48): THREE.Vector3[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const c = new THREE.Vector3((a.x + b.x) / 2 - (dz / len) * len * k, STROKE_Y, (a.z + b.z) / 2 + (dx / len) * len * k);
  return bezier(a, c, b, n);
}

// ---------------------------------------------------------------------------
// Attack arrow: one gold dry-brush stroke
// ---------------------------------------------------------------------------

export class AttackArrow {
  group = new THREE.Group();
  /** Reduced motion: the stroke fades in whole (150 ms) instead of drawing tip-first. */
  reduced = false;
  /** Where a territory's figure stands (world); the stroke runs figure to figure. Default: the anchor. */
  anchorOf: ((id: TerritoryId) => THREE.Vector3) | null = null;
  private bodies: BrushRibbon[];
  private head: BrushRibbon;
  private lens: number[] = [0, 0];
  progress = 0;
  key = '';
  private ver = 0;

  constructor(
    private tiles: TileSet,
    private anim: Animator,
    noise: THREE.Texture,
  ) {
    const gold = hexToRgb(GOLD);
    this.bodies = [new BrushRibbon(noise, gold, 80), new BrushRibbon(noise, gold, 80)];
    this.head = new BrushRibbon(noise, gold, 16);
    this.head.u.uDry.value = 0;
    // The armed arrow is the one bright thing on the board: a loaded brush, dry only toward its tail end.
    for (const r of [...this.bodies, this.head]) r.u.uDryK.value = 0.55;
    for (const b of this.bodies) this.group.add(b.mesh);
    this.group.add(this.head.mesh);
    this.group.visible = false;
  }

  get materials(): THREE.Material[] {
    return [...this.bodies.map((b) => b.mat), this.head.mat];
  }

  private build(from: TerritoryId, to: TerritoryId): void {
    const A = (this.anchorOf ? this.anchorOf(from) : this.tiles.get(from).anchorW).clone();
    const B = (this.anchorOf ? this.anchorOf(to) : this.tiles.get(to).anchorW).clone();
    const lane = seaLaneBetween(from, to);
    let curves: THREE.Vector3[][];
    if (lane && lane.wrap) {
      // Off one edge and back in on the other, following the lane.
      const [s1, s2] = lane.segments;
      const edgeOf = (seg: typeof s1) => {
        const p0 = seg[0];
        const p1 = seg[seg.length - 1];
        return Math.abs(p0[0] - 50) > Math.abs(p1[0] - 50) ? p0 : p1;
      };
      const e1 = edgeOf(s1);
      const e2 = edgeOf(s2);
      const [ea, eb] = Math.sign(e1[0] - 50) === Math.sign(A.x) ? [e1, e2] : [e2, e1];
      const EA = toWorld(ea[0] + Math.sign(ea[0] - 50) * 3.2, ea[1], STROKE_Y);
      const EB = toWorld(eb[0] + Math.sign(eb[0] - 50) * 3.2, eb[1], STROKE_Y);
      const B2 = B.clone().lerp(EB, Math.min(0.35, 1.1 / Math.max(1, B.distanceTo(EB))));
      curves = [bow(A, EA, 0.08, 32), bow(EB, B2, 0.08, 32)];
    } else {
      const d = Math.hypot(B.x - A.x, B.z - A.z);
      // start just off the source's figure, stop short of the target's number
      const A2 = A.clone().lerp(B, Math.min(0.3, 0.75 / Math.max(d, 0.001)));
      const B2 = B.clone().lerp(A, Math.min(0.36, 1.45 / Math.max(d, 0.001)));
      curves = [bow(A2, B2, 0.14, 56), []];
    }
    const total = (c: THREE.Vector3[]) => {
      let l = 0;
      for (let i = 1; i < c.length; i++) l += Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z);
      return l;
    };
    const L0 = total(curves[0]);
    const L1 = curves[1].length ? total(curves[1]) : 0;
    const LT = L0 + L1 || 1;
    // thick → thin across the whole stroke (both pieces of a wrapped one)
    const width = (g: number) => 0.46 * (1 - 0.5 * g) * (0.8 + 0.2 * Math.min(1, g * 8));
    this.lens = [L0 / LT, L1 / LT];
    this.bodies[0].set(curves[0], (u) => width((u * L0) / LT));
    if (L1 > 0) this.bodies[1].set(curves[1], (u) => width((L0 + u * L1) / LT));
    else this.bodies[1].set([], () => 0);
    // the head: a brushed wedge along the last stretch, pressed down then flicked off
    const last = curves[1].length ? curves[1] : curves[0];
    const tip = last[last.length - 1];
    const pre = last[Math.max(0, last.length - 4)];
    const dir = new THREE.Vector3(tip.x - pre.x, 0, tip.z - pre.z).normalize();
    const hl = 0.95;
    const hpts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) hpts.push(tip.clone().addScaledVector(dir, -hl * 0.75 + hl * (i / 10)));
    this.head.set(hpts, (u) => 0.6 * Math.pow(Math.max(0, 1 - u), 0.85) * Math.min(1, 0.55 + u * 4));
  }

  private setProgress(p: number): void {
    this.progress = p;
    const [f0, f1] = this.lens;
    this.bodies[0].u.uProgress.value = f0 > 0 ? Math.min(1, p / f0) : 0;
    this.bodies[1].u.uProgress.value = f1 > 0 ? Math.max(0, Math.min(1, (p - f0) / f1)) : 0;
    this.head.u.uProgress.value = Math.max(0, Math.min(1, (p - 0.86) / 0.14)) * 1.02;
  }

  private setDry(tail: number, opacity: number): void {
    for (const r of [...this.bodies, this.head]) {
      r.u.uTail.value = tail;
      r.u.uOpacity.value = opacity;
    }
  }

  /** Draw the stroke (tip first, `growMs`), from `startAt` of the way if given. Colour is always the gold. */
  show(from: TerritoryId, to: TerritoryId, _color?: RGB, run: Run | null = null, growMs = 260, startAt = 0): Promise<void> {
    const key = `${from}|${to}`;
    if (this.key === key && this.group.visible && this.progress >= 1) {
      this.setDry(0, 1);
      return Promise.resolve();
    }
    const same = this.key === key && this.group.visible;
    this.key = key;
    this.build(from, to);
    this.group.visible = true;
    this.setDry(0, 1);
    const ver = ++this.ver;
    const start = same ? Math.min(this.progress, 1) : startAt;
    if (this.reduced && !same) {
      this.setProgress(1);
      this.setDry(0, 0);
      return this.anim.tween({
        ms: 150,
        ease: ease.outQuad,
        run,
        update: (v) => {
          if (ver === this.ver) this.setDry(0, v);
        },
      });
    }
    this.setProgress(start);
    return this.anim.tween({
      ms: growMs,
      ease: (t) => 1 - Math.pow(1 - t, 2.4),
      run,
      update: (v) => {
        if (ver !== this.ver) return;
        this.setProgress(start + (1 - start) * v);
      },
    });
  }

  private gold = 1;
  private inkVer = 0;
  /**
   * Gold while the fight is in flight (the stroke, the dice deciding); ivory at rest, when the armed
   * arrow waits and the commit button holds the one gold (INK B2.1 / A9). `ms` 0 = at once.
   */
  ink(gold: boolean, ms = 200): void {
    const to = gold ? 1 : 0;
    const ver = ++this.inkVer;
    const G = hexToRgb(GOLD);
    const I = hexToRgb(IVORY);
    const apply = (g: number) => {
      this.gold = g;
      for (const r of [...this.bodies, this.head]) {
        const c = r.u.uColor.value as THREE.Vector3;
        c.set(I[0] + (G[0] - I[0]) * g, I[1] + (G[1] - I[1]) * g, I[2] + (G[2] - I[2]) * g);
      }
    };
    if (ms <= 0 || this.anim.instant || !this.group.visible || this.reduced) return apply(to);
    const from = this.gold;
    if (from === to) return;
    void this.anim.tween({
      ms,
      ease: ease.outQuad,
      update: (v) => {
        if (ver === this.inkVer) apply(from + (to - from) * v);
      },
    });
  }

  /** The tail dries up to `v` (0..1 of the stroke) — the conquest's traveller walking it. */
  trail(v: number): void {
    if (!this.group.visible) return;
    for (const r of [...this.bodies, this.head]) r.u.uTail.value = Math.max(r.u.uTail.value, v);
  }

  /** Dry out from the tail (140 ms). */
  hide(immediate = false): void {
    if (!this.group.visible) return;
    this.key = '';
    const ver = ++this.ver;
    if (immediate || this.anim.instant) {
      this.group.visible = false;
      this.progress = 0;
      return;
    }
    this.anim.tween({
      ms: 140,
      ease: ease.inQuad,
      update: (v) => {
        if (ver !== this.ver) return;
        this.setDry(v * 1.05, 1 - v * 0.6);
      },
      done: () => {
        if (ver === this.ver) {
          this.group.visible = false;
          this.progress = 0;
        }
      },
    });
  }

  dispose(): void {
    for (const b of this.bodies) b.dispose();
    this.head.dispose();
  }
}

// ---------------------------------------------------------------------------
// Draw-to-attack: the live stroke under the pointer (docs/INK.md A2)
// ---------------------------------------------------------------------------

export class LiveStroke {
  group = new THREE.Group();
  private body: BrushRibbon;
  private pts: THREE.Vector3[] = [];
  active = false;
  private ver = 0;
  private startedAt = 0;

  constructor(
    private anim: Animator,
    noise: THREE.Texture,
  ) {
    this.body = new BrushRibbon(noise, hexToRgb(GOLD), 200);
    this.group.add(this.body.mesh);
    this.group.visible = false;
  }

  get materials(): THREE.Material[] {
    return [this.body.mat];
  }

  begin(at: THREE.Vector3): void {
    ++this.ver;
    this.active = true;
    this.pts = [new THREE.Vector3(at.x, STROKE_Y, at.z)];
    this.startedAt = performance.now();
    this.body.u.uTail.value = 0;
    this.body.u.uOpacity.value = 1;
    this.body.u.uProgress.value = 1.02;
    this.body.u.uDry.value = 0;
    this.body.u.uSeed.value = Math.random();
    this.body.set([], () => 0);
    this.group.visible = true;
    // The brush touches down (80 ms) as the HUD's gold steps aside: one gold, never two at once.
    if (!this.anim.instant) {
      const ver = this.ver;
      this.body.u.uOpacity.value = 0;
      this.anim.tween({
        ms: 80,
        unscaled: true,
        ease: ease.outQuad,
        update: (v) => {
          if (ver === this.ver && this.active) this.body.u.uOpacity.value = v;
        },
      });
    }
  }

  /** Extend to a new pointer point on the board (world). */
  move(p: THREE.Vector3): void {
    if (!this.active) return;
    const last = this.pts[this.pts.length - 1];
    const d = Math.hypot(p.x - last.x, p.z - last.z);
    if (d < 0.12) return;
    // fill long jumps so the ribbon bends smoothly
    const steps = Math.min(12, Math.ceil(d / 0.35));
    for (let i = 1; i <= steps; i++) this.pts.push(new THREE.Vector3(last.x + ((p.x - last.x) * i) / steps, STROKE_Y, last.z + ((p.z - last.z) * i) / steps));
    // keep it bounded: thin out the oldest points
    while (this.pts.length > 190) this.pts.splice(1, 2);
    this.rebuild();
  }

  private rebuild(): void {
    // one Chaikin pass smooths the hand's wobble
    const src = this.pts;
    let pts = src;
    if (src.length > 3) {
      pts = [src[0]];
      for (let i = 0; i < src.length - 1; i++) {
        const a = src[i];
        const b = src[i + 1];
        pts.push(new THREE.Vector3(a.x * 0.75 + b.x * 0.25, STROKE_Y, a.z * 0.75 + b.z * 0.25), new THREE.Vector3(a.x * 0.25 + b.x * 0.75, STROKE_Y, a.z * 0.25 + b.z * 0.75));
      }
      pts.push(src[src.length - 1]);
      if (pts.length > 200) pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    }
    const L = this.body.set(pts, (u) => 0.42 * (1 - 0.45 * u) * Math.min(1, 0.35 + u * 10) * (u > 0.94 ? Math.max(0.35, (1 - u) / 0.06) : 1));
    // the tail dries as the stroke grows
    this.body.u.uDry.value = Math.min(0.6, L / 30);
  }

  /** Cancelled: the stroke dries out (200 ms). Settled: it fades as the arrow takes over (160 ms). */
  end(settle: boolean): void {
    if (!this.active && !this.group.visible) return;
    this.active = false;
    const ver = ++this.ver;
    if (this.anim.instant) {
      this.group.visible = false;
      return;
    }
    void this.startedAt;
    this.anim.tween({
      // Settling into the arrow is quick: the gold moves on to the commit button (one gold, INK A9).
      ms: settle ? 120 : 200,
      unscaled: true,
      ease: ease.inQuad,
      update: (v) => {
        if (ver !== this.ver) return;
        this.body.u.uTail.value = settle ? 0 : v * 1.05;
        this.body.u.uOpacity.value = 1 - v * (settle ? 1 : 0.5);
      },
      done: () => {
        if (ver === this.ver) this.group.visible = false;
      },
    });
  }

  dispose(): void {
    this.body.dispose();
  }
}

// ---------------------------------------------------------------------------
// Fortify route: a dotted ink line through the owned chain
// ---------------------------------------------------------------------------

export class FortifyRoute {
  group = new THREE.Group();
  /** Reduced motion: the route fades in whole (150 ms). */
  reduced = false;
  /** Where a territory's figure stands (world); the route runs figure to figure. Default: the anchor. */
  anchorOf: ((id: TerritoryId) => THREE.Vector3) | null = null;
  /** A walk is drawing the route: highlight changes (the controller clearing the armed route) leave it be. */
  private walking = 0;
  private line: BrushRibbon;
  key = '';
  private ver = 0;
  /** Kept for the view's resize hook (the route is a mesh now, not a screen-space line). */
  mats: { resolution: THREE.Vector2 }[] = [];

  constructor(
    private tiles: TileSet,
    private anim: Animator,
    noise: THREE.Texture,
  ) {
    this.line = new BrushRibbon(noise, hexToRgb(IVORY), 200, true);
    this.group.add(this.line.mesh);
    this.group.visible = false;
  }

  get materials(): THREE.Material[] {
    return [this.line.mat];
  }

  show(path: TerritoryId[]): void {
    if (this.walking) return;
    const key = path.join('>');
    if (key === this.key && this.group.visible) return;
    this.key = key;
    this.layout(path);
    const ver = ++this.ver;
    if (this.anim.instant) {
      this.line.u.uProgress.value = 1.02;
      return;
    }
    if (this.reduced) {
      this.line.u.uProgress.value = 1.02;
      this.line.u.uOpacity.value = 0;
      void this.anim.tween({ ms: 150, unscaled: true, ease: ease.outQuad, update: (v) => ver === this.ver && (this.line.u.uOpacity.value = 0.92 * v) });
      return;
    }
    this.line.u.uProgress.value = 0;
    void this.anim.tween({
      ms: Math.min(420, 160 + 60 * path.length),
      unscaled: true,
      ease: ease.outCubic,
      update: (v) => {
        if (ver === this.ver) this.line.u.uProgress.value = v * 1.02;
      },
    });
  }

  /**
   * The fortify move (B §4): the dotted route draws a little ahead of the walking figure and dries behind
   * it, over the walk's `ms`, then is gone. `ease` matches the walker's.
   */
  walk(path: TerritoryId[], ms: number, run: Run | null, e: (t: number) => number = ease.inOutSine): Promise<void> {
    if (this.anim.instant || (run && run.skipped) || path.length < 2) {
      this.hide();
      return Promise.resolve();
    }
    this.key = `walk:${path.join('>')}`;
    this.layout(path);
    const ver = ++this.ver;
    const w = ++this.walking;
    const end = () => {
      if (this.walking === w) this.walking = 0;
      if (ver === this.ver) this.hide();
    };
    const u = this.line.u;
    if (this.reduced) {
      u.uProgress.value = 1.02;
      u.uTail.value = 0;
      u.uOpacity.value = 0.92;
      return this.anim.tween({ ms, run, update: () => undefined }).then(end);
    }
    u.uProgress.value = 0.34;
    u.uTail.value = 0;
    u.uOpacity.value = 0.92;
    return this.anim
      .tween({
        ms,
        ease: ease.linear,
        run,
        update: (raw) => {
          if (ver !== this.ver) return;
          const v = e(raw);
          u.uProgress.value = Math.min(1.02, v * 1.02 + 0.34);
          u.uTail.value = Math.max(0, v - 0.24);
        },
      })
      .then(end);
  }

  private layout(path: TerritoryId[]): void {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < path.length; i++) {
      const a = (this.anchorOf ? this.anchorOf(path[i]) : this.tiles.get(path[i]).anchorW).clone();
      a.y = STROKE_Y;
      if (i > 0) {
        const prev = pts[pts.length - 1];
        const dx = a.x - prev.x;
        const dz = a.z - prev.z;
        const mid = prev.clone().add(a).multiplyScalar(0.5);
        mid.x -= dz * 0.1;
        mid.z += dx * 0.1;
        pts.push(mid);
      }
      pts.push(a);
    }
    // stop short of both numbers
    const trim = (p: THREE.Vector3, q: THREE.Vector3, d: number) => {
      const v = q.clone().sub(p);
      const l = v.length();
      if (l > 0.01) p.addScaledVector(v.normalize(), Math.min(d, l * 0.4));
    };
    if (pts.length >= 2) {
      trim(pts[0], pts[1], 0.7);
      trim(pts[pts.length - 1], pts[pts.length - 2], 0.9);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const sp = curve.getSpacedPoints(Math.min(190, Math.max(24, path.length * 24)));
    this.line.set(sp, () => 0.13);
    this.line.u.uTail.value = 0;
    this.line.u.uOpacity.value = 0.92;
    this.group.visible = true;
  }

  hide(): void {
    if (this.walking) return;
    if (!this.group.visible) {
      this.key = '';
      return;
    }
    this.key = '';
    const ver = ++this.ver;
    if (this.anim.instant) {
      this.group.visible = false;
      return;
    }
    void this.anim.tween({
      ms: 150,
      unscaled: true,
      ease: ease.inQuad,
      update: (v) => {
        if (ver === this.ver) {
          this.line.u.uTail.value = v;
          this.line.u.uOpacity.value = 0.92 * (1 - v);
        }
      },
      done: () => {
        if (ver === this.ver) this.group.visible = false;
      },
    });
  }

  dispose(): void {
    this.line.dispose();
  }
}
