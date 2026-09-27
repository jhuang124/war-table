// Continent contours (soft coast halos) and engraved ocean labels ("ASIA · +7"), recolored to the
// holder, with "1 AWAY" in the chasing player's light tint.
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

interface Cont {
  id: ContinentId;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  label: THREE.Mesh;
  labelMat: THREE.MeshBasicMaterial;
  away: THREE.Mesh;
  awayMat: THREE.MeshBasicMaterial;
  holder: PlayerId;
  chaser: PlayerId;
  // animated
  labelRgb: RGB;
  labelA: number;
  haloRgb: RGB;
  haloA: number;
  awayRgb: RGB;
  awayA: number;
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
      let h = 1.72;
      let w = h * aspect;
      if (w > room * 1.08) {
        w = room * 1.08;
        h = w / aspect;
      }
      const labelMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.84,
        toneMapped: false,
      });
      setColor(labelMat.color, NEUTRAL_LABEL);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMat);
      label.rotation.x = -Math.PI / 2;
      toWorld(la[0], la[1], 0.03, label.position);
      label.renderOrder = 2;
      this.group.add(label);

      const at = textTexture([{ text: '1 AWAY', font: `700 {px}px ${FONT_SANS}`, tracking: 0.16 }]);
      const ah = Math.max(h * 0.78, 1.0);
      const aw = ah * at.aspect;
      const awayMat = new THREE.MeshBasicMaterial({
        map: at.texture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
      });
      const away = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah), awayMat);
      away.rotation.x = -Math.PI / 2;
      toWorld(la[0], la[1] - h * 0.5 - ah * 0.45, 0.03, away.position);
      away.renderOrder = 2;
      this.group.add(away);

      this.materials.push(haloMat, labelMat, awayMat);
      this.conts.set(id, {
        id,
        halo,
        haloMat,
        label,
        labelMat,
        away,
        awayMat,
        holder: -2,
        chaser: -2,
        labelRgb: NEUTRAL_LABEL,
        labelA: 0.84,
        haloRgb: NEUTRAL_HALO,
        haloA: 0.1,
        awayRgb: [1, 1, 1],
        awayA: 0,
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
    setColor(c.awayMat.color, c.awayRgb);
    c.awayMat.opacity = c.awayA;
    c.away.visible = c.awayA > 0.01;
  }

  /** Seat colors changed (new game): force the next refresh to recolor every label. */
  invalidate(): void {
    for (const c of this.conts.values()) {
      c.holder = -2;
      c.chaser = -2;
    }
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
      let chaser: PlayerId = -1;
      for (const [p, n] of counts) {
        if (n === ts.length) holder = p;
        else if (n === ts.length - 1) chaser = p;
      }
      if (holder === c.holder && chaser === c.chaser) continue;
      c.holder = holder;
      c.chaser = chaser;
      const pal = holder >= 0 && state?.players[holder] ? PLAYER_COLORS[state.players[holder].color] : null;
      const cpal = chaser >= 0 && state?.players[chaser] ? PLAYER_COLORS[state.players[chaser].color] : null;
      const toLabel: RGB = pal ? mixRgb(hexToRgb(pal.base), hexToRgb(pal.light), 0.35) : NEUTRAL_LABEL;
      const toLabelA = pal ? 1 : 0.84;
      const toHalo: RGB = pal ? hexToRgb(pal.base) : NEUTRAL_HALO;
      const toHaloA = pal ? 0.62 : 0.1;
      const toAway: RGB = cpal ? hexToRgb(cpal.light) : c.awayRgb;
      const toAwayA = cpal ? 0.95 : 0;
      const from = {
        l: c.labelRgb,
        la: c.labelA,
        h: c.haloRgb,
        ha: c.haloA,
        a: c.awayRgb,
        aa: c.awayA,
      };
      const ver = ++c.ver;
      const step = (v: number) => {
        if (c.ver !== ver) return;
        c.labelRgb = mixRgb(from.l, toLabel, v);
        c.labelA = from.la + (toLabelA - from.la) * v;
        c.haloRgb = mixRgb(from.h, toHalo, v);
        c.haloA = from.ha + (toHaloA - from.ha) * v;
        c.awayRgb = cpal ? toAway : from.a;
        c.awayA = from.aa + (toAwayA - from.aa) * v;
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

  labelCenter(id: ContinentId): THREE.Vector3 {
    return this.conts.get(id)!.label.position;
  }

  dispose(): void {
    for (const c of this.conts.values()) {
      c.halo.geometry.dispose();
      c.label.geometry.dispose();
      c.away.geometry.dispose();
      c.haloMat.map?.dispose();
      c.labelMat.map?.dispose();
      c.awayMat.map?.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
