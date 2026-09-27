// DOM overlay above the canvas: the army number on each token, the +N ghost while a placement is
// staged, −N loss chips, traveler numbers, and territory names (hidden unless hovered, picked, or
// the "Territory names" setting is on). Text is laid out at its real size (no CSS scale at rest), so
// it stays crisp at DPR 1 and 2. All writes are batched once per frame, and only when they change.
import * as THREE from 'three';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS, TERRITORIES } from '../engine/mapData';
import type { PlayerPalette } from '../shared/palette';
import type { BoardGeometry } from '../map/types';
import type { TileSet } from './tiles';
import type { TokenSystem } from './tokens';
import { Animator, ease } from './anim';
import { hexToRgb } from './util';

const CSS = `
.rb-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;contain:strict;--ui:1;--lab:1}
.rb-vignette{position:absolute;inset:0;background:radial-gradient(ellipse 82% 80% at 50% 47%,rgba(0,0,0,0) 72%,rgba(4,5,7,.34) 100%)}
.rb-badge,.rb-trav{position:absolute;left:0;top:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  box-sizing:border-box;color:#f3ead8;font:700 13px/1 'Inter Variable',Inter,system-ui,sans-serif;
  font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.02em;white-space:nowrap;
  will-change:transform;transform-origin:50% 50%;visibility:hidden;transition:opacity 180ms ease-out}
.rb-badge .n,.rb-trav .n{display:block;padding-top:.07em}
.rb-badge.dim{opacity:.62}
.rb-badge.ghosted{z-index:2}
.rb-ghost{position:absolute;left:calc(100% + 3px);top:50%;transform:translateY(-50%);height:calc(17px * var(--ui));padding:0 calc(5px * var(--ui));
  border-radius:calc(9px * var(--ui));background:#f3ead8;color:#12151a;font:700 calc(12px * var(--ui))/calc(17px * var(--ui)) 'Inter Variable',Inter,system-ui,sans-serif;
  font-variant-numeric:tabular-nums lining-nums;letter-spacing:0;box-shadow:0 0 0 1px rgba(12,14,18,.8),0 2px 6px rgba(0,0,0,.45);display:none}
.rb-loss{position:absolute;left:0;top:0;height:calc(19px * var(--ui));padding:0 calc(6px * var(--ui));border-radius:calc(10px * var(--ui));background:rgba(18,21,26,.94);
  color:#f3ead8;font:700 calc(13px * var(--ui))/calc(19px * var(--ui)) 'Inter Variable',Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums lining-nums;
  box-shadow:0 0 0 1px rgba(243,234,216,.35),0 2px 6px rgba(0,0,0,.5);will-change:transform,opacity;white-space:nowrap}
.rb-label{position:absolute;left:0;top:0;color:rgba(243,234,216,.92);font:650 calc(9.5px * var(--lab))/1.05 'Inter Variable',Inter,system-ui,sans-serif;
  letter-spacing:.07em;text-transform:uppercase;text-align:center;white-space:pre;will-change:transform;
  text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.6);visibility:hidden;opacity:0;transition:opacity 120ms ease-out}
.rb-label.focus{font-size:calc(11.5px * var(--lab));letter-spacing:.08em;color:#f7f0e0;z-index:3;
  text-shadow:0 1px 2px rgba(0,0,0,1),0 0 4px rgba(0,0,0,.95),0 0 9px rgba(0,0,0,.7)}
.rb-label.on{opacity:1}
.rb-cut{position:absolute;inset:0;background:#0c0f13;opacity:0}
`;

interface Badge {
  id: TerritoryId;
  el: HTMLDivElement;
  num: HTMLSpanElement;
  ghost: HTMLSpanElement;
  shown: number; // displayed number
  visible: boolean;
  lastT: string;
  lastD: number;
  lastInk: string;
  ghostN: number;
  /** Client px (for getScreenPosition / sound pan). */
  x: number;
  y: number;
  /** Container px. */
  cx: number;
  cy: number;
  /** Projected token diameter, px. */
  diam: number;
  onScreen: boolean;
}

