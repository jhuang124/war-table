// Sea lanes, the attack arrow, the fortify route, dust puffs and ripple rings.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { BoardGeometry } from '../map/types';
import type { TerritoryId } from '../engine/types';
import { seaLaneBetween } from '../map';
import { Animator, ease, type Run } from './anim';
import { IVORY, TILE_TOP, setColor, toWorld, type RGB } from './util';
import { softDotTexture } from './textures';
import type { TileSet } from './tiles';

// ---------------------------------------------------------------------------
// Sea lanes
// ---------------------------------------------------------------------------

export class SeaLanes {
  group = new THREE.Group();
  mats: LineMaterial[] = [];
  private geos: LineGeometry[] = [];

  constructor(g: BoardGeometry) {
    const dash = new LineMaterial({
      color: new THREE.Color(IVORY).getHex(),
      linewidth: 1.7,
      transparent: true,
      opacity: 0.62,
      dashed: true,
      dashSize: 0.3,
      gapSize: 0.22,
      depthWrite: false,
    });
    const glow = new LineMaterial({
      color: new THREE.Color('#f7eed8').getHex(),
      linewidth: 6,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    });
    this.mats.push(dash, glow);
    for (const lane of g.seaLanes) {
      for (const seg of lane.segments) {
        const n = seg.length;
        let len = 0;
        for (let i = 1; i < n; i++) len += Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]);
        const lift = Math.min(0.45, 0.08 + len * 0.06);
        const pts: number[] = [];
        seg.forEach(([x, y], i) => {
          const t = n > 1 ? i / (n - 1) : 0;
          const w = toWorld(x, y, 0.07 + Math.sin(Math.PI * t) * (lane.wrap ? lift * 0.3 : lift));
          pts.push(w.x, w.y, w.z);
        });
        const geo = new LineGeometry();
        geo.setPositions(pts);
        this.geos.push(geo);
        const gl = new Line2(geo, glow);
        gl.renderOrder = 1;
        const dl = new Line2(geo, dash);
        dl.computeLineDistances();
        dl.renderOrder = 2;
        this.group.add(gl, dl);
      }
    }
  }

  dispose(): void {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
  }
}

// ---------------------------------------------------------------------------
// Attack arrow: a ribbon in the attacker's color with an ivory core, grown along an arc.
// ---------------------------------------------------------------------------

const RIB_N = 64;

