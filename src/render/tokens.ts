// Army tokens: one painted wooden disc per territory, in the owner's color, sitting on the tile at
// its anchor. The count is a DOM number laid over the disc (overlay.ts reads `top`/`visual`), so it
// stays crisp at any DPR. Movement reads through the tokens: they hop, flinch and pop in place, and a
// traveler disc carries the moved count along an arc.
import * as THREE from 'three';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS } from '../engine/mapData';
import { Animator, ease, type Run } from './anim';
import { TILE_TOP, adjust, type RGB } from './util';
import type { TileSet } from './tiles';

/**
 * Token radius (board units, at UI scale 1). The tightest tile (Japan) has 1.32 units clear around its
 * anchor, so every token leaves tile showing on all sides.
 */
export const TOKEN_R = 1.0;
/** Token thickness (board units). */
export const TOKEN_H = 0.3;
const MAX_TRAVELERS = 8;

export interface TokenTraveler {
  /** Count carried (drawn as the traveler's number). */
  n: number;
  /** Number color (the mover's palette ink). */
  ink: string;
  /** World position of the traveler's top centre (updated every frame while it flies). */
  top: THREE.Vector3;
  alive: boolean;
}

interface Tok {
  id: TerritoryId;
  base: RGB; // token fill before dim
  n: number;
  /** 0..1 presence (appear / knock-off); 0 = not drawn. */
  scale: number;
  /** Transient size multiplier (pops). */
  pop: number;
  /** Transient height offset (hops, drops). */
  hop: number;
  /** Transient vertical squash (1 = none). */
  squash: number;
  /** Transient sideways offset (flinch). */
  dx: number;
  ver: Record<string, number>;
  /** World position of the top centre, refreshed by update(). */
  top: THREE.Vector3;
}

interface Traveler extends TokenTraveler {
  color: RGB;
  pts: THREE.Vector3[];
  t: number;
  arc: number;
}

