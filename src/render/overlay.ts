// DOM overlay above the canvas: army badges (with seat emblems), +N ghosts, −N loss chips,
// territory names. All transforms are written in one batch per frame, and only when they change.
import * as THREE from 'three';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS, TERRITORIES } from '../engine/mapData';
import { EMBLEM_PATHS, type PlayerPalette } from '../shared/palette';
import type { BoardGeometry } from '../map/types';
import { TILE_TOP, toWorld } from './util';
import type { TileSet } from './tiles';
import { Animator, ease } from './anim';

const CSS = `
.rb-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;contain:strict}
.rb-vignette{position:absolute;inset:0;background:radial-gradient(ellipse 75% 70% at 50% 46%,rgba(0,0,0,0) 58%,rgba(4,5,7,.5) 100%)}
.rb-badge{position:absolute;left:0;top:0;display:flex;align-items:center;gap:3px;height:22px;box-sizing:border-box;
  padding:0 7px 0 5px;border-radius:12px;background:rgba(18,21,26,.9);
  box-shadow:0 0 0 2.5px var(--ring),0 0 0 3.5px rgba(8,9,12,.55),0 3px 8px rgba(0,0,0,.5);
  color:#f3ead8;font:700 15px/1 'Inter Variable',Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums lining-nums;
  letter-spacing:.01em;white-space:nowrap;will-change:transform;transform-origin:50% 50%;visibility:hidden}
.rb-badge svg{width:11px;height:11px;flex:none;display:block}
.rb-badge svg path{fill:var(--tint)}
.rb-badge .n{display:block;min-width:.6em;text-align:center;padding-top:1px}
.rb-badge.zero .n{opacity:.55}
.rb-badge{transition:opacity 180ms ease-out}
.rb-badge.dim{opacity:.58}
.rb-badge.ghosted{z-index:2}
.rb-ghost{position:absolute;left:calc(100% + 6px);top:50%;transform:translateY(-50%);height:18px;padding:0 6px;border-radius:9px;
  background:#f3ead8;color:#12151a;font:700 13px/18px 'Inter Variable',Inter,system-ui,sans-serif;
  font-variant-numeric:tabular-nums lining-nums;box-shadow:0 0 0 1px rgba(12,14,18,.8),0 2px 6px rgba(0,0,0,.45);display:none}
.rb-loss{position:absolute;left:0;top:0;height:20px;padding:0 7px;border-radius:10px;background:rgba(18,21,26,.94);
  color:#f3ead8;font:700 14px/20px 'Inter Variable',Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums lining-nums;
  box-shadow:0 0 0 1px rgba(243,234,216,.35),0 2px 6px rgba(0,0,0,.5);will-change:transform,opacity;white-space:nowrap}
.rb-label{position:absolute;left:0;top:0;color:rgba(243,234,216,.9);font:650 9px/1.05 'Inter Variable',Inter,system-ui,sans-serif;
  letter-spacing:.07em;text-transform:uppercase;text-align:center;white-space:pre;will-change:transform;transform-origin:50% 0;
  text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.6);visibility:hidden}
.rb-cut{position:absolute;inset:0;background:#0c0f13;opacity:0}
`;

interface Badge {
  id: TerritoryId;
  el: HTMLDivElement;
  num: HTMLSpanElement;
  svg: SVGSVGElement;
  path: SVGPathElement;
  ghost: HTMLSpanElement;
  world: THREE.Vector3;
  shown: number; // displayed number
  visible: boolean;
  pop: number; // scale multiplier from pops
  lastT: string;
  lastRing: string;
  lastEmblem: string;
  ghostN: number;
  x: number;
  y: number;
  onScreen: boolean;
  /** Cached unscaled layout size for the label collision pass (0 = measure again). */
  w: number;
  h: number;
}

interface Label {
  el: HTMLDivElement;
  world: THREE.Vector3;
  lastT: string;
  /** Unscaled layout size (measured once the font is in), for the collision pass. */
  w: number;
  h: number;
  /** Current collision verdict: hidden names never overlap a badge or another name. */
  hidden: boolean;
  x: number;
  y: number;
  s: number;
}

interface Chip {
  el: HTMLDivElement;
  id: TerritoryId;
  t: number;
  dx: number;
  lastT: string;
}

