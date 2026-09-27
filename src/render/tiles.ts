// Territory tiles: extruded, bevelled, per-tile materials (owner color, dim, hover light, flash,
// conquest flood), ivory rims, and the flat footprint data used for picking.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { BoardGeometry, Vec2 } from '../map/types';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS } from '../engine/mapData';
import { BEVEL_S, BEVEL_T, TILE_DEPTH, TILE_TOP, adjust, mixRgb, setColor, toWorld, type RGB, hexToRgb, IVORY, distToRing } from './util';

export type RimMode = 'none' | 'selectable' | 'selected' | 'target' | 'armed';

export interface Tile {
  id: TerritoryId;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  top: THREE.MeshStandardMaterial;
  side: THREE.MeshStandardMaterial;
  uniforms: {
    uFloodColor: { value: THREE.Color };
    uFloodOrigin: { value: THREE.Vector2 };
    uFloodR: { value: number };
    uFloodOn: { value: number };
  };
  rimUnder: LineSegments2;
  rimIvory: LineSegments2;
  rimUnderMat: LineMaterial;
  rimIvoryMat: LineMaterial;
  /** World-space anchor at the un-lifted tile top. */
  anchorW: THREE.Vector3;
  anchor: Vec2;
  rings: Vec2[][];
  bbox: [number, number, number, number];
  /** Max distance from the anchor to any vertex (board units). */
  radius: number;
  /** Clear radius around the anchor inside the tile (board units). */
  clearance: number;
  /** Badge sits this far south of the anchor; the formation this far north (board units). */
  badgeDz: number;
  formDz: number;
  // --- displayed look (animated)
  rgb: RGB; // owner color currently shown (before dim/light)
  dim: number; // 0..1
  light: number; // 0..1 hover lightness
  flash: number; // 0..1 ivory flash
  flashColor: RGB;
  tint: number; // 0..1 wave tint toward tintColor
  tintColor: RGB;
  hoverLift: number;
  selectLift: number;
  press: number;
  fxLift: number;
  flipX: number; // 1 = normal, 0 = edge-on
  rimMode: RimMode;
  rimAlpha: number; // animated rim opacity target multiplier
  dirty: boolean;
  ver: Record<string, number>;
}

const FLOOD_SOFT = 0.9;

export class TileSet {
  group = new THREE.Group();
  tiles = new Map<TerritoryId, Tile>();
  list: Tile[] = [];
  private entry = new Map<string, Vec2>();
  materials: THREE.Material[] = [];
  private lineMats: LineMaterial[] = [];

