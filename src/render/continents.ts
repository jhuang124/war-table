// Continent contours (soft coast halos) and quiet engraved ocean labels ("ASIA · +7"), recolored to
// the holder once someone holds the whole continent.
import * as THREE from 'three';
import type { BoardGeometry, Vec2 } from '../map/types';
import type { ContinentId, GameState, PlayerId, TerritoryId } from '../engine/types';
import { CONTINENTS, CONTINENT_IDS } from '../engine/mapData';
import { PLAYER_COLORS } from '../shared/palette';
import { Animator, ease } from './anim';
import { FONT_SANS, FONT_SERIF_CAPS, haloTexture, textTexture } from './textures';
import { hexToRgb, mixRgb, setColor, toWorld, type RGB } from './util';

const NEUTRAL_LABEL: RGB = hexToRgb('#d9cfb6');
const NEUTRAL_HALO: RGB = hexToRgb('#e8dcc0');
/** Label opacity: unheld labels are a quiet engraving; a held one takes its holder's color. */
const LABEL_A = 0.5;
const HELD_LABEL_A = 0.78;

interface Cont {
  id: ContinentId;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  label: THREE.Mesh;
  labelMat: THREE.MeshBasicMaterial;
  holder: PlayerId;
  // animated
  labelRgb: RGB;
  labelA: number;
  haloRgb: RGB;
  haloA: number;
  flare: number;
  ver: number;
}

export class Continents {
  group = new THREE.Group();
  private conts = new Map<ContinentId, Cont>();
  materials: THREE.Material[] = [];
  reducedMotion = false;