export class Overlay {
  root: HTMLDivElement;
  cut: HTMLDivElement;
  private badges = new Map<TerritoryId, Badge>();
  private labels: Label[] = [];
  private chips: Chip[] = [];
  private v = new THREE.Vector3();
  private showLabels = false;
  get labelsOn(): boolean {
    return this.showLabels;
  }
  uiScale = 1;
  zoomScale = 1;
  private labelsDirty = true;
  width = 1;
  height = 1;

  constructor(
    container: HTMLElement,
    g: BoardGeometry,
    private tiles: TileSet,
    private anim: Animator,
  ) {
    if (!document.getElementById('rb-style')) {
      const st = document.createElement('style');
      st.id = 'rb-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'rb-overlay';
    const vig = document.createElement('div');
    vig.className = 'rb-vignette';
    this.root.appendChild(vig);
    const labelLayer = document.createElement('div');
    this.root.appendChild(labelLayer);
    const badgeLayer = document.createElement('div');
    this.root.appendChild(badgeLayer);
    this.cut = document.createElement('div');
    this.cut.className = 'rb-cut';
    this.root.appendChild(this.cut);
    container.appendChild(this.root);

    const NS = 'http://www.w3.org/2000/svg';
    for (const id of TERRITORY_IDS) {
      const t = tiles.get(id);
      const el = document.createElement('div');
      el.className = 'rb-badge';
      const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS(NS, 'path') as SVGPathElement;
      svg.appendChild(path);
      const num = document.createElement('span');
      num.className = 'n';
      const ghost = document.createElement('span');
      ghost.className = 'rb-ghost';
      el.append(svg, num, ghost);
      badgeLayer.appendChild(el);
      this.badges.set(id, {
        id,
        el,
        num,
        svg,
        path,
        ghost,
        world: new THREE.Vector3(t.anchorW.x, TILE_TOP + 0.05, t.anchorW.z + t.badgeDz),
        shown: -1,
        visible: false,
        pop: 1,
        lastT: '',
        lastRing: '',
        lastEmblem: '',
        ghostN: 0,
        x: 0,
        y: 0,
        onScreen: false,
        w: 0,
        h: 0,
      });

      const lab = document.createElement('div');
      lab.className = 'rb-label';
      const name = TERRITORIES[id].name.toUpperCase();
      lab.textContent = splitName(name);
      labelLayer.appendChild(lab);
      const la = g.territories[id].labelAnchor;
      this.labels.push({ el: lab, world: toWorld(la[0], la[1], TILE_TOP + 0.02), lastT: '', w: 0, h: 0, hidden: false, x: 0, y: 0, s: 1 });
    }
  }

  setBadge(id: TerritoryId, n: number, pal: PlayerPalette | null, pop = false): void {
    const b = this.badges.get(id)!;
    const vis = !!pal;
    if (b.visible !== vis) {
      b.visible = vis;
      if (!vis) b.el.style.visibility = 'hidden';
      b.lastT = '';
      this.labelsDirty = true;
    }
    if (!pal) return;
    if (b.shown !== n) {
      if (String(b.shown).length !== String(n).length) {
        this.labelsDirty = true;
        b.w = 0;
      }
      b.num.textContent = String(n);
      b.el.classList.toggle('zero', n === 0);
      b.shown = n;
    }
    if (b.lastRing !== pal.base) {
      b.el.style.setProperty('--ring', pal.base);
      b.el.style.setProperty('--tint', pal.light);
      b.lastRing = pal.base;
    }
    if (b.lastEmblem !== pal.emblem) {
      b.path.setAttribute('d', EMBLEM_PATHS[pal.emblem]);
      b.lastEmblem = pal.emblem;
    }
    if (pop) this.pop(id);
  }

  /** Badges of dimmed tiles recede (still legible) so the choice in play leads. */
  setDim(id: TerritoryId, on: boolean): void {
    const b = this.badges.get(id)!;
    if (b.el.classList.contains('dim') !== on) b.el.classList.toggle('dim', on);
  }

  hideBadge(id: TerritoryId): void {
    const b = this.badges.get(id)!;
    b.visible = false;
    b.el.style.visibility = 'hidden';
    this.labelsDirty = true;
  }

  pop(id: TerritoryId): void {
    const b = this.badges.get(id)!;
    if (this.anim.instant) return;
    this.anim.tween({
      ms: 160,
      unscaled: true,
      ease: ease.linear,
      update: (v) => {
        b.pop = 1 + 0.18 * Math.sin(v * Math.PI);
        b.lastT = '';
      },
    });
  }

  setGhost(id: TerritoryId, n: number): void {
    const b = this.badges.get(id)!;
    if (b.ghostN === n) return;
    b.ghostN = n;
    // The chip hangs off the badge's right edge, over where the next badge may sit; lift the whole
    // badge above its neighbours so the pending count is never hidden under a later sibling.
    b.el.classList.toggle('ghosted', n > 0);
    if (n > 0) {
      b.ghost.textContent = `+${n}`;
      b.ghost.style.display = 'block';
    } else b.ghost.style.display = 'none';
  }

  /** A rising "−N" chip beside a territory's badge (700 ms). */
  lossChip(id: TerritoryId, n: number, side: -1 | 1 = 1): void {
    if (n <= 0) return;
    const el = document.createElement('div');
    el.className = 'rb-loss';
    el.textContent = `−${n}`;
    this.root.insertBefore(el, this.cut);
    const chip: Chip = { el, id, t: 0, dx: side * 30, lastT: '' };
    this.chips.push(chip);
    const remove = () => {
      el.remove();
      this.chips = this.chips.filter((c) => c !== chip);
    };
    if (this.anim.instant) {
      // Instant speed: still readable briefly, without motion.
      chip.t = 0.35;
      setTimeout(remove, 900);
      return;
    }
    this.anim.tween({ ms: 700, ease: ease.linear, update: (v) => (chip.t = v), done: remove });
  }

  setShowLabels(on: boolean): void {
    this.showLabels = on;
    this.labelsDirty = true;
    for (const l of this.labels) {
      l.el.style.visibility = on ? 'visible' : 'hidden';
      l.lastT = '';
      l.hidden = false;
    }
  }

  /** Fresh projection of a badge anchor (client px), independent of the last frame. */
  project(id: TerritoryId, camera: THREE.Camera, rect: { left: number; top: number }): { x: number; y: number } | null {
    const b = this.badges.get(id)!;
    const t = this.tiles.get(id);
    this.v.copy(b.world);
    this.v.y += t.pivot.position.y;
    this.v.project(camera);
    const x = (this.v.x * 0.5 + 0.5) * this.width;
    const y = (-this.v.y * 0.5 + 0.5) * this.height;
    if (!(this.v.z < 1 && x > -20 && x < this.width + 20 && y > -20 && y < this.height + 20)) return null;
    return { x: x + rect.left, y: y + rect.top };
  }

  screenPos(id: TerritoryId): { x: number; y: number } | null {
    const b = this.badges.get(id)!;
    return b.onScreen ? { x: b.x, y: b.y } : null;
  }

  /** Project and write every transform. Call once per frame after the camera updates. */
  update(camera: THREE.Camera, rect: DOMRect): void {
    const W = this.width;
    const H = this.height;
    const base = this.uiScale * this.zoomScale;
    for (const t of this.tiles.list) {
      const b = this.badges.get(t.id)!;
      this.v.copy(b.world);
      this.v.y += t.pivot.position.y;
      this.v.project(camera);
      const x = (this.v.x * 0.5 + 0.5) * W;
      const y = (-this.v.y * 0.5 + 0.5) * H;
      b.x = x + rect.left;
      b.y = y + rect.top;
      b.onScreen = this.v.z < 1 && x > -20 && x < W + 20 && y > -20 && y < H + 20;
      if (!b.visible) continue;
      if (!b.onScreen) {
        if (b.lastT !== 'off') {
          b.el.style.visibility = 'hidden';
          b.lastT = 'off';
        }
        continue;
      }
      const s = base * b.pop;
      const tr = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`;
      if (tr !== b.lastT) {
        if (b.lastT === '' || b.lastT === 'off') b.el.style.visibility = 'visible';
        b.el.style.transform = tr;
        b.lastT = tr;
      }
    }
    if (this.showLabels) {
      // Names hang just under their own badge, so name and count read as one unit and never
      // collide with each other's badge.
      const ls = this.uiScale * Math.min(1.35, Math.max(0.9, this.zoomScale));
      let moved = false;
      for (let i = 0; i < this.labels.length; i++) {
        const l = this.labels[i];
        const b = this.badges.get(this.tiles.list[i].id)!;
        const x = b.x - rect.left;
        const y = b.y - rect.top + 13 * base + 2;
        const tr = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,0) scale(${ls.toFixed(3)})`;
        l.x = x;
        l.y = y;
        l.s = ls;
        if (tr !== l.lastT) {
          l.el.style.transform = tr;
          l.lastT = tr;
          moved = true;
        }
      }
      if (moved || this.labelsDirty) this.cullLabels(base, rect);
    }
    for (const c of this.chips) {
      const b = this.badges.get(c.id)!;
      const e = ease.outCubic(Math.min(1, c.t));
      const op = c.t < 0.6 ? 1 : 1 - (c.t - 0.6) / 0.4;
      const x = b.x - rect.left + c.dx * base;
      const y = b.y - rect.top - 16 * base - 18 * e * base;
      const tr = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${base.toFixed(3)})`;
      if (tr !== c.lastT) {
        c.el.style.transform = tr;
        c.el.style.opacity = op.toFixed(3);
        c.lastT = tr;
      }
    }
  }

  /**
   * Names that would overlap a badge (other than their own) or an already-placed name are hidden, so
   * the board never shows half-covered, colliding text. Greedy in board order; runs only when the
   * layout moved (camera, resize, zoom). 42 × 84 rect tests: well under 0.1 ms.
   */
  private cullLabels(base: number, rect: DOMRect): void {
    this.labelsDirty = false;
    const n = this.labels.length;
    const boxes: number[] = []; // placed rects, flat [x0, y0, x1, y1, ...]
    const pad = 1.5;
    // Every visible badge is an obstacle.
    const badgeBox: (number[] | null)[] = [];
    for (let i = 0; i < n; i++) {
      const b = this.badges.get(this.tiles.list[i].id)!;
      if (!b.visible || !b.onScreen) {
        badgeBox.push(null);
        continue;
      }
      if (!b.w) {
        b.w = b.el.offsetWidth;
        b.h = b.el.offsetHeight;
      }
      const w = (b.w || 34) * base;
      const h = (b.h || 22) * base;
      const x = b.x - rect.left;
      const y = b.y - rect.top;
      badgeBox.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
    }
    const hit = (a: number[], x0: number, y0: number, x1: number, y1: number) =>
      a[0] < x1 + pad && a[2] > x0 - pad && a[1] < y1 + pad && a[3] > y0 - pad;
    for (let i = 0; i < n; i++) {
      const l = this.labels[i];
      if (!l.w) {
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
      const w = l.w * l.s;
      const h = l.h * l.s;
      const x0 = l.x - w / 2;
      const x1 = l.x + w / 2;
      const free = (y0: number): boolean => {
        const y1 = y0 + h;
        for (let j = 0; j < n; j++) {
          const bb = badgeBox[j];
          if (j !== i && bb && hit(bb, x0, y0, x1, y1)) return false;
        }
        for (let k = 0; k < boxes.length; k += 4) {
          if (boxes[k] < x1 + pad && boxes[k + 2] > x0 - pad && boxes[k + 1] < y1 + pad && boxes[k + 3] > y0 - pad) return false;
        }
        return true;
      };
      // Under the badge first; if that collides, try just above it; otherwise hide the name.
      const below = l.y;
      const own = badgeBox[i];
      const above = own ? own[1] - 1 - h : l.y;
      const y = free(below) ? below : own && free(above) ? above : NaN;
      const bad = Number.isNaN(y);
      if (!bad) {
        boxes.push(x0, y, x1, y + h);
        const dy = y - below;
        const flip = Math.abs(dy) > 0.5;
        if (flip || l.el.dataset.dy) {
          const tr = `${l.lastT} translateY(${(dy / l.s).toFixed(1)}px)`;
          l.el.style.transform = flip ? tr : l.lastT;
          if (flip) l.el.dataset.dy = '1';
          else delete l.el.dataset.dy;
        }
      }
      if (bad !== l.hidden) {
        l.hidden = bad;
        l.el.style.visibility = bad ? 'hidden' : 'visible';
      }
    }
  }

  get chipCount(): number {
    return this.chips.length;
  }

  dispose(): void {
    this.root.remove();
  }
}

function splitName(name: string): string {
  if (name.length <= 13) return name;
  const words = name.split(' ');
  if (words.length < 2) return name;
  let best = name;
  let bestD = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const d = Math.abs(a.length - b.length);
    if (d < bestD) {
      bestD = d;
      best = `${a}\n${b}`;
    }
  }
  return best;
}