  constructor(g: BoardGeometry, grain: THREE.Texture) {
    const ivory = new THREE.Color(IVORY);
    for (const id of TERRITORY_IDS) {
      const tg = g.territories[id];
      const anchorW = toWorld(tg.anchor[0], tg.anchor[1], TILE_TOP);
      const shapes: THREE.Shape[] = [];
      const rings: Vec2[][] = [];
      for (const p of tg.polygons) {
        rings.push(p.outer);
        const s = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
        for (const h of p.holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
        shapes.push(s);
      }
      const geo = new THREE.ExtrudeGeometry(shapes, {
        depth: TILE_DEPTH,
        bevelEnabled: true,
        bevelThickness: BEVEL_T,
        bevelSize: BEVEL_S,
        bevelOffset: -BEVEL_S,
        bevelSegments: 2,
        curveSegments: 1,
      });
      // shape (x, y, z) → world (x − W/2, z, H/2 − y), then relative to the anchor.
      geo.rotateX(-Math.PI / 2);
      geo.translate(-g.width / 2 - anchorW.x, 0, g.height / 2 - anchorW.z);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();

      const uniforms = {
        uFloodColor: { value: new THREE.Color() },
        uFloodOrigin: { value: new THREE.Vector2() },
        uFloodR: { value: 0 },
        uFloodOn: { value: 0 },
      };
      const top = new THREE.MeshStandardMaterial({ color: '#cbbd9b', map: grain, roughness: 0.78, metalness: 0 });
      top.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vFloodP;')
          .replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\nvFloodP = (modelMatrix * vec4(transformed, 1.0)).xz;',
          );
        sh.fragmentShader = sh.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            varying vec2 vFloodP;
            uniform vec3 uFloodColor; uniform vec2 uFloodOrigin; uniform float uFloodR; uniform float uFloodOn;`,
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            if (uFloodOn > 0.5) {
              float fd = distance(vFloodP, uFloodOrigin);
              float k = smoothstep(uFloodR, uFloodR - ${FLOOD_SOFT.toFixed(2)}, fd);
              float edge = exp(-pow((fd - uFloodR + 0.35) / 0.28, 2.0)) * step(0.01, uFloodR);
              diffuseColor.rgb = mix(diffuseColor.rgb, uFloodColor, k) + edge * 0.10;
            }`,
          );
      };
      top.customProgramCacheKey = () => 'tile-top-v1';
      // UVs are board units; the grain tiles every 9 units.
      grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
      grain.repeat.set(1 / 9, 1 / 9);
      const side = new THREE.MeshStandardMaterial({ color: '#7a6a50', roughness: 0.7, metalness: 0 });
      const mesh = new THREE.Mesh(geo, [top, side]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.territory = id;
      const pivot = new THREE.Group();
      pivot.position.set(anchorW.x, 0, anchorW.z);
      pivot.add(mesh);

      // Rims: the tile outline at the bevel shoulder, relative to the pivot.
      const segs: number[] = [];
      const yRim = TILE_DEPTH + BEVEL_T * 0.55;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const wa = toWorld(a[0], a[1], yRim);
          const wb = toWorld(b[0], b[1], yRim);
          segs.push(wa.x - anchorW.x, wa.y, wa.z - anchorW.z, wb.x - anchorW.x, wb.y, wb.z - anchorW.z);
        }
      }
      const lg = new LineSegmentsGeometry();
      lg.setPositions(segs);
      const rimUnderMat = new LineMaterial({
        color: 0x0b0d10,
        linewidth: 4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const rimIvoryMat = new LineMaterial({
        color: ivory.getHex(),
        linewidth: 2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      this.lineMats.push(rimUnderMat, rimIvoryMat);
      const rimUnder = new LineSegments2(lg, rimUnderMat);
      const rimIvory = new LineSegments2(lg, rimIvoryMat);
      rimUnder.renderOrder = 3;
      rimIvory.renderOrder = 4;
      rimUnder.visible = rimIvory.visible = false;
      mesh.add(rimUnder, rimIvory);

      let radius = 0;
      for (const ring of rings)
        for (const [x, y] of ring) radius = Math.max(radius, Math.hypot(x - tg.anchor[0], y - tg.anchor[1]));
      let clearance = Infinity;
      for (const ring of rings) clearance = Math.min(clearance, distToRing(tg.anchor[0], tg.anchor[1], ring));
      const badgeDz = Math.max(0.1, Math.min(0.75, (clearance - 1.3) * 0.55 + 0.1));
      const formDz = Math.max(0.35, Math.min(1.25, clearance - 1.15));

      const tile: Tile = {
        id,
        pivot,
        mesh,
        top,
        side,
        uniforms,
        rimUnder,
        rimIvory,
        rimUnderMat,
        rimIvoryMat,
        anchorW,
        anchor: tg.anchor,
        rings,
        bbox: tg.bbox,
        radius,
        clearance,
        badgeDz,
        formDz,
        rgb: hexToRgb('#cbbd9b'),
        dim: 0,
        light: 0,
        flash: 0,
        flashColor: hexToRgb(IVORY),
        tint: 0,
        tintColor: [1, 1, 1],
        hoverLift: 0,
        selectLift: 0,
        press: 0,
        fxLift: 0,
        flipX: 1,
        rimMode: 'none',
        rimAlpha: 0,
        dirty: true,
        ver: {},
      };
      this.tiles.set(id, tile);
      this.list.push(tile);
      this.group.add(pivot);
      this.materials.push(top, side);
    }
    this.buildEntryPoints(g);
  }

  get(id: TerritoryId): Tile {
    return this.tiles.get(id)!;
  }

  /** Point (board coords) on `to`'s edge where an attack/march from `from` enters. */
  entryPoint(from: TerritoryId, to: TerritoryId): Vec2 {
    return this.entry.get(`${from}|${to}`) ?? this.get(to).anchor;
  }

  private buildEntryPoints(g: BoardGeometry): void {
    const key = (p: Vec2) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    const vertsOf = new Map<TerritoryId, Set<string>>();
    for (const id of TERRITORY_IDS) {
      const s = new Set<string>();
      for (const p of g.territories[id].polygons) for (const v of p.outer) s.add(key(v));
      vertsOf.set(id, s);
    }
    for (const a of TERRITORY_IDS) {
      for (const b of TERRITORY_IDS) {
        if (a === b) continue;
        const sa = vertsOf.get(a)!;
        const shared: Vec2[] = [];
        for (const p of g.territories[b].polygons) for (const v of p.outer) if (sa.has(key(v))) shared.push(v);
        if (shared.length >= 2) {
          // centroid of the shared vertices, snapped to the nearest shared vertex
          let cx = 0;
          let cy = 0;
          for (const v of shared) {
            cx += v[0];
            cy += v[1];
          }
          cx /= shared.length;
          cy /= shared.length;
          let best = shared[0];
          let bd = Infinity;
          for (const v of shared) {
            const d = (v[0] - cx) ** 2 + (v[1] - cy) ** 2;
            if (d < bd) {
              bd = d;
              best = v;
            }
          }
          this.entry.set(`${a}|${b}`, best);
        }
      }
    }
    for (const lane of g.seaLanes) {
      for (const [from, to] of [
        [lane.a, lane.b],
        [lane.b, lane.a],
      ] as const) {
        const anchor = g.territories[to].anchor;
        let best: Vec2 = anchor;
        let bd = Infinity;
        for (const seg of lane.segments)
          for (const p of [seg[0], seg[seg.length - 1]]) {
            const d = (p[0] - anchor[0]) ** 2 + (p[1] - anchor[1]) ** 2;
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
        this.entry.set(`${from}|${to}`, best);
      }
    }
  }

  setResolution(w: number, h: number): void {
    for (const m of this.lineMats) m.resolution.set(w, h);
  }

  /** Recompute a tile's material colors and transform from its animated fields. */
  apply(t: Tile, pulse: number, rimScale: number): void {
    const lift = t.hoverLift + t.selectLift + t.press + t.fxLift;
    t.pivot.position.y = lift;
    t.pivot.scale.x = Math.max(0.001, t.flipX);
    if (!t.dirty && t.rimMode !== 'target') return;
    if (t.dirty) {
      let c = t.rgb;
      if (t.dim > 0) c = adjust(c, 1 - 0.25 * t.dim, 1 - 0.38 * t.dim);
      if (t.light > 0) c = adjust(c, 1, 1, 0.08 * t.light);
      if (t.tint > 0) c = mixRgb(c, t.tintColor, t.tint * 0.7);
      setColor(t.top.color, c);
      setColor(t.side.color, adjust(c, 1.05, 0.52));
      const fl = t.flash * 0.16;
      const ti = t.tint * 0.34;
      if (fl > 0 || ti > 0) {
        setColor(t.top.emissive, ti >= fl ? t.tintColor : t.flashColor);
        t.top.emissiveIntensity = Math.max(fl, ti);
      } else t.top.emissiveIntensity = 0;
    }
    // Rims
    let a = 0;
    let w = 2;
    switch (t.rimMode) {
      case 'selectable':
        a = 0.3;
        w = 2;
        break;
      case 'selected':
        a = 1;
        w = 3;
        break;
      case 'target':
        a = pulse;
        w = 2.5;
        break;
      case 'armed':
        a = 0.95;
        w = 2.5;
        break;
    }
    a *= t.rimAlpha;
    const vis = a > 0.01;
    t.rimIvory.visible = t.rimUnder.visible = vis;
    if (vis) {
      t.rimIvoryMat.opacity = a;
      t.rimIvoryMat.linewidth = w * rimScale;
      t.rimUnderMat.opacity = Math.min(1, a * 0.75);
      t.rimUnderMat.linewidth = (w + 2) * rimScale;
    }
    t.dirty = false;
  }

  dispose(): void {
    for (const t of this.list) {
      t.mesh.geometry.dispose();
      t.rimIvory.geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
    for (const m of this.lineMats) m.dispose();
  }
}

export { TILE_TOP };