interface Label {
  id: TerritoryId;
  el: HTMLDivElement;
  lastT: string;
  /** Laid-out size (measured when the font changes). */
  w: number;
  h: number;
  /** Currently on screen. */
  on: boolean;
  focus: boolean;
}

interface Chip {
  el: HTMLDivElement;
  id: TerritoryId;
  t: number;
  side: number;
  lastT: string;
}

interface TravEl {
  el: HTMLDivElement;
  num: HTMLSpanElement;
  used: boolean;
  lastT: string;
  lastD: number;
  n: number;
  ink: string;
}

const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const snap = (v: number, r: number) => Math.round(v * r) / r;

function shadowFor(ink: string): string {
  const [r, g, b] = hexToRgb(ink);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? '0 1px 1px rgba(0,0,0,.42)' : '0 1px 0 rgba(255,255,255,.3)';
}

export class Overlay {
  root: HTMLDivElement;
  cut: HTMLDivElement;
  private badges = new Map<TerritoryId, Badge>();
  private badgeList: Badge[] = [];
  private labels: Label[] = [];
  private chips: Chip[] = [];
  private travs: TravEl[] = [];
  private travLayer: HTMLDivElement;
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private showAll = false;
  private focusIds = new Set<TerritoryId>();
  private hoverId: TerritoryId | null = null;
  private _ui = 1;
  private labScale = -1;
  zoomScale = 1;
  private labelsDirty = true;
  width = 1;
  height = 1;
  /** Screen rect (container px) the dice tray covers while it shows; numbers under it hide. */
  occluder: { x0: number; y0: number; x1: number; y1: number; on: boolean } = { x0: 0, y0: 0, x1: 0, y1: 0, on: false };

  constructor(
    container: HTMLElement,
    g: BoardGeometry,
    private tiles: TileSet,
    private tokens: TokenSystem,
    private anim: Animator,
  ) {
    void g;
    if (!document.getElementById('rb-style')) {
      const st = document.createElement('style');
      st.id = 'rb-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    } else document.getElementById('rb-style')!.textContent = CSS;
    this.root = document.createElement('div');
    this.root.className = 'rb-overlay';
    const vig = document.createElement('div');
    vig.className = 'rb-vignette';
    this.root.appendChild(vig);
    const badgeLayer = document.createElement('div');
    this.root.appendChild(badgeLayer);
    this.travLayer = document.createElement('div');
    this.root.appendChild(this.travLayer);
    const labelLayer = document.createElement('div');
    this.root.appendChild(labelLayer);
    this.cut = document.createElement('div');
    this.cut.className = 'rb-cut';
    this.root.appendChild(this.cut);
    container.appendChild(this.root);

    for (const id of TERRITORY_IDS) {
      const el = document.createElement('div');
      el.className = 'rb-badge';
      el.dataset.t = id;
      const num = document.createElement('span');
      num.className = 'n';
      const ghost = document.createElement('span');
      ghost.className = 'rb-ghost';
      el.append(num, ghost);
      badgeLayer.appendChild(el);
      const b: Badge = {
        id,
        el,
        num,
        ghost,
        shown: -1,
        visible: false,
        lastT: '',
        lastD: 0,
        lastInk: '',
        ghostN: 0,
        x: 0,
        y: 0,
        cx: 0,
        cy: 0,
        diam: 24,
        onScreen: false,
      };
      this.badges.set(id, b);
      this.badgeList.push(b);

      const lab = document.createElement('div');
      lab.className = 'rb-label';
      lab.textContent = splitName(TERRITORIES[id].name.toUpperCase());
      labelLayer.appendChild(lab);
      this.labels.push({ id, el: lab, lastT: '', w: 0, h: 0, on: false, focus: false });
    }
  }

  get uiScale(): number {
    return this._ui;
  }
  set uiScale(s: number) {
    this._ui = s;
    this.root.style.setProperty('--ui', String(s));
    this.labelsDirty = true;
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
      if (String(b.shown).length !== String(n).length) b.lastD = 0; // refit the font
      b.num.textContent = String(n);
      b.shown = n;
    }
    if (b.lastInk !== pal.ink) {
      b.el.style.color = pal.ink;
      b.el.style.textShadow = shadowFor(pal.ink);
      b.lastInk = pal.ink;
    }
    if (pop) this.pop(id);
  }

