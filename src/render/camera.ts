// Damped orbit/pan/zoom-to-cursor camera with clamps, a home view fitted to the HUD-free region
// (principal point shifted to that region's center), and rate-limited automatic moves.
import * as THREE from 'three';
import type { ViewportInsets } from './BoardView';
import { clamp, ease, lerp } from './anim';
import { FRAME_W } from './scene';

const DEG = Math.PI / 180;
/** Home pitch: steep enough that the land fills the screen, shallow enough that the tokens read as objects. */
export const HOME_PITCH = 64;
const BASE_FOV = 36;

interface Pose {
  tx: number;
  tz: number;
  dist: number;
  pitch: number; // deg
  az: number; // deg
}

interface AutoMove {
  from: Pose;
  to: Pose;
  t: number;
  dur: number;
  resolve: () => void;
}

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  cur: Pose = { tx: 0, tz: 0, dist: 80, pitch: HOME_PITCH, az: 0 };
  goal: Pose = { tx: 0, tz: 0, dist: 80, pitch: HOME_PITCH, az: 0 };
  home: Pose = { tx: 0, tz: 0, dist: 80, pitch: HOME_PITCH, az: 0 };
  private auto: AutoMove | null = null;
  attract = false;
  private attractT = 0;
  private attractBlend = 0;
  insets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0, trayBand: 0 };
  W = 1;
  H = 1;
  boardW: number;
  boardH: number;
  /** Degrees per second of the fastest automatic rotation so far (metrics). */
  maxAutoDegPerSec = 0;
  onWhoosh: ((ms: number) => void) | null = null;
  private tmp = new THREE.Vector3();

  constructor(boardW: number, boardH: number) {
    this.boardW = boardW;
    this.boardH = boardH;
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 1, 600);
  }

  get moving(): boolean {
    if (this.auto || this.attract) return true;
    const c = this.cur;
    const g = this.goal;
    return (
      Math.abs(c.tx - g.tx) > 0.01 ||
      Math.abs(c.tz - g.tz) > 0.01 ||
      Math.abs(c.dist - g.dist) > 0.01 ||
      Math.abs(c.pitch - g.pitch) > 0.02 ||
      Math.abs(c.az - g.az) > 0.02
    );
  }

  /** Progress of the running automatic move (1 when none). */
  get autoProgress(): number {
    return this.auto ? this.auto.t / this.auto.dur : 1;
  }

  get zoom(): number {
    return this.home.dist / this.cur.dist;
  }

  setSize(W: number, H: number): void {
    this.W = W;
    this.H = H;
    this.applyProjection();
    this.recomputeHome();
  }

  setInsets(i: ViewportInsets): void {
    this.insets = { ...i };
    this.applyProjection();
    this.recomputeHome();
  }

  /** Free region (HUD-free) in canvas px. */
  region(): { x0: number; y0: number; x1: number; y1: number } {
    const i = this.insets;
    let x0 = clamp(i.left, 0, this.W * 0.45);
    let x1 = clamp(this.W - i.right, this.W * 0.55, this.W);
    let y0 = clamp(i.top, 0, this.H * 0.45);
    let y1 = clamp(this.H - i.bottom, this.H * 0.5, this.H);
    if (x1 - x0 < 100) {
      x0 = 0;
      x1 = this.W;
    }
    if (y1 - y0 < 100) {
      y0 = 0;
      y1 = this.H;
    }
    return { x0, y0, x1, y1 };
  }

  private applyProjection(): void {
    const { x0, y0, x1, y1 } = this.region();
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const dx = cx - this.W / 2;
    const dy = cy - this.H / 2;
    const fullW = this.W + 2 * Math.abs(dx);
    const fullH = this.H + 2 * Math.abs(dy);
    const cam = this.camera;
    cam.aspect = fullW / fullH;
    cam.fov = (2 * Math.atan(Math.tan((BASE_FOV * DEG) / 2) * (fullH / this.H))) / DEG;
    cam.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, this.W, this.H);
    cam.updateProjectionMatrix();
  }

  private place(p: Pose, cam = this.camera): void {
    const pr = p.pitch * DEG;
    const az = p.az * DEG;
    const cp = Math.cos(pr);
    cam.position.set(p.tx + p.dist * Math.sin(az) * cp, p.dist * Math.sin(pr), p.tz + p.dist * Math.cos(az) * cp);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.tx, 0, p.tz);
    cam.updateMatrixWorld(true);
  }

  /**
   * Home view: the biggest board the HUD allows at HOME_PITCH, azimuth 0 (docs/SIMPLIFY.md §1, §4).
   * - The land (every territory) fills the HUD-free region between the top and bottom strips, with a
   *   small margin; it is width-bound at 16:10 and 16:9, so it spans nearly the full window width. The
   *   frame and the outer ocean may run off the canvas edges.
   * - The dice tray only shows during fights and is not reserved: the land is centred, and lifted only
   *   if a token (with its name and the tray's header line) would sit under the tray's footprint, as
   *   far as the free region's slack allows. Coastline and ocean may run under the tray.
   */
  recomputeHome(): void {
    const wasHome = this.isHome(0.02);
    this.home = this.solveHome();
    if (wasHome || !this.initialized) {
      this.cur = { ...this.home };
      this.goal = { ...this.home };
      this.initialized = true;
    }
  }

  /** Convex hull of every territory outline, board coords (set once by the view). */
  landHull: [number, number][] | null = null;
  /** Token anchors, board coords, for the tray check. */
  keepPoints: [number, number][] | null = null;
  /** The dice tray's nominal footprint in canvas px: x span, and the top edge tokens should stay above. */
  trayKeepOut: { x0: number; x1: number; y0: number } | null = null;

  private toWorldPts(ring: [number, number][]): number[][] {
    // board coords (origin bottom-left, +y north) → world (x east, z south), at the tile tops
    return ring.map(([bx, by]) => [bx - this.boardW / 2, 0.55, this.boardH / 2 - by]);
  }

  private project(pts: number[][], cam: THREE.PerspectiveCamera): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of pts) {
      this.tmp.set(c[0], c[1], c[2]).project(cam);
      const px = (this.tmp.x * 0.5 + 0.5) * this.W;
      const py = (-this.tmp.y * 0.5 + 0.5) * this.H;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    return { x0, y0, x1, y1 };
  }

  /** Lowest screen y of the points inside the x span [x0, x1] (−Infinity if none). */
  private lowestIn(pts: number[][], cam: THREE.PerspectiveCamera, x0: number, x1: number): number {
    let y = -Infinity;
    for (const c of pts) {
      this.tmp.set(c[0], c[1], c[2]).project(cam);
      const px = (this.tmp.x * 0.5 + 0.5) * this.W;
      if (px < x0 || px > x1) continue;
      y = Math.max(y, (-this.tmp.y * 0.5 + 0.5) * this.H);
    }
    return y;
  }

  private solveHome(): Pose {
    const r = this.region();
    const mx = Math.max(10, (r.x1 - r.x0) * 0.016);
    const my = Math.max(8, (r.y1 - r.y0) * 0.016);
    // land limits: the HUD-free region with a small margin
    const L = { x0: r.x0 + mx, x1: r.x1 - mx, y0: r.y0 + my, y1: r.y1 - my };
    const hull = this.toWorldPts(
      this.landHull ?? [
        [0, 0],
        [this.boardW, 0],
        [this.boardW, this.boardH],
        [0, this.boardH],
      ],
    );
    const cam = this.camera.clone();
    const pose: Pose = { tx: 0, tz: 0, dist: 90, pitch: HOME_PITCH, az: 0 };
    const pr = HOME_PITCH * DEG;
    const upp = (dist: number) => (2 * dist * Math.tan((BASE_FOV * DEG) / 2)) / this.H / Math.sin(pr);
    // Place the pose at `dist` with the land centred vertically in its limits; false if it can't fit.
    const fitAt = (dist: number): boolean => {
      pose.dist = dist;
      pose.tz = 0;
      const unitsPerPx = upp(dist);
      for (let it = 0; it < 8; it++) {
        this.place(pose, cam);
        const l = this.project(hull, cam);
        const off = (l.y0 + l.y1) / 2 - (L.y0 + L.y1) / 2;
        if (Math.abs(off) < 0.2) break;
        pose.tz += off * unitsPerPx;
      }
      this.place(pose, cam);
      const l = this.project(hull, cam);
      return l.x0 >= L.x0 - 0.5 && l.x1 <= L.x1 + 0.5 && l.y1 - l.y0 <= L.y1 - L.y0 + 0.5;
    };
    // Largest board that fits: bisect the distance (feasibility is monotone in it).
    let lo = 20;
    let hi = 400;
    for (let it = 0; it < 40 && !fitAt(hi); it++) hi *= 1.5;
    for (let it = 0; it < 32; it++) {
      const mid = (lo + hi) / 2;
      if (fitAt(mid)) hi = mid;
      else lo = mid;
    }
    fitAt(hi);
    // Lift the land clear of the dice tray's footprint, within the slack above it.
    const k = this.trayKeepOut;
    if (k && this.keepPoints) {
      const pts = this.toWorldPts(this.keepPoints);
      const unitsPerPx = upp(pose.dist);
      for (let it = 0; it < 6; it++) {
        this.place(pose, cam);
        const intrude = this.lowestIn(pts, cam, k.x0, k.x1) - k.y0;
        const room = this.project(hull, cam).y0 - L.y0;
        const shift = Math.min(intrude, room);
        if (!(shift > 0.3)) break;
        pose.tz += shift * unitsPerPx;
      }
    }
    return { ...pose };
  }
  private initialized = false;

  /** A camera parked at the home pose (for layout that is decided at the home view). */
  homeCamera(): THREE.PerspectiveCamera {
    const cam = this.camera.clone();
    this.place(this.home, cam);
    return cam;
  }

  isHome(tol = 0.1): boolean {
    const c = this.goal;
    const h = this.home;
    return (
      Math.abs(c.dist / h.dist - 1) <= tol &&
      Math.hypot(c.tx - h.tx, c.tz - h.tz) <= tol * this.boardH &&
      Math.abs(c.pitch - h.pitch) <= 5 &&
      Math.abs(c.az - h.az) <= 5
    );
  }

  // --- user input ---------------------------------------------------------

  orbit(dxPx: number, dyPx: number): void {
    this.cancelAuto();
    this.goal.az = clamp(this.goal.az - dxPx * 0.2, -25, 25);
    this.goal.pitch = clamp(this.goal.pitch + dyPx * 0.18, 35, 80);
  }

  /** Ground point under a canvas pixel at the given pose (or current camera). */
  groundAt(px: number, py: number, out: THREE.Vector3, cam = this.camera): boolean {
    const ndc = new THREE.Vector2((px / this.W) * 2 - 1, -(py / this.H) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cam);
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    if (!(t > 0)) return false;
    out.copy(ray.ray.origin).addScaledVector(ray.ray.direction, t);
    return true;
  }

  pan(fromPx: [number, number], toPx: [number, number]): void {
    this.cancelAuto();
    const cam = this.camera.clone();
    this.place(this.goal, cam);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    if (!this.groundAt(fromPx[0], fromPx[1], a, cam) || !this.groundAt(toPx[0], toPx[1], b, cam)) return;
    this.goal.tx -= b.x - a.x;
    this.goal.tz -= b.z - a.z;
    this.clampPan(this.goal);
  }

  zoomAt(px: number, py: number, deltaY: number): void {
    this.cancelAuto();
    const f = Math.exp(-deltaY * 0.0016);
    const minD = this.home.dist / 3.5;
    const maxD = this.home.dist / 0.9;
    const nd = clamp(this.goal.dist / f, minD, maxD);
    const cam = this.camera.clone();
    this.place(this.goal, cam);
    const p = new THREE.Vector3();
    if (this.groundAt(px, py, p, cam)) {
      const k = nd / this.goal.dist;
      this.goal.tx = p.x + (this.goal.tx - p.x) * k;
      this.goal.tz = p.z + (this.goal.tz - p.z) * k;
    }
    this.goal.dist = nd;
    this.clampPan(this.goal);
  }

  private clampPan(p: Pose): void {
    // keep the look-at point on the board, so the board never leaves the screen
    p.tx = clamp(p.tx, -this.boardW / 2, this.boardW / 2);
    p.tz = clamp(p.tz, -this.boardH / 2, this.boardH / 2 + 4);
  }

  // --- automatic moves ------------------------------------------------------

  private cancelAuto(): void {
    if (this.auto) {
      this.goal = { ...this.cur };
      const r = this.auto.resolve;
      this.auto = null;
      r();
    }
    if (this.attract) this.setAttract(false, false);
  }

  /** Ease to a pose with the SPEC limits. Resolves on arrival. */
  moveTo(to: Pose, durationMs?: number): Promise<void> {
    // An explicit move wins over the idle orbit: update() never advances a move while the orbit runs,
    // so anything awaiting this one (the board's camera waits) would otherwise hang.
    if (this.attract) {
      this.attract = false;
      this.goal = { ...this.cur };
    }
    if (this.auto) {
      const r = this.auto.resolve;
      this.auto = null;
      r();
    }
    const from = { ...this.cur };
    const dist = Math.hypot(to.tx - from.tx, to.tz - from.tz) + Math.abs(to.dist - from.dist) * 0.5;
    let dur = durationMs ?? clamp(500 + 400 * (dist / this.boardW), 500, 900);
    const rot = Math.max(Math.abs(to.az - from.az), Math.abs(to.pitch - from.pitch));
    // easeInOutCubic peaks at 1.5× the average rate: size the move so the PEAK stays ≤ 45°/s.
    dur = Math.max(dur, (rot / 45) * 1000 * 1.5);
    if (dist < 0.05 && rot < 0.05) {
      this.goal = { ...to };
      this.cur = { ...to };
      return Promise.resolve();
    }
    this.maxAutoDegPerSec = Math.max(this.maxAutoDegPerSec, (rot / dur) * 1000 * 1.5);
    if (dist > 0.3 * this.boardW) this.onWhoosh?.(dur);
    return new Promise((resolve) => {
      this.auto = { from, to: { ...to }, t: 0, dur, resolve };
    });
  }

  goHome(durationMs?: number): Promise<void> {
    return this.moveTo({ ...this.home }, durationMs);
  }

  /** Pose that frames world-space points (keeps pitch within 8° of now, azimuth as is). */
  framePose(points: THREE.Vector3[], minZoom = 1, maxZoom = 2.4): Pose {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 4;
    const w = maxX - minX + pad * 2;
    const h = maxZ - minZ + pad * 2;
    const scale = Math.max(w / (this.boardW + 2 * FRAME_W), h / (this.boardH + 2 * FRAME_W));
    const zoom = clamp(1 / Math.max(scale, 1e-3), Math.min(minZoom, maxZoom), maxZoom);
    const pitch = clamp(this.cur.pitch, this.cur.pitch - 8, this.cur.pitch + 8);
    const pose: Pose = {
      tx: (minX + maxX) / 2,
      tz: (minZ + maxZ) / 2 + (this.home.tz * 1) / zoom,
      dist: this.home.dist / zoom,
      pitch,
      az: this.cur.az,
    };
    this.clampPan(pose);
    return pose;
  }

  /** Cut (no motion) to a pose. */
  jump(p: Pose): void {
    this.cancelAuto();
    this.cur = { ...p };
    this.goal = { ...p };
  }

  setAttract(on: boolean, returnHome = true): void {
    if (this.attract === on) return;
    this.attract = on;
    if (on) {
      this.attractT = 0;
      this.attractBlend = 0;
    } else {
      // continue from wherever the orbit is
      this.goal = { ...this.cur };
      if (returnHome) void this.moveTo({ ...this.home }, 900);
    }
  }

  // --- per frame --------------------------------------------------------------

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50);
    if (this.attract) {
      this.attractT += dt / 1000;
      this.attractBlend = Math.min(1, this.attractBlend + dt / 1500);
      // Slow sway (peak 4°/s) with a gentle dolly; stays inside the table.
      // ±18° at a 28.5 s period: peak 3.97°/s (UX: attract orbit at 4°/s).
      const period = 28.5;
      const ang = Math.sin((this.attractT / period) * Math.PI * 2) * 18;
      const target: Pose = {
        tx: this.home.tx,
        tz: this.home.tz,
        dist: this.home.dist * (0.97 + 0.03 * Math.sin((this.attractT / 23) * Math.PI * 2)),
        pitch: 51 + 3 * Math.sin((this.attractT / 29) * Math.PI * 2),
        az: ang,
      };
      const k = 1 - Math.pow(1 - 0.03, dt / 16.67);
      const b = this.attractBlend;
      for (const key of ['tx', 'tz', 'dist', 'pitch', 'az'] as const) {
        this.cur[key] = lerp(this.cur[key], target[key], k * b + (1 - b) * k * 0.5);
      }
      this.goal = { ...this.cur };
    } else if (this.auto) {
      const a = this.auto;
      a.t = Math.min(a.dur, a.t + dt);
      const e = ease.inOutCubic(a.t / a.dur);
      for (const key of ['tx', 'tz', 'dist', 'pitch', 'az'] as const) this.cur[key] = lerp(a.from[key], a.to[key], e);
      this.goal = { ...this.cur };
      if (a.t >= a.dur) {
        this.auto = null;
        a.resolve();
      }
    } else {
      const k = 1 - Math.pow(1 - 0.12, dt / 16.67);
      for (const key of ['tx', 'tz', 'dist', 'pitch', 'az'] as const) {
        const d = this.goal[key] - this.cur[key];
        this.cur[key] = Math.abs(d) < 1e-4 ? this.goal[key] : this.cur[key] + d * k;
      }
    }
    this.place(this.cur);
  }

  /** Finish an automatic move immediately. */
  finishAuto(): void {
    if (this.auto) {
      this.cur = { ...this.auto.to };
      this.goal = { ...this.auto.to };
      const r = this.auto.resolve;
      this.auto = null;
      r();
    }
  }
}

export type { Pose };
