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
import { TERRITORY_IDS } from '../engine/mapData';
import type { AudioEngine, PlayOptions, SfxName } from '../audio/types';
import { PLAYER_COLORS, type PlayerPalette } from '../shared/palette';
import { Animator, ease, clamp, type Run } from './anim';
import { buildScene } from './scene';
import { TileSet, type Tile, type RimMode } from './tiles';
import { PieceSystem } from './pieces';
import { Overlay } from './overlay';
import { Continents } from './continents';
import { AttackArrow, FortifyRoute, Particles, Ripples, SeaLanes } from './fx';
import { DiceTray } from './dice';
import { CameraRig } from './camera';
import { paintGrainTexture } from './textures';
import {
  IVORY,
  TILE_DEPTH,
  TILE_TOP,
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

  // --- renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    opacity: '0',
    transition: 'opacity 400ms ease-out',
    touchAction: 'none',
    outline: 'none',
  } as Partial<CSSStyleDeclaration>);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  const anim = new Animator();
  const parts = buildScene(renderer, G);
  const scene = parts.scene;
  const grain = paintGrainTexture();
  const tiles = new TileSet(G, grain);
  scene.add(tiles.group);
  const pieces = new PieceSystem(anim, tiles);
  scene.add(pieces.group);
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
  const overlay = new Overlay(container, G, tiles, anim);
  const tray = new DiceTray(anim, parts.envTexture, parts.walnut);
  const rig = new CameraRig(G.width, G.height);
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
  let insets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0, trayBand: 0 };
  let W = 1;
  let H = 1;
  let disposed = false;
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
    pieces.setColor(id, t.rgb);
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
      if (t.id === sel) mode = 'selected';
      else if (targets.has(t.id)) mode = t.id === arrowTo || reduced ? 'armed' : 'target';
      else if (selectable.has(t.id)) mode = 'selectable';
      else if (t.id === arrowTo) mode = 'armed';
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
      const dim = h.dimOthers && !keep.has(t.id) ? 1 : 0;
      if (Math.abs(dim - t.dim) > 1e-4) tw(t, 'dim', t.dim, dim, dim > t.dim ? 180 : 140, ease.outQuad);
      overlay.setDim(t.id, dim === 1);
      if (!clickable.has(t.id) && t.hoverLift > 0 && t.id !== hovered) tw(t, 'hoverLift', t.hoverLift, 0, 140);
    }
    // hover state may have changed clickability
    if (hovered) setHoverLook(hovered, clickable.has(hovered));
    updateCursor();
    // pending ghosts
    for (const id of TERRITORY_IDS) overlay.setGhost(id, Math.max(0, h.pending?.[id] ?? 0));
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
    // A selection change ends the dice linger.
    const selKey = (x: BoardHighlights) => `${x.selected ?? ''}|${x.arrow ? `${x.arrow.from}>${x.arrow.to}` : ''}`;
    if (selKey(h) !== selKey(prev) && tray.visible && rolling === 0) tray.hide(200);
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
  const pick = (cx: number, cy: number, useHysteresis: boolean): TerritoryId | null => {
    const bp = boardPoint(cx, cy);
    if (!bp) return null;
    const cand = territoryAt(bp[0], bp[1]);
    if (!useHysteresis || !hovered || cand === hovered) return cand;
    // A new tile takes hover only once the pointer is ≥ 3 px past the shared edge.
    const cur = tiles.get(hovered);
    let d = Infinity;
    for (const ring of cur.rings) d = Math.min(d, distToRing(bp[0], bp[1], ring));
    if (d / unitsPerPx(bp[0], bp[1]) < 3) return hovered;
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
    if (prev) setHoverLook(prev, false);
    if (id && clickable.has(id)) setHoverLook(id, true);
    updateCursor();
    if (!e) for (const cb of hoverCbs) cb(null);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (disposed) return;
    audio?.unlock?.();
    canvas.setPointerCapture?.(e.pointerId);
    const id = pick(e.clientX, e.clientY, true);
    down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, tile: id, id: e.pointerId };
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
    if (disposed || !down) return;
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
    const dt = performance.now() - d.t;
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
  const onPointerCancel = () => {
    down = null;
    dragging = false;
    releasePress();
    updateCursor();
  };
  const onLeave = () => {
    if (down) return;
    setHovered(null, null);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = rectOf();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    rig.zoomAt(e.clientX - r.left, e.clientY - r.top, clamp(dy, -240, 240));
  };
  const onContext = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
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
          pieces.setArmies(p.id, armies[p.id], 'drop');
          if (anim.instant) {
            refreshBadge(p.id, false);
            playPlace(p.id, p.vol * 0.8);
          }
        } else {
          pieces.setArmies(p.id, armies[p.id], 'lift');
          overlay.pop(p.id);
          sfx('unplace', { volume: p.vol, pan: panOf(p.id) });
        }
      };
      if (i === 0 || anim.instant) go();
      else void anim.wait(stagger * i, null, true).then(go);
    });
  };
  pieces.onContact = (id) => {
    overlay.pop(id);
    const pv = new THREE.Vector3();
    pieces.dustPoint(id, pv);
    if (!reduced) particles.burst(pv, 5);
    playPlace(id, isHuman(owners[id]) ? 1 : 0.6);
  };

  // --- flips (deal / claim) -------------------------------------------------------------
  const flip = (id: TerritoryId, owner: PlayerId, delay: number, run: Run | null, vol: number): Promise<void> => {
    const t = tiles.get(id);
    const to = tileRgb(lastState, owner);
    const swap = () => {
      owners[id] = owner;
      setOwnerLook(id, owner);
      if (armies[id] < 1) armies[id] = 1;
      pieces.setArmies(id, armies[id], 'snap');
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
      pieces.setArmies(e.from, fromN, 'topple');
      refreshBadge(e.from, true);
      if (chips) overlay.lossChip(e.from, e.attackerLosses, -1);
      const t = tiles.get(e.from);
      hitFlash(t);
    }
    if (e.defenderLosses > 0) {
      pieces.setArmies(e.to, toN, 'topple');
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
        if (arrowSource === 'event') {
          arrow.hide();
          arrowSource = null;
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
          tray.linger(2500, performance.now());
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
        pieces.setArmies(to, 0, 'snap');
        pieces.setColor(to, tileRgb(lastState, e.player));
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
        // the color change keeps running while the pieces move.
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
        pieces.setArmies(from, fromN, 'lift', run);
        refreshBadge(from, true);
        sfx('march', { volume: vol, duration: anim.scale(ms) / 1000, pan: panOf(from) });
        if (!owners[to] || owners[to] !== e.player) {
          owners[to] = e.player;
          setOwnerLook(to, e.player);
        }
        await pieces.march(from, to, count, color, ms, run, via, e.reason === 'fortify' ? 0.6 : 1.1);
        if (gen === syncGen) {
          armies[to] = toN;
          pieces.setArmies(to, toN, 'snap');
          refreshBadge(to, true);
          const pv = new THREE.Vector3();
          pieces.dustPoint(to, pv);
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
        tray.hide(200);
        await wave(null, p ? hexToRgb(p.light) : IVORY_RGB, 2400, 0.45, run);
        if (!reduced) rig.setAttract(true);
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
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
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
        pieces.setArmies(id, ts.armies, 'snap');
        changed = true;
      }
      refreshBadge(id, false);
    }
    if (changed) {
      syncGen++;
      needShadow = true;
    }
    continents.refresh(owners, s, true);
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

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    clientOrigin();
    if (w === W && h === H) return;
    W = w;
    H = h;
    renderer.setSize(W, H, false);
    rig.setSize(W, H);
    overlay.width = W;
    overlay.height = H;
    tiles.setResolution(W, H);
    for (const m of lanes.mats) m.resolution.set(W, H);
    for (const m of route.mats) m.resolution.set(W, H);
    particles.setViewportHeight(H * renderer.getPixelRatio(), camera.fov);
    layoutTray();
  };
  const layoutTray = () => {
    let bandTop = H - insets.bottom;
    let bandH = insets.trayBand;
    if (!(bandH > 0)) {
      bandH = 150;
      bandTop = H - insets.bottom - bandH - 8;
    }
    tray.layout(W, H, bandTop, bandH, uiScale);
  };
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const rawDt = now - lastT;
    lastT = now;
    if (rawDt > 0 && rawDt < 1000) {
      frameTimes.push(rawDt);
      if (frameTimes.length > 240) frameTimes.shift();
      fpsAcc += rawDt;
      fpsN++;
      if (fpsAcc >= 500) {
        fps = (fpsN * 1000) / fpsAcc;
        fpsAcc = 0;
        fpsN = 0;
      }
    }
    flushPlacements();
    anim.tick(rawDt);
    rig.update(rawDt);
    // camera waiters
    for (let i = camWaiters.length - 1; i >= 0; i--) {
      const w = camWaiters[i];
      if (rig.autoProgress >= 0.8 || (w.run && w.run.skipped)) {
        camWaiters.splice(i, 1);
        w.resolve();
      }
    }
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
    if (moved) pieces.markDirty();
    const piecesMoving = pieces.animating;
    pieces.update();
    particles.update(Math.min(rawDt, 50) / 1000);
    tray.tick(now);
    parts.oceanUniforms.uTime.value = now / 1000;
    overlay.zoomScale = clamp(Math.pow(rig.zoom, 0.3), 0.85, 1.3);
    overlay.update(camera, rect0);

    renderer.info.reset();
    renderer.clear();
    if (moved || piecesMoving || anim.active > 0 || needShadow) {
      renderer.shadowMap.needsUpdate = true;
      needShadow = false;
    }
    renderer.render(scene, camera);
    if (tray.visible) {
      renderer.clearDepth();
      renderer.shadowMap.needsUpdate = true;
      renderer.render(tray.scene, tray.camera);
    }
  };
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
    pieces.markDirty();
    // The warm-up frame baked the arrow/route into the shadow map: re-render it clean.
    needShadow = true;
  }
  lastT = performance.now();
  raf = requestAnimationFrame(frame);
  // The DOM overlay (badges, names) fades in with the canvas, so names never float over a black board.
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
    setHighlights(h: BoardHighlights) {
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
      if (rig.attract) rig.setAttract(false, false);
      if (reduced) cutTo({ ...rig.home });
      else void rig.goHome();
    },
    setAttractMode(on: boolean) {
      if (on && reduced) return;
      rig.setAttract(on);
    },
    setShowLabels(on: boolean) {
      overlay.setShowLabels(on);
    },
    setViewportInsets(i: ViewportInsets) {
      insets = { ...i };
      rig.setInsets(insets);
      layoutTray();
    },
    setUiScale(scale: number) {
      uiScale = clamp(scale || 1, 0.75, 2);
      overlay.uiScale = uiScale;
      layoutTray();
    },
    setReducedMotion(on: boolean) {
      reduced = on;
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
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      anim.dispose();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      container.removeEventListener('contextmenu', onContext);
      for (const w of camWaiters.splice(0)) w.resolve();
      tiles.dispose();
      pieces.dispose();
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

  // Debug hook for the sandbox / e2e (cheap).
  (view as unknown as { __debug: unknown }).__debug = {
    rig,
    anim,
    tray,
    owners,
    armies,
    tiles,
    renderer,
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
