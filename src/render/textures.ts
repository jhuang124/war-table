// Procedural canvas textures: felt, paint grain, the ocean chart, dice faces, the tray's ink ring, text.
// (The pigment maps in public/tex are served by texmaps.ts.)
import * as THREE from 'three';
import type { BoardGeometry, Vec2 } from '../map/types';
import { brushRing } from '../shared/enso';

export const FONT_SERIF_CAPS = "'Cormorant Garamond Variable', 'Cormorant Garamond', Georgia, serif";
export const FONT_SANS = FONT_SERIF_CAPS; // one family (INK B3): Cinzel and Inter are gone

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, seed: number, wrapX = 0, wrapY = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (v: number, m: number) => (m ? ((v % m) + m) % m : v);
  const a = hash(w(xi, wrapX), w(yi, wrapY), seed);
  const b = hash(w(xi + 1, wrapX), w(yi, wrapY), seed);
  const c = hash(w(xi, wrapX), w(yi + 1, wrapY), seed);
  const d = hash(w(xi + 1, wrapX), w(yi + 1, wrapY), seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number, oct = 4, wrapX = 0, wrapY = 0): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f, seed + i * 17, wrapX ? wrapX * f : 0, wrapY ? wrapY * f : 0);
    amp *= 0.5;
    f *= 2;
  }
  return s / (1 - Math.pow(0.5, oct));
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Felt / grain
// ---------------------------------------------------------------------------

/** Near-white matte paint grain for tile tops (multiplied by the owner color). */
export function paintGrainTexture(size = 512): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 64, y / 64, 21, 4, size / 64, size / 64);
      const f = hash(x, y, 2);
      const brush = vnoise(x / 3, y / 90, 4, size / 3, size / 90);
      const v = 0.9 + (n - 0.5) * 0.1 + (f - 0.5) * 0.045 + (brush - 0.5) * 0.04;
      const o = (y * size + x) * 4;
      const g = Math.round(Math.min(1, v) * 255);
      d[o] = g;
      d[o + 1] = g;
      d[o + 2] = g - 3;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, true, true);
}

// ---------------------------------------------------------------------------
// Ocean chart
// ---------------------------------------------------------------------------