  /** Numbers on dimmed tiles recede (still legible) so the choice in play leads. */
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

  /** Pop the token (the number rides along: it reads the token's drawn size). */
  pop(id: TerritoryId): void {
    this.tokens.pop(id);
  }

  setGhost(id: TerritoryId, n: number): void {
    const b = this.badges.get(id)!;
    if (b.ghostN === n) return;
    b.ghostN = n;
    // The chip hangs off the token's right edge; lift it above its neighbours so it is never hidden.
    b.el.classList.toggle('ghosted', n > 0);
    if (n > 0) {
      b.ghost.textContent = `+${n}`;
      b.ghost.style.display = 'block';
    } else b.ghost.style.display = 'none';
  }

  /** A rising "−N" chip beside a territory's token (700 ms). */
  lossChip(id: TerritoryId, n: number, side: -1 | 1 = 1): void {
    if (n <= 0) return;
    const el = document.createElement('div');
    el.className = 'rb-loss';
    el.textContent = `−${n}`;
    this.root.insertBefore(el, this.cut);
    const chip: Chip = { el, id, t: 0, side, lastT: '' };
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

  /** Settings "Territory names": every name on (collision-culled). */
  setShowLabels(on: boolean): void {
    this.showAll = on;
    this.labelsDirty = true;
  }

  /** Names shown regardless of the setting: the picked source / target (from highlights). */
  setFocus(ids: Iterable<TerritoryId>): void {
    const next = new Set(ids);
    if (next.size === this.focusIds.size && [...next].every((x) => this.focusIds.has(x))) return;
    this.focusIds = next;
    this.labelsDirty = true;
  }

  setHover(id: TerritoryId | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.labelsDirty = true;
  }

  /** Fresh projection of a token's top centre (client px), independent of the last frame. */
  project(id: TerritoryId, camera: THREE.Camera, rect: { left: number; top: number }): { x: number; y: number } | null {
    this.tokens.freshTop(id, this.v).project(camera);
    const x = (this.v.x * 0.5 + 0.5) * this.width;
    const y = (-this.v.y * 0.5 + 0.5) * this.height;
    if (!(this.v.z < 1 && x > -20 && x < this.width + 20 && y > -20 && y < this.height + 20)) return null;
    return { x: x + rect.left, y: y + rect.top };
  }

  screenPos(id: TerritoryId): { x: number; y: number } | null {
    const b = this.badges.get(id)!;
    return b.onScreen ? { x: b.x, y: b.y } : null;
  }

  private underTray(x: number, y: number): boolean {
    const o = this.occluder;
    return o.on && x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1;
  }

  /** Projected centre (container px) and diameter of a disc of radius R at a world point. */
  private disc(p: THREE.Vector3, R: number, camera: THREE.Camera): [number, number, number, number] {
    const W = this.width;
    const H = this.height;
    this.v.copy(p).project(camera);
    const x = (this.v.x * 0.5 + 0.5) * W;
    const y = (-this.v.y * 0.5 + 0.5) * H;
    this.v2.set(p.x + R, p.y, p.z).project(camera);
    const d = 2 * Math.hypot((this.v2.x - this.v.x) * 0.5 * W, (this.v2.y - this.v.y) * 0.5 * H);
    return [x, y, d, this.v.z];
  }

  /** Project and write every transform. Call once per frame after the camera updates. */
  update(camera: THREE.Camera, rect: DOMRect): void {
    const W = this.width;
    const H = this.height;
    const r = dpr();
    const R = this.tokens.radius;
    let moved = false;
    for (let i = 0; i < this.badgeList.length; i++) {
      const b = this.badgeList[i];
      const [x, y, d, z] = this.disc(this.tokens.top(b.id), R, camera);
      if (Math.abs(x - b.cx) > 0.25 || Math.abs(y - b.cy) > 0.25) moved = true;
      b.cx = x;
      b.cy = y;
      b.diam = d;
      b.x = x + rect.left;
      b.y = y + rect.top;
      b.onScreen = z < 1 && x > -20 && x < W + 20 && y > -20 && y < H + 20;
      if (!b.visible) continue;
      const vis = this.tokens.visual(b.id);
      const tray = this.underTray(x, y);
      if (!b.onScreen || vis < 0.05 || tray) {
        if (b.lastT !== 'off') {
          b.el.style.visibility = 'hidden';
          b.lastT = 'off';
        }
        continue;
      }
      const dq = Math.max(8, Math.round(d * 2) / 2);
      if (dq !== b.lastD) {
        b.lastD = dq;
        const digits = String(b.shown).length;
        const fs = dq * (digits >= 3 ? 0.44 : digits === 2 ? 0.54 : 0.58);
        b.el.style.width = b.el.style.height = `${dq}px`;
        b.el.style.fontSize = `${Math.round(fs * 2) / 2}px`;
      }
      const flip = this.tiles.get(b.id).pivot.scale.x;
      const sx = vis * flip;
      const sc = Math.abs(sx - 1) > 0.004 || Math.abs(vis - 1) > 0.004 ? ` scale(${sx.toFixed(3)},${vis.toFixed(3)})` : '';
      const tr = `translate3d(${snap(x - dq / 2, r)}px,${snap(y - dq / 2, r)}px,0)${sc}`;
      if (tr !== b.lastT) {
        if (b.lastT === '' || b.lastT === 'off') b.el.style.visibility = 'visible';
        b.el.style.transform = tr;
        b.lastT = tr;
      }
    }
    this.updateTravelers(camera, R, r);
    this.updateLabels(moved, r);
    for (const c of this.chips) {
      const b = this.badges.get(c.id)!;
      const e = ease.outCubic(Math.min(1, c.t));
      const op = c.t < 0.6 ? 1 : 1 - (c.t - 0.6) / 0.4;
      const x = b.cx + c.side * (b.diam * 0.5 + 12 * this._ui);
      const y = b.cy - b.diam * 0.5 - 6 - 18 * e * this._ui;
      const tr = `translate3d(${snap(x, r)}px,${snap(y, r)}px,0) translate(-50%,-50%)`;
      if (tr !== c.lastT) {
        c.el.style.transform = tr;
        c.el.style.opacity = op.toFixed(3);
        c.lastT = tr;
      }
    }
  }

  private updateTravelers(camera: THREE.Camera, R: number, r: number): void {
    const list = this.tokens.travelers;
    for (const t of this.travs) t.used = false;
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      let e = this.travs[i];
      if (!e) {
        const el = document.createElement('div');
        el.className = 'rb-trav';
        const num = document.createElement('span');
        num.className = 'n';
        el.appendChild(num);
        this.travLayer.appendChild(el);
        e = { el, num, used: false, lastT: '', lastD: 0, n: -1, ink: '' };
        this.travs.push(e);
      }
      e.used = true;
      const ink = tr.ink;
      if (e.n !== tr.n) {
        e.n = tr.n;
        e.num.textContent = String(tr.n);
        e.lastD = 0;
      }
      if (e.ink !== ink) {
        e.ink = ink;
        e.el.style.color = ink;
        e.el.style.textShadow = shadowFor(ink);
      }
      const [x, y, d] = this.disc(tr.top, R, camera);
      const dq = Math.max(8, Math.round(d * 2) / 2);
      if (dq !== e.lastD) {
        e.lastD = dq;
        const digits = String(tr.n).length;
        e.el.style.width = e.el.style.height = `${dq}px`;
        e.el.style.fontSize = `${Math.round(dq * (digits >= 3 ? 0.44 : digits === 2 ? 0.54 : 0.58) * 2) / 2}px`;
      }
      const t = `translate3d(${snap(x - dq / 2, r)}px,${snap(y - dq / 2, r)}px,0)`;
      if (t !== e.lastT || e.el.style.visibility !== 'visible') {
        e.el.style.transform = t;
        e.el.style.visibility = this.underTray(x, y) ? 'hidden' : 'visible';
        e.lastT = t;
      }
    }
    for (const t of this.travs) {
      if (!t.used && t.el.style.visibility !== 'hidden') {
        t.el.style.visibility = 'hidden';
        t.lastT = '';
      }
    }
  }

