// Shared constants and helpers for the renderer.
import * as THREE from 'three';
import type { BoardGeometry, Vec2 } from '../map/types';
import { PLAYER_COLORS, UNCLAIMED_COLOR } from '../shared/palette';
import type { GameState, PlayerId } from '../engine/types';

export const TILE_DEPTH = 0.42;
export const BEVEL_T = 0.13;
export const BEVEL_S = 0.16;
/** Height of the un-lifted tile top (picking plane). */
export const TILE_TOP = TILE_DEPTH + BEVEL_T;
export const IVORY = '#f3ead8';
export const INK_DARK = '#12151a';

let BW = 100;
let BH = 49.5;
export function setBoardSize(g: BoardGeometry): void {
  BW = g.width;
  BH = g.height;
}
export const boardW = () => BW;
export const boardH = () => BH;

/** Board coords (origin bottom-left, +y north) → world (x east, y up, z south). */
export function toWorld(bx: number, by: number, y = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(bx - BW / 2, y, BH / 2 - by);
}
export function toBoard(x: number, z: number): Vec2 {
  return [x + BW / 2, BH / 2 - z];
}

// ---------------------------------------------------------------------------
// Color (all math in sRGB 0..1, converted on assignment)
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHsv([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb([h, s, v]: RGB): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Scale saturation / value in HSV. */
export function adjust(c: RGB, satMul: number, valMul: number, valAdd = 0): RGB {
  const hsv = rgbToHsv(c);
  hsv[1] = Math.min(1, hsv[1] * satMul);
  hsv[2] = Math.min(1, Math.max(0, hsv[2] * valMul + valAdd));
  return hsvToRgb(hsv);
}

export function setColor(c: THREE.Color, rgb: RGB): THREE.Color {
  return c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

export function rgbCss(c: RGB, a = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}

/** Tile top color for an owner: base, desaturated 14% (matte painted finish). */
export function tileRgb(state: GameState | null, owner: PlayerId): RGB {
  if (owner < 0 || !state || !state.players[owner]) return adjust(hexToRgb(UNCLAIMED_COLOR), 0.9, 0.92);
  const p = PLAYER_COLORS[state.players[owner].color];
  return adjust(hexToRgb(p.base), 0.86, 0.97);
}

export function paletteOf(state: GameState | null, owner: PlayerId) {
  if (owner < 0 || !state || !state.players[owner]) return null;
  return PLAYER_COLORS[state.players[owner].color];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function pointInRing(x: number, y: number, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToRing(x: number, y: number, ring: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0];
    const ay = ring[j][1];
    const bx = ring[i][0];
    const by = ring[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx - x;
    const py = ay + t * dy - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => disposeMaterial(x));
    else if (mat) disposeMaterial(mat);
  });
}

function disposeMaterial(m: THREE.Material): void {
  for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
  m.dispose();
}