function tracePolys(ctx: CanvasRenderingContext2D, polys: Vec2[][], s: number, h: number): void {
  ctx.beginPath();
  for (const ring of polys) {
    ring.forEach(([x, y], i) => {
      const px = x * s;
      const py = (h - y) * s;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }
}

export function allLandRings(g: BoardGeometry): Vec2[][] {
  const rings: Vec2[][] = [];
  for (const t of Object.values(g.territories)) for (const p of t.polygons) rings.push(p.outer);
  for (const p of g.decorativeLand) rings.push(p.outer);
  return rings;
}

/** The engraved sea chart under the tiles. Width in px; height follows the board aspect. */
export function oceanChartTexture(g: BoardGeometry, W = 4096): THREE.CanvasTexture {
  const s = W / g.width;
  const H = Math.round(g.height * s);
  const [c, ctx] = canvas(W, H);
  const land = allLandRings(g);

  // Base: deep ink-teal, a little lighter toward the middle.
  const grad = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.1, W * 0.5, H * 0.5, W * 0.62);
  grad.addColorStop(0, '#15454b');
  grad.addColorStop(0.55, '#10373d');
  grad.addColorStop(1, '#0a262c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Mottled paper-like variation (low contrast).
  {
    const [nc, nctx] = canvas(256, 128);
    const img = nctx.createImageData(256, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 256; x++) {
        const n = fbm(x / 22, y / 22, 31, 4);
        const o = (y * 256 + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = n * 255;
        img.data[o + 3] = 255;
      }
    nctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.globalCompositeOperation = 'overlay';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(nc, 0, 0, W, H);
    ctx.restore();
  }

  // Graticule: engraved (dark line + faint light line beside it).
  ctx.save();
  const step = g.width / 18;
  for (let i = 1; i < 18; i++) {
    const x = Math.round(i * step * s) + 0.5;
    ctx.strokeStyle = 'rgba(0,10,12,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(190,225,215,0.07)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, 0);
    ctx.lineTo(x + 2, H);
    ctx.stroke();
  }
  for (let j = 1; j < 9; j++) {
    const y = Math.round((j * g.height * s) / 9) + 0.5;
    ctx.strokeStyle = 'rgba(0,10,12,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(190,225,215,0.07)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y + 2);
    ctx.lineTo(W, y + 2);
    ctx.stroke();
  }
  ctx.restore();

  // Shallow shelf glow around every coast.
  ctx.save();
  ctx.shadowColor = 'rgba(70,140,140,0.55)';
  ctx.shadowBlur = 1.4 * s;
  ctx.fillStyle = 'rgba(40,100,104,0.55)';
  tracePolys(ctx, land, s, g.height);
  ctx.fill('nonzero');
  ctx.restore();

  // Engraved water lines hugging the coasts (vintage chart ripples).
  const rings = [0.42, 0.78, 1.2];
  const [lc, lctx] = canvas(W, H);
  rings.forEach((r, i) => {
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, W, H);
    lctx.lineJoin = 'round';
    lctx.strokeStyle = '#000';
    tracePolys(lctx, land, s, g.height);
    lctx.lineWidth = 2 * r * s;
    lctx.stroke();
    lctx.globalCompositeOperation = 'destination-out';
    lctx.lineWidth = 2 * r * s - 3.2;
    lctx.stroke();
    lctx.fill('nonzero');
    lctx.globalCompositeOperation = 'source-in';
    lctx.fillStyle = `rgba(200,232,222,${0.2 - i * 0.05})`;
    lctx.fillRect(0, 0, W, H);
    ctx.drawImage(lc, 0, 0);
  });

  // Compass rose in the south Pacific.
  drawCompass(ctx, 8.6 * s, (g.height - 8.4) * s, 3.6 * s);

  // No ocean names (g.oceanLabels stays in the map data): the board carries only what play needs.

  // Vignette toward the frame.
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.6);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,6,8,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const t = tex(c, true, false);
  t.anisotropy = 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const ink = 'rgba(214,230,216,0.34)';
  const inkSoft = 'rgba(214,230,216,0.16)';
  const dark = 'rgba(0,12,14,0.35)';
  ctx.lineWidth = r * 0.012;
  ctx.strokeStyle = ink;
  for (const k of [1, 0.93, 0.62]) {
    ctx.beginPath();
    ctx.arc(0, 0, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Tick ring
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const r0 = r * (i % 4 === 0 ? 0.86 : 0.9);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93);
    ctx.stroke();
  }
  const point = (a: number, len: number, w: number, lightSide: boolean) => {
    const tipX = Math.cos(a) * len;
    const tipY = Math.sin(a) * len;
    const lx = Math.cos(a + Math.PI / 2) * w;
    const ly = Math.sin(a + Math.PI / 2) * w;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(lx, ly);
    ctx.closePath();
    ctx.fillStyle = lightSide ? ink : dark;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(-lx, -ly);
    ctx.closePath();
    ctx.fillStyle = lightSide ? dark : inkSoft;
    ctx.fill();
  };
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4 + Math.PI / 8;
    point(a, r * 0.5, r * 0.06, i % 2 === 0);
  }
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 2 + Math.PI / 4;
    point(a, r * 0.62, r * 0.08, true);
  }
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 2;
    point(a, r * 0.98, r * 0.11, true);
  }
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 ${r * 0.26}px ${FONT_SERIF_CAPS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('N', 0, -r * 1.06);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Continent halo (white alpha; tinted by the material)
// ---------------------------------------------------------------------------

export interface HaloTex {
  texture: THREE.CanvasTexture;
  /** Board-space rectangle the texture covers. */
  minX: number;
  minY: number;
  w: number;
  h: number;
}

export function haloTexture(rings: Vec2[][], pad = 2.2, ppu = 12): HaloTex {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const w = maxX - minX;
  const h = maxY - minY;
  const W = Math.ceil(w * ppu);
  const H = Math.ceil(h * ppu);
  const [c, ctx] = canvas(W, H);
  const path = () => {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach(([x, y], i) => {
        const px = (x - minX) * ppu;
        const py = (maxY - y) * ppu;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
  };
  ctx.lineJoin = 'round';
  // Soft glow
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 0.9 * ppu;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 0.5 * ppu;
  path();
  ctx.stroke();
  ctx.restore();
  // Crisp contour band hugging the coast (outer half shows beyond the tiles).
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 0.44 * ppu;
  path();
  ctx.stroke();
  const t = tex(c, true, false);
  return { texture: t, minX, minY, w, h };
}

// ---------------------------------------------------------------------------
// Text planes
// ---------------------------------------------------------------------------

export interface TextPart {
  text: string;
  font: string;
  /** letter spacing in em */
  tracking?: number;
}

/** White text with an engraved under-shadow, on transparent. Returns the texture and its aspect. */
export function textTexture(parts: TextPart[], pxHeight = 128): { texture: THREE.CanvasTexture; aspect: number } {
  const [m, mctx] = canvas(8, 8);
  void m;
  const pad = pxHeight * 0.16;
  let width = 0;
  const widths: number[] = [];
  for (const p of parts) {
    mctx.font = p.font.replace('{px}', String(pxHeight));
    const chars = p.text.split('');
    const track = (p.tracking ?? 0) * pxHeight;
    let w = 0;
    for (const ch of chars) w += mctx.measureText(ch).width + track;
    widths.push(w);
    width += w;
  }
  const W = Math.ceil(width + pad * 2);
  const H = Math.ceil(pxHeight * 1.3);
  const [c, ctx] = canvas(W, H);
  ctx.textBaseline = 'middle';
  const draw = (dy: number, style: string) => {
    let x = pad;
    parts.forEach((p) => {
      ctx.font = p.font.replace('{px}', String(pxHeight));
      const track = (p.tracking ?? 0) * pxHeight;
      ctx.fillStyle = style;
      for (const ch of p.text.split('')) {
        ctx.fillText(ch, x, H / 2 + dy);
        x += ctx.measureText(ch).width + track;
      }
    });
  };
  draw(pxHeight * 0.045, 'rgba(0,0,0,0.75)');
  draw(0, '#ffffff');
  const t = tex(c, true, false);
  return { texture: t, aspect: W / H };
}

// ---------------------------------------------------------------------------
// Dice faces
// ---------------------------------------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.28, 0.24],
    [0.72, 0.24],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.76],
    [0.72, 0.76],
  ],
};