class Ribbon {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private geo: THREE.BufferGeometry;
  constructor(
    material: THREE.Material,
    private width: number,
    private headW: number,
    private headL: number,
    private yOff: number,
  ) {
    const segs = 2; // up to two curve pieces (edge wrap)
    const verts = segs * (RIB_N + 1) * 2 + 3;
    this.pos = new Float32Array(verts * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let s = 0; s < segs; s++) {
      const b = s * (RIB_N + 1) * 2;
      for (let i = 0; i < RIB_N; i++) {
        const a = b + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const h = segs * (RIB_N + 1) * 2;
    idx.push(h, h + 1, h + 2);
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }

  /** curves: sampled point arrays (world). progress 0..1 over their total length. */
  build(curves: THREE.Vector3[][], progress: number): void {
    const lens = curves.map((c) => {
      let l = 0;
      for (let i = 1; i < c.length; i++) l += c[i].distanceTo(c[i - 1]);
      return l;
    });
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let remain = total * progress;
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const p = new THREE.Vector3();
    let tip: THREE.Vector3 | null = null;
    let tipTan = new THREE.Vector3(1, 0, 0);
    const P = this.pos;
    P.fill(0);
    curves.forEach((c, s) => {
      const segLen = lens[s];
      const use = Math.max(0, Math.min(segLen, remain));
      remain -= segLen;
      const base = s * (RIB_N + 1) * 2;
      if (use <= 1e-4) return;
      // resample c up to `use` length
      const frac = use / segLen;
      for (let i = 0; i <= RIB_N; i++) {
        const u = (i / RIB_N) * frac;
        samplePath(c, u, p, tan);
        side.crossVectors(tan, up).normalize();
        const along = (s === 0 ? u * (segLen / total) : 1) as number;
        const taper = s === 0 ? Math.min(1, 0.35 + along * 3.5) : 1;
        const endPinch = i === RIB_N ? 0.55 : 1;
        const w = (this.width / 2) * taper * endPinch;
        const o = (base + i * 2) * 3;
        P[o] = p.x + side.x * w;
        P[o + 1] = p.y + this.yOff;
        P[o + 2] = p.z + side.z * w;
        P[o + 3] = p.x - side.x * w;
        P[o + 4] = p.y + this.yOff;
        P[o + 5] = p.z - side.z * w;
        if (i === RIB_N) {
          tip = p.clone();
          tipTan = tan.clone();
        }
      }
    });
    const h = curves.length * 0 + 2 * (RIB_N + 1) * 2;
    if (tip) {
      const t = tip as THREE.Vector3;
      side.crossVectors(tipTan, up).normalize();
      const o = h * 3;
      const back = t.clone().addScaledVector(tipTan, -this.headL * 0.25);
      const front = t.clone().addScaledVector(tipTan, this.headL * 0.75);
      P[o] = back.x + side.x * this.headW * 0.5;
      P[o + 1] = back.y + this.yOff;
      P[o + 2] = back.z + side.z * this.headW * 0.5;
      P[o + 3] = back.x - side.x * this.headW * 0.5;
      P[o + 4] = back.y + this.yOff;
      P[o + 5] = back.z - side.z * this.headW * 0.5;
      P[o + 6] = front.x;
      P[o + 7] = front.y + this.yOff;
      P[o + 8] = front.z;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  dispose(): void {
    this.geo.dispose();
  }
}

function samplePath(c: THREE.Vector3[], u: number, out: THREE.Vector3, tan: THREE.Vector3): void {
  const f = Math.min(0.99999, Math.max(0, u)) * (c.length - 1);
  const i = Math.floor(f);
  const t = f - i;
  out.lerpVectors(c[i], c[i + 1], t);
  tan.subVectors(c[i + 1], c[i]).normalize();
}

function arc(a: THREE.Vector3, b: THREE.Vector3, height: number, n = 48, side = 0): THREE.Vector3[] {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += height;
  if (side) {
    // Bow sideways (perpendicular on the board plane) as well as up.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    mid.x += (-dz / len) * side;
    mid.z += (dx / len) * side;
  }
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return curve.getSpacedPoints(n);
}

export class AttackArrow {
  group = new THREE.Group();
  private outerMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshBasicMaterial;
  private outer: Ribbon;
  private core: Ribbon;
  private edge: Ribbon;
  private edgeMat: THREE.MeshBasicMaterial;
  private curves: THREE.Vector3[][] = [];
  progress = 0;
  key = '';
  private ver = 0;

  constructor(
    private tiles: TileSet,
    private anim: Animator,
  ) {
    this.outerMat = new THREE.MeshStandardMaterial({
      color: '#c63d36',
      emissive: '#c63d36',
      emissiveIntensity: 0.28,
      roughness: 0.45,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: IVORY,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.edgeMat = new THREE.MeshBasicMaterial({
      color: '#0b0d10',
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    // dark edge (reads on a same-colored tile) → attacker color → ivory core
    this.edge = new Ribbon(this.edgeMat, 1.02, 2.3, 1.85, -0.012);
    this.outer = new Ribbon(this.outerMat, 0.78, 1.9, 1.55, 0);
    this.core = new Ribbon(this.coreMat, 0.22, 0.78, 0.8, 0.014);
    this.outer.mesh.castShadow = true;
    this.edge.mesh.renderOrder = 4;
    this.outer.mesh.renderOrder = 5;
    this.core.mesh.renderOrder = 6;
    this.group.add(this.edge.mesh, this.outer.mesh, this.core.mesh);
    this.group.visible = false;
  }

  get materials(): THREE.Material[] {
    return [this.outerMat, this.coreMat, this.edgeMat];
  }

  private makeCurves(from: TerritoryId, to: TerritoryId): THREE.Vector3[][] {
    const A = this.tiles.get(from).anchorW.clone();
    const B = this.tiles.get(to).anchorW.clone();
    A.y = B.y = TILE_TOP + 0.3;
    const lane = seaLaneBetween(from, to);
    if (lane && lane.wrap) {
      // Off one edge and back in on the other, following the lane.
      const [s1, s2] = lane.segments;
      const edgeOf = (seg: typeof s1) => {
        const p0 = seg[0];
        const p1 = seg[seg.length - 1];
        const edge = Math.abs(p0[0] - 50) > Math.abs(p1[0] - 50) ? p0 : p1;
        return edge;
      };
      const e1 = edgeOf(s1);
      const e2 = edgeOf(s2);
      const aX = this.tiles.get(from).anchorW.x;
      const [ea, eb] = Math.sign(e1[0] - 50) === Math.sign(aX) ? [e1, e2] : [e2, e1];
      const EA = toWorld(ea[0] + Math.sign(ea[0] - 50) * 3.2, ea[1], TILE_TOP + 0.6);
      const EB = toWorld(eb[0] + Math.sign(eb[0] - 50) * 3.2, eb[1], TILE_TOP + 0.6);
      const B2 = B.clone().lerp(EB, Math.min(0.3, 0.9 / Math.max(1, B.distanceTo(EB))));
      return [arc(A, EA, 1.2, 40), arc(EB, B2, 1.2, 40)];
    }
    const d = A.distanceTo(B);
    const back = Math.min(0.95, d * 0.22);
    const B2 = B.clone().lerp(A, back / Math.max(d, 0.001));
    const A2 = A.clone().lerp(B, Math.min(0.35, d * 0.08) / Math.max(d, 0.001));
    // A tall arc so the arrow clears the two badges it connects. From the home camera a north–south
    // pair lines up with its own badges on screen, so those arcs also bow sideways, around them.
    const ns = Math.abs(B.z - A.z) / Math.max(d, 0.001);
    const side = ns > 0.55 ? Math.sign(B.z - A.z || 1) * (3 + d * 0.5) * ((ns - 0.55) / 0.45) : 0;
    return [arc(A2, B2, 1.6 + d * 0.36, 56, side)];
  }

  /** Show (grow 240 ms) or re-color the arrow. Returns when grown. */
  show(from: TerritoryId, to: TerritoryId, color: RGB, run: Run | null = null, growMs = 240): Promise<void> {
    const key = `${from}|${to}`;
    setColor(this.outerMat.color, color);
    setColor(this.outerMat.emissive, color);
    if (this.key === key && this.group.visible && this.progress >= 1) return Promise.resolve();
    const same = this.key === key && this.group.visible;
    this.key = key;
    this.curves = this.makeCurves(from, to);
    this.group.visible = true;
    const ver = ++this.ver;
    const start = same ? Math.min(this.progress, 1) : 0;
    return this.anim.tween({
      ms: growMs,
      ease: ease.outCubic,
      run,
      update: (v) => {
        if (ver !== this.ver) return;
        this.progress = start + (1 - start) * v;
        this.rebuild();
      },
    });
  }

  hide(immediate = false): void {
    if (!this.group.visible) return;
    this.key = '';
    const ver = ++this.ver;
    if (immediate || this.anim.instant) {
      this.group.visible = false;
      this.progress = 0;
      return;
    }
    const from = this.progress;
    this.anim.tween({
      ms: 120,
      ease: ease.inQuad,
      update: (v) => {
        if (ver !== this.ver) return;
        this.progress = from * (1 - v);
        if (this.progress <= 0.001) this.group.visible = false;
        else this.rebuild();
      },
      done: () => {
        if (ver === this.ver) this.group.visible = false;
      },
    });
  }

  private rebuild(): void {
    this.edge.build(this.curves, this.progress);
    this.outer.build(this.curves, this.progress);
    this.core.build(this.curves, this.progress);
  }

  dispose(): void {
    this.edge.dispose();
    this.outer.dispose();
    this.core.dispose();
    this.edgeMat.dispose();
    this.outerMat.dispose();
    this.coreMat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Fortify route: ivory dashed, through the owned chain.
// ---------------------------------------------------------------------------

export class FortifyRoute {
  group = new THREE.Group();
  private geo = new LineGeometry();
  private under: Line2;
  private line: Line2;
  mats: LineMaterial[] = [];
  private head: THREE.Mesh;
  key = '';

  constructor(private tiles: TileSet) {
    const ivory = new THREE.Color(IVORY).getHex();
    const lm = new LineMaterial({
      color: ivory,
      linewidth: 3,
      dashed: true,
      dashSize: 0.55,
      gapSize: 0.35,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const um = new LineMaterial({ color: 0x0b0d10, linewidth: 5, transparent: true, opacity: 0.5, depthWrite: false });
    this.mats.push(lm, um);
    this.geo.setPositions([0, 0, 0, 1, 0, 0]);
    this.under = new Line2(this.geo, um);
    this.line = new Line2(this.geo, lm);
    this.under.renderOrder = 5;
    this.line.renderOrder = 6;
    const hs = new THREE.Shape([new THREE.Vector2(-0.4, -0.35), new THREE.Vector2(0.45, 0), new THREE.Vector2(-0.4, 0.35)]);
    this.head = new THREE.Mesh(
      new THREE.ShapeGeometry(hs),
      new THREE.MeshBasicMaterial({ color: IVORY, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.head.renderOrder = 6;
    this.group.add(this.under, this.line, this.head);
    this.group.visible = false;
  }

  show(path: TerritoryId[]): void {
    const key = path.join('>');
    if (key === this.key && this.group.visible) return;
    this.key = key;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < path.length; i++) {
      const a = this.tiles.get(path[i]).anchorW.clone();
      a.y = TILE_TOP + 0.2;
      if (i > 0) {
        const prev = pts[pts.length - 1];
        const mid = prev.clone().add(a).multiplyScalar(0.5);
        mid.y += 0.25 + prev.distanceTo(a) * 0.05;
        pts.push(mid);
      }
      pts.push(a);
    }
    // stop short of the destination badge
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2] ?? last;
    const dir = last.clone().sub(prev);
    const dl = dir.length();
    if (dl > 0.01) last.addScaledVector(dir.normalize(), -Math.min(0.8, dl * 0.4));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const sp = curve.getSpacedPoints(Math.max(24, path.length * 24));
    const flat: number[] = [];
    for (const p of sp) flat.push(p.x, p.y, p.z);
    this.geo.dispose();
    this.geo = new LineGeometry();
    this.geo.setPositions(flat);
    this.line.geometry = this.geo;
    this.under.geometry = this.geo;
    this.line.computeLineDistances();
    const tip = sp[sp.length - 1];
    const before = sp[sp.length - 3] ?? sp[0];
    this.head.position.copy(tip);
    this.head.rotation.set(-Math.PI / 2, 0, Math.atan2(-(tip.z - before.z), tip.x - before.x));
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
    this.key = '';
  }

  dispose(): void {
    this.geo.dispose();
    this.mats.forEach((m) => m.dispose());
    this.head.geometry.dispose();
    (this.head.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Dust (≤ 40 particles alive) and ripple rings
// ---------------------------------------------------------------------------

const MAX_P = 40;

export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX_P * 3);
  private alpha = new Float32Array(MAX_P);
  private size = new Float32Array(MAX_P);
  private vel = new Float32Array(MAX_P * 3);
  private life = new Float32Array(MAX_P);
  private maxLife = new Float32Array(MAX_P);
  alive = 0;
  material: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDotTexture() }, uColor: { value: new THREE.Color('#e9dcc0') }, uScale: { value: 400 } },
      vertexShader: `attribute float aAlpha; attribute float aSize; varying float vA; uniform float uScale;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z; }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  burst(at: THREE.Vector3, n = 6): void {
    for (let k = 0; k < n; k++) {
      let i = -1;
      for (let j = 0; j < MAX_P; j++)
        if (this.life[j] <= 0) {
          i = j;
          break;
        }
      if (i < 0) return;
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.2;
      this.pos[i * 3] = at.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = at.y + 0.03;
      this.pos[i * 3 + 2] = at.z + Math.sin(a) * r;
      const sp = 0.9 + Math.random() * 0.8;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = 0.35 + Math.random() * 0.3;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.maxLife[i] = this.life[i] = 0.35;
      this.size[i] = 0.35 + Math.random() * 0.25;
    }
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const drag = Math.exp(-dt * 7);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = this.life[i] > 0 ? 0.55 * (1 - t) : 0;
      this.size[i] *= 1 + dt * 1.2;
      if (this.life[i] > 0) alive++;
    }
    this.alive = alive;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  setViewportHeight(h: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.uniforms.uMap.value.dispose();
    this.material.dispose();
  }
}

export class Ripples {
  group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; busy: boolean }[] = [];
  constructor(private anim: Animator) {
    const geo = new THREE.RingGeometry(0.86, 1, 64);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: IVORY, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, busy: false });
    }
  }

  ring(at: THREE.Vector3, maxR: number, color: RGB, ms = 500, run: Run | null = null): void {
    const r = this.rings.find((x) => !x.busy);
    if (!r || this.anim.instant) return;
    r.busy = true;
    r.mesh.visible = true;
    r.mesh.position.copy(at);
    setColor(r.mat.color, color);
    this.anim.tween({
      ms,
      ease: ease.outCubic,
      run,
      update: (v) => {
        const s = 0.3 + (maxR - 0.3) * v;
        r.mesh.scale.set(s, 1, s);
        r.mat.opacity = 0.85 * (1 - v);
      },
      done: () => {
        r.mesh.visible = false;
        r.busy = false;
      },
    });
  }

  get materials(): THREE.Material[] {
    return this.rings.map((r) => r.mat);
  }

  dispose(): void {
    this.rings[0]?.mesh.geometry.dispose();
    this.rings.forEach((r) => r.mat.dispose());
  }
}
