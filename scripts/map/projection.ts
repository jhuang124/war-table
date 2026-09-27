// Projection + smooth regional magnification ("lenses") for the board.
//
// Base: Miller cylindrical (k = 0.8), Pacific seam. Longitudes are unwrapped into
// [LON_LEFT, LON_LEFT + 360] and squeezed into [MARGIN_X, WIDTH - MARGIN_X] so that the
// Bering Strait land tips sit a little inside the left/right board edges (the
// Alaska–Kamchatka lane runs off one edge and back in on the other).
//
// Lenses: elliptical radial maps r -> f(r) that are monotone along every ray from the
// lens centre (f(0)=0, f' > 0, f(r)=r outside the lens). Each lens is therefore a
// bijection of the plane, so composing them can never create or destroy land contacts:
// topology is preserved, only sizes change.

export const WIDTH = 100;
export const LON_LEFT = -169.2;
export const MARGIN_X = 2.4;
export const LAT_BOTTOM = -56.2;
export const LAT_TOP = 83.8;
export const MARGIN_BOTTOM = 1.4;
export const MARGIN_TOP = 1.2;

const SX = (WIDTH - 2 * MARGIN_X) / 360; // board units per degree of longitude
const RAD_SCALE = (SX * 180) / Math.PI; // board units per radian

const millerY = (latDeg: number) => {
  const phi = (latDeg * Math.PI) / 180;
  return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi));
};
const millerLat = (y: number) => ((Math.atan(Math.exp(y / 1.25)) - Math.PI / 4) / 0.4) * (180 / Math.PI);

const Y0 = millerY(LAT_BOTTOM);

/** Unwrap a longitude into the board's window. */
export function unwrapLon(lon: number): number {
  let l = lon;
  while (l < LON_LEFT) l += 360;
  while (l >= LON_LEFT + 360) l -= 360;
  return l;
}

export function projectRaw(lon: number, lat: number): [number, number] {
  const x = MARGIN_X + (lon - LON_LEFT) * SX;
  const y = MARGIN_BOTTOM + (millerY(lat) - Y0) * RAD_SCALE;
  return [x, y];
}

export function unprojectRaw(x: number, y: number): [number, number] {
  const lon = (x - MARGIN_X) / SX + LON_LEFT;
  const lat = millerLat((y - MARGIN_BOTTOM) / RAD_SCALE + Y0);
  return [lon, lat];
}

export const RAW_HEIGHT = MARGIN_BOTTOM + (millerY(LAT_TOP) - Y0) * RAD_SCALE + MARGIN_TOP;

export interface LensSpec {
  name: string;
  /** Centre in lon/lat. */
  lon: number;
  lat: number;
  /** Core radius (board units, before the ellipse scaling) magnified uniformly by m. */
  r0: number;
  /** Outer radius where the map returns to identity. */
  R: number;
  m: number;
  /** Ellipse axis scale: distances are measured as hypot(dx/ax, dy/ay). */
  ax?: number;
  ay?: number;
}

export class Lens {
  spec: LensSpec;
  cx = 0;
  cy = 0;
  ax: number;
  ay: number;
  // Hermite coefficients for the transition zone.
  private h0 = 0;
  private h1 = 0;
  constructor(spec: LensSpec, center: [number, number]) {
    this.spec = spec;
    [this.cx, this.cy] = center;
    this.ax = spec.ax ?? 1;
    this.ay = spec.ay ?? 1;
    const { r0, R, m } = spec;
    if (!(m * r0 < R)) throw new Error(`lens ${spec.name}: m*r0 must be < R`);
    this.h0 = m * r0;
    this.h1 = R;
    // Monotonicity check of the transition.
    let prev = -Infinity;
    for (let i = 0; i <= 2000; i++) {
      const r = (R * 1.02 * i) / 2000;
      const v = this.f(r);
      if (!(v > prev)) throw new Error(`lens ${spec.name} is not monotone at r=${r}`);
      prev = v;
    }
  }
  /** Radial profile. */
  f(r: number): number {
    const { r0, R, m } = this.spec;
    if (r <= r0) return m * r;
    if (r >= R) return r;
    const L = R - r0;
    const t = (r - r0) / L;
    const t2 = t * t, t3 = t2 * t;
    const H00 = 2 * t3 - 3 * t2 + 1, H10 = t3 - 2 * t2 + t, H01 = -2 * t3 + 3 * t2, H11 = t3 - t2;
    return H00 * this.h0 + H10 * L * m + H01 * this.h1 + H11 * L * 1;
  }
  finv(q: number): number {
    const { r0, R, m } = this.spec;
    if (q <= m * r0) return q / m;
    if (q >= R) return q;
    let lo = r0, hi = R;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (this.f(mid) < q) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  apply(x: number, y: number): [number, number] {
    const dx = (x - this.cx) / this.ax, dy = (y - this.cy) / this.ay;
    const r = Math.hypot(dx, dy);
    if (r === 0 || r >= this.spec.R) return [x, y];
    const s = this.f(r) / r;
    return [this.cx + dx * s * this.ax, this.cy + dy * s * this.ay];
  }
  invert(x: number, y: number): [number, number] {
    const dx = (x - this.cx) / this.ax, dy = (y - this.cy) / this.ay;
    const q = Math.hypot(dx, dy);
    if (q === 0 || q >= this.spec.R) return [x, y];
    const s = this.finv(q) / q;
    return [this.cx + dx * s * this.ax, this.cy + dy * s * this.ay];
  }
}

export class BoardProjection {
  lenses: Lens[];
  height: number;
  /** Final affine: board = raw-lensed * 1 (kept for clarity; vertical scale may be tuned). */
  constructor(specs: LensSpec[]) {
    this.lenses = [];
    for (const s of specs) {
      // Lens centres are specified in lon/lat and placed after the previous lenses.
      let c = projectRaw(unwrapLon(s.lon), s.lat);
      for (const l of this.lenses) c = l.apply(c[0], c[1]);
      this.lenses.push(new Lens(s, c));
    }
    this.height = RAW_HEIGHT;
  }
  /** lon (already unwrapped) / lat → board. */
  forward(lon: number, lat: number): [number, number] {
    let p = projectRaw(lon, lat);
    for (const l of this.lenses) p = l.apply(p[0], p[1]);
    return p;
  }
  inverse(x: number, y: number): [number, number] {
    let p: [number, number] = [x, y];
    for (let i = this.lenses.length - 1; i >= 0; i--) p = this.lenses[i].invert(p[0], p[1]);
    return unprojectRaw(p[0], p[1]);
  }
}