// ---------------------------------------------------------------------------
// Ink (docs/INK.md B §3–4, INK2 §2.3: pigment dice, the verdict's ink splash, the tray's ink ring)
// ---------------------------------------------------------------------------

/**
 * A die face in pigment: the seat's wash colour, matte, with a faint paper grain and ivory pips laid
 * like ink dots (each a touch irregular, a little heavier at its centre).
 */
export function inkDiceFaceTexture(value: number, base: string, ink: string, size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  // Matte, bone-like pigment: the seat's wash settled a little toward the paper's deep indigo, with a
  // soft mottle and a fine tooth (no sheen); it sits inside the board's palette rather than above it.
  const deep = [11, 18, 36];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 18, y / 18, 71 + value, 3) - 0.5;
      const g = hash(x, y, 5) - 0.5;
      const k = 1 + n * 0.14 + g * 0.08;
      const o = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) d[o + ch] = Math.min(255, (d[o + ch] * 0.9 + deep[ch] * 0.1) * k);
    }
  ctx.putImageData(img, 0, 0);
  // the rounded edge reads a little deeper
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.34, size / 2, size / 2, size * 0.74);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const r = size * (value === 1 ? 0.12 : 0.088);
  for (const [px, py] of PIPS[value]) {
    const x = px * size;
    const y = py * size;
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 + (hash(i, Math.round(x * 7 + y), value) - 0.5) * 0.14);
      const X = x + Math.cos(a) * rr;
      const Y = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    }
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
  }
  const t = tex(c, true, false);
  t.anisotropy = 4;
  return t;
}

/** An ink splash decal (dark, transparent): a spattered blot with a few flung drops. */
export function inkSplashTexture(size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  // flung drops, thrown one way (the blow's), smaller the farther they fly
  const drops: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const a = -0.6 + (hash(i, 1, 9) - 0.5) * 3.4;
    const r = 0.14 + Math.pow(hash(i, 2, 9), 0.8) * 0.3;
    drops.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.012 + (1 - r / 0.44) * 0.03 * hash(i, 3, 9) + 0.006]);
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5;
      const v = y / size - 0.5;
      const ang = Math.atan2(v, u);
      const rr = Math.hypot(u, v);
      const edge = 0.12 + 0.06 * (fbm(Math.cos(ang) * 2.4 + 3, Math.sin(ang) * 2.4 + 3, 12, 3) - 0.5) * 2.6;
      let a = (1 - smooth(edge - 0.025, edge + 0.008, rr)) * 0.9;
      for (const [dx, dy, dr] of drops) a = Math.max(a, 1 - smooth(dr * 0.6, dr, Math.hypot(x / size - dx, y / size - dy)));
      a *= 0.7 + 0.3 * fbm(x / 8, y / 8, 4, 2);
      const o = (y * size + x) * 4;
      d[o] = 10;
      d[o + 1] = 12;
      d[o + 2] = 20;
      d[o + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    }
  ctx.putImageData(img, 0, 0);
  return tex(c, true, false);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The dice tray's ink ring (docs/INK2.md §2.3): one closed brushed ellipse (`brushRing` from
 * src/shared/enso.ts) rasterised once per size into an alpha canvas (white ink, coverage in alpha).
 * `aspect` is the ring's viewBox width / height (the viewBox is 100 × aspect by 100); `w` × `h` is the
 * canvas in device px. Cached by size and seed, like the count rings.
 */
const ringCache = new Map<string, THREE.CanvasTexture>();
export function inkRingTexture(seed: number, aspect: number, w: number, h: number, weight: number, bristles = 4): THREE.CanvasTexture {
  const key = `${seed}|${aspect.toFixed(3)}|${w}x${h}|${weight.toFixed(3)}|${bristles}`;
  const hit = ringCache.get(key);
  if (hit) return hit;
  const shape = brushRing(seed, aspect, { weight, bristles, startAt: 270, samples: 200 });
  const [c, ctx] = canvas(w, h);
  ctx.scale(w / (100 * aspect), h / 100);
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(shape.d), 'nonzero');
  const t = tex(c, false, false);
  t.premultiplyAlpha = false;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  // A handful of sizes over a session at most (a resize, a rotation): keep the cache small.
  if (ringCache.size > 6) {
    const first = ringCache.keys().next().value as string;
    ringCache.get(first)?.dispose();
    ringCache.delete(first);
  }
  ringCache.set(key, t);
  return t;
}
