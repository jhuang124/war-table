// Army miniatures: instanced low-poly infantry / cavalry / artillery, plus a banner whose pole grows
// with strength. Each territory shows a small formation behind its badge.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS } from '../engine/mapData';
import { Animator, ease, type Run } from './anim';
import { TILE_TOP, setColor, type RGB, adjust, toWorld } from './util';
import type { TileSet } from './tiles';

type PieceType = 0 | 1 | 2; // infantry, cavalry, artillery
const MAX_SLOTS = 5;

interface Slot {
  type: PieceType;
  dx: number;
  dz: number;
  yaw: number;
  drop: number; // y offset
  tilt: number; // topple angle (rad)
  scale: number;
  alive: boolean; // false = animating out
}

interface Formation {
  id: TerritoryId;
  armies: number;
  color: RGB;
  slots: Slot[];
  leaving: Slot[];
  banner: number; // pole height (0 = none)
  bannerTarget: number;
  inflight: number;
  seed: number;
}

interface Traveler {
  type: PieceType;
  color: RGB;
  from: THREE.Vector3;
  to: THREE.Vector3;
  via: THREE.Vector3[];
  t: number;
  arc: number;
  yaw: number;
  alive: boolean;
}

// Formation positions (dx east, dz south) in board units relative to the anchor. Back row first.
/** Miniature scale (geometry is modelled at ~0.6 units tall). */
export const PIECE_SCALE = 2.25;
const BACK: [number, number][] = [
  [0, -0.78],
  [-0.84, -0.6],
  [0.84, -0.6],
];
const FRONT: [number, number][] = [
  [-0.44, 0.04],
  [0.44, 0.04],
];

export function composition(n: number): PieceType[] {
  if (n <= 0) return [];
  let art = Math.floor(n / 10);
  let cav = Math.floor((n % 10) / 5);
  let inf = n % 5;
  const out: PieceType[] = [];
  // Keep it ≤ MAX_SLOTS: big stacks show their artillery; the banner and badge carry the rest.
  art = Math.min(art, 3);
  const room = MAX_SLOTS - art;
  cav = Math.min(cav, room);
  inf = Math.min(inf, MAX_SLOTS - art - cav);
  for (let i = 0; i < art; i++) out.push(2);
  for (let i = 0; i < cav; i++) out.push(1);
  for (let i = 0; i < inf; i++) out.push(0);
  return out;
}

function layout(types: PieceType[]): [number, number][] {
  const back = [...BACK];
  const front = [...FRONT];
  return types.map((t) => (t > 0 ? (back.shift() ?? front.shift()!) : (front.shift() ?? back.shift()!)));
}

function bannerHeight(n: number): number {
  if (n < 8) return 0;
  return 0.5 + Math.min(0.55, Math.log2(n / 8) * 0.22);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function colored(g: THREE.BufferGeometry, shade: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.attributes.position.count;
  const c = new Float32Array(n * 3).fill(shade);
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!ng.attributes.normal) ng.computeVertexNormals();
  return ng;
}

function baseDisc(r: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r + 0.012, 0.03),
    new THREE.Vector2(r - 0.01, 0.065),
    new THREE.Vector2(0, 0.065),
  ];
  return new THREE.LatheGeometry(pts, 14);
}