function tokenGeometry(): THREE.BufferGeometry {
  // A turned disc at unit radius: flat base, rounded shoulders, a flat top for the number.
  const h = TOKEN_H;
  const prof: [number, number][] = [
    [0, 0],
    [0.9, 0],
    [0.965, 0.012],
    [0.995, 0.045],
    [1.0, 0.09],
    [1.0, h - 0.085],
    [0.99, h - 0.04],
    [0.965, h - 0.013],
    [0.93, h],
    [0, h],
  ];
  const geo = new THREE.LatheGeometry(
    prof.map(([x, y]) => new THREE.Vector2(x, y)),
    40,
  );
  // Vertex shade: full on the top face, a touch deeper down the turned edge (worn paint).
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const k = y >= h - 1e-4 ? 1 : r < 0.5 ? 0.55 : 0.78 + 0.2 * (y / h);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export class TokenSystem {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private toks = new Map<TerritoryId, Tok>();
  private list: Tok[] = [];
  private movers: Traveler[] = [];
  private dirty = true;
  materials: THREE.Material[] = [];
  /** Radius multiplier from the UI text size (bigger numbers need a bigger disc). */
  sizeScale = 1;
  /** Reduced motion: counts change in place (no hops, drops or flinches); travelers glide flat. */
  reduced = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private last = new Float32Array(0);
  /** Called when a dropped token touches down (dust, number pop, sound). */
  onContact: ((id: TerritoryId) => void) | null = null;

  constructor(
    private anim: Animator,
    private tiles: TileSet,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0, envMapIntensity: 0.9 });
    this.materials.push(mat);
    const cap = TERRITORY_IDS.length + MAX_TRAVELERS;
    this.mesh = new THREE.InstancedMesh(tokenGeometry(), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.mesh);
    for (const id of TERRITORY_IDS) {
      const t: Tok = {
        id,
        base: [0.8, 0.75, 0.65],
        n: 0,
        scale: 0,
        pop: 1,
        hop: 0,
        squash: 1,
        dx: 0,
        ver: {},
        top: tiles.get(id).anchorW.clone(),
      };
      this.toks.set(id, t);
      this.list.push(t);
    }
    this.last = new Float32Array(this.list.length * 6);
  }

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

  /** Token fill for an owner's tile color: a touch deeper and richer than the tile, so it reads on it. */
  static fill(tile: RGB): RGB {
    return adjust(tile, 1.12, 0.8);
  }

  setColor(id: TerritoryId, tileColor: RGB): void {
    this.toks.get(id)!.base = TokenSystem.fill(tileColor);
    this.dirty = true;
  }

  /** Top-centre world position and visual size of a token (for the DOM number). */
  top(id: TerritoryId): THREE.Vector3 {
    return this.toks.get(id)!.top;
  }
  /** Drawn size multiplier (presence × pop); 0 = hidden. */
  visual(id: TerritoryId): number {
    const t = this.toks.get(id)!;
    return t.scale * t.pop;
  }
  /** Fresh top-centre position (not last frame's), for getScreenPosition. */
  freshTop(id: TerritoryId, out: THREE.Vector3): THREE.Vector3 {
    const t = this.toks.get(id)!;
    const tile = this.tiles.get(id);
    return out.set(tile.anchorW.x + t.dx, tile.pivot.position.y + TILE_TOP + t.hop + TOKEN_H * t.squash, tile.anchorW.z);
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

  /**
   * Change a territory's count. mode:
   * - 'snap'  no motion (sync, deal)
   * - 'drop'  placement: an empty tile's token drops in, an existing one hops; onContact on touchdown
   * - 'lift'  armies leave (march start / unplace): a small lift, or it lifts away if it empties
   * - 'hit'   dice losses: a flinch; knocked off the board if it empties
   * - 'land'  a traveler arrived: settle (appears at once if the tile was empty)
   * - 'out'   leave the board (conquered)
   */
  setArmies(id: TerritoryId, n: number, mode: 'snap' | 'drop' | 'lift' | 'hit' | 'land' | 'out', run: Run | null = null): void {
    const t = this.toks.get(id)!;
    const wasShown = t.scale > 0.5 && t.n > 0;
    t.n = n;
    this.dirty = true;
    const instant = this.anim.instant || (run && run.skipped);
    if (this.reduced && mode !== 'snap' && !instant) {
      // Steady: appear / leave with a short fade of size, no motion.
      if (mode === 'drop') this.onContact?.(id);
      const to = n > 0 ? 1 : 0;
      const from = t.scale;
      for (const k of ['pop', 'hop', 'squash', 'dx']) t.ver[k] = (t.ver[k] ?? 0) + 1;
      t.pop = 1;
      t.hop = 0;
      t.squash = 1;
      t.dx = 0;
      if (Math.abs(to - from) < 1e-3) return;
      this.tw(t, 'scale', { ms: 150, ease: ease.outQuad, run, update: (v) => (t.scale = from + (to - from) * v), done: () => (t.scale = to) });
      return;
    }
    if (mode === 'snap' || instant) {
      for (const k of ['scale', 'pop', 'hop', 'squash', 'dx']) t.ver[k] = (t.ver[k] ?? 0) + 1;
      t.scale = n > 0 ? 1 : 0;
      t.pop = 1;
      t.hop = 0;
      t.squash = 1;
      t.dx = 0;
      if (mode === 'drop' && instant) this.onContact?.(id);
      return;
    }
    if (n <= 0 || mode === 'out') {
      if (!wasShown && t.scale <= 0.001) {
        t.scale = 0;
        return;
      }
      const from = t.scale;
      const up = mode === 'lift' ? 0.5 : mode === 'hit' ? 0.25 : 0.15;
      const ms = mode === 'hit' ? 240 : 150;
      this.tw(t, 'scale', {
        ms,
        ease: ease.inQuad,
        run,
        update: (v) => {
          t.scale = from * (1 - v);
          t.hop = up * v;
        },
        done: () => {
          t.scale = 0;
          t.hop = 0;
        },
      });
      return;
    }
    // n > 0 from here
    if (!wasShown) {
      // Appear: drop in from above (placement) or settle in place (a landed traveler).
      t.ver.scale = (t.ver.scale ?? 0) + 1;
      t.scale = 1;
      if (mode === 'drop') {
        this.tw(t, 'hop', {
          ms: 170,
          ease: ease.inQuad,
          run,
          update: (v) => (t.hop = 1.6 * (1 - v)),
          done: () => {
            t.hop = 0;
            this.onContact?.(id);
            this.settle(t, run, 0.2);
          },
        });
      } else this.settle(t, run, mode === 'land' ? 0.16 : 0.1);
      return;
    }
    t.ver.scale = (t.ver.scale ?? 0) + 1;
    t.scale = 1;
    switch (mode) {
      case 'drop': {
        // A short hop, then down with a thunk.
        this.tw(t, 'hop', {
          ms: 150,
          ease: ease.linear,
          run,
          update: (v) => (t.hop = v < 0.4 ? 0.34 * ease.outQuad(v / 0.4) : 0.34 * (1 - ease.inQuad((v - 0.4) / 0.6))),
          done: () => {
            t.hop = 0;
            this.onContact?.(id);
            this.settle(t, run, 0.16);
          },
        });
        break;
      }
      case 'lift': {
        this.tw(t, 'hop', {
          ms: 180,
          ease: ease.linear,
          run,
          update: (v) => (t.hop = 0.22 * Math.sin(v * Math.PI)),
          done: () => (t.hop = 0),
        });
        break;
      }
      case 'hit': {
        this.tw(t, 'dx', {
          ms: 260,
          ease: ease.linear,
          run,
          update: (v) => {
            t.dx = Math.sin(v * Math.PI * 5) * 0.14 * (1 - v);
            t.squash = 1 - 0.28 * Math.sin(Math.min(1, v * 2.2) * Math.PI);
          },
          done: () => {
            t.dx = 0;
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
  pop(id: TerritoryId, amt = 0.14): void {
    const t = this.toks.get(id)!;
    if (this.anim.instant || this.reduced || t.scale <= 0) return;
    this.tw(t, 'pop', {
      ms: 160,
      ease: ease.linear,
      update: (v) => (t.pop = 1 + amt * Math.sin(v * Math.PI)),
      done: () => (t.pop = 1),
    });
  }

  /** A traveler token carrying `count` flies from a to b (via optional waypoints). Resolves on landing. */
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
  ): Promise<void> {
    if (this.anim.instant || (run && run.skipped) || this.movers.length >= MAX_TRAVELERS) return Promise.resolve();
    const a = this.freshTop(from, new THREE.Vector3());
    const b = this.tiles.get(to).anchorW.clone();
    b.y = TILE_TOP + this.tiles.get(to).pivot.position.y;
    a.y -= TOKEN_H * 0.2; // lifts off the top of the source stack
    const first = viaIds.length ? this.tiles.get(viaIds[0]).anchorW : b;
    // ...and slides off it toward where it's going, so its number never sits on the source's.
    const dx = first.x - a.x;
    const dz = first.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const off = Math.min(this.radius * 1.15, d * 0.35);
      a.x += (dx / d) * off;
      a.z += (dz / d) * off;
    }
    const pts = [a, ...viaIds.map((v) => this.tiles.get(v).anchorW.clone().setY(TILE_TOP)), b];
    const tr: Traveler = { n: count, ink, top: a.clone(), alive: true, color: TokenSystem.fill(tileColor), pts, t: 0, arc };
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

  /** World position on the tile top at a token (for dust). */
  dustPoint(id: TerritoryId, out: THREE.Vector3): THREE.Vector3 {
    const tile = this.tiles.get(id);
    return out.set(tile.anchorW.x, TILE_TOP + tile.pivot.position.y + 0.02, tile.anchorW.z + this.radius * 0.6);
  }

  /** Write instance matrices/colors. Cheap; uploads only when something changed. */
  update(): void {
    const R = this.radius;
    const L = this.last;
    // Tile lifts, flips and dims move tokens without a token tween: compare against last frame.
    for (let i = 0; i < this.list.length; i++) {
      const tile = this.tiles.get(this.list[i].id);
      const y = tile.pivot.position.y;
      const fx = tile.pivot.scale.x;
      const d = tile.dim;
      const o = i * 6;
      if (L[o] !== y || L[o + 1] !== fx || L[o + 2] !== d) {
        L[o] = y;
        L[o + 1] = fx;
        L[o + 2] = d;
        this.dirty = true;
      }
    }
    if (!this.dirty && !this.movers.length) return;
    this.dirty = false;
    let k = 0;
    const m = this.m;
    this.q.identity();
    for (const t of this.list) {
      const tile = this.tiles.get(t.id);
      const y0 = tile.pivot.position.y + TILE_TOP;
      t.top.set(tile.anchorW.x + t.dx, y0 + t.hop + TOKEN_H * t.squash, tile.anchorW.z);
      if (t.scale <= 0.001) continue;
      const sc = R * t.scale * t.pop;
      this.p.set(tile.anchorW.x + t.dx, y0 + t.hop, tile.anchorW.z);
      this.s.set(sc * Math.max(0.001, tile.pivot.scale.x), t.squash * Math.max(0.2, t.scale), sc);
      m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(k, m);
      let c = t.base;
      if (tile.dim > 0) c = adjust(c, 1 - 0.25 * tile.dim, 1 - 0.38 * tile.dim);
      this.c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
      this.mesh.setColorAt(k, this.c);
      k++;
    }
    for (const tr of this.movers) {
      const pts = tr.pts;
      const segs = pts.length - 1;
      const u = tr.t * segs;
      const j = Math.min(segs - 1, Math.floor(u));
      const lt = u - j;
      const a = pts[j];
      const b = pts[j + 1];
      this.p.lerpVectors(a, b, lt);
      const hopH = this.reduced ? 0 : segs > 1 ? 0.45 : tr.arc;
      this.p.y += Math.sin(lt * Math.PI) * hopH;
      tr.top.set(this.p.x, this.p.y + TOKEN_H, this.p.z);
      this.s.set(R, 1, R);
      m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(k, m);
      this.c.setRGB(tr.color[0], tr.color[1], tr.color[2], THREE.SRGBColorSpace);
      this.mesh.setColorAt(k, this.c);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    for (const m of this.materials) m.dispose();
  }
}