  constructor(
    g: BoardGeometry,
    private anim: Animator,
  ) {
    for (const id of CONTINENT_IDS) {
      const info = CONTINENTS[id];
      const rings: Vec2[][] = [];
      for (const t of info.territories) for (const p of g.territories[t].polygons) rings.push(p.outer);
      const ht = haloTexture(rings);
      const haloMat = new THREE.MeshBasicMaterial({
        map: ht.texture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
      });
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(ht.w, ht.h), haloMat);
      halo.rotation.x = -Math.PI / 2;
      toWorld(ht.minX + ht.w / 2, ht.minY + ht.h / 2, 0.012, halo.position);
      halo.renderOrder = 1;
      this.group.add(halo);

      // Label: name in Cinzel caps, the bonus in Inter (numbers are never Cinzel).
      const la = g.continents[id].labelAnchor;
      const room = g.continents[id].labelRoom ?? 10;
      const { texture, aspect } = textTexture([
        { text: info.name.toUpperCase(), font: `600 {px}px ${FONT_SERIF_CAPS}`, tracking: 0.07 },
        { text: '  ·  ', font: `500 {px}px ${FONT_SANS}` },
        { text: `+${info.bonus}`, font: `650 {px}px ${FONT_SANS}` },
      ]);
      let h = 1.5;
      let w = h * aspect;
      if (w > room * 1.08) {
        w = room * 1.08;
        h = w / aspect;
      }
      const labelMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: LABEL_A,
        toneMapped: false,
      });
      setColor(labelMat.color, NEUTRAL_LABEL);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMat);
      label.rotation.x = -Math.PI / 2;
      toWorld(la[0], la[1], 0.03, label.position);
      label.renderOrder = 2;
      this.group.add(label);
      this.anchors.set(id, label.position.clone());
      this.rooms.set(id, room * 0.96);

      this.materials.push(haloMat, labelMat);
      this.conts.set(id, {
        id,
        halo,
        haloMat,
        label,
        labelMat,
        holder: -2,
        labelRgb: NEUTRAL_LABEL,
        labelA: LABEL_A,
        haloRgb: NEUTRAL_HALO,
        haloA: 0.1,
        flare: 0,
        ver: 0,
      });
    }
    for (const c of this.conts.values()) this.apply(c);
  }

  private apply(c: Cont): void {
    setColor(c.labelMat.color, c.labelRgb);
    c.labelMat.opacity = c.labelA;
    const flareRgb = mixRgb(c.haloRgb, [1, 1, 1], c.flare * 0.35);
    setColor(c.haloMat.color, flareRgb);
    c.haloMat.opacity = Math.min(1, c.haloA + c.flare * (0.95 - c.haloA));
  }

  /** Seat colors changed (new game): force the next refresh to recolor every label. */
  invalidate(): void {
    for (const c of this.conts.values()) c.holder = -2;
  }

  /** Recompute holders from displayed owners. Crossfades over 300 ms unless `snap`. */
  refresh(owners: Record<TerritoryId, PlayerId>, state: GameState | null, snap: boolean): void {
    for (const c of this.conts.values()) {
      const ts = CONTINENTS[c.id].territories;
      const counts = new Map<PlayerId, number>();
      for (const t of ts) {
        const o = owners[t];
        if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
      }
      let holder: PlayerId = -1;
      for (const [p, n] of counts) if (n === ts.length) holder = p;
      if (holder === c.holder) continue;
      c.holder = holder;
      const pal = holder >= 0 && state?.players[holder] ? PLAYER_COLORS[state.players[holder].color] : null;
      const toLabel: RGB = pal ? mixRgb(hexToRgb(pal.base), hexToRgb(pal.light), 0.35) : NEUTRAL_LABEL;
      const toLabelA = pal ? HELD_LABEL_A : LABEL_A;
      const toHalo: RGB = pal ? hexToRgb(pal.base) : NEUTRAL_HALO;
      const toHaloA = pal ? 0.62 : 0.1;
      const from = {
        l: c.labelRgb,
        la: c.labelA,
        h: c.haloRgb,
        ha: c.haloA,
      };
      const ver = ++c.ver;
      const step = (v: number) => {
        if (c.ver !== ver) return;
        c.labelRgb = mixRgb(from.l, toLabel, v);
        c.labelA = from.la + (toLabelA - from.la) * v;
        c.haloRgb = mixRgb(from.h, toHalo, v);
        c.haloA = from.ha + (toHaloA - from.ha) * v;
        this.apply(c);
      };
      if (snap) step(1);
      else this.anim.tween({ ms: 300, ease: ease.inOutQuad, update: step });
    }
  }

  /** Contour flare in the holder's color: 250 in / 400 hold / 500 out. Resolves after the hold. */
  async flare(id: ContinentId, color: string, run: import('./anim').Run | null): Promise<void> {
    const c = this.conts.get(id)!;
    const rgb = hexToRgb(color);
    c.haloRgb = rgb;
    const set = (v: number) => {
      c.flare = v;
      this.apply(c);
    };
    await this.anim.tween({ ms: this.reducedMotion ? 150 : 250, ease: ease.outCubic, update: set, run });
    await this.anim.wait(400, run);
    // the fade-out doesn't block the queue
    this.anim.tween({ ms: 500, ease: ease.inOutQuad, update: (v) => set(1 - v) });
  }

  /**
   * Keep every label on screen at the home view. The land now spans nearly the full width, so a label
   * anchored in open ocean off a board edge (North America's) can run off the canvas: it then shrinks
   * toward the inner end of its clear water (labelRoom) until it clears the edge, never into the land.
   */
  fitLabels(cam: THREE.Camera, W: number): void {
    const margin = Math.max(10, W * 0.012);
    const v = new THREE.Vector3();
    for (const c of this.conts.values()) {
      const home = this.anchors.get(c.id)!;
      const room = this.rooms.get(c.id)!;
      c.label.position.x = home.x;
      c.label.scale.set(1, 1, 1);
      const g = c.label.geometry as THREE.PlaneGeometry;
      const hw = (g.parameters.width / 2) * 0.88; // the texture pads either side of the text
      const px = (x: number) => (v.set(x, home.y, home.z).project(cam).x * 0.5 + 0.5) * W;
      const l = px(home.x - hw);
      const r = px(home.x + hw);
      if (l >= margin && r <= W - margin) continue;
      const upp = (2 * hw) / Math.max(1, r - l);
      // Inner limit: the end of the label's clear water on the board side (or its own inner end).
      const west = l < margin;
      const innerX = west ? Math.max(home.x + hw, home.x + room / 2) : Math.min(home.x - hw, home.x - room / 2);
      const outerX = west ? home.x - hw + (margin - l) * upp : home.x + hw - (r - (W - margin)) * upp;
      const k = Math.max(0.6, Math.min(1, Math.abs(innerX - outerX) / (2 * hw)));
      c.label.scale.set(k, k, 1);
      c.label.position.x = west ? outerX + hw * k : outerX - hw * k;
    }
  }
  private rooms = new Map<ContinentId, number>();
  private anchors = new Map<ContinentId, THREE.Vector3>();

  labelCenter(id: ContinentId): THREE.Vector3 {
    return this.conts.get(id)!.label.position;
  }

  dispose(): void {
    for (const c of this.conts.values()) {
      c.halo.geometry.dispose();
      c.label.geometry.dispose();
      c.haloMat.map?.dispose();
      c.labelMat.map?.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