function infantryGeo(): THREE.BufferGeometry {
  const p = [
    [0.0, 0.06],
    [0.1, 0.06],
    [0.115, 0.14],
    [0.12, 0.27],
    [0.15, 0.31],
    [0.13, 0.35],
    [0.07, 0.37],
    [0.075, 0.4],
    [0.098, 0.45],
    [0.09, 0.5],
    [0.125, 0.515],
    [0.11, 0.545],
    [0.075, 0.585],
    [0.0, 0.6],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(p, 10);
  // rifle
  const rifle = new THREE.CylinderGeometry(0.014, 0.014, 0.42, 5);
  rifle.translate(0.135, 0.36, 0.03);
  return mergeGeometries([colored(baseDisc(0.17), 0.55), colored(body, 1), colored(rifle, 0.35)])!;
}

function cavalryGeo(): THREE.BufferGeometry {
  const pts = [
    [-0.14, 0.06],
    [0.15, 0.06],
    [0.13, 0.15],
    [0.06, 0.24],
    [0.1, 0.32],
    [0.2, 0.38],
    [0.225, 0.44],
    [0.18, 0.49],
    [0.08, 0.52],
    [0.055, 0.6],
    [0.075, 0.67],
    [0.015, 0.635],
    [-0.035, 0.655],
    [-0.12, 0.56],
    [-0.155, 0.43],
    [-0.14, 0.29],
    [-0.165, 0.16],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const shape = new THREE.Shape(pts);
  const head = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  head.translate(0, 0, -0.05);
  return mergeGeometries([colored(baseDisc(0.19), 0.55), colored(head, 1)])!;
}

function artilleryGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = baseDisc(0.21);
  parts.push(colored(base, 0.55));
  const barrel = new THREE.CylinderGeometry(0.045, 0.062, 0.5, 8);
  barrel.rotateZ(Math.PI / 2 - 0.22);
  barrel.translate(0.05, 0.26, 0);
  parts.push(colored(barrel, 1));
  const muzzle = new THREE.TorusGeometry(0.048, 0.014, 5, 10);
  muzzle.rotateY(Math.PI / 2);
  muzzle.rotateZ(-0.22);
  muzzle.translate(0.29, 0.315, 0);
  parts.push(colored(muzzle, 1));
  for (const z of [-0.1, 0.1]) {
    const w = new THREE.CylinderGeometry(0.12, 0.12, 0.035, 12);
    w.rotateX(Math.PI / 2);
    w.translate(-0.02, 0.185, z);
    parts.push(colored(w, 0.62));
    const hub = new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6);
    hub.rotateX(Math.PI / 2);
    hub.translate(-0.02, 0.185, z * 1.15);
    parts.push(colored(hub, 0.35));
  }
  const trail = new THREE.BoxGeometry(0.28, 0.05, 0.08);
  trail.rotateZ(0.35);
  trail.translate(-0.15, 0.12, 0);
  parts.push(colored(trail, 0.62));
  return mergeGeometries(parts)!;
}

function poleGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.018, 0.022, 1, 6);
  g.translate(0, 0.5, 0);
  const knob = new THREE.SphereGeometry(0.04, 8, 6);
  knob.translate(0, 1.02, 0);
  const foot = new THREE.CylinderGeometry(0.1, 0.12, 0.06, 10);
  foot.translate(0, 0.03, 0);
  return mergeGeometries([colored(g, 1), colored(knob, 1), colored(foot, 0.6)])!;
}

function flagGeo(): THREE.BufferGeometry {
  // A pennant with a slight wave, hanging from the pole top toward +x.
  const w = 0.42;
  const h = 0.26;
  const seg = 6;
  const g = new THREE.PlaneGeometry(w, h, seg, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2;
    const y = pos.getY(i);
    const taper = 1 - (x / w) * 0.45;
    pos.setXYZ(i, x, y * taper, Math.sin((x / w) * Math.PI * 1.4) * 0.04);
  }
  g.computeVertexNormals();
  g.translate(0.015, -h / 2 - 0.03, 0);
  return colored(g, 1);
}

// ---------------------------------------------------------------------------

