// createBoardView: the Three.js war table. Implements the BoardView contract (./BoardView.ts).
import * as THREE from 'three';
import '@fontsource/cinzel/600.css';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import type {
  BoardHighlights,
  BoardStats,
  BoardView,
  BoardViewOptions,
  CreateBoardView,
  PlayEventOptions,
  TerritoryPointerInfo,
  ViewportInsets,
} from './BoardView';
import type { GameEvent, GameState, PlayerId, TerritoryId } from '../engine/types';
import { ADJACENCY, TERRITORIES, TERRITORY_IDS } from '../engine/mapData';
import type { AudioEngine, PlayOptions, SfxName } from '../audio/types';
import { PLAYER_COLORS, type PlayerPalette } from '../shared/palette';
import { Animator, ease, clamp, type Run } from './anim';
import { buildScene } from './scene';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TileSet, type Tile, type RimMode } from './tiles';
import { TokenSystem } from './tokens';
import { Overlay } from './overlay';
import { Continents } from './continents';
import { AttackArrow, FortifyRoute, Particles, Ripples, SeaLanes } from './fx';
import { DiceTray, boardTrayGeometry } from './dice';
import { CameraRig, HOME_CLEAR_PX, HOME_PITCH } from './camera';
import { paintGrainTexture } from './textures';
import {
  IVORY,
  TILE_DEPTH,
  TILE_TOP,
  convexHull,
  distToRing,
  hexToRgb,
  paletteOf,
  pointInRing,
  setBoardSize,
  tileRgb,
  toBoard,
  toWorld,
  type RGB,
} from './util';

const BLITZ_CAP = 3000;
/** Battle tray: fade length, and how long a decided fight's result stays up (docs/ROUND2.md §E). */
const TRAY_FADE_MS = 300;
const TRAY_DECIDED_MS = 1000;
const IVORY_RGB = hexToRgb(IVORY);

async function loadFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const want = [
    "600 64px 'Cinzel'",
    "500 64px 'Inter Variable'",
    "700 64px 'Inter Variable'",
    "italic 500 64px 'Cormorant Garamond Variable'",
  ];
  const t = new Promise<void>((r) => setTimeout(r, 1500));
  await Promise.race([Promise.all(want.map((f) => document.fonts.load(f, 'AB·+7'))).then(() => undefined), t]).catch(() => undefined);
}

/** Middle-roll duration for blitz roll `index` of `count` (UX.md §8.2), capped to ≤ 3.0 s total. */
export function blitzRollMs(index: number, count: number): number {
  if (count <= 1) return 1200;
  if (index === 0 || index === count - 1) return 700;
  let total = 1400;
  for (let k = 1; k < count - 1; k++) total += Math.max(180, 600 * Math.pow(0.75, k - 1));
  const mid = Math.max(180, 600 * Math.pow(0.75, index - 1));
  if (total <= BLITZ_CAP) return mid;
  const midCount = count - 2;
  const scale = (BLITZ_CAP - 1400) / (total - 1400);
  // floor 120 ms unless the cap can't hold it (very long blitzes): the cap wins.
  const floor = Math.min(120, (BLITZ_CAP - 1400) / midCount);
  return Math.max(floor, mid * scale);
}

