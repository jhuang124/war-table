// DOM overlay above the canvas: the army count beside each figure in a brushed ensō ring (docs/INK.md
// B §3), the +N staged beside it while a placement is staged, −N as a loss re-inks, the travellers'
// counts, and territory names (hidden unless hovered, picked, or the "Territory names" setting is on).
// Text is laid out at its real size (no CSS scale at rest), so it stays crisp at DPR 1 and 2. All writes
// are batched once per frame, and only when they change.
//
// The rings are the shared seeded ensō (src/shared/enso.ts): a few brush variants per seat, each ring
// turned its own way, so no two read the same (wabi-sabi); the numbers are plain, crisp Cormorant
// Garamond 600 with lining, tabular figures, ivory on the owner's deep ink.
import * as THREE from 'three';
import type { TerritoryId } from '../engine/types';
import { TERRITORY_IDS, TERRITORIES } from '../engine/mapData';
import type { PlayerPalette } from '../shared/palette';
import type { BoardGeometry } from '../map/types';
import type { TileSet } from './tiles';
import type { TokenSystem } from './tokens';
import { Animator, ease } from './anim';
import { hexToRgb } from './util';
import { PLAYER_COLORS } from '../shared/palette';
import { ensoPath } from '../shared/enso';

const SERIF = "'Cormorant Garamond Variable','Cormorant Garamond',Georgia,serif";
const CSS = `
.rb-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;contain:strict;--ui:1;--lab:1}
.rb-badge,.rb-trav{position:absolute;left:0;top:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;
  box-sizing:border-box;color:#f2ede2;font:600 19px/1 ${SERIF};font-variant-numeric:lining-nums tabular-nums;font-feature-settings:'lnum' 1,'tnum' 1;
  letter-spacing:0;white-space:nowrap;will-change:transform;visibility:hidden;transition:opacity 180ms ease-out}
.rb-ring{position:absolute;inset:0;background-size:100% 100%;background-repeat:no-repeat}
.rb-badge .n,.rb-trav .n{position:relative;display:block;transform:translateY(-.05em)}
.rb-badge.dim{opacity:.8}
.rb-badge.ghosted{z-index:2}
.rb-ghost{position:absolute;left:calc(100% + 2px);top:50%;transform:translateY(-54%);color:#f2ede2;
  font:600 calc(18px * var(--ui))/1 ${SERIF};font-variant-numeric:lining-nums tabular-nums;letter-spacing:0;display:none}
.rb-loss{position:absolute;left:0;top:0;color:#f2ede2;font:600 calc(18px * var(--ui))/1 ${SERIF};font-variant-numeric:lining-nums tabular-nums;
  will-change:transform,opacity;white-space:nowrap}
.rb-label{position:absolute;left:0;top:0;color:rgba(242,237,226,.94);font:600 calc(13.5px * var(--lab))/1.02 ${SERIF};
  letter-spacing:.09em;font-variant-caps:all-small-caps;text-align:center;white-space:pre;will-change:transform;
  visibility:hidden;opacity:0;transition:opacity 120ms ease-out}
.rb-label.focus{font-size:calc(15px * var(--lab));color:#f7f2e8;z-index:3}
.rb-label.on{opacity:1}
.rb-cut{position:absolute;inset:0;background:#0b1224;opacity:0}
`;