export class PieceSystem {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private pole: THREE.InstancedMesh;
  private flag: THREE.InstancedMesh;
  private forms = new Map<TerritoryId, Formation>();
  private travelers: Traveler[] = [];
  private dirty = true;
  materials: THREE.Material[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private tq = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private tmpV = new THREE.Vector3();
  /** Called when a dropping piece touches down (for dust, pop, sound). */
  onContact: ((id: TerritoryId) => void) | null = null;

  constructor(
    private anim: Animator,
    private tiles: TileSet,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.08, envMapIntensity: 1.4 });
    const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshStandardMaterial({ color: '#d8c7a0', roughness: 0.35, metalness: 0.6 });
    this.materials.push(mat, flagMat, poleMat);
    const cap = 42 * MAX_SLOTS + 24;
    for (const geo of [infantryGeo(), cavalryGeo(), artilleryGeo()]) {
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      // allocate instanceColor
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      this.meshes.push(im);
      this.group.add(im);
    }
    this.pole = new THREE.InstancedMesh(poleGeo(), poleMat, 48);
    this.flag = new THREE.InstancedMesh(flagGeo(), flagMat, 48);
    for (const im of [this.pole, this.flag]) {
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(im);
    }
    let seed = 1;
    for (const id of TERRITORY_IDS) {
      this.forms.set(id, {
        id,
        armies: 0,
        color: [1, 1, 1],
        slots: [],
        leaving: [],
        banner: 0,
        bannerTarget: 0,
        inflight: 0,
        seed: seed++ * 0.6180339,
      });
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  get animating(): boolean {
    return this.travelers.length > 0;
  }

  setColor(id: TerritoryId, color: RGB): void {
    const f = this.forms.get(id)!;
    // A deeper, glossier shade than the tile so the miniatures read against their own territory.
    f.color = adjust(color, 1.08, 0.66);
    this.dirty = true;
  }

  /**
   * Change the formation. mode: 'snap' (no motion), 'drop' (new pieces fall in),
   * 'topple' (lost pieces fall over), 'lift' (pieces leave upward, for marches).
   */
  setArmies(id: TerritoryId, n: number, mode: 'snap' | 'drop' | 'topple' | 'lift' = 'snap', run?: Run | null): number {
    const f = this.forms.get(id)!;
    const prev = f.slots;
    const types = composition(n);
    const pos = layout(types);
    f.armies = n;
    const next: Slot[] = [];
    let contactAt = 0;
    for (let i = 0; i < types.length; i++) {
      const old = prev[i];
      const [dx, dz] = pos[i];
      const yaw = -0.5 + ((f.seed * 7.3 + i * 1.91) % 1) * 0.6 + (types[i] === 0 ? 0 : 0.2);
      if (old && old.type === types[i] && old.alive) {
        old.dx = dx;
        old.dz = dz;
        next.push(old);
        continue;
      }
      const s: Slot = { type: types[i], dx, dz, yaw, drop: 0, tilt: 0, scale: 1, alive: true };
      next.push(s);
      if (mode === 'drop' && f.inflight < 3 && !this.anim.instant) {
        f.inflight++;
        s.drop = 2.2;
        const fall = this.anim.scale(200);
        contactAt = Math.max(contactAt, fall);
        this.anim
          .tween({
            ms: 200,
            ease: ease.inQuad,
            run,
            update: (v) => {
              s.drop = 2.2 * (1 - v);
              this.dirty = true;
            },
          })
          .then(() => {
            this.onContact?.(id);
            return this.anim.tween({
              ms: 90,
              ease: ease.linear,
              run,
              update: (v) => {
                s.drop = Math.sin(v * Math.PI) * 0.13;
                this.dirty = true;
              },
            });
          })
          .then(() => {
            f.inflight = Math.max(0, f.inflight - 1);
          });
      } else if (mode !== 'snap' && !this.anim.instant) {
        s.scale = 0.001;
        this.anim.tween({
          ms: 160,
          ease: ease.outBack(1.4),
          run,
          update: (v) => {
            s.scale = Math.max(0.001, v);
            this.dirty = true;
          },
        });
      }
    }
    if (mode === 'drop' && contactAt === 0 && !this.anim.instant) {
      // No new piece falls (formation capped or merged, or 3 drops already in flight): still
      // acknowledge on the contact frame so the badge pops and the chip sound lands.
      if (f.inflight >= 3) this.onContact?.(id);
      else void this.anim.wait(200, run).then(() => this.onContact?.(id));
    }
    // Pieces that no longer exist
    for (let i = 0; i < prev.length; i++) {
      const old = prev[i];
      if (next.includes(old)) continue;
      if (mode === 'snap' || this.anim.instant) continue;
      old.alive = false;
      f.leaving.push(old);
      const done = () => {
        f.leaving = f.leaving.filter((x) => x !== old);
        this.dirty = true;
      };
      if (mode === 'topple') {
        const dir = ((f.seed * 13 + i) % 2 > 1 ? 1 : -1) * 1;
        this.anim
          .tween({
            ms: 280,
            ease: ease.inBack(1.6),
            run,
            update: (v) => {
              old.tilt = dir * v * (Math.PI / 2);
              this.dirty = true;
            },
          })
          .then(() =>
            this.anim.tween({
              ms: 260,
              ease: ease.inQuad,
              run,
              update: (v) => {
                old.scale = Math.max(0.001, 1 - v);
                old.drop = -0.1 * v;
                this.dirty = true;
              },
            }),
          )
          .then(done);
      } else if (mode === 'lift') {
        this.anim
          .tween({
            ms: 140,
            ease: ease.inQuad,
            run,
            update: (v) => {
              old.drop = v * 0.5;
              old.scale = Math.max(0.001, 1 - v);
              this.dirty = true;
            },
          })
          .then(done);
      } else {
        this.anim
          .tween({
            ms: 140,
            ease: ease.inQuad,
            run,
            update: (v) => {
              old.scale = Math.max(0.001, 1 - v);
              this.dirty = true;
            },
          })
          .then(done);
      }
    }
    f.slots = next;
    const bh = bannerHeight(n);
    if (mode === 'snap' || this.anim.instant) f.banner = bh;
    else {
      const from = f.banner;
      this.anim.tween({
        ms: 260,
        ease: ease.outCubic,
        run,
        update: (v) => {
          f.banner = from + (bh - from) * v;
          this.dirty = true;
        },
      });
    }
    f.bannerTarget = bh;
    this.dirty = true;
    return contactAt;
  }

  /** Pieces travel from a to b (via optional waypoints). Resolves on landing. */
  march(
    from: TerritoryId,
    to: TerritoryId,
    count: number,
    color: RGB,
    ms: number,
    run: Run | null,
    viaIds: TerritoryId[] = [],
    arc = 1.2,
  ): Promise<void> {
    const types = composition(count).slice(0, 3);
    if (!types.length) types.push(0);
    const a = this.tiles.get(from).anchorW;
    const b = this.tiles.get(to).anchorW;
    const via = viaIds.map((v) => this.tiles.get(v).anchorW.clone());
    const dir = Math.atan2(-(b.z - a.z), b.x - a.x);
    const trav: Traveler[] = types.map((type, i) => ({
      type,
      color: adjust(color, 1.08, 0.66),
      from: a.clone().add(new THREE.Vector3((i - 1) * 0.55, 0, -this.tiles.get(from).formDz)),
      to: b.clone().add(new THREE.Vector3((i - 1) * 0.55, 0, -this.tiles.get(to).formDz)),
      via,
      t: 0,
      arc,
      yaw: dir,
      alive: true,
    }));
    this.travelers.push(...trav);
    this.dirty = true;
    return this.anim
      .tween({
        ms,
        ease: via.length ? ease.inOutSine : ease.inOutCubic,
        run,
        update: (v) => {
          for (const t of trav) t.t = v;
          this.dirty = true;
        },
      })
      .then(() => {
        this.travelers = this.travelers.filter((t) => !trav.includes(t));
        this.dirty = true;
      });
  }

  clearTravelers(): void {
    this.travelers = [];
    this.dirty = true;
  }

  update(force = false): void {
    if (!this.dirty && !force) return;
    this.dirty = false;
    const counts = [0, 0, 0];
    let poles = 0;
    const m = this.m;
    for (const f of this.forms.values()) {
      if (!f.slots.length && !f.leaving.length) continue;
      const tile = this.tiles.get(f.id);
      const baseY = tile.pivot.position.y + TILE_TOP;
      const ax = tile.anchorW.x;
      const az = tile.anchorW.z - tile.formDz;
      this.c.setRGB(f.color[0], f.color[1], f.color[2], THREE.SRGBColorSpace);
      const draw = (s: Slot) => {
        const im = this.meshes[s.type];
        const idx = counts[s.type]++;
        this.p.set(ax + s.dx, baseY + s.drop, az + s.dz);
        this.e.set(0, s.yaw, 0, 'YXZ');
        this.q.setFromEuler(this.e);
        if (s.tilt) {
          this.tq.setFromAxisAngle(this.tmpV.set(0, 0, 1), s.tilt);
          this.q.multiply(this.tq);
        }
        const sc = s.scale * PIECE_SCALE * (s.type === 2 ? 0.95 : 1.0);
        this.s.set(sc, sc, sc);
        m.compose(this.p, this.q, this.s);
        im.setMatrixAt(idx, m);
        im.setColorAt(idx, this.c);
      };
      for (const s of f.slots) draw(s);
      for (const s of f.leaving) draw(s);
      if (f.banner > 0.02 && f.slots.length) {
        const h = f.banner;
        this.p.set(ax + 0.42, baseY, az - 1.3);
        this.q.identity();
        this.s.set(PIECE_SCALE * 0.9, h * PIECE_SCALE * 0.9, PIECE_SCALE * 0.9);
        m.compose(this.p, this.q, this.s);
        this.pole.setMatrixAt(poles, m);
        this.pole.setColorAt(poles, this.c.setRGB(1, 1, 1));
        this.p.set(ax + 0.42, baseY + h * PIECE_SCALE * 0.9, az - 1.3);
        this.s.set(PIECE_SCALE * 0.9, PIECE_SCALE * 0.9, PIECE_SCALE * 0.9);
        m.compose(this.p, this.q, this.s);
        this.flag.setMatrixAt(poles, m);
        setColor(this.c, f.color);
        this.flag.setColorAt(poles, this.c);
        poles++;
      }
    }
    for (const t of this.travelers) {
      const im = this.meshes[t.type];
      const idx = counts[t.type]++;
      const pts = [t.from, ...t.via, t.to];
      const segs = pts.length - 1;
      const u = t.t * segs;
      const k = Math.min(segs - 1, Math.floor(u));
      const lt = u - k;
      const a = pts[k];
      const b = pts[k + 1];
      this.p.lerpVectors(a, b, lt);
      const hopH = segs > 1 ? 0.35 : t.arc;
      this.p.y = TILE_TOP + Math.sin(lt * Math.PI) * hopH;
      const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      this.e.set(0, yaw, 0.12 * Math.sin(lt * Math.PI * 2), 'YXZ');
      this.q.setFromEuler(this.e);
      this.s.set(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE);
      m.compose(this.p, this.q, this.s);
      im.setMatrixAt(idx, m);
      setColor(this.c, t.color);
      im.setColorAt(idx, this.c);
    }
    this.meshes.forEach((im, i) => {
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
    this.pole.count = this.flag.count = poles;
    for (const im of [this.pole, this.flag]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** World position just above a territory's formation (for dust). */
  dustPoint(id: TerritoryId, out: THREE.Vector3): THREE.Vector3 {
    const t = this.tiles.get(id);
    return out.set(t.anchorW.x, TILE_TOP + t.pivot.position.y + 0.02, t.anchorW.z - 0.4);
  }

  dispose(): void {
    for (const im of [...this.meshes, this.pole, this.flag]) {
      im.geometry.dispose();
      im.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}

export { toWorld };