export const createBoardView: CreateBoardView = async (opts: BoardViewOptions): Promise<BoardView> => {
  const { container, geometry: G } = opts;
  setBoardSize(G);
  await loadFonts();

  // --- device profile (docs/MOBILE.md §7) ------------------------------------------
  // Chosen by capability, not user agent: a coarse primary pointer = a touch device (phone or tablet);
  // a small screen on top of that = a phone GPU budget.
  const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const coarse = mq('(pointer: coarse)') || (!mq('(pointer: fine)') && (navigator.maxTouchPoints ?? 0) > 0);
  const phoneGpu = coarse && Math.min(screen.width || 9999, screen.height || 9999) < 600;
  /** Device pixel ratio cap: 2 everywhere; touch devices step down to 1.5 when frames miss budget (§7). */
  let dprCap = 2;
  const pixelRatio = () => Math.min(dprCap, window.devicePixelRatio || 1);

  // --- renderer -------------------------------------------------------------
  const makeRenderer = (): THREE.WebGLRenderer => {
    const r = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance', alpha: false });
    r.setPixelRatio(pixelRatio());
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    r.autoClear = false;
    r.info.autoReset = false;
    Object.assign(r.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      opacity: '0',
      transition: 'opacity 400ms ease-out',
      touchAction: 'none',
      outline: 'none',
      // A lost context (or the first frames) shows the far ocean, never a white page.
      background: '#0a1a1d',
      webkitUserSelect: 'none',
      userSelect: 'none',
      webkitTouchCallout: 'none',
      webkitTapHighlightColor: 'transparent',
    } as Partial<CSSStyleDeclaration>);
    return r;
  };
  let renderer = makeRenderer();
  let canvas = renderer.domElement;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  const anim = new Animator();
  const parts = buildScene(renderer, G);
  const scene = parts.scene;
  // Cheaper lamp shadows on touch GPUs (the board's shadows only re-render when something moves).
  if (coarse) parts.key.shadow.mapSize.set(phoneGpu ? 1024 : 2048, phoneGpu ? 1024 : 2048);
  const grain = paintGrainTexture();
  const tiles = new TileSet(G, grain);
  scene.add(tiles.group);
  const tokens = new TokenSystem(anim, tiles);
  scene.add(tokens.group);
  tokens.reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const continents = new Continents(G, anim);
  scene.add(continents.group);
  const lanes = new SeaLanes(G);
  scene.add(lanes.group);
  const arrow = new AttackArrow(tiles, anim);
  scene.add(arrow.group);
  const route = new FortifyRoute(tiles);
  scene.add(route.group);
  const particles = new Particles();
  scene.add(particles.points);
  const ripples = new Ripples(anim);
  scene.add(ripples.group);
  const overlay = new Overlay(container, G, tiles, tokens, anim);
  const tray = new DiceTray(anim, parts.envTexture, parts.walnut);
  const rig = new CameraRig(G.width, G.height);
  // The home view fits the land (not the frame) inside the HUD-free region.
  rig.landHull = convexHull(TERRITORY_IDS.flatMap((id) => G.territories[id].polygons.flatMap((p) => p.outer)));
  // Piece extents (figure tops, base sides, plaque depth): the home view keeps every piece inside the free
  // region and clear of the dice tray's footprint.
  const setPieceExtents = () => {
    // The plaque hangs ~0.55 of its height below the base front; ~0.8 board units at the home scale.
    rig.pieceExtents = tokens.extentPoints(HOME_PITCH, 0.8 * (1 + (uiScale - 1) * 0.8));
  };
  const camera = rig.camera;

  // --- displayed board state --------------------------------------------------
  const owners = {} as Record<TerritoryId, PlayerId>;
  const armies = {} as Record<TerritoryId, number>;
  for (const t of TERRITORY_IDS) {
    owners[t] = -1;
    armies[t] = 0;
  }
  let lastState: GameState | null = null;
  let colorKey = '';
  let syncGen = 0;
  let reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  let audio: AudioEngine | null = null;
  let autoCamera = true;
  let uiScale = 1;
  /** Effective insets: `bottom` = the bottom strip only, `trayBand` = the band above it (0 = default). */
  let insets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0, trayBand: 0 };
  let W = 1;
  let H = 1;
  let disposed = false;
  /** Frames still to draw after the last change (a short tail, so settling values land). */
  let hot = 3;
  const invalidate = () => {
    hot = Math.max(hot, 3);
  };
  /** playEvent promises still running: their handlers may change the board between tweens. */
  let inflight = 0;
  let lastConquered: TerritoryId | null = null;
  let lastConquestAt = -1e9;
  let lastPairKey = '';
  let lastRollEnd = -1e9;
  let rolling = 0;
  let arrowSource: 'hl' | 'event' | null = null;
  let lastHl: BoardHighlights = {};
  let clickable = new Set<TerritoryId>();
  let hovered: TerritoryId | null = null;
  let pressed: TerritoryId | null = null;
  const clickCbs: ((i: TerritoryPointerInfo) => void)[] = [];
  const hoverCbs: ((i: TerritoryPointerInfo | null) => void)[] = [];

  // Phase response (pulsePhase): other players' tiles dimmed in fortify.
  const phaseDimmed = new Set<TerritoryId>();
  let phaseVer = 0;
  // Listeners: the view left home (Reset view pill) / the battle tray showed or started to fade.
  const displacedCbs: ((d: boolean) => void)[] = [];
  let lastDisplaced = false;
  const trayCbs: ((v: boolean) => void)[] = [];
  let trayShownEmitted = false;
  const emitTray = (v: boolean) => {
    if (v === trayShownEmitted) return;
    trayShownEmitted = v;
    for (const cb of trayCbs) {
      try {
        cb(v);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const hideTray = (ms: number) => {
    tray.hide(ms);
    emitTray(false);
  };
  // Title / attract view: the wooden frame on its table; play: open ocean past every edge.
  let tableV = 0;
  let tableVer = 0;
  const tableView = (on: boolean) => {
    const to = on ? 1 : 0;
    if (Math.abs(tableV - to) < 1e-3) return;
    const ver = ++tableVer;
    const from = tableV;
    if (reduced) {
      tableV = to;
      parts.setTableView(to);
      needShadow = true;
      return;
    }
    void anim.tween({
      ms: 560,
      unscaled: true,
      ease: ease.inOutCubic,
      update: (v) => {
        if (ver !== tableVer) return;
        tableV = from + (to - from) * v;
        parts.setTableView(tableV);
        needShadow = true;
      },
    });
  };

  const pal = (p: PlayerId): PlayerPalette | null => paletteOf(lastState, p);
  const isHuman = (p: PlayerId) => !!lastState?.players[p] && lastState.players[p].kind === 'human';
  const isAi = (p: PlayerId) => !!lastState?.players[p] && lastState.players[p].kind === 'ai';

  // --- sound helpers ------------------------------------------------------------
  const sfx = (name: SfxName, o: PlayOptions = {}) => {
    if (!audio) return;
    try {
      audio.play(name, o);
    } catch {
      /* never throws, but be safe */
    }
  };
  const panOf = (t: TerritoryId) => {
    const p = overlay.screenPos(t);
    if (!p) return 0;
    return clamp(((p.x / Math.max(1, window.innerWidth)) * 2 - 1) * 0.6, -1, 1);
  };
  // Camera moves > 0.3 board widths get a whoosh that lasts as long as the move.
  rig.onWhoosh = (ms) => sfx('whoosh', { duration: Math.min(1.5, Math.max(0.2, ms / 1000)) });
  const placeSound = new Map<TerritoryId, { t: number; streak: number }>();
  const playPlace = (t: TerritoryId, vol: number) => {
    const now = performance.now();
    const s = placeSound.get(t) ?? { t: -1e9, streak: 0 };
    if (now - s.t < 70) return;
    s.streak = now - s.t < 650 ? Math.min(5, s.streak + 1) : 0;
    s.t = now;
    placeSound.set(t, s);
    sfx('place', { volume: vol, pan: panOf(t), rate: 1 + 0.03 * s.streak + (Math.random() - 0.5) * 0.08 });
  };

  // --- tile look helpers ----------------------------------------------------------
  const tw = (t: Tile, key: string, from: number, to: number, ms: number, e = ease.outCubic, set?: (v: number) => void, run: Run | null = null) => {
    const ver = (t.ver[key] = (t.ver[key] ?? 0) + 1);
    const apply =
      set ??
      ((v: number) => {
        (t as unknown as Record<string, number>)[key] = v;
      });
    if (Math.abs(from - to) < 1e-4) {
      apply(to);
      t.dirty = true;
      return Promise.resolve();
    }
    return anim.tween({
      ms,
      ease: e,
      run,
      update: (v) => {
        if (t.ver[key] !== ver) return;
        apply(from + (to - from) * v);
        t.dirty = true;
      },
    });
  };

  const setOwnerLook = (id: TerritoryId, owner: PlayerId) => {
    const t = tiles.get(id);
    t.rgb = tileRgb(lastState, owner);
    t.dirty = true;
    tokens.setColor(id, t.rgb);
  };

  const refreshBadge = (id: TerritoryId, pop = false) => {
    const p = pal(owners[id]);
    if (!p || armies[id] <= 0) {
      overlay.hideBadge(id);
      return;
    }
    overlay.setBadge(id, armies[id], p, pop);
  };

  // --- highlights ------------------------------------------------------------------
  const applyHighlights = (h: BoardHighlights, prev: BoardHighlights) => {
    const sel = h.selected ?? null;
    const targets = new Set(h.targets ?? []);
    const selectable = new Set(h.selectable ?? []);
    const arrowTo = h.arrow?.kind === 'attack' ? h.arrow.to : null;
    const arrowFrom = h.arrow?.from ?? null;
    clickable = new Set<TerritoryId>([...selectable, ...targets]);
    if (sel) clickable.add(sel);
    if (arrowTo) clickable.add(arrowTo);
    const keep = new Set<TerritoryId>([...clickable]);
    if (arrowFrom) keep.add(arrowFrom);
    if (h.arrow?.path) h.arrow.path.forEach((x) => keep.add(x));
    for (const t of tiles.list) {
      let mode: RimMode = 'none';
      // Armed (an attack arrow is up): only the pair and the arrow are lit; the other targets fall back
      // to plain selectable (still clickable), so the fight in play leads (docs/ROUND2.md §E).
      if (t.id === sel) mode = 'selected';
      else if (t.id === arrowTo) mode = 'armed';
      else if (targets.has(t.id)) mode = arrowTo ? 'selectable' : reduced ? 'armed' : 'target';
      else if (selectable.has(t.id)) mode = 'selectable';
      if (mode !== t.rimMode) {
        const wasNone = t.rimMode === 'none';
        t.rimMode = mode;
        t.dirty = true;
        if (wasNone && mode !== 'none') tw(t, 'rimAlpha', 0, 1, mode === 'selected' ? 120 : 100, ease.outQuad);
        else t.rimAlpha = 1;
      }
      const lift = t.id === sel ? 0.35 * TILE_DEPTH : 0;
      if (Math.abs(lift - t.selectLift) > 1e-4) {
        const up = lift > t.selectLift;
        tw(t, 'selectLift', t.selectLift, lift, up ? 160 : 120, up ? (reduced ? ease.outCubic : ease.outBack(1.4)) : ease.inQuad);
      }
      // Fortify's phase dim is deeper than a selection's: the board becomes "your side" (docs/ROUND2.md §A).
      const dim = Math.max(h.dimOthers && !keep.has(t.id) ? 1 : 0, phaseDimmed.has(t.id) ? 1.8 : 0);
      if (Math.abs(dim - t.dim) > 1e-4) tw(t, 'dim', t.dim, dim, dim > t.dim ? 180 : 140, ease.outQuad);
      overlay.setDim(t.id, dim >= 1);
      if (!clickable.has(t.id) && t.hoverLift > 0 && t.id !== hovered) tw(t, 'hoverLift', t.hoverLift, 0, 140);
    }
    // hover state may have changed clickability
    if (hovered) setHoverLook(hovered, clickable.has(hovered));
    updateCursor();
    // pending ghosts
    for (const id of TERRITORY_IDS) overlay.setGhost(id, Math.max(0, h.pending?.[id] ?? 0));
    // names: the picked source and the armed target show theirs (the hovered tile's is set on hover)
    const named: TerritoryId[] = [];
    if (sel) named.push(sel);
    if (h.arrow) named.push(h.arrow.from, h.arrow.to);
    overlay.setFocus(named);
    // arrow / route
    const a = h.arrow ?? null;
    if (a && a.kind === 'attack') {
      route.hide();
      const color = tileRgb(lastState, owners[a.from]);
      arrowSource = 'hl';
      const sameArrow = prev.arrow?.kind === 'attack' && prev.arrow.from === a.from && prev.arrow.to === a.to;
      const off = !sameArrow && rig.autoProgress >= 1 && isAi(owners[a.from]) ? needsFraming(a.from, a.to) : false;
      if (off) {
        void frameEngagement(a.from, a.to, null).then(() => {
          if (lastHl.arrow?.from === a.from && lastHl.arrow?.to === a.to) void arrow.show(a.from, a.to, color);
        });
      } else void arrow.show(a.from, a.to, color);
    } else if (a && a.kind === 'fortify') {
      if (arrowSource === 'hl') arrow.hide();
      arrowSource = null;
      route.show(a.path && a.path.length >= 2 ? a.path : [a.from, a.to]);
    } else {
      route.hide();
      if (arrowSource === 'hl') {
        arrow.hide();
        arrowSource = null;
      }
    }
    // A selection change ends the dice linger, except the controller's auto-chain after a conquest:
    // with no arrow and the selection on the last engagement's own pair, the deciding roll keeps its
    // moment until the linger timer or the next roll ends it (R1-07).
    const selKey = (x: BoardHighlights) => `${x.selected ?? ''}|${x.arrow ? `${x.arrow.from}>${x.arrow.to}` : ''}`;
    const [pairFrom, pairTo] = lastPairKey.split('>');
    const autoChain = !h.arrow && !!h.selected && (h.selected === pairFrom || h.selected === pairTo);
    if (selKey(h) !== selKey(prev) && tray.visible && rolling === 0 && !autoChain) hideTray(TRAY_FADE_MS);
  };

  // --- phase response (no camera moves) ---------------------------------------------------------
  const clearPhase = () => {
    phaseVer++;
    const had = phaseDimmed.size > 0;
    phaseDimmed.clear();
    for (const t of tiles.list) {
      if (t.phaseLift > 1e-4) tw(t, 'phaseLift', t.phaseLift, 0, 160, ease.inQuad);
      if (t.glow > 1e-4) tw(t, 'glow', t.glow, 0, 160, ease.outQuad);
    }
    if (had) applyHighlights(lastHl, lastHl);
  };
  /**
   * The board answers a phase change (docs/ROUND2.md §A): → attack, the tiles that can attack lift and their
   * rims sweep west → east; → fortify, other players' tiles dim (until the turn ends); → end, it all clears.
   * Any change also ends the battle tray.
   */
  const pulsePhase = (phase: 'attack' | 'fortify' | 'end', o?: { player?: PlayerId; territories?: TerritoryId[] }) => {
    if (disposed) return;
    if (tray.visible && rolling === 0) hideTray(TRAY_FADE_MS);
    clearPhase();
    if (phase === 'end') return;
    const me = o?.player ?? lastState?.currentPlayer;
    if (me === undefined || me === null || me < 0) return;
    if (phase === 'fortify') {
      for (const id of TERRITORY_IDS) if (owners[id] !== me) phaseDimmed.add(id);
      applyHighlights(lastHl, lastHl);
      return;
    }
    const ids = o?.territories ?? TERRITORY_IDS.filter((id) => owners[id] === me && armies[id] >= 2 && ADJACENCY[id].some((n) => owners[n] !== me));
    if (!ids.length) return;
    const xs = ids.map((id) => tiles.get(id).anchor[0]);
    const x0 = Math.min(...xs);
    const span = Math.max(1, Math.max(...xs) - x0);
    const ver = phaseVer;
    ids.forEach((id, i) => {
      const t = tiles.get(id);
      const go = () => {
        if (ver !== phaseVer) return;
        // rim: 0 → 0.85 → 0 (the tile's own highlight rim, if any, carries on underneath)
        void tw(t, 'glow', 0, 1, 150, ease.outQuad).then(() => {
          if (ver === phaseVer) void tw(t, 'glow', t.glow, 0, 620, ease.inOutQuad);
        });
        if (reduced) return;
        void tw(t, 'phaseLift', t.phaseLift, 0.15, 170, ease.outBack(1.5)).then(() => {
          if (ver !== phaseVer) return;
          void anim.wait(260, null, true).then(() => {
            if (ver === phaseVer) void tw(t, 'phaseLift', t.phaseLift, 0, 380, ease.inOutQuad);
          });
        });
      };
      const delay = reduced ? 0 : (260 * (xs[i] - x0)) / span;
      if (delay <= 1) go();
      else void anim.wait(delay, null, true).then(go);
    });
  };

  // --- hover / picking -----------------------------------------------------------------
  const setHoverLook = (id: TerritoryId, on: boolean) => {
    const t = tiles.get(id);
    const lift = on ? 0.15 * TILE_DEPTH : 0;
    if (Math.abs(t.hoverLift - lift) > 1e-4) tw(t, 'hoverLift', t.hoverLift, lift, on ? 90 : 140);
    const light = on ? 1 : 0;
    if (Math.abs(t.light - light) > 1e-4) tw(t, 'light', t.light, light, on ? 90 : 140);
  };
  const updateCursor = () => {
    const c = dragging ? 'grabbing' : hovered && clickable.has(hovered) ? 'pointer' : 'default';
    if (canvas.style.cursor !== c) canvas.style.cursor = c;
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP);
  const rectOf = () => canvas.getBoundingClientRect();

  /** Board point under a client pixel on the un-lifted tile-top plane. */
  const boardPoint = (cx: number, cy: number): [number, number] | null => {
    const r = rectOf();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return toBoard(hit.x, hit.z);
  };
  const territoryAt = (bx: number, by: number): TerritoryId | null => {
    for (const t of tiles.list) {
      const [x0, y0, x1, y1] = t.bbox;
      if (bx < x0 || bx > x1 || by < y0 || by > y1) continue;
      for (const ring of t.rings) if (pointInRing(bx, by, ring)) return t.id;
    }
    return null;
  };
  /** Board units per CSS px near a board point (for the 3 px hysteresis). */
  const unitsPerPx = (bx: number, by: number): number => {
    const a = toWorld(bx, by, TILE_TOP).project(camera);
    const b = toWorld(bx + 1, by, TILE_TOP).project(camera);
    const px = Math.hypot((b.x - a.x) * 0.5 * W, (b.y - a.y) * 0.5 * H);
    return px > 0 ? 1 / px : 0.1;
  };
  /** A piece's figure stands up over the tiles behind it: a click on the figure picks its own territory. */
  const inPiece = (id: TerritoryId, x: number, y: number, pad: number): boolean => {
    const b = overlay.pieceBox(id);
    if (!b) return false;
    const hw = (b[2] - b[0]) * 0.5 * 0.8 + pad;
    const mx = (b[0] + b[2]) / 2;
    return x >= mx - hw && x <= mx + hw && y >= b[1] + 2 - pad && y <= b[3] + pad;
  };
  const pieceAt = (x: number, y: number): TerritoryId | null => {
    let best: TerritoryId | null = null;
    let bestY = -Infinity;
    for (const t of tiles.list) {
      if (!inPiece(t.id, x, y, 0)) continue;
      const b = overlay.pieceBox(t.id)!;
      // overlapping pieces: the one standing in front (lower on screen) wins
      if (b[3] > bestY) {
        bestY = b[3];
        best = t.id;
      }
    }
    return best;
  };
  const pick = (cx: number, cy: number, useHysteresis: boolean): TerritoryId | null => {
    const r = rectOf();
    const x = cx - r.left;
    const y = cy - r.top;
    const bp = boardPoint(cx, cy);
    const ground = bp ? territoryAt(bp[0], bp[1]) : null;
    const cand = pieceAt(x, y) ?? ground;
    if (!useHysteresis || !hovered || cand === hovered) return cand;
    // A new tile or piece takes hover only once the pointer is ≥ 3 px past the hovered one's edge.
    if (inPiece(hovered, x, y, 3)) return hovered;
    if (!bp) return cand;
    const cur = tiles.get(hovered);
    let d = Infinity;
    for (const ring of cur.rings) d = Math.min(d, distToRing(bp[0], bp[1], ring));
    if (ground === hovered || d / unitsPerPx(bp[0], bp[1]) < 3) {
      // still over (or within 3 px of) the hovered tile: a piece standing there takes it only once the
      // pointer is 3 px inside that piece
      const onPiece = pieceAt(x, y);
      if (!onPiece || !inPiece(onPiece, x, y, -3)) return hovered;
      return onPiece;
    }
    return cand;
  };

  const pointerInfo = (e: PointerEvent | MouseEvent, id: TerritoryId, button?: number): TerritoryPointerInfo => ({
    territory: id,
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    button: button ?? e.button,
  });

  let down: { x: number; y: number; t: number; button: number; tile: TerritoryId | null; id: number } | null = null;
  let dragging = false;
  let lastMove = { x: 0, y: 0 };
  let lastHoverEvent: PointerEvent | null = null;

  const setHovered = (id: TerritoryId | null, e: PointerEvent | null) => {
    if (id === hovered) return;
    const prev = hovered;
    hovered = id;
    overlay.setHover(id);
    if (prev) setHoverLook(prev, false);
    if (id && clickable.has(id)) setHoverLook(id, true);
    updateCursor();
    if (!e) for (const cb of hoverCbs) cb(null);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (disposed) return;
    audio?.unlock?.();
    invalidate();
    if (isTouch(e)) return onTouchDown(e);
    canvas.setPointerCapture?.(e.pointerId);
    const id = pick(e.clientX, e.clientY, true);
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp, button: e.button, tile: id, id: e.pointerId };
    lastMove = { x: e.clientX, y: e.clientY };
    dragging = false;
    if (id && clickable.has(id) && (e.button === 0 || e.button === 2)) {
      pressed = id;
      const t = tiles.get(id);
      tw(t, 'press', t.press, -0.05 * TILE_DEPTH, 60, ease.outQuad);
    }
  };
  const releasePress = () => {
    if (!pressed) return;
    const t = tiles.get(pressed);
    tw(t, 'press', t.press, 0, 90, reduced ? ease.outCubic : ease.outBack(1.5));
    pressed = null;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (disposed) return;
    invalidate();
    if (isTouch(e)) return onTouchMove(e);
    const r = rectOf();
    if (down) {
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (!dragging && moved > 6) {
        dragging = true;
        releasePress();
        if (hovered) setHovered(null, null);
        updateCursor();
      }
      if (dragging) {
        const dx = e.clientX - lastMove.x;
        const dy = e.clientY - lastMove.y;
        if (down.button === 0) rig.orbit(dx, dy);
        else if (down.button === 2 || down.button === 1)
          rig.pan([lastMove.x - r.left, lastMove.y - r.top], [e.clientX - r.left, e.clientY - r.top]);
        lastMove = { x: e.clientX, y: e.clientY };
        return;
      }
    }
    const id = pick(e.clientX, e.clientY, true);
    setHovered(id, e);
    lastHoverEvent = e;
    if (id) for (const cb of hoverCbs) cb(pointerInfo(e, id, 0));
    else for (const cb of hoverCbs) cb(null);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (disposed) return;
    invalidate();
    if (isTouch(e)) return onTouchUp(e, false);
    if (!down) return;
    const d = down;
    down = null;
    canvas.releasePointerCapture?.(e.pointerId);
    const wasDrag = dragging;
    dragging = false;
    releasePress();
    updateCursor();
    if (wasDrag) {
      const id = pick(e.clientX, e.clientY, false);
      setHovered(id, e);
      return;
    }
    const dt = e.timeStamp - d.t; // event timestamps: a main-thread stall between press and release must not eat a real click
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (dt > 350 || moved > 6) return;
    const id = pick(e.clientX, e.clientY, true);
    if (!id || id !== d.tile) return;
    const info = pointerInfo(e, id, d.button);
    for (const cb of clickCbs) {
      try {
        cb(info);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const onPointerCancel = (e: PointerEvent) => {
    invalidate();
    if (isTouch(e)) return onTouchUp(e, true);
    down = null;
    dragging = false;
    releasePress();
    updateCursor();
  };
  const onLeave = (e: PointerEvent) => {
    if (isTouch(e) || down) return;
    setHovered(null, null);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    invalidate();
    const r = rectOf();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    rig.zoomAt(e.clientX - r.left, e.clientY - r.top, clamp(dy, -240, 240));
  };

  // --- touch (docs/MOBILE.md §3) ------------------------------------------------------------
  // Tap = select (the click callback; a tap on open water picks the nearest selectable territory within
  // ~22 px). One finger drags = pan, two = pinch-zoom about their midpoint (momentum + soft limits);
  // no orbit, no double-tap zoom, and a drag never selects. Hold 400 ms = the name card
  // (onTerritoryLongPress; sliding the held finger moves it to the tile under it; lifting clears it).
  // A long-press never selects. The pressed tile shows its name (touch has no hover).
  const TOUCH_SLOP = 10;
  const TAP_TOLERANCE = 22;
  const LONG_PRESS_MS = 400;
  const isTouch = (e: PointerEvent) => e.pointerType === 'touch' || e.pointerType === 'pen';
  const touches = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  let tMode: 'none' | 'maybe' | 'pan' | 'pinch' | 'long' | 'done' = 'none';
  let tPressed: TerritoryId | null = null;
  let tNamed: TerritoryId | null = null;
  let tLong: TerritoryId | null = null;
  let tTimer: ReturnType<typeof setTimeout> | null = null;
  let tPinch: { d: number; mx: number; my: number } | null = null;
  const longCbs: ((i: TerritoryPointerInfo | null) => void)[] = [];
  const emitLong = (info: TerritoryPointerInfo | null) => {
    for (const cb of longCbs) {
      try {
        cb(info);
      } catch (err) {
        console.error(err);
      }
    }
  };
  /** Distance (CSS px) from a canvas point to a territory: its tile outline or its piece, 0 inside. */
  const pxDistTo = (id: TerritoryId, x: number, y: number, bp: [number, number] | null, upp: number, max: number): number => {
    let d = Infinity;
    const b = overlay.pieceBox(id);
    if (b) {
      const hw = (b[2] - b[0]) * 0.5 * 0.8;
      const mx = (b[0] + b[2]) / 2;
      const dx = Math.max(mx - hw - x, 0, x - mx - hw);
      const dy = Math.max(b[1] + 2 - y, 0, y - b[3]);
      d = Math.hypot(dx, dy);
    }
    if (bp && upp > 0) {
      const t = tiles.get(id);
      const [x0, y0, x1, y1] = t.bbox;
      const bx = Math.max(x0 - bp[0], 0, bp[0] - x1);
      const by = Math.max(y0 - bp[1], 0, bp[1] - y1);
      if (Math.hypot(bx, by) / upp <= Math.min(d, max)) {
        for (const ring of t.rings) {
          if (pointInRing(bp[0], bp[1], ring)) return 0;
          d = Math.min(d, distToRing(bp[0], bp[1], ring) / upp);
        }
      }
    }
    return d;
  };
  /**
   * The territory a finger means: the tile or piece exactly under it; on open water, the nearest
   * `pool` territory (the selectable ones for a tap, any for the name card) within TAP_TOLERANCE px.
   */
  const touchPick = (cx: number, cy: number, pool: Iterable<TerritoryId>): TerritoryId | null => {
    const r0 = rectOf();
    // A number under the finger wins: it is drawn above every piece and tile (a neighbour's figure may
    // stand over it in 3D, e.g. Argentina's over Peru's plaque at the portrait zoom).
    const onPlaque = overlay.plaqueAt(cx - r0.left, cy - r0.top);
    if (onPlaque) return onPlaque;
    const exact = pick(cx, cy, false);
    if (exact) return exact;
    const r = rectOf();
    const x = cx - r.left;
    const y = cy - r.top;
    const bp = boardPoint(cx, cy);
    const upp = bp ? unitsPerPx(bp[0], bp[1]) : 0;
    let best: TerritoryId | null = null;
    let bd = TAP_TOLERANCE;
    for (const id of pool) {
      const d = pxDistTo(id, x, y, bp, upp, bd);
      if (d <= bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };
  /** Name shown under the finger (the overlay's hover name; the mouse's own hover is restored after). */
  const touchName = (id: TerritoryId | null) => {
    if (id === tNamed) return;
    tNamed = id;
    overlay.setHover(id ?? hovered);
  };
  const touchPress = (id: TerritoryId | null) => {
    if (tPressed === id) return;
    if (tPressed) {
      const t = tiles.get(tPressed);
      tw(t, 'press', t.press, 0, 90, reduced ? ease.outCubic : ease.outBack(1.5));
      setHoverLook(tPressed, false);
    }
    tPressed = id;
    if (id) {
      const t = tiles.get(id);
      // Same-frame feedback: the tile dips and brightens under the finger.
      tw(t, 'press', t.press, -0.05 * TILE_DEPTH, 60, ease.outQuad);
      const light = 1;
      if (Math.abs(t.light - light) > 1e-4) tw(t, 'light', t.light, light, 70);
    }
  };
  const clearTimer = () => {
    if (tTimer) clearTimeout(tTimer);
    tTimer = null;
  };
  const endLong = () => {
    if (!tLong) return;
    setHoverLook(tLong, false);
    tLong = null;
    emitLong(null);
  };
  const longInfo = (id: TerritoryId, x: number, y: number): TerritoryPointerInfo => ({
    territory: id,
    clientX: x,
    clientY: y,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    button: 0,
  });
  const showLong = (id: TerritoryId, x: number, y: number) => {
    if (tLong !== id) {
      if (tLong) setHoverLook(tLong, false);
      tLong = id;
      setHoverLook(id, true);
      touchName(id);
    }
    emitLong(longInfo(id, x, y));
  };
  const pinchOf = () => {
    const [a, b] = [...touches.values()];
    const r = rectOf();
    return { d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
  };
  const onTouchDown = (e: PointerEvent) => {
    canvas.setPointerCapture?.(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp });
    if (touches.size === 1) {
      tMode = 'maybe';
      const id = touchPick(e.clientX, e.clientY, clickable);
      touchPress(id && clickable.has(id) ? id : null);
      touchName(id);
      clearTimer();
      tTimer = setTimeout(() => {
        tTimer = null;
        if (disposed || tMode !== 'maybe' || touches.size !== 1) return;
        const p = [...touches.values()][0];
        const lid = touchPick(p.x, p.y, TERRITORY_IDS);
        if (!lid) return;
        tMode = 'long';
        touchPress(null);
        showLong(lid, p.x, p.y);
        invalidate();
      }, LONG_PRESS_MS);
      return;
    }
    // A second finger: pinch (never a tap, never a long-press).
    clearTimer();
    touchPress(null);
    touchName(null);
    endLong();
    if (touches.size === 2) {
      tMode = 'pinch';
      rig.touchBegin();
      tPinch = pinchOf();
    }
  };
  const onTouchMove = (e: PointerEvent) => {
    const p = touches.get(e.pointerId);
    if (!p) return;
    const r = rectOf();
    const px = p.x;
    const py = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (tMode === 'maybe') {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) <= TOUCH_SLOP) return;
      clearTimer();
      touchPress(null);
      touchName(null);
      tMode = 'pan';
      rig.touchBegin();
      rig.touchPan([p.x0 - r.left, p.y0 - r.top], [p.x - r.left, p.y - r.top]);
      return;
    }
    if (tMode === 'pan') {
      rig.touchPan([px - r.left, py - r.top], [p.x - r.left, p.y - r.top]);
      return;
    }
    if (tMode === 'long') {
      // Scrub: the card follows the finger to the tile under it.
      const id = touchPick(p.x, p.y, TERRITORY_IDS);
      if (id) showLong(id, p.x, p.y);
      return;
    }
    if (tMode === 'pinch' && touches.size >= 2 && tPinch) {
      const n = pinchOf();
      rig.touchPan([tPinch.mx, tPinch.my], [n.mx, n.my]);
      rig.touchZoom(n.mx, n.my, n.d / tPinch.d);
      tPinch = n;
    }
  };
  const onTouchUp = (e: PointerEvent, cancelled: boolean) => {
    const p = touches.get(e.pointerId);
    if (!p) return;
    touches.delete(e.pointerId);
    canvas.releasePointerCapture?.(e.pointerId);
    if (tMode === 'pinch') {
      if (touches.size === 1) {
        // One finger stays: it carries on panning from where it is.
        tMode = 'pan';
        tPinch = null;
        return;
      }
      if (touches.size >= 2) {
        tPinch = pinchOf();
        return;
      }
    }
    if (touches.size > 0) return;
    if (pendingRecenter) {
      pendingRecenter = false;
      if (!rig.displaced && tMode !== 'pan' && tMode !== 'pinch') void rig.goHome();
    }
    const mode = tMode;
    tMode = 'none';
    tPinch = null;
    clearTimer();
    touchPress(null);
    touchName(null);
    if (mode === 'long') endLong();
    if (mode === 'pan' || mode === 'pinch') {
      if (cancelled) rig.touchCancel();
      else rig.touchEnd();
      return;
    }
    if (mode !== 'maybe' || cancelled) return;
    if (e.timeStamp - p.t0 >= LONG_PRESS_MS || Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > TOUCH_SLOP) return;
    const id = touchPick(e.clientX, e.clientY, clickable);
    if (!id) return;
    const info = pointerInfo(e, id, 0);
    for (const cb of clickCbs) {
      try {
        cb(info);
      } catch (err) {
        console.error(err);
      }
    }
  };
  // Safari's own pinch gesture events: never let the page zoom under the board.
  const onGesture = (e: Event) => e.preventDefault();

  const onContext = (e: Event) => e.preventDefault();
  const bindCanvas = (c: HTMLCanvasElement) => {
    c.addEventListener('pointerdown', onPointerDown);
    c.addEventListener('pointermove', onPointerMove);
    c.addEventListener('pointerup', onPointerUp);
    c.addEventListener('pointercancel', onPointerCancel);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('contextmenu', onContext);
    c.addEventListener('gesturestart', onGesture);
    c.addEventListener('gesturechange', onGesture);
    c.addEventListener('webglcontextlost', onContextLost, false);
    c.addEventListener('webglcontextrestored', onContextRestored, false);
  };
  const unbindCanvas = (c: HTMLCanvasElement) => {
    c.removeEventListener('pointerdown', onPointerDown);
    c.removeEventListener('pointermove', onPointerMove);
    c.removeEventListener('pointerup', onPointerUp);
    c.removeEventListener('pointercancel', onPointerCancel);
    c.removeEventListener('pointerleave', onLeave);
    c.removeEventListener('wheel', onWheel);
    c.removeEventListener('contextmenu', onContext);
    c.removeEventListener('gesturestart', onGesture);
    c.removeEventListener('gesturechange', onGesture);
    c.removeEventListener('webglcontextlost', onContextLost, false);
    c.removeEventListener('webglcontextrestored', onContextRestored, false);
  };
  bindCanvas(canvas);
  container.addEventListener('contextmenu', onContext);

  // --- camera helpers ------------------------------------------------------------------
  const camWaiters: { resolve: () => void; run: Run | null }[] = [];
  const waitCamera = (run: Run | null): Promise<void> => {
    if (rig.autoProgress >= 0.8 || (run && run.skipped)) return Promise.resolve();
    return new Promise((resolve) => camWaiters.push({ resolve, run }));
  };
  const cutTo = (pose: import('./camera').Pose) => {
    rig.jump(pose);
    overlay.cut.style.transition = 'none';
    overlay.cut.style.opacity = '1';
    requestAnimationFrame(() => {
      overlay.cut.style.transition = 'opacity 200ms ease-out';
      overlay.cut.style.opacity = '0';
    });
  };
  const projTmp = new THREE.Vector3();
  const needsFraming = (from: TerritoryId, to: TerritoryId): boolean => {
    const { x0, y0, x1, y1 } = rig.region();
    for (const id of [from, to]) {
      const t = tiles.get(id);
      projTmp.copy(t.anchorW).project(camera);
      const px = (projTmp.x * 0.5 + 0.5) * W;
      const py = (-projTmp.y * 0.5 + 0.5) * H;
      if (projTmp.z > 1 || px < x0 + 8 || px > x1 - 8 || py < y0 + 8 || py > y1 - 8) return true;
    }
    const t = tiles.get(to);
    const a = toWorld(t.bbox[0], (t.bbox[1] + t.bbox[3]) / 2, TILE_TOP).project(camera);
    const b = toWorld(t.bbox[2], (t.bbox[1] + t.bbox[3]) / 2, TILE_TOP).project(camera);
    return Math.abs(b.x - a.x) * 0.5 * W < 24;
  };
  const frameEngagement = async (from: TerritoryId, to: TerritoryId, run: Run | null) => {
    const pts = [tiles.get(from).anchorW, tiles.get(to).anchorW];
    const t = tiles.get(to);
    const widthUnits = t.bbox[2] - t.bbox[0];
    // zoom so the target is at least ~40 px wide
    const pxPerUnitHome = W / (G.width * 1.1);
    const minZoom = clamp(40 / Math.max(1, widthUnits * pxPerUnitHome), 1, 1.8);
    // Frame a region, not a close-up: the room still needs context around the fight.
    const pose = rig.framePose(pts, minZoom, 1.7);
    if (reduced || anim.instant) {
      cutTo(pose);
      return;
    }
    void rig.moveTo(pose);
    await waitCamera(run);
  };

  // --- placement batching (same-frame bursts stagger 35–50 ms, ≤ 1.2 s spread) ----------
  const placeQueue: { id: TerritoryId; count: number; source: string; vol: number; run: Run }[] = [];
  const flushPlacements = () => {
    if (!placeQueue.length) return;
    const list = placeQueue.splice(0);
    const n = list.length;
    const stagger = n > 1 ? Math.min(50, 1200 / (n - 1)) : 0;
    list.forEach((p, i) => {
      const go = () => {
        if (p.count > 0) {
          // The token hops (or drops in, on an empty tile); dust, pop and sound land on touchdown.
          tokens.setArmies(p.id, armies[p.id], 'drop');
          if (anim.instant) refreshBadge(p.id, false);
        } else {
          tokens.setArmies(p.id, armies[p.id], 'lift');
          overlay.pop(p.id);
          sfx('unplace', { volume: p.vol, pan: panOf(p.id) });
        }
      };
      if (i === 0 || anim.instant) go();
      else void anim.wait(stagger * i, null, true).then(go);
    });
  };
  tokens.onContact = (id) => {
    tokens.pop(id, 0.1);
    const pv = new THREE.Vector3();
    tokens.dustPoint(id, pv);
    if (!reduced && !anim.instant) particles.burst(pv, 5);
    playPlace(id, (isHuman(owners[id]) ? 1 : 0.6) * (anim.instant ? 0.8 : 1));
  };

  // --- flips (deal / claim) -------------------------------------------------------------
  const flip = (id: TerritoryId, owner: PlayerId, delay: number, run: Run | null, vol: number): Promise<void> => {
    const t = tiles.get(id);
    const to = tileRgb(lastState, owner);
    const swap = () => {
      owners[id] = owner;
      setOwnerLook(id, owner);
      if (armies[id] < 1) armies[id] = 1;
      tokens.setArmies(id, armies[id], 'snap');
      refreshBadge(id, true);
      if (vol > 0) sfx('place', { volume: 0.35 * vol, pan: panOf(id) });
    };
    if (anim.instant || (run && run.skipped)) {
      swap();
      return Promise.resolve();
    }
    if (reduced) {
      const from = t.rgb;
      return anim.wait(delay, run).then(() =>
        anim
          .tween({
            ms: 250,
            ease: ease.inOutQuad,
            run,
            update: (v) => {
              t.rgb = [from[0] + (to[0] - from[0]) * v, from[1] + (to[1] - from[1]) * v, from[2] + (to[2] - from[2]) * v];
              t.dirty = true;
            },
          })
          .then(swap),
      );
    }
    return anim.wait(delay, run).then(async () => {
      await anim.tween({
        ms: 200,
        ease: ease.inQuad,
        run,
        update: (v) => {
          t.flipX = 1 - v;
          t.fxLift = Math.sin(v * Math.PI * 0.5) * 0.7;
          t.dirty = true;
        },
      });
      swap();
      await anim.tween({
        ms: 220,
        ease: ease.outCubic,
        run,
        update: (v) => {
          t.flipX = v;
          t.fxLift = Math.cos(v * Math.PI * 0.5) * 0.7;
          t.dirty = true;
        },
      });
      t.flipX = 1;
      t.fxLift = 0;
    });
  };

  // --- conquest flood ------------------------------------------------------------------
  const flood = (from: TerritoryId, to: TerritoryId, owner: PlayerId, ms: number, run: Run | null): Promise<void> => {
    const t = tiles.get(to);
    const toRgb = tileRgb(lastState, owner);
    const done = () => {
      t.uniforms.uFloodOn.value = 0;
      // A drift-correcting syncState may have moved on; always land on the displayed owner.
      t.rgb = owners[to] === owner ? toRgb : tileRgb(lastState, owners[to]);
      t.dirty = true;
    };
    if (anim.instant || (run && run.skipped)) {
      done();
      return Promise.resolve();
    }
    if (reduced) {
      const fromRgb = t.rgb;
      return anim.tween({
        ms: 250,
        ease: ease.inOutQuad,
        run,
        update: (v) => {
          t.rgb = [fromRgb[0] + (toRgb[0] - fromRgb[0]) * v, fromRgb[1] + (toRgb[1] - fromRgb[1]) * v, fromRgb[2] + (toRgb[2] - fromRgb[2]) * v];
          t.dirty = true;
        },
        done,
      });
    }
    const ep = tiles.entryPoint(from, to);
    const w = toWorld(ep[0], ep[1], 0);
    t.uniforms.uFloodOrigin.value.set(w.x, w.z);
    t.uniforms.uFloodColor.value.setRGB(toRgb[0], toRgb[1], toRgb[2], THREE.SRGBColorSpace);
    let maxD = 0;
    for (const ring of t.rings) for (const [x, y] of ring) maxD = Math.max(maxD, Math.hypot(x - ep[0], y - ep[1]));
    t.uniforms.uFloodR.value = 0;
    t.uniforms.uFloodOn.value = 1;
    return anim.tween({
      ms,
      ease: ease.inOutCubic,
      run,
      update: (v) => {
        t.uniforms.uFloodR.value = v * (maxD + 1.2);
      },
      done,
    });
  };

  // --- waves (elimination / victory) --------------------------------------------------------
  const wave = (originId: TerritoryId | null, color: RGB, ms: number, lift: number, run: Run | null): Promise<void> => {
    const o = originId ? tiles.get(originId).anchor : ([G.width / 2, G.height / 2] as [number, number]);
    let maxD = 0;
    const dist = tiles.list.map((t) => {
      const d = Math.hypot(t.anchor[0] - o[0], t.anchor[1] - o[1]);
      maxD = Math.max(maxD, d);
      return d;
    });
    const width = maxD * 0.22;
    for (const t of tiles.list) t.tintColor = color;
    const reset = () => {
      for (const t of tiles.list) {
        t.tint = 0;
        t.fxLift = 0;
        t.dirty = true;
      }
    };
    if (anim.instant || (run && run.skipped)) {
      reset();
      return Promise.resolve();
    }
    return anim.tween({
      ms,
      ease: ease.linear,
      run,
      update: (v) => {
        const front = ease.outQuad(v) * (maxD + width * 2) - width;
        tiles.list.forEach((t, i) => {
          const k = Math.max(0, 1 - Math.abs(dist[i] - front) / width);
          const s = k * k * (3 - 2 * k);
          t.tint = s * 0.9;
          t.fxLift = reduced ? 0 : s * lift;
          t.dirty = true;
        });
      },
      done: reset,
    });
  };

  // --- losses at a verdict ---------------------------------------------------------------------
  const applyLosses = (e: Extract<GameEvent, { type: 'diceRolled' }>, fromN: number, toN: number, gen: number, chips: boolean) => {
    if (gen !== syncGen) return;
    armies[e.from] = fromN;
    armies[e.to] = toN;
    if (e.attackerLosses > 0) {
      tokens.setArmies(e.from, fromN, 'hit', null, e.to);
      refreshBadge(e.from, true);
      if (chips) overlay.lossChip(e.from, e.attackerLosses, -1);
      const t = tiles.get(e.from);
      hitFlash(t);
    }
    if (e.defenderLosses > 0) {
      // Emptied, the defender's piece topples toward the attacker (docs/ROUND2.md §D).
      tokens.setArmies(e.to, toN, 'hit', null, e.from);
      refreshBadge(e.to, true);
      if (chips) overlay.lossChip(e.to, e.defenderLosses, 1);
      hitFlash(tiles.get(e.to));
    }
    if (toN <= 0) overlay.hideBadge(e.to);
  };
  const hitFlash = (t: Tile) => {
    t.flashColor = IVORY_RGB;
    if (anim.instant) return;
    const ver = (t.ver.flash = (t.ver.flash ?? 0) + 1);
    void anim.tween({
      ms: 260,
      ease: ease.linear,
      update: (v) => {
        if (t.ver.flash !== ver) return;
        t.flash = Math.sin(v * Math.PI) * (1 - v * 0.3);
        t.dirty = true;
      },
      done: () => {
        if (t.ver.flash === ver) {
          t.flash = 0;
          t.dirty = true;
        }
      },
    });
  };

  // --- event playback ----------------------------------------------------------------------------
  const ensureColors = (s: GameState) => {
    const key = s.players.map((p) => p.color).join(',');
    if (key !== colorKey) {
      colorKey = key;
      for (const id of TERRITORY_IDS) {
        setOwnerLook(id, owners[id]);
        refreshBadge(id, false);
      }
      continents.invalidate();
    }
  };

  async function handle(e: GameEvent, s: GameState, o: PlayEventOptions, run: Run): Promise<void> {
    const gen = syncGen;
    const style = o.style ?? 'full';
    switch (e.type) {
      case 'gameStarted':
      case 'setupTurn':
      case 'phaseChanged':
      case 'cardDrawn':
      case 'cardsCaptured':
      case 'controllerChanged':
      case 'cardsTraded':
        return;

      case 'territoriesDealt': {
        const ids = TERRITORY_IDS.filter((t) => e.owners[t] !== undefined);
        ids.sort((a, b) => tiles.get(a).anchor[0] - tiles.get(b).anchor[0]);
        const stagger = ids.length > 1 ? Math.min(35, 1200 / (ids.length - 1)) : 0;
        await Promise.all(ids.map((id, i) => flip(id, e.owners[id], i * stagger, run, i % 3 === 0 ? 1 : 0)));
        continents.refresh(owners, lastState, false);
        return;
      }

      case 'territoryClaimed': {
        void flip(e.territory, e.player, 0, null, 1).then(() => continents.refresh(owners, lastState, false));
        return;
      }

      case 'armiesPlaced': {
        const id = e.territory;
        if (owners[id] !== e.player) {
          owners[id] = e.player;
          setOwnerLook(id, e.player);
        }
        armies[id] = Math.max(0, armies[id] + e.count);
        refreshBadge(id, false);
        placeQueue.push({ id, count: e.count, source: e.source, vol: isHuman(e.player) ? 1 : 0.6, run });
        return;
      }

      case 'turnStarted': {
        clearPhase();
        if (arrowSource === 'event') {
          arrow.hide();
          arrowSource = null;
        }
        if (rig.mode === 'fill') {
          // Portrait phones: home centres on the new player's territories; the view eases there only if the
          // player hasn't moved it (and never under a finger: then it waits for the lift).
          setFocusFor(e.player);
          rig.retarget();
          if (autoCamera && !rig.attract && !rig.displaced && !rig.isHome(0.01)) {
            if (touches.size > 0 || down) pendingRecenter = true;
            else if (reduced || anim.instant) cutTo({ ...rig.home });
            else {
              void rig.goHome();
              await waitCamera(run);
            }
          }
          return;
        }
        if (autoCamera && !rig.attract && !rig.isHome(0.1)) {
          if (reduced || anim.instant) cutTo({ ...rig.home });
          else {
            void rig.goHome();
            await waitCamera(run);
          }
        }
        return;
      }

      case 'diceRolled': {
        const idx = o.seq?.index ?? 0;
        const count = o.seq?.count ?? 1;
        const fromN = Math.max(1, armies[e.from] - e.attackerLosses);
        const toN = Math.max(0, armies[e.to] - e.defenderLosses);
        const vol = isHuman(e.player) || isHuman(e.defender) ? 1 : 0.6;
        const aPal = pal(e.player) ?? PLAYER_COLORS.crimson;
        const dPal = pal(e.defender) ?? PLAYER_COLORS.cobalt;
        const key = `${e.from}>${e.to}`;
        if (idx === 0 && isAi(e.player)) {
          if (rig.autoProgress < 1) await waitCamera(run);
          else if (needsFraming(e.from, e.to)) await frameEngagement(e.from, e.to, run);
        }
        const hlMatches = lastHl.arrow?.kind === 'attack' && lastHl.arrow.from === e.from && lastHl.arrow.to === e.to;
        if (!hlMatches && (arrow.key !== key || !arrow.group.visible)) {
          arrowSource = 'event';
          const p = arrow.show(e.from, e.to, tileRgb(lastState, owners[e.from]), run, style === 'brief' ? 150 : 240);
          if (idx === 0) await p;
        }
        const last = idx >= count - 1;
        if (style === 'brief') {
          tray.hide(120);
          // arrow 150 + hit ticks ≤ 350 + flip/march 300 ≤ 0.8 s per engagement
          const tick = 350 / Math.max(1, count);
          if (idx === 0 && (e.defenderLosses > 0 || e.attackerLosses > 0)) sfx('hit', { volume: 0.45 * vol, pan: panOf(e.to) });
          applyLosses(e, fromN, toN, gen, false);
          await anim.wait(tick, run);
          if (last && toN > 0 && arrowSource === 'event') {
            arrow.hide();
            arrowSource = null;
          }
          return;
        }
        // full: the battle tray
        rolling++;
        try {
          let mode: 'single' | 'repeat' | 'first' | 'middle' | 'final';
          const now = performance.now();
          if (count <= 1) mode = lastPairKey === key && now - lastRollEnd < 3000 ? 'repeat' : 'single';
          else mode = idx === 0 ? 'first' : last ? 'final' : 'middle';
          let hitPlayed = false;
          await tray.roll({
            attack: e.attackDice,
            defend: e.defendDice,
            attacker: aPal,
            defender: dPal,
            mode,
            durMs: mode === 'middle' ? blitzRollMs(idx, count) : undefined,
            reduced,
            run,
            onShake: (ms) => sfx('diceShake', { duration: Math.max(0.06, ms / 1000), volume: vol }),
            onLand: (side, i) => {
              if (mode === 'middle' || (reduced && i === 0)) {
                sfx('diceLand', { volume: vol, rate: Math.min(1.4, 1 + 0.08 * idx) });
              } else sfx('diceLand', { volume: vol, pan: side * 0.3, rate: count > 1 ? Math.min(1.4, 1 + 0.08 * idx) : 1 });
            },
            onVerdict: () => {
              if (!hitPlayed) {
                hitPlayed = true;
                const loserSide = e.defenderLosses >= e.attackerLosses ? 0.3 : -0.3;
                sfx('hit', { volume: (mode === 'middle' ? 0.5 : 1) * vol, pan: loserSide });
              }
              applyLosses(e, fromN, toN, gen, mode !== 'middle' || count <= 6);
            },
          });
        } finally {
          rolling--;
        }
        lastPairKey = key;
        lastRollEnd = performance.now();
        if (last) {
          // A decided fight (captured, or the attacker can't go on) fades ~1 s after the verdict; an
          // undecided single roll keeps the tray for the next roll.
          const decided = toN <= 0 || fromN <= 1 || count > 1;
          tray.linger(decided ? TRAY_DECIDED_MS : 2500, performance.now());
          if (toN > 0 && arrowSource === 'event') {
            arrow.hide();
            arrowSource = null;
          }
        } else tray.lingerUntil = 0;
        return;
      }

      case 'territoryConquered': {
        const to = e.to;
        lastConquered = to;
        lastConquestAt = performance.now();
        const prevOwner = e.previousOwner;
        owners[to] = e.player;
        armies[to] = 0;
        overlay.hideBadge(to);
        tokens.setArmies(to, 0, 'out', null, e.from);
        tokens.setColor(to, tileRgb(lastState, e.player));
        const somber = isHuman(prevOwner) && isAi(e.player);
        sfx('conquer', { volume: isHuman(e.player) || isHuman(prevOwner) ? 1 : 0.6, pan: panOf(to), variant: somber ? 'somber' : undefined });
        const ms = style === 'brief' ? 250 : 600;
        const f = flood(e.from, to, e.player, ms, null).then(() => {
          if (gen === syncGen) continents.refresh(owners, lastState, false);
        });
        if (!reduced && style !== 'brief') {
          const t = tiles.get(to);
          ripples.ring(new THREE.Vector3(t.anchorW.x, TILE_TOP + 0.03, t.anchorW.z), Math.min(3.2, t.clearance * 1.6 + 0.8), IVORY_RGB, 500);
        }
        // The march starts +150 ms into the flood (full) / +100 ms into the flip (brief); the rest of
        // the color change keeps running while the token moves.
        void f;
        await anim.wait(style === 'brief' ? 100 : 150, run);
        return;
      }

      case 'armiesMoved': {
        const { from, to, count } = e;
        const color = tileRgb(lastState, e.player);
        const vol = isHuman(e.player) ? 1 : 0.6;
        const fromN = Math.max(0, armies[from] - count);
        const toN = armies[to] + count;
        let ms: number;
        let via: TerritoryId[] = [];
        if (e.reason === 'fortify') {
          const path = e.path && e.path.length >= 2 ? e.path : [from, to];
          const hops = path.length - 1;
          ms = Math.min(900, 220 * hops);
          via = path.slice(1, -1);
          if (via.length > 4) via = via.filter((_, i) => i % Math.ceil(via.length / 4) === 0);
        } else {
          // inlineMarch = the conquest's own march (AI occupy / auto-occupy): 500 ms from +150.
          // A manual occupy count after a pause is a 400 ms move.
          const inline = o.inlineMarch ?? (lastConquered === to && performance.now() - lastConquestAt < 1500);
          ms = style === 'brief' ? 200 : inline ? 500 : 400;
        }
        // lift-off
        armies[from] = fromN;
        tokens.setArmies(from, fromN, 'lift', run);
        refreshBadge(from, false);
        sfx('march', { volume: vol, duration: anim.scale(ms) / 1000, pan: panOf(from) });
        if (!owners[to] || owners[to] !== e.player) {
          owners[to] = e.player;
          setOwnerLook(to, e.player);
        }
        // A token carrying the count glides along the arc; the destination's number updates on landing.
        const ink = pal(e.player)?.ink ?? IVORY;
        await tokens.march(from, to, count, color, ink, ms, run, via, e.reason === 'fortify' ? 0.7 : 1.3, pal(e.player)?.id ?? '');
        if (gen === syncGen) {
          armies[to] = toN;
          tokens.setArmies(to, toN, 'land', run);
          refreshBadge(to, false);
          const pv = new THREE.Vector3();
          tokens.dustPoint(to, pv);
          if (!reduced && !anim.instant) particles.burst(pv, 6);
        }
        if (e.reason === 'occupy' && arrowSource === 'event') {
          arrow.hide();
          arrowSource = null;
        }
        return;
      }

      case 'continentGained': {
        continents.refresh(owners, lastState, false);
        const p = pal(e.player);
        if (p) await continents.flare(e.continent, p.base, run);
        return;
      }

      case 'continentLost': {
        continents.refresh(owners, lastState, false);
        await anim.wait(300, run);
        return;
      }

      case 'playerEliminated': {
        const p = pal(e.by);
        await wave(lastConquered, p ? hexToRgb(p.base) : IVORY_RGB, 1600, 0.22, run);
        return;
      }

      case 'gameOver': {
        const p = pal(e.winner);
        if (arrowSource) {
          arrow.hide();
          arrowSource = null;
        }
        hideTray(200);
        await wave(null, p ? hexToRgb(p.light) : IVORY_RGB, 2400, 0.45, run);
        // Only if the finale played out: a skipped run means the table has moved on (a Rematch or a new
        // game pressed during the wave), and an orbit switched on now would sway the next game's board.
        if (!reduced && !run.skipped) {
          rig.setAttract(true);
          tableView(true);
        }
        return;
      }
    }
  }

  const NON_BLOCKING = new Set(['armiesPlaced', 'territoryClaimed', 'setupTurn', 'phaseChanged', 'cardDrawn', 'controllerChanged']);

  const playEvent = (e: GameEvent, stateAfter: GameState, o: PlayEventOptions = {}): Promise<void> => {
    if (disposed) return Promise.resolve();
    lastState = stateAfter;
    ensureColors(stateAfter);
    const run = anim.beginRun();
    const nb = NON_BLOCKING.has(e.type);
    inflight++;
    invalidate();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        inflight--;
        invalidate();
        clearTimeout(dog);
        anim.endRun(run);
        resolve();
      };
      // Watchdog: nothing may hang the queue.
      const dog = setTimeout(() => {
        anim.skipRun(run);
        setTimeout(finish, 50);
      }, 9000);
      const go = async () => {
        try {
          if (!nb) await waitCamera(run);
          await handle(e, stateAfter, o, run);
        } catch (err) {
          console.error('[render] playEvent', e.type, err);
        } finally {
          finish();
        }
      };
      void go();
    });
  };

  // Portrait fill view: which player's territories home favours (the current player; before any owner,
  // Europe and Africa).
  let focusPlayer: PlayerId | -2 = -2;
  let focusGame: string | null = null;
  let pendingRecenter = false;
  const FOCUS_FALLBACK = (() => {
    const ids = TERRITORY_IDS.filter((id) => ['europe', 'africa'].includes(TERRITORIES[id].continent));
    return ids.reduce((a, id) => a + tiles.get(id).anchorW.x, 0) / Math.max(1, ids.length);
  })();
  /**
   * The fill view centres on where the player's turn happens: their front (their territories that border
   * an enemy, and the enemies across it); with no front, all of theirs; with none, Europe / Africa.
   */
  function setFocusFor(p: PlayerId): void {
    focusPlayer = p;
    const mine = TERRITORY_IDS.filter((id) => owners[id] === p);
    const front = new Set<TerritoryId>();
    for (const id of mine) {
      const foes = ADJACENCY[id].filter((n) => owners[n] !== p && owners[n] >= 0);
      if (!foes.length) continue;
      front.add(id);
      for (const f of foes) front.add(f);
    }
    const ids = front.size ? [...front] : mine;
    rig.setFocus(
      ids.map((id) => tiles.get(id).anchorW.x),
      FOCUS_FALLBACK,
    );
  }
  const syncState = (s: GameState) => {
    lastState = s;
    ensureColors(s);
    let changed = false;
    for (const id of TERRITORY_IDS) {
      const ts = s.territories[id];
      if (owners[id] !== ts.owner) {
        owners[id] = ts.owner;
        const t = tiles.get(id);
        t.uniforms.uFloodOn.value = 0;
        setOwnerLook(id, ts.owner);
        changed = true;
      }
      if (armies[id] !== ts.armies) {
        armies[id] = ts.armies;
        tokens.setArmies(id, ts.armies, 'snap');
        changed = true;
      }
      refreshBadge(id, false);
    }
    if (changed) {
      syncGen++;
      needShadow = true;
    }
    continents.refresh(owners, s, true);
    // Portrait fill view: home follows the current player's territories. A new game / load / resume (a new
    // state id) eases there; otherwise home is only re-aimed (turnStarted moves the camera, never mid-turn).
    if (changed || focusPlayer !== s.currentPlayer || s.id !== focusGame) {
      const fresh = s.id !== focusGame;
      focusGame = s.id;
      setFocusFor(s.currentPlayer);
      if (rig.mode === 'fill') {
        rig.retarget();
        if (fresh && !rig.displaced && touches.size === 0 && !down && !rig.attract) {
          if (reduced || anim.instant) cutTo({ ...rig.home });
          else void rig.goHome();
        }
      }
    }
  };

  // --- frame loop ------------------------------------------------------------------------------
  const frameTimes: number[] = [];
  let lastT = performance.now();
  let fps = 60;
  let fpsAcc = 0;
  let fpsN = 0;
  let raf = 0;
  // Container origin in client px (the overlay itself is positioned in container px).
  const rect0 = { left: 0, top: 0 } as DOMRect;
  const clientOrigin = () => {
    const r = container.getBoundingClientRect();
    (rect0 as { left: number; top: number }).left = r.left;
    (rect0 as { left: number; top: number }).top = r.top;
  };
  let prevLift = new Float32Array(tiles.list.length);

  /** Phone-sized layout (either side under 520 CSS px): phone framing, 20 px plaques, deeper zoom. */
  let compact = false;
  /** Landscape phones look down a little less steeply: a shorter land fits the short screen wider. */
  let phoneLandPitch = HOME_PITCH;
  let landClearOverride: number | null = null;
  // The side safe areas (notch / Dynamic Island in landscape): the land runs to 12 px inside them.
  const safeProbe = document.createElement('div');
  Object.assign(safeProbe.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: '0',
    height: '0',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
  } as Partial<CSSStyleDeclaration>);
  container.appendChild(safeProbe);
  const readSafeArea = () => {
    const cs = getComputedStyle(safeProbe);
    rig.safeLeft = parseFloat(cs.paddingLeft) || 0;
    rig.safeRight = parseFloat(cs.paddingRight) || 0;
  };
  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    clientOrigin();
    invalidate();
    if (w === W && h === H) return;
    W = w;
    H = h;
    compact = Math.min(W, H) < 520;
    rig.trayKeepOutSoft = compact;
    // Phones: portrait fills the height (east–west crops, pans); landscape fits the land edge to edge,
    // tighter to the HUD bands. Desktop and tablets keep the round-2 home.
    rig.mode = compact && H > W ? 'fill' : 'fit';
    // Landscape phones are height-bound (the land is ~2.1:1, the free band ~3.5:1): the land's own edge
    // (Arctic islands, Tierra del Fuego) may tuck under the translucent HUD bands, and the figures' tops a
    // little under the top one; every count plaque and base stays 6 px clear, so every piece is tappable.
    const phoneLand = compact && W > H;
    rig.landClear = landClearOverride ?? (phoneLand ? -40 : compact ? 4 : HOME_CLEAR_PX);
    rig.pieceClear = compact ? 6 : HOME_CLEAR_PX;
    rig.figureClear = phoneLand ? -14 : null;
    rig.homePitch = phoneLand ? phoneLandPitch : HOME_PITCH;
    readSafeArea();
    overlay.minPlaque = compact ? 20 : 22;
    overlay.relax = compact;
    renderer.setSize(W, H, false);
    rig.setSize(W, H);
    overlay.width = W;
    overlay.height = H;
    tiles.setResolution(W, H);
    for (const m of lanes.mats) m.resolution.set(W, H);
    for (const m of route.mats) m.resolution.set(W, H);
    particles.setViewportHeight(H * renderer.getPixelRatio(), camera.fov);
    keepBand = insets.trayBand;
    layoutTray();
  };
  /** The dice tray's own band height when the HUD doesn't report one (tray + a little air). */
  const nominalBand = () => boardTrayGeometry(W, H, 1e9, uiScale).trayH + 12;
  /** Largest band the HUD has reported (sticky): the home view's tray keep-out follows it. */
  let keepBand = 0;
  const layoutTray = () => {
    const band = insets.trayBand > 0 ? insets.trayBand : nominalBand();
    // The band sits just above the bottom strip; the tray is centred in it.
    tray.layout(W, H, H - insets.bottom - band, band, uiScale);
    // The home view keeps tokens clear of the tray's footprint where it can (camera.ts). The band it
    // assumes only ever grows, so a HUD that reports the band only during fights never moves the camera
    // mid-game (it re-homes once, the first time).
    keepBand = Math.max(keepBand, insets.trayBand);
    const kb = keepBand > 0 ? keepBand : nominalBand();
    const g = boardTrayGeometry(W, H, kb, uiScale);
    // Every piece (its plaque included) stays above the tray's top with a little air, and clear of its
    // sides. (The HUD's header line is centred and short; southern pieces near the tray's ends sit beside it.)
    const clear = 6 * uiScale;
    rig.trayKeepOut = { x0: W / 2 - g.trayW / 2 - 12, x1: W / 2 + g.trayW / 2 + 12, y0: H - insets.bottom - kb + (kb - g.trayH) / 2 - clear };
    setPieceExtents();
    rig.recomputeHome();
    if (compact) {
      // Phones: the count plaque (≥ 20 px) is far bigger than the piece at the home scale, so fit its real
      // reach below the base (in board units at this scale), and let the player zoom in further.
      for (let it = 0; it < 2; it++) {
        const ppu = homePxPerUnit();
        const ph = overlay.plaqueH(2 * tokens.radius * ppu);
        const reach = (0.7 * ph) / Math.max(0.5, ppu * Math.sin((HOME_PITCH * Math.PI) / 180));
        rig.pieceExtents = tokens.extentPoints(HOME_PITCH, Math.max(0.8 * (1 + (uiScale - 1) * 0.8), reach));
        rig.recomputeHome();
      }
      rig.zoomInMax = clamp(40 / Math.max(1, homePxPerUnit()), 3.5, 9);
    } else rig.zoomInMax = 3.5;
    continents.fitLabels(rig.homeCamera(), W);
    invalidate();
  };
  /** CSS px per board unit at the centre of the board, at the home view. */
  const homePxPerUnit = (): number => {
    const cam = rig.homeCamera();
    const a = toWorld(G.width / 2, G.height / 2, TILE_TOP).project(cam);
    const b = toWorld(G.width / 2 + 1, G.height / 2, TILE_TOP).project(cam);
    return Math.hypot((b.x - a.x) * 0.5 * W, (b.y - a.y) * 0.5 * H);
  };

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  // --- power (docs/MOBILE.md §7): render on demand, pause when hidden, adaptive pixel ratio ----------
  // The loop keeps ticking (cheap bookkeeping), but the GPU only draws when something changed: a tween,
  // the camera, a piece, a particle, a pulsing outline, an API call or input (invalidate()).
  let frameNo = 0;
  let drawnN = 0;
  let drawnAcc = 0;
  let drawnFps = 0;
  let drawnTotal = 0;
  let drewLast = false;
  /** Adaptive pixel ratio (touch GPUs): a smoothed frame time and how long it has been over budget. */
  let emaMs = 16.7;
  let overMs = 0;
  let contextLost = false;
  const applyPixelRatio = () => {
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(W, H, false);
    particles.setViewportHeight(H * renderer.getPixelRatio(), camera.fov);
    needShadow = true;
    invalidate();
  };
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const rawDt = now - lastT;
    lastT = now;
    frameNo++;
    if (rawDt > 0 && rawDt < 1000) {
      frameTimes.push(rawDt);
      if (frameTimes.length > 240) frameTimes.shift();
      fpsAcc += rawDt;
      fpsN++;
      if (fpsAcc >= 500) {
        fps = (fpsN * 1000) / fpsAcc;
        drawnFps = (drawnN * 1000) / fpsAcc;
        fpsAcc = 0;
        fpsN = 0;
        drawnN = 0;
      }
    }
    if (contextLost) return;
    flushPlacements();
    const tweening = anim.active > 0;
    anim.tick(rawDt);
    const camMoving = rig.moving;
    rig.update(rawDt);
    // camera waiters
    for (let i = camWaiters.length - 1; i >= 0; i--) {
      const w = camWaiters[i];
      if (rig.autoProgress >= 0.8 || (w.run && w.run.skipped)) {
        camWaiters.splice(i, 1);
        w.resolve();
      }
    }
    const disp = rig.displaced;
    if (disp !== lastDisplaced) {
      lastDisplaced = disp;
      for (const cb of displacedCbs) {
        try {
          cb(disp);
        } catch (err) {
          console.error(err);
        }
      }
    }
    if (tray.lingerUntil && now >= tray.lingerUntil) {
      tray.lingerUntil = 0;
      hideTray(TRAY_FADE_MS);
      invalidate();
    }
    // Anything to draw? (`pulsing` = an unarmed target outline breathes: ambient, 30 fps on phones.)
    let pulsing = false;
    let tileDirty = false;
    for (const t of tiles.list) {
      if (t.rimMode === 'target') pulsing = true;
      if (t.dirty) tileDirty = true;
    }
    const busy =
      hot > 0 ||
      inflight > 0 ||
      tweening ||
      anim.active > 0 ||
      camMoving ||
      rig.moving ||
      tokens.animating ||
      tokens.needsUpdate ||
      particles.alive > 0 ||
      needShadow ||
      tileDirty ||
      overlay.dirty ||
      overlay.chipCount > 0;
    if (!busy && !pulsing) {
      drewLast = false;
      return;
    }
    if (!busy && pulsing && phoneGpu && frameNo % 2 === 1) return;
    if (hot > 0) hot--;
    // Adaptive pixel ratio on touch GPUs: over budget (< ~48 fps smoothed) for 2 s of continuous drawing
    // drops the cap from 2 to 1.5, once.
    if (coarse && drewLast && rawDt > 0 && rawDt < 250 && dprCap > 1.5 && (window.devicePixelRatio || 1) > 1.5) {
      emaMs = emaMs * 0.92 + rawDt * 0.08;
      overMs = emaMs > 21 ? overMs + rawDt : 0;
      if (overMs > 2000) {
        dprCap = 1.5;
        overMs = 0;
        applyPixelRatio();
      }
    }
    drewLast = true;
    drawnN++;
    drawnTotal++;
    const pulse = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin((now / 1200) * Math.PI * 2));
    const rimScale = 1;
    let moved = false;
    tiles.list.forEach((t, i) => {
      tiles.apply(t, pulse, rimScale);
      const y = t.pivot.position.y + t.pivot.scale.x;
      if (y !== prevLift[i]) {
        prevLift[i] = y;
        moved = true;
      }
    });
    const tokensMoving = tokens.animating;
    tokens.setView(rig.cur.az, rig.cur.pitch);
    tokens.update();
    particles.update(Math.min(rawDt, 50) / 1000);
    tray.tick(now);
    if (tray.showing !== trayShownEmitted) emitTray(tray.showing);
    parts.oceanUniforms.uTime.value = now / 1000;
    overlay.zoomScale = clamp(Math.pow(rig.zoom, 0.3), 0.85, 1.3);
    // Numbers and names under the dice tray hide while it shows (the tray is drawn after the board).
    const oc = overlay.occluder;
    oc.on = tray.visible;
    if (oc.on) {
      oc.x0 = tray.cx - tray.trayW / 2;
      oc.x1 = tray.cx + tray.trayW / 2;
      oc.y0 = tray.cy - tray.trayH / 2 - 4;
      oc.y1 = tray.cy + tray.trayH / 2 + 4;
    }
    overlay.update(camera, rect0);

    renderer.info.reset();
    renderer.clear();
    if (moved || tokensMoving || anim.active > 0 || needShadow) {
      renderer.shadowMap.needsUpdate = true;
      needShadow = false;
    }
    renderer.render(scene, camera);
    if (tray.visible) {
      renderer.clearDepth();
      renderer.shadowMap.needsUpdate = true;
      renderer.render(tray.scene, tray.camera);
    }
    if (reloading && !contextLost) {
      reloading = false;
      overlay.root.style.transition = 'opacity 300ms ease-out';
      overlay.root.style.opacity = '1';
      emitLoss(false);
    }
  };
  const onVisibility = () => {
    if (disposed) return;
    if (document.hidden) {
      // Paused while hidden: no frames at all (the watchdogs still resolve every playEvent).
      cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    if (!raf) {
      lastT = performance.now();
      invalidate();
      needShadow = true;
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // --- WebGL context loss (docs/MOBILE.md §7): a quiet reload, never a white screen ------------------
  // Lost: stop drawing (the canvas shows the far-ocean colour) and tell the HUD (`Reloading the board…`).
  // Restored: three.js re-creates its GL state and re-uploads every geometry and texture on the next draw;
  // the board regenerates what only lived on the GPU (the environment map, the shadow maps) and redraws.
  // No restore within 3 s: a fresh renderer (new canvas) takes over the same scene.
  const lossCbs: ((lost: boolean) => void)[] = [];
  let reloading = false;
  let lossTimer: ReturnType<typeof setTimeout> | null = null;
  const emitLoss = (lost: boolean) => {
    for (const cb of lossCbs) {
      try {
        cb(lost);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const regenEnvironment = () => {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const old = parts.envTexture;
    parts.envTexture = env;
    scene.environment = env;
    tray.scene.environment = env;
    old.dispose();
  };
  const afterRestore = () => {
    contextLost = false;
    if (lossTimer) clearTimeout(lossTimer);
    lossTimer = null;
    try {
      regenEnvironment();
    } catch (err) {
      console.warn('[render] environment', err);
    }
    needShadow = true;
    for (const t of tiles.list) t.dirty = true;
    tokens.markDirty();
    invalidate();
    // `reloading` clears (and the HUD hears `false`) after the first frame is drawn.
  };
  function onContextLost(e: Event): void {
    e.preventDefault(); // ask the browser to restore it
    if (disposed || contextLost) return;
    contextLost = true;
    reloading = true;
    // Numbers and names would float over an empty canvas: they wait for the board to come back.
    overlay.root.style.transition = 'opacity 160ms ease-out';
    overlay.root.style.opacity = '0';
    emitLoss(true);
    if (lossTimer) clearTimeout(lossTimer);
    lossTimer = setTimeout(recreateRenderer, 3000);
  }
  function onContextRestored(): void {
    if (disposed) return;
    afterRestore();
  }
  function recreateRenderer(): void {
    lossTimer = null;
    if (disposed || !contextLost) return;
    try {
      const old = renderer;
      const oldCanvas = canvas;
      unbindCanvas(oldCanvas);
      renderer = makeRenderer();
      canvas = renderer.domElement;
      canvas.style.opacity = '1';
      container.insertBefore(canvas, oldCanvas);
      oldCanvas.remove();
      bindCanvas(canvas);
      try {
        old.dispose();
      } catch {
        /* the old context is gone */
      }
      renderer.setSize(W, H, false);
      particles.setViewportHeight(H * renderer.getPixelRatio(), camera.fov);
      afterRestore();
    } catch (err) {
      console.error('[render] renderer rebuild', err);
      lossTimer = setTimeout(recreateRenderer, 3000);
    }
  }

  let needShadow = true;

  // --- warm-up: compile every material, render one hidden dice + flood frame ------------------
  {
    const t0 = tiles.list[0];
    t0.uniforms.uFloodOn.value = 1;
    t0.uniforms.uFloodR.value = 3;
    tray.warm(PLAYER_COLORS.crimson, PLAYER_COLORS.cobalt);
    arrow.group.visible = true;
    void arrow.show('ural', 'siberia', [1, 0, 0], null, 0);
    route.show(['ural', 'siberia', 'yakutsk']);
    const tmpR = ripples;
    void tmpR;
    particles.burst(new THREE.Vector3(0, 1, 0), 2);
    tokens.setArmies('ural', 1, 'snap');
    tokens.update();
    // compile() only walks visible objects: expose one rim pair and the ripple rings for it.
    t0.rimIvory.visible = t0.rimUnder.visible = true;
    t0.rimIvoryMat.opacity = t0.rimUnderMat.opacity = 0.01;
    for (const c of ripples.group.children) c.visible = true;
    try {
      renderer.compile(scene, camera);
      renderer.compile(tray.scene, tray.camera);
    } catch (err) {
      console.warn('[render] compile', err);
    }
    frame();
    cancelAnimationFrame(raf);
    t0.uniforms.uFloodOn.value = 0;
    t0.rimIvory.visible = t0.rimUnder.visible = false;
    t0.dirty = true;
    for (const c of ripples.group.children) c.visible = false;
    tray.resetWarm();
    arrow.hide(true);
    route.hide();
    anim.skipAll();
    tokens.setArmies('ural', 0, 'snap');
    tokens.markDirty();
    // The warm-up frame baked the arrow/route into the shadow map: re-render it clean.
    needShadow = true;
  }
  lastT = performance.now();
  raf = requestAnimationFrame(frame);
  // The DOM overlay (numbers, names) fades in with the canvas, so text never floats over a black board.
  overlay.root.style.opacity = '0';
  requestAnimationFrame(() => {
    canvas.style.opacity = '1';
    overlay.root.style.opacity = '1';
    overlay.root.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  });

  // --- the BoardView ------------------------------------------------------------------------------
  const view: BoardView = {
    syncState,
    playEvent,
    setAnimationSpeed(m: number) {
      anim.speed = m <= 0 ? 0 : m;
    },
    skipAnimations() {
      anim.skipAll();
      rig.finishAuto();
      for (const w of camWaiters.splice(0)) w.resolve();
      if (audio) {
        try {
          audio.stopAll();
        } catch {
          /* ignore */
        }
      }
    },
    setHighlights(hl: BoardHighlights) {
      const h = hl ?? {};
      const prev = lastHl;
      lastHl = { ...h, targets: h.targets ? [...h.targets] : undefined };
      applyHighlights(h, prev);
    },
    onTerritoryClick(cb) {
      clickCbs.push(cb);
    },
    onTerritoryHover(cb) {
      hoverCbs.push(cb);
    },
    focusTerritories(ids: TerritoryId[], o?: { durationMs?: number }) {
      if (!ids.length) {
        if (reduced) cutTo({ ...rig.home });
        else void rig.goHome(o?.durationMs);
        return;
      }
      const pose = rig.framePose(ids.map((id) => tiles.get(id).anchorW), ids.length === 1 ? 2.2 : 1);
      if (reduced) cutTo(pose);
      else void rig.moveTo(pose, o?.durationMs);
    },
    resetCamera() {
      if (rig.attract) {
        rig.setAttract(false, false);
        tableView(false);
      }
      rig.userMoved = false;
      if (reduced) cutTo({ ...rig.home });
      else void rig.goHome();
    },
    setAttractMode(on: boolean) {
      if (on && reduced) {
        tableView(true);
        return;
      }
      if (!on && reduced) tableView(false);
      rig.setAttract(on);
      if (rig.attract === on) tableView(on);
    },
    isViewDisplaced() {
      return rig.displaced;
    },
    onViewDisplacedChange(cb: (displaced: boolean) => void) {
      displacedCbs.push(cb);
    },
    onTrayChange(cb: (visible: boolean) => void) {
      trayCbs.push(cb);
    },
    pulsePhase(phase: 'attack' | 'fortify' | 'end', o?: { player?: PlayerId; territories?: TerritoryId[] }) {
      pulsePhase(phase, o);
    },
    setShowLabels(on: boolean) {
      overlay.setShowLabels(on);
    },
    setViewportInsets(i: ViewportInsets) {
      // `bottom` is the bottom strip; `trayBand` the band above it. A HUD that folds the band into
      // `bottom` (the round-1 convention) is recognised, so the home view never reserves the band.
      let bottom = i.bottom;
      const band = i.trayBand > 0 ? i.trayBand : 0;
      // (Not when rects are sent: that HUD reports the strip's real top edge, whatever its height.)
      if (band > 0 && bottom >= band + 40 && !(i.rects && i.rects.length)) bottom -= band;
      insets = { top: i.top, right: i.right, left: i.left, bottom, trayBand: band, rects: i.rects?.map((r) => ({ ...r })) };
      rig.setInsets(insets);
      layoutTray();
    },
    setUiScale(scale: number) {
      uiScale = clamp(scale || 1, 0.75, 2);
      tokens.sizeScale = 1 + (uiScale - 1) * 0.6;
      overlay.uiScale = uiScale;
      // Bigger numbers need a bigger disc (softened, so tokens still leave their tiles showing).
      tokens.sizeScale = 1 + (uiScale - 1) * 0.6;
      tokens.markDirty();
      keepBand = insets.trayBand;
      layoutTray();
    },
    setReducedMotion(on: boolean) {
      reduced = on;
      if (on && rig.attract) tableView(true);
      tokens.reduced = on;
      continents.reducedMotion = on;
      if (on && rig.attract) rig.setAttract(false, false);
      applyHighlights(lastHl, lastHl);
    },
    setAudio(a: AudioEngine | null) {
      audio = a;
    },
    setAutoCamera(on: boolean) {
      autoCamera = on;
    },
    getScreenPosition(t: TerritoryId) {
      // Fresh each call (not last frame's value), in client px.
      return overlay.project(t, camera, container.getBoundingClientRect());
    },
    onTerritoryLongPress(cb: (info: TerritoryPointerInfo | null) => void) {
      longCbs.push(cb);
    },
    onContextLoss(cb: (lost: boolean) => void) {
      lossCbs.push(cb);
    },
    getStats(): BoardStats {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      return {
        fps: Math.round(fps * 10) / 10,
        frameMsP95: Math.round(p95 * 10) / 10,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        activeTweens: anim.active,
        cameraMoving: rig.moving,
        particles: particles.alive,
        maxCameraDegPerSec: Math.round(rig.maxAutoDegPerSec * 10) / 10,
        drawnFps: Math.round(drawnFps * 10) / 10,
        pixelRatio: renderer.getPixelRatio(),
        contextLost,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      anim.dispose();
      unbindCanvas(canvas);
      clearTimer();
      if (lossTimer) clearTimeout(lossTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      container.removeEventListener('contextmenu', onContext);
      for (const w of camWaiters.splice(0)) w.resolve();
      tiles.dispose();
      tokens.dispose();
      continents.dispose();
      lanes.dispose();
      arrow.dispose();
      route.dispose();
      particles.dispose();
      ripples.dispose();
      tray.dispose();
      overlay.dispose();
      grain.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      parts.materials.forEach((m) => m.dispose());
      parts.envTexture.dispose();
      parts.walnut.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };

  // Every call from the controller may change what the board shows: draw the next frames.
  for (const k of Object.keys(view) as (keyof BoardView)[]) {
    const f = view[k];
    if (typeof f !== 'function' || k === 'getStats' || k === 'getScreenPosition' || k === 'isViewDisplaced') continue;
    (view as unknown as Record<string, unknown>)[k] = function (this: unknown, ...args: unknown[]) {
      invalidate();
      return (f as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  // Debug hook for the sandbox / e2e (cheap).
  (view as unknown as { __debug: unknown }).__debug = {
    rig,
    anim,
    tray,
    owners,
    armies,
    tiles,
    get renderer() {
      return renderer;
    },
    get canvas() {
      return canvas;
    },
    get compact() {
      return compact;
    },
    set figureClear(v: number) {
      rig.figureClear = v;
      W = -1;
      resize();
    },
    set landClear(v: number) {
      landClearOverride = v;
      W = -1;
      resize();
    },
    set phoneLandPitch(v: number) {
      phoneLandPitch = v;
      W = -1;
      resize();
    },
    get frameNo() {
      return frameNo;
    },
    /** Why the render-on-demand loop is drawing right now (debugging idle redraws). */
    busyWhy: () => ({
      hot,
      inflight,
      tweens: anim.active,
      cam: rig.moving,
      tokens: tokens.animating || tokens.needsUpdate,
      particles: particles.alive,
      needShadow,
      tileDirty: tiles.list.filter((t) => t.dirty).map((t) => t.id),
      pulsing: tiles.list.filter((t) => t.rimMode === 'target').length,
      overlay: overlay.dirty,
      chips: overlay.chipCount,
      tray: tray.visible,
    }),
    get drawn() {
      return drawnTotal;
    },
    coarse,
    phoneGpu,
    touchPick: (x: number, y: number) => touchPick(x, y, clickable),
    homePxPerUnit,
    tokens,
    overlay,
    get hovered() {
      return hovered;
    },
    pick: (x: number, y: number) => pick(x, y, false),
  };
  void lastHoverEvent;
  void prevLift;
  prevLift = prevLift;
  return view;
};

export default createBoardView;