/** Ring variants per seat (each ring also turns its own way). */
const RING_VARIANTS = 6;
const ringCache = new Map<string, string>();
/** The ring for a seat: a brushed ensō in a pale seat-tinted ivory round a disc of the seat's deep ink. */
function ringImage(pal: PlayerPalette, variant: number): string {
  const key = `${pal.id}:${variant}`;
  let url = ringCache.get(key);
  if (!url) {
    const e = ensoPath(9173 + variant * 131 + pal.id.length * 17, { bristles: 4, samples: 60, weight: 1.05 });
    const [lr, lg, lb] = hexToRgb(pal.light);
    const ivory = [0.95, 0.93, 0.886];
    const mix = (a: number, b: number) => Math.round((a * 0.62 + b * 0.38) * 255);
    const stroke = `rgb(${mix(ivory[0], lr)},${mix(ivory[1], lg)},${mix(ivory[2], lb)})`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="7 7 86 86">` +
      `<circle cx="50" cy="50" r="37" fill="${pal.deep}" fill-opacity=".9"/>` +
      `<path d="${e.d}" fill="${stroke}"/></svg>`;
    url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    ringCache.set(key, url);
  }
  return url;
}
const hash01 = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

interface Badge {
  id: TerritoryId;
  el: HTMLDivElement;
  ring: HTMLElement;
  num: HTMLSpanElement;
  /** The ring's variant and turn (stable per territory). */
  variant: number;
  turn: number;
  lastOp: number;
  /** A hidden badge dries out (opacity) before it leaves the layout. */
  hideAt: number;
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
  /** Ring diameter, px. */
  diam: number;
  /** Plaque centre / size (container px). */
  px: number;
  py: number;
  ph: number;
  pw: number;
  /** The whole piece's screen box (figure and ring), container px. */
  box: [number, number, number, number];
  lastW: number;
  lastDigits: number;
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
  ring: HTMLElement;
  num: HTMLSpanElement;
  used: boolean;
  lastT: string;
  lastD: number;
  n: number;
  owner: string;
}

const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const snap = (v: number, r: number) => Math.round(v * r) / r;

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
  /** Smallest count plaque, CSS px (× the text-size softening). Phones use 20 (docs/MOBILE.md §6). */
  minPlaque = 22;
  /** Phones: nudge overlapping count plaques apart (relaxPlaques). */
  relax = false;
  private pos = new Float64Array(TERRITORY_IDS.length * 6);
  private off = new Float64Array(TERRITORY_IDS.length * 2);
  private hw = new Float64Array(TERRITORY_IDS.length);
  private labelsDirty = true;
  /** Names need a re-layout (the board's render-on-demand loop asks). */
  get dirty(): boolean {
    return this.labelsDirty;
  }
  width = 1;
  height = 1;
  /** Screen rect (container px) the dice tray covers while it shows; numbers under it hide. */
  occluder: { x0: number; y0: number; x1: number; y1: number; on: boolean; hx0?: number; hx1?: number; hy0?: number } = { x0: 0, y0: 0, x1: 0, y1: 0, on: false };

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
      const ring = document.createElement('i');
      ring.className = 'rb-ring';
      const h = hash01(id);
      const turn = Math.round(h * 360);
      ring.style.transform = `rotate(${turn}deg)`;
      const num = document.createElement('span');
      num.className = 'n';
      const ghost = document.createElement('span');
      ghost.className = 'rb-ghost';
      el.append(ring, num, ghost);
      badgeLayer.appendChild(el);
      const b: Badge = {
        id,
        el,
        ring,
        num,
        variant: Math.floor(hash01(id + '~') * RING_VARIANTS),
        turn,
        lastOp: 1,
        hideAt: 0,
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
        px: 0,
        py: 0,
        ph: 22,
        pw: 22,
        box: [0, 0, 0, 0],
        lastW: 0,
        lastDigits: 0,
        onScreen: false,
      };
      this.badges.set(id, b);
      this.badgeList.push(b);

      const lab = document.createElement('div');
      lab.className = 'rb-label';
      lab.textContent = splitName(TERRITORIES[id].name);
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
      b.hideAt = 0;
      b.lastOp = -1;
      this.labelsDirty = true;
    }
    if (!pal) return;
    if (b.shown !== n) {
      if (String(b.shown).length !== String(n).length) b.lastD = 0; // refit the font
      b.num.textContent = String(n);
      b.shown = n;
    }
    if (b.lastInk !== pal.id) {
      // The ring: the seat's deep ink inside a brushed ensō, the numeral ivory (readable on any wash).
      b.ring.style.backgroundImage = ringImage(pal, b.variant);
      b.lastInk = pal.id;
    }
    if (pop) this.pop(id);
  }

  /** Numbers on dimmed tiles recede (still legible) so the choice in play leads. */
  setDim(id: TerritoryId, on: boolean): void {
    const b = this.badges.get(id)!;
    if (b.el.classList.contains('dim') !== on) b.el.classList.toggle('dim', on);
  }

  /** The ring dries out (180 ms) and leaves; at instant speed it goes at once. */
  hideBadge(id: TerritoryId): void {
    const b = this.badges.get(id)!;
    if (!b.visible) return;
    b.visible = false;
    if (this.anim.instant || b.lastT === '' || b.lastT === 'off') {
      b.el.style.visibility = 'hidden';
      b.hideAt = 0;
    } else {
      b.el.style.opacity = '0';
      b.lastOp = 0;
      b.hideAt = performance.now() + 190;
    }
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

  /** "−N" beside a territory's ring: it rises a little and dries out (700 ms). */
  lossChip(id: TerritoryId, n: number, side: -1 | 1 = 1): void {
    if (n <= 0) return;
    const el = document.createElement('div');
    el.className = 'rb-loss';
    el.textContent = `−${n}`;
    // Hidden until the next frame places it (never a flash at the corner).
    el.style.visibility = 'hidden';
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

  private overTray(x0: number, y0: number, x1: number, y1: number, above = 0): boolean {
    const o = this.occluder;
    if (!o.on) return false;
    if (x1 > o.x0 && x0 < o.x1 && y1 > o.y0 && y0 < o.y1) return true;
    if (above <= 0) return false;
    // The header strip above the tray: only where its words actually are (hx0..hx1 when known), so the
    // numbers beside a short 'Ural 12 · Siberia 4' stay on the board.
    const hx0 = o.hx0 ?? o.x0;
    const hx1 = o.hx1 ?? o.x1;
    return x1 > hx0 && x0 < hx1 && y1 > (o.hy0 ?? o.y0 - above) && y0 < o.y1;
  }
  /** Height of the HUD's fight header line just above the tray (CSS px). */
  get headerBand(): number {
    // Phones only: there the tray band is tight and the header runs over the board; on desktop the band
    // has its own text strip and the home view keeps pieces clear of the tray (behaviour unchanged).
    return this.relax ? 30 * this._ui : 0;
  }
  private trayWasOn = false;

  /**
   * Phones: at the home scale the ≥ 20 px plaques are bigger than the tiles, and neighbours overlap. Nudge
   * overlapping plaques apart along their shallower overlap, each by at most ~0.45 of its height from its
   * piece, so every number stays readable and still sits at its own piece. Deterministic per layout.
   */
  private relaxPlaques(n: number): void {
    const P = this.pos;
    const O = this.off;
    O.fill(0);
    const gap = 1;
    for (let it = 0; it < 4; it++) {
      let any = false;
      for (let i = 0; i < n; i++) {
        const a = i * 6;
        if (!P[a + 5]) continue;
        for (let j = i + 1; j < n; j++) {
          const b = j * 6;
          if (!P[b + 5]) continue;
          const dx = P[b] + O[j * 2] - (P[a] + O[i * 2]);
          const dy = P[b + 1] + O[j * 2 + 1] - (P[a + 1] + O[i * 2 + 1]);
          const ox = (P[a + 2] + P[b + 2]) / 2 + gap - Math.abs(dx);
          const oy = (P[a + 3] + P[b + 3]) / 2 + gap - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          any = true;
          // Move along the axis that needs less (vertical slightly favoured: plaques are wider than tall).
          if (oy <= ox * 1.2) {
            const s = (dy >= 0 ? 1 : -1) * oy * 0.5;
            O[i * 2 + 1] -= s;
            O[j * 2 + 1] += s;
          } else {
            const s = (dx >= 0 ? 1 : -1) * ox * 0.5;
            O[i * 2] -= s;
            O[j * 2] += s;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const lim = P[i * 6 + 3] * 0.45;
        O[i * 2] = Math.max(-lim, Math.min(lim, O[i * 2]));
        O[i * 2 + 1] = Math.max(-lim, Math.min(lim, O[i * 2 + 1]));
      }
      if (!any) break;
    }
    for (let i = 0; i < n; i++) {
      P[i * 6] += O[i * 2];
      P[i * 6 + 1] += O[i * 2 + 1];
    }
  }

  private underTray(x: number, y: number): boolean {
    const o = this.occluder;
    return o.on && x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1;
  }

  /** Projected feet (container px, depth) and the figure's screen height, px. */
  private figure(feet: THREE.Vector3, top: THREE.Vector3, camera: THREE.Camera): [number, number, number, number] {
    const W = this.width;
    const H = this.height;
    this.v.copy(feet).project(camera);
    const x = (this.v.x * 0.5 + 0.5) * W;
    const y = (-this.v.y * 0.5 + 0.5) * H;
    const z = this.v.z;
    this.v2.copy(top).project(camera);
    const h = Math.hypot((this.v2.x - this.v.x) * 0.5 * W, (this.v2.y - this.v.y) * 0.5 * H);
    return [x, y, h, z];
  }

  private proj(p: THREE.Vector3, camera: THREE.Camera): [number, number] {
    this.v.copy(p).project(camera);
    return [(this.v.x * 0.5 + 0.5) * this.width, (-this.v.y * 0.5 + 0.5) * this.height];
  }

  /**
   * Ring diameter for a figure `figH` px tall: ~0.74 of the soldier's height (≈ 30 px at the 1440 home),
   * never under 22 px (20 on phones) × the text size, and never over 38.
   */
  plaqueH(figH: number): number {
    const soft = 1 + (this._ui - 1) * 0.8;
    return Math.max(this.minPlaque * soft, Math.min(38 * soft, figH * 0.74));
  }
  /** Rings are round; a 3-digit count gets a slightly wider ring. */
  private plaqueW(h: number, digits: number): number {
    return digits >= 3 ? h * 1.18 : h;
  }
  /** Where the ring sits for a figure (container px): beside it, to its right, its foot at the figure's. */
  private ringAt(fx: number, fy: number, hwPx: number, figH: number, d: number): [number, number] {
    return [fx + hwPx + d * 0.36, fy - Math.max(d * 0.5, figH * 0.3) + d * 0.08];
  }

  /**
   * The count plaque drawn under a container point (the numbers sit above the whole 3D board, so on touch
   * the number under the finger is what was meant). Overlapping plaques: the one drawn on top (a staged
   * "+N" plaque, else the later in document order) — the number the player can actually see there.
   */
  plaqueAt(x: number, y: number, pad = 0): TerritoryId | null {
    let best: TerritoryId | null = null;
    let bestZ = -1;
    for (const b of this.badgeList) {
      if (!b.visible || !b.onScreen || b.lastT === 'off') continue;
      if (Math.abs(x - b.px) > b.pw / 2 + pad || Math.abs(y - b.py) > b.ph / 2 + pad) continue;
      const z = b.ghostN > 0 ? 1 : 0;
      if (z >= bestZ) {
        bestZ = z;
        best = b.id;
      }
    }
    return best;
  }

  /** Every piece's screen box (container px) this frame, for the board's picking. Null = not drawn. */
  pieceBox(id: TerritoryId): [number, number, number, number] | null {
    const b = this.badges.get(id)!;
    return b.visible && b.onScreen && b.lastT !== 'off' ? b.box : null;
  }

  /** Project and write every transform. Call once per frame after the camera updates. */
  update(camera: THREE.Camera, rect: DOMRect): void {
    const W = this.width;
    const H = this.height;
    const r = dpr();
    const now = performance.now();
    let moved = false;
    const list = this.badgeList;
    const n = list.length;
    const P = this.pos;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const feet = this.tokens.top(b.id);
      const top = this.tokens.figTop(b.id);
      const [x, y, fh, z] = this.figure(feet, top, camera);
      // the soldier's height sets the ring size for every figure (a cannon is squat, its count isn't)
      const ph = this.plaqueH(fh * (this.tokens.figH[0] / Math.max(0.01, this.tokens.figH[this.tokens.denom(b.id)])));
      const upx = fh / Math.max(0.01, feet.distanceTo(top));
      const hw = this.tokens.halfWidth(b.id) * upx;
      const [px, py] = this.ringAt(x, y, hw, fh, ph);
      b.cx = x;
      b.cy = y;
      b.diam = ph;
      b.x = x + rect.left;
      b.y = y + rect.top;
      b.onScreen = z < 1 && x > -20 && x < W + 20 && y > -20 && y < H + 20;
      const digits = String(Math.max(0, b.shown)).length;
      const o = i * 6;
      P[o] = px;
      P[o + 1] = py;
      P[o + 2] = this.plaqueW(ph, digits);
      P[o + 3] = ph;
      P[o + 4] = y - fh;
      P[o + 5] = b.visible && b.onScreen && this.tokens.visual(b.id) >= 0.05 ? 1 : 0;
      // (the figure's own half-width, for the box below)
      this.hw[i] = hw;
    }
    if (this.relax) this.relaxPlaques(n);
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const o = i * 6;
      const px = P[o];
      const py = P[o + 1];
      const pw = P[o + 2];
      const ph = P[o + 3];
      const fy = P[o + 4];
      const x = b.cx;
      const digits = String(Math.max(0, b.shown)).length;
      if (Math.abs(px - b.px) > 0.25 || Math.abs(py - b.py) > 0.25 || Math.abs(fy - b.box[1]) > 0.25) moved = true;
      b.px = px;
      b.py = py;
      b.ph = ph;
      b.pw = pw;
      const hw = this.hw[i];
      // The piece: the figure (feet to head, its width) and its ring.
      b.box = [Math.min(x - hw, px - pw / 2), Math.min(fy, py - ph / 2), Math.max(x + hw, px + pw / 2), Math.max(b.cy + 3, py + ph / 2)];
      if (!b.visible) {
        if (b.hideAt && now >= b.hideAt) {
          b.hideAt = 0;
          b.el.style.visibility = 'hidden';
          b.lastT = 'off';
          if (this.relax) this.labelsDirty = true;
        }
        continue;
      }
      const vis = this.tokens.visual(b.id);
      // Any part of the ring over the dice tray, or behind the HUD's fight header just above it, hides it
      // (a number straddling the tray's rim or cut by the header strip reads as broken).
      const tray = this.overTray(px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2, this.headerBand);
      if (!b.onScreen || vis < 0.05 || tray) {
        if (b.lastT !== 'off') {
          b.el.style.visibility = 'hidden';
          b.lastT = 'off';
          if (this.relax) this.labelsDirty = true;
        }
        continue;
      }
      const hq = Math.round(ph * 2) / 2;
      const wq = Math.round(pw * 2) / 2;
      if (hq !== b.lastD || wq !== b.lastW || digits !== b.lastDigits) {
        b.lastD = hq;
        b.lastW = wq;
        b.lastDigits = digits;
        const fs = hq * (digits >= 3 ? 0.56 : digits === 2 ? 0.66 : 0.72);
        b.el.style.width = `${wq}px`;
        b.el.style.height = `${hq}px`;
        b.el.style.fontSize = `${Math.round(fs * 2) / 2}px`;
      }
      const op = Math.round(Math.min(1, vis) * 20) / 20;
      if (op !== b.lastOp) {
        b.lastOp = op;
        b.el.style.opacity = op >= 1 ? '' : String(op);
      }
      const tr = `translate3d(${snap(px - wq / 2, r)}px,${snap(py - hq / 2, r)}px,0)`;
      if (tr !== b.lastT) {
        if (b.lastT === '' || b.lastT === 'off') {
          b.el.style.visibility = 'visible';
          // Phones: a count coming back (after a conquest's flood, or from under the tray) re-lays the names,
          // so a name placed while it was hidden never stays on top of it.
          if (this.relax && b.lastT === 'off') this.labelsDirty = true;
        }
        b.el.style.transform = tr;
        b.lastT = tr;
      }
    }
    this.updateTravelers(camera, r);
    if (this.occluder.on !== this.trayWasOn) {
      this.trayWasOn = this.occluder.on;
      this.labelsDirty = true;
    }
    this.updateLabels(moved, r);
    for (const c of this.chips) {
      const b = this.badges.get(c.id)!;
      const e = ease.outCubic(Math.min(1, c.t));
      const op = c.t < 0.55 ? 1 : 1 - (c.t - 0.55) / 0.45;
      // −N beside the ring (the right of the piece), rising a little as it dries
      const x = b.px + b.pw / 2 + 4 * this._ui;
      const y = b.py - 2 * this._ui - 14 * e * this._ui;
      const tr = `translate3d(${snap(x, r)}px,${snap(y, r)}px,0) translate(0,-50%)`;
      if (tr !== c.lastT) {
        if (!c.lastT) c.el.style.visibility = 'visible';
        c.el.style.transform = tr;
        c.el.style.opacity = op.toFixed(3);
        c.lastT = tr;
      }
    }
  }

  private updateTravelers(camera: THREE.Camera, r: number): void {
    const list = this.tokens.travelers;
    for (const t of this.travs) t.used = false;
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      let e = this.travs[i];
      if (!e) {
        const el = document.createElement('div');
        el.className = 'rb-trav';
        const ring = document.createElement('i');
        ring.className = 'rb-ring';
        ring.style.transform = `rotate(${Math.round(i * 97) % 360}deg)`;
        const num = document.createElement('span');
        num.className = 'n';
        el.append(ring, num);
        this.travLayer.appendChild(el);
        e = { el, ring, num, used: false, lastT: '', lastD: 0, n: -1, owner: '' };
        this.travs.push(e);
      }
      e.used = true;
      if (e.n !== tr.n) {
        e.n = tr.n;
        e.num.textContent = String(tr.n);
        e.lastD = 0;
      }
      if (e.owner !== tr.owner) {
        e.owner = tr.owner;
        const pal = PLAYER_COLORS[tr.owner as keyof typeof PLAYER_COLORS];
        e.ring.style.backgroundImage = pal ? ringImage(pal, i % RING_VARIANTS) : 'none';
      }
      const [fx, fy, fh] = this.figure(tr.top, tr.figTop, camera);
      const h = Math.round(this.plaqueH(fh * (this.tokens.figH[0] / this.tokens.figH[tr.denom])) * 2) / 2;
      const upx = fh / Math.max(0.01, tr.top.distanceTo(tr.figTop));
      const [x, y] = this.ringAt(fx, fy, tr.halfW * upx, fh, h);
      const digits = String(tr.n).length;
      const w = Math.round(this.plaqueW(h, digits) * 2) / 2;
      if (h !== e.lastD) {
        e.lastD = h;
        e.el.style.width = `${w}px`;
        e.el.style.height = `${h}px`;
        e.el.style.fontSize = `${Math.round(h * (digits >= 3 ? 0.56 : digits === 2 ? 0.66 : 0.72) * 2) / 2}px`;
      }
      const t = `translate3d(${snap(x - w / 2, r)}px,${snap(y - h / 2, r)}px,0)`;
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
    // Piece boxes (figure top → plaque bottom) are the obstacles.
    const boxes: number[] = [];
    const tokenBox: (number[] | null)[] = [];
    for (let i = 0; i < n; i++) {
      const b = this.badgeList[i];
      if (!b.visible || !b.onScreen || b.lastT === 'off') {
        tokenBox.push(null);
        continue;
      }
      tokenBox.push([b.box[0], b.box[1], b.box[2], b.box[3]]);
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
    // Phones: a name never covers an army count, its own included. Every territory's count counts, even
    // one drying out or hidden for a moment (a conquest changing hands, the dice tray): it is still on
    // screen, or comes back where it was.
    const countsClear = (x0: number, y0: number, x1: number, y1: number): boolean => {
      if (!this.relax) return true;
      for (let j = 0; j < n; j++) {
        const o = this.badgeList[j];
        if (!o.onScreen || o.pw <= 0) continue;
        if (o.px - o.pw / 2 < x1 + pad && o.px + o.pw / 2 > x0 - pad && o.py - o.ph / 2 < y1 + pad && o.py + o.ph / 2 > y0 - pad) return false;
      }
      return true;
    };
    const freeOfNames = (x0: number, y0: number, x1: number, y1: number): boolean => {
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
        const shown = b.visible && b.lastT !== 'off';
        const below = shown ? b.box[3] + 2 : b.cy + 2;
        const above = shown ? b.box[1] - 2 - l.h : b.cy - 2 - l.h;
        if (free(i, x0, below, x1, below + l.h) && countsClear(x0, below, x1, below + l.h)) place = [b.cx, below];
        else if (shown && free(i, x0, above, x1, above + l.h) && countsClear(x0, above, x1, above + l.h)) place = [b.cx, above];
        else if (isFocus && !this.relax) place = [b.cx, below];
        else if (isFocus) {
          // Phones: a name that must show: beside its piece if that is clear, else wherever it at least misses the
          // other names (the source and target names of a fight on a phone would otherwise stack).
          const cands: [number, number][] = [];
          for (const y of shown ? [below, above] : [below]) for (const dx of [0.55, -0.55]) cands.push([b.cx + dx * l.w, y]);
          if (shown) {
            // beside the piece, level with it
            const mid = (b.box[1] + b.box[3]) / 2 - l.h / 2;
            cands.push([b.box[2] + 2 + l.w / 2, mid], [b.box[0] - 2 - l.w / 2, mid]);
          }
          place = cands.find(([cx, y]) => free(i, cx - l.w / 2, y, cx + l.w / 2, y + l.h) && countsClear(cx - l.w / 2, y, cx + l.w / 2, y + l.h)) ?? null;
          if (!place) {
            // Crowded (a landscape phone's Ural, Europe): a name never prints over an army count (its own included).
            // Of the spots that miss the other names and every count, take the one that covers the least of
            // the other figures; if there is none, the name stays hidden (the dock's line already says it,
            // and the picked tiles are lit), rather than hide a number.
            const all: [number, number][] = [...cands];
            const ys = shown ? [below, above, below + 0.4 * l.h, above - 0.4 * l.h, (b.box[1] + b.box[3]) / 2 - l.h / 2] : [below, below + 0.4 * l.h];
            for (const y of ys) for (const dx of [0, 0.3, -0.3, 0.55, -0.55, 0.8, -0.8, 1.05, -1.05]) all.push([b.cx + dx * l.w, y]);
            const ov = (a0: number, a1: number, c0: number, c1: number) => Math.max(0, Math.min(a1, c1) - Math.max(a0, c0));
            let best: [number, number] | null = null;
            let bestC = Infinity;
            for (const p of all) {
              const x0 = p[0] - l.w / 2;
              const x1 = p[0] + l.w / 2;
              const y0 = p[1];
              const y1 = p[1] + l.h;
              if (!freeOfNames(x0, y0, x1, y1) || !countsClear(x0, y0, x1, y1)) continue;
              let figs = 0;
              for (let j = 0; j < n; j++) {
                const bb = tokenBox[j];
                if (j !== i && bb) figs += ov(x0, x1, bb[0], bb[2]) * ov(y0, y1, bb[1], bb[3]);
              }
              // the least figure covered, then the nearest to its own piece
              const c = figs + 2 * Math.hypot(p[0] - b.cx, p[1] + l.h / 2 - b.cy);
              if (c < bestC - 0.5) {
                best = p;
                bestC = c;
              }
            }
            place = best;
          }
        }
      }
      // While the dice tray shows, the HUD's header line above it names the fight: names that would sit in
      // that line (or on the tray) stay hidden rather than print over it.
      if (place && this.occluder.on && this.overTray(place[0] - l.w / 2, place[1] + 2, place[0] + l.w / 2, place[1] + l.h, this.headerBand)) place = null;
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

  /** A piece's screen box (figure top → plaque bottom) and its count plaque, container px; null if hidden. */
  pieceRects(id: TerritoryId): { box: [number, number, number, number]; plaque: [number, number, number, number] } | null {
    const b = this.badgeList.find((x) => x.id === id);
    if (!b || !b.visible || !b.onScreen) return null;
    return { box: [b.box[0], b.box[1], b.box[2], b.box[3]], plaque: [b.px - b.pw / 2, b.py - b.ph / 2, b.px + b.pw / 2, b.py + b.ph / 2] };
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