  /**
   * Names: the hovered tile and the picked source/target always show theirs, just under the token
   * (or above it if another token sits below). With "Territory names" on, every other name shows too,
   * unless it would overlap a token or a name already placed. Runs only when the layout moved.
   */
  private updateLabels(moved: boolean, r: number): void {
    const ls = Math.round(this._ui * Math.min(1.3, Math.max(0.9, this.zoomScale)) * 20) / 20;
    if (ls !== this.labScale) {
      this.labScale = ls;
      this.root.style.setProperty('--lab', String(ls));
      for (const l of this.labels) l.w = 0;
      this.labelsDirty = true;
    }
    if (!moved && !this.labelsDirty) return;
    this.labelsDirty = false;
    const n = this.labels.length;
    const focus = new Set(this.focusIds);
    if (this.hoverId) focus.add(this.hoverId);
    // Token boxes are the obstacles.
    const boxes: number[] = [];
    const tokenBox: (number[] | null)[] = [];
    for (let i = 0; i < n; i++) {
      const b = this.badgeList[i];
      if (!b.visible || !b.onScreen || b.lastT === 'off') {
        tokenBox.push(null);
        continue;
      }
      const h = b.diam / 2 + 1;
      tokenBox.push([b.cx - h, b.cy - h, b.cx + h, b.cy + h]);
    }
    const pad = 1.5;
    const hit = (a: number[], x0: number, y0: number, x1: number, y1: number) =>
      a[0] < x1 + pad && a[2] > x0 - pad && a[1] < y1 + pad && a[3] > y0 - pad;
    const free = (i: number, x0: number, y0: number, x1: number, y1: number): boolean => {
      for (let j = 0; j < n; j++) {
        const bb = tokenBox[j];
        if (j !== i && bb && hit(bb, x0, y0, x1, y1)) return false;
      }
      for (let k = 0; k < boxes.length; k += 4) if (hit([boxes[k], boxes[k + 1], boxes[k + 2], boxes[k + 3]], x0, y0, x1, y1)) return false;
      return true;
    };
    // Focused names first (they always show), then the rest in board order.
    const order = [...Array(n).keys()].sort((a, b) => Number(focus.has(this.labels[b].id)) - Number(focus.has(this.labels[a].id)));
    for (const i of order) {
      const l = this.labels[i];
      const b = this.badgeList[i];
      const isFocus = focus.has(l.id);
      const want = (isFocus || this.showAll) && b.onScreen && !this.underTray(b.cx, b.cy);
      if (l.focus !== isFocus) {
        l.focus = isFocus;
        l.el.classList.toggle('focus', isFocus);
        l.w = 0;
      }
      let place: [number, number] | null = null;
      if (want) {
        if (l.el.style.visibility !== 'visible') l.el.style.visibility = 'visible';
        if (!l.w) {
          l.w = l.el.offsetWidth;
          l.h = l.el.offsetHeight;
        }
        const x0 = b.cx - l.w / 2;
        const x1 = b.cx + l.w / 2;
        const half = (b.visible ? b.diam / 2 : 0) + 2;
        const below = b.cy + half;
        const above = b.cy - half - l.h;
        if (free(i, x0, below, x1, below + l.h)) place = [b.cx, below];
        else if (b.visible && free(i, x0, above, x1, above + l.h)) place = [b.cx, above];
        else if (isFocus) place = [b.cx, below];
      }
      const on = !!place;
      if (place) {
        boxes.push(place[0] - l.w / 2, place[1], place[0] + l.w / 2, place[1] + l.h);
        const tr = `translate3d(${snap(place[0] - l.w / 2, r)}px,${snap(place[1], r)}px,0)`;
        if (tr !== l.lastT) {
          l.el.style.transform = tr;
          l.lastT = tr;
        }
      }
      if (on !== l.on) {
        l.on = on;
        l.el.classList.toggle('on', on);
        if (!on) l.el.style.visibility = 'hidden';
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
