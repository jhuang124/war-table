// Pigment pack (docs/INK2.md §4.1–4.3, Phase 0). Run after the chosen source renders change:
//   npx tsx scripts/textures.ts            pack public/tex/* + src/render/texmaps.json, then verify
//   npx tsx scripts/textures.ts --check    verify the shipped files only (stats, seams, budget, sheets)
//
// Reads the picked imagegen renders in _claude/tex-src/ (kept out of public/ so the service worker never
// precaches them), turns each into greyscale, makes it seamless (offset by half, variance-preserving
// cross-blend over a 12 % margin; streaks along x only, tip not tiled), derives the channels in §4.1,
// equalises every data channel to mean 128 / std 40 (rank → Gaussian quantiles, so the shader's
// existing nz() coefficients and smoothstep thresholds mean what they did), and writes the 1024 (desktop)
// and 512 (phone) sets. Two things the codec forces (see BAND / maskA below): data in R/G/B is band-limited
// to half resolution so WebP's 4:2:0 chroma keeps the channels independent, and the lossless alpha plane
// carries a mask (paper flecks, wash tide lines) rather than an equalised noise field, to fit the budget.
// The wash's granulation and tide therefore sit in B and A (the spec had them in A and B). Verification decodes the shipped files the way WebGL will (no premultiply, no
// colour conversion) and measures per-channel mean/std, the wrap seam, the payload budget, and writes
// 2×2 contact sheets to artifacts/ink2/tex/.
//
// Uses the Playwright Chromium (already a dev dependency) to decode PNG and encode/decode WebP; the pixel
// maths runs here in Node. PNGs (tip.png, contact sheets) are written with node:zlib. Nothing to install.
import { chromium, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const SRC = '_claude/tex-src';
const OUT = 'public/tex';
const MANIFEST = 'src/render/texmaps.json';
const SHEETS = 'artifacts/ink2/tex';
const CHECK_ONLY = process.argv.includes('--check');

/** The picked render per map (one generation each unless noted in texmaps.json). */
const PICKS = {
  paper: `${SRC}/paper.png`,
  wash: `${SRC}/wash.png`,
  streaks: `${SRC}/streaks.png`,
  tip: `${SRC}/tip.png`,
  smoke: `${SRC}/smoke.png`,
} as const;

const TARGET_MEAN = 128;
const TARGET_STD = 40;
/** WebP quality per file (Chromium: 1.0 = lossless). Tuned to land inside BUDGET. */
const Q = { map1024: 0.78, map512: 0.66, streaks: 0.85, smoke: 0.7 };
const TIP_STEP = 8; // tip alpha quantisation (levels of 4) for the PNG size
const BUDGET = { desktop: 600_000, phone: 250_000, total: 850_000 }; // bytes (the stricter reading of "KB")

// ---------------------------------------------------------------------------------------------------
// Greyscale images and filters (Float32, 0..1 unless noted)
// ---------------------------------------------------------------------------------------------------

type Img = { w: number; h: number; d: Float32Array };
const img = (w: number, h: number, d = new Float32Array(w * h)): Img => ({ w, h, d });
const clone = (a: Img): Img => img(a.w, a.h, a.d.slice());
const map = (a: Img, f: (v: number, i: number) => number): Img => {
  const o = new Float32Array(a.d.length);
  for (let i = 0; i < o.length; i++) o[i] = f(a.d[i], i);
  return img(a.w, a.h, o);
};
const zip = (a: Img, b: Img, f: (x: number, y: number) => number): Img => map(a, (v, i) => f(v, b.d[i]));

function meanStd(d: ArrayLike<number>): { mean: number; std: number } {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < d.length; i++) {
    s += d[i];
    s2 += d[i] * d[i];
  }
  const mean = s / d.length;
  return { mean, std: Math.sqrt(Math.max(0, s2 / d.length - mean * mean)) };
}

const wrapIdx = (i: number, n: number) => ((i % n) + n) % n;
const clampIdx = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i);

/** One running-sum box pass of radius r along x (axis 0) or y (axis 1). */
function boxPass(a: Img, r: number, axis: 0 | 1, wrap: boolean): Img {
  if (r <= 0) return clone(a);
  const { w, h } = a;
  const o = new Float32Array(w * h);
  const n = axis === 0 ? w : h;
  const lines = axis === 0 ? h : w;
  const at = (line: number, k: number) => (axis === 0 ? line * w + k : k * w + line);
  const idx = wrap ? wrapIdx : clampIdx;
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += a.d[at(line, idx(k, n))];
    for (let k = 0; k < n; k++) {
      o[at(line, k)] = s * inv;
      s += a.d[at(line, idx(k + r + 1, n))] - a.d[at(line, idx(k - r, n))];
    }
  }
  return img(w, h, o);
}

/** Gaussian blur, σ in px, approximated by three box passes per axis (error < 3 %). */
function blur(a: Img, sigma: number, wrap: boolean, axes: 'xy' | 'x' = 'xy'): Img {
  if (sigma <= 0) return clone(a);
  // box radii for 3 passes approximating σ (Kovesi)
  const nb = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / nb + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - nb * wl * wl - 4 * nb * wl - 3 * nb) / (-4 * wl - 4));
  let o = a;
  for (let i = 0; i < nb; i++) {
    const r = ((i < m ? wl : wu) - 1) / 2;
    o = boxPass(o, r, 0, wrap);
    if (axes === 'xy') o = boxPass(o, r, 1, wrap);
  }
  return o;
}

/** Separable resample to nw×nh: area (triangle) filter when shrinking, bilinear when growing. */
function resize(a: Img, nw: number, nh: number, wrap: boolean): Img {
  const pass = (src: Img, n: number, axis: 0 | 1): Img => {
    const sn = axis === 0 ? src.w : src.h;
    const lines = axis === 0 ? src.h : src.w;
    const ow = axis === 0 ? n : src.w;
    const oh = axis === 0 ? src.h : n;
    const o = new Float32Array(ow * oh);
    const scale = sn / n;
    const support = Math.max(1, scale);
    const idx = wrap ? wrapIdx : clampIdx;
    for (let k = 0; k < n; k++) {
      const c = (k + 0.5) * scale - 0.5;
      const k0 = Math.floor(c - support);
      const k1 = Math.ceil(c + support);
      const taps: [number, number][] = [];
      let ws = 0;
      for (let j = k0; j <= k1; j++) {
        const wgt = Math.max(0, 1 - Math.abs(j - c) / support);
        if (wgt > 0) {
          taps.push([idx(j, sn), wgt]);
          ws += wgt;
        }
      }
      for (let line = 0; line < lines; line++) {
        let s = 0;
        for (const [j, wgt] of taps) s += src.d[axis === 0 ? line * src.w + j : j * src.w + line] * wgt;
        o[axis === 0 ? line * ow + k : k * ow + line] = s / ws;
      }
    }
    return img(ow, oh, o);
  };
  let o = a;
  if (nw !== a.w) o = pass(o, nw, 0);
  if (nh !== a.h) o = pass(o, nh, 1);
  return o;
}

function crop(a: Img, x0: number, y0: number, w: number, h: number): Img {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) o[y * w + x] = a.d[clampIdx(y0 + y, a.h) * a.w + clampIdx(x0 + x, a.w)];
  return img(w, h, o);
}

function roll(a: Img, dx: number, dy: number): Img {
  const o = new Float32Array(a.d.length);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) o[y * a.w + x] = a.d[wrapIdx(y + dy, a.h) * a.w + wrapIdx(x + dx, a.w)];
  return img(a.w, a.h, o);
}

/**
 * Seamless along x and/or y: blend the image with itself rolled by half, the rolled copy taking over in a
 * `margin` band at each edge (smoothstep window). The rolled copy's own seam sits mid-image where the
 * window is 0, and its edge pixels were neighbours in the source, so the wrap is continuous. The blend is
 * variance-preserving (divide by √(w² + (1−w)²) about the mean) so the band doesn't read as a flatter stripe.
 */
function seamless(a: Img, margin: number, axes: 'xy' | 'x'): Img {
  const pass = (src: Img, axis: 0 | 1): Img => {
    const n = axis === 0 ? src.w : src.h;
    const rolled = axis === 0 ? roll(src, n >> 1, 0) : roll(src, 0, n >> 1);
    const { mean } = meanStd(src.d);
    const band = margin * n;
    const win = (k: number) => {
      const e = Math.min(k + 0.5, n - k - 0.5); // distance to the nearest edge
      const t = Math.min(1, Math.max(0, e / band));
      return 1 - t * t * (3 - 2 * t);
    };
    return map(src, (v, i) => {
      const k = axis === 0 ? i % src.w : Math.floor(i / src.w);
      const wgt = win(k);
      const norm = Math.sqrt(wgt * wgt + (1 - wgt) * (1 - wgt));
      return mean + ((v - mean) * (1 - wgt) + (rolled.d[i] - mean) * wgt) / norm;
    });
  };
  let o = pass(a, 0);
  if (axes === 'xy') o = pass(o, 1);
  return o;
}

/** Remove structure larger than the tile (lighting drift, density gradients) so repeats don't band. */
const flatten = (a: Img, sigma: number, wrap: boolean): Img => {
  const lo = blur(a, sigma, wrap);
  const { mean } = meanStd(a.d);
  return zip(a, lo, (v, l) => v - l + mean);
};

const highPass = (a: Img, sigma: number, wrap: boolean): Img => zip(a, blur(a, sigma, wrap), (v, l) => v - l);

function dilate(a: Img, r: number, wrap: boolean): Img {
  const idx = wrap ? wrapIdx : clampIdx;
  const o = new Float32Array(a.d.length);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      let m = -Infinity;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) m = Math.max(m, a.d[idx(y + dy, a.h) * a.w + idx(x + dx, a.w)]);
      o[y * a.w + x] = m;
    }
  return img(a.w, a.h, o);
}

/** Sobel magnitude with non-maximum suppression along the gradient: thin edge lines, weighted. */
function thinEdges(a: Img, wrap: boolean): { line: Img; mag: Img } {
  const { w, h } = a;
  const idx = wrap ? wrapIdx : clampIdx;
  const at = (x: number, y: number) => a.d[idx(y, h) * w + idx(x, w)];
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const sy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const i = y * w + x;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.hypot(sx, sy);
    }
  const m = (x: number, y: number) => mag[idx(y, h) * w + idx(x, w)];
  const line = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ang = Math.atan2(gy[i], gx[i]);
      const q = ((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4; // 0: x, 1: diag, 2: y, 3: anti-diag
      const [dx, dy] = [[1, 0], [1, 1], [0, 1], [-1, 1]][q];
      if (mag[i] >= m(x + dx, y + dy) && mag[i] >= m(x - dx, y - dy)) line[i] = mag[i];
    }
  return { line: img(w, h, line), mag: img(w, h, mag) };
}

// ---------------------------------------------------------------------------------------------------
// Equalisation: rank → Gaussian quantiles (mean 128, std 40), ties broken by an optional second key
// ---------------------------------------------------------------------------------------------------

/** Inverse standard-normal CDF (Acklam). */
function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628274631];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Returns 8-bit-range values (0..255 floats) with the same rank order as `key` (then `tie`). */
function equalise(key: Img, tie?: Img): Img {
  const n = key.d.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const k = key.d;
  const t = tie?.d;
  order.sort((i, j) => k[i] - k[j] || (t ? t[i] - t[j] : 0) || i - j);
  const o = new Float32Array(n);
  for (let r = 0; r < n; r++) o[order[r]] = Math.min(255, Math.max(0, TARGET_MEAN + TARGET_STD * probit((r + 0.5) / n)));
  return img(key.w, key.h, o);
}

/** The equalised value that sits at the rank where `key` crosses `level` (for thresholds in the manifest). */
function levelAfterEq(key: Img, eq: Img, level: number): number {
  let lo = 255;
  for (let i = 0; i < key.d.length; i++) if (key.d[i] >= level && eq.d[i] < lo) lo = eq.d[i];
  return lo / 255;
}

const to8 = (a: Img): Uint8Array => {
  const o = new Uint8Array(a.d.length);
  for (let i = 0; i < o.length; i++) o[i] = Math.min(255, Math.max(0, Math.round(a.d[i])));
  return o;
};

// ---------------------------------------------------------------------------------------------------
// PNG writer (grey, grey+alpha, RGB) with per-row adaptive filtering
// ---------------------------------------------------------------------------------------------------

function png(w: number, h: number, channels: 1 | 2 | 3 | 4, data: Uint8Array): Buffer {
  const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = new Uint8Array(stride);
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : prev;
    let best = 0;
    let bestCost = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? row[i - channels] : 0;
        const b = up[i];
        const cc = i >= channels ? up[i - channels] : 0;
        let p = 0;
        if (f === 1) p = a;
        else if (f === 2) p = b;
        else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) {
          const pa = Math.abs(b - cc);
          const pb = Math.abs(a - cc);
          const pc = Math.abs(a + b - 2 * cc);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        const v = (row[i] - p) & 255;
        c[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    raw.set(cand[best], y * (stride + 1) + 1);
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb) >>> 0);
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Chromium: decode PNG, encode + decode WebP (WebGL, unpremultiplied, no colour conversion)
// ---------------------------------------------------------------------------------------------------

const b64 = (u: Uint8Array | Buffer) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

async function decodeImage(page: Page, bytes: Buffer, mime: string): Promise<{ w: number; h: number; rgba: Uint8Array }> {
  const r = await page.evaluate(
    async ({ data, mime }) => {
      const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: mime });
      const im = new Image();
      im.src = URL.createObjectURL(blob);
      await im.decode();
      const w = im.naturalWidth;
      const h = im.naturalHeight;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const gl = cv.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })!;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = '';
      for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
      return { w, h, data: btoa(s) };
    },
    { data: b64(bytes), mime },
  );
  return { w: r.w, h: r.h, rgba: unb64(r.data) };
}

async function encodeWebp(page: Page, w: number, h: number, rgba: Uint8Array, quality: number): Promise<Buffer> {
  const url = await page.evaluate(
    ({ data, w, h, quality }) => {
      const px = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const gl = cv.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true })!;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // canvas row 0 is the top; GL row 0 is the bottom
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const pr = gl.createProgram()!;
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision highp float; uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor = texture2D(t, v); }'));
      gl.linkProgram(pr);
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return cv.toDataURL('image/webp', quality);
    },
    { data: b64(rgba), w, h, quality },
  );
  return Buffer.from(url.split(',')[1], 'base64');
}

// ---------------------------------------------------------------------------------------------------
// The maps
// ---------------------------------------------------------------------------------------------------

type Channel = { img: Img; name: string; note: string; threshold?: number; lossless?: boolean; mask?: boolean };
type MapOut = {
  name: 'paper' | 'wash' | 'streaks' | 'tip' | 'smoke';
  set: 'desktop' | 'phone' | 'shared';
  file: string;
  w: number;
  h: number;
  channels: (Channel | null)[]; // R G B A (null = filler)
  format: 'webp' | 'png-alpha';
  quality?: number;
  tile: 'xy' | 'x' | 'none';
};

const grey = (rgba: Uint8Array, w: number, h: number): Img => {
  const o = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  return img(w, h, o);
};

/** Centre-square crop, resize to n, flatten > tile-scale drift, seamless in both axes. */
function tileBase(src: Img, n: number, flattenSigma: number): Img {
  const s = Math.min(src.w, src.h);
  const sq = crop(src, (src.w - s) >> 1, (src.h - s) >> 1, s, s);
  const r = resize(sq, n, n, false);
  return seamless(flatten(r, flattenSigma, false), 0.12, 'xy');
}

/**
 * WebP lossy stores RGB as 4:2:0 YUV: above half resolution every colour channel gets the same luma detail,
 * so independent data channels bleed into each other and lose their fine band (grain std 40 → 24 measured).
 * Data that ships in R/G/B is therefore band-limited to half resolution first (σ 1.2 texels), which the codec
 * keeps per channel. The alpha plane is lossless and full resolution, so A carries the sparse, crisp channel
 * (flecks, tide lines), lightly quantised (A_STEP) so it compresses.
 */
const BAND = 1.2;
const A_STEP = 4;
/**
 * Masks (paper flecks, wash tide lines) ship as 0.5 → 1: background 128, "set" 255, anti-aliased between.
 * They are not equalised: a 0/1 mask equalised to std 40 either loses its meaning or (with ranked ties)
 * becomes a noise field that costs ~300 KB in the lossless plane. The 128 floor keeps every texel's RGB safe
 * on decode paths that premultiply alpha (iOS Safari, 2D canvas): the round-trip error there is ≤ 2 levels.
 */
const maskA = (m: Img) => map(m, (v) => 128 + 127 * Math.min(1, Math.max(0, v)));
const rgbChan = (field: Img, tie?: Img) => equalise(blur(field, BAND, true), tie);

function paperChannels(base: Img): Channel[] {
  const R = rgbChan(base);
  const G = rgbChan(blur(base, 24, true));
  const B = rgbChan(highPass(base, 2, true));
  // flecks: small dark specks = difference of Gaussians on darkness, top 1 %, dilated 1 px. Ties inside
  // and outside the mask are ordered by a smooth (σ 6) field so the channel stays low-entropy in the
  // lossless alpha plane while still meeting the equalisation target.
  const dark = map(base, (v) => 1 - v);
  const dog = zip(blur(dark, 1, true), blur(dark, 5, true), (a, b) => a - b);
  const sorted = Float32Array.from(dog.d).sort();
  const t99 = sorted[Math.floor(sorted.length * 0.99)];
  const mask = dilate(map(dog, (v) => (v >= t99 ? 1 : 0)), 1, true);
  const A = maskA(blur(mask, 0.5, true));
  const frac = meanStd(mask.d).mean;
  return [
    { img: R, name: 'fibre', note: 'raw luminance: long fibres (bright), soft mottling' },
    { img: G, name: 'mottle', note: '24 px (σ) blur of raw' },
    { img: B, name: 'grain', note: 'high-pass 2 px (raw − σ2 blur), band-limited to half resolution' },
    {
      img: A,
      lossless: true,
      mask: true,
      name: 'flecks',
      note: `MASK, not equalised: fleck mask (top 1 % DoG on darkness, dilated 1 px, 0.5 px AA; ${(frac * 100).toFixed(1)} % of texels). Background 0.5, fleck 1.0; "set" = smoothstep(0.6, 0.9, A)`,
      threshold: 0.75,
    },
  ];
}

function washChannels(base: Img): Channel[] {
  const R = rgbChan(base);
  const b16 = blur(base, 16, true);
  const G = equalise(b16); // bloom field: smoothstep(0.56, 0.66, G) is the bloom mask (as today's bm)
  const { line, mag } = thinEdges(G, true); // tide lines on the equalised field so the scale is known
  const sortedLine = Float32Array.from(line.d).filter((v) => v > 0).sort();
  const strong = sortedLine[Math.floor(sortedLine.length * 0.5)] ?? 1;
  const lineAA = blur(line, 0.7, true);
  const A = maskA(map(lineAA, (v) => {
    const t = Math.min(1, Math.max(0, (v - 0.35 * strong) / (0.65 * strong)));
    return t * t * (3 - 2 * t);
  }));
  void mag;
  const B = rgbChan(highPass(base, 3, true));
  return [
    { img: R, name: 'pigment', note: 'raw luminance: pooled pigment (dark = more pigment), pale bloom centres, dark tide rims' },
    {
      img: G,
      name: 'bloom',
      note: "16 px (σ) blur of raw, equalised; the bloom mask is smoothstep(0.56, 0.66, G) in the shader (rank-identical to the spec's smoothstepped mask, which as a 0/1 mask could not meet mean 128 / std 40)",
      threshold: 0.56,
    },
    { img: B, name: 'granulation', note: 'high-pass 3 px (raw − σ3 blur), band-limited to half resolution. MOVED from A (spec) to B: a noisy channel in the lossless alpha plane costs ~600 KB alone' },
    {
      img: A,
      lossless: true,
      mask: true,
      name: 'tide',
      note: 'MASK, not equalised: Sobel edge of the bloom field, thinned by non-maximum suppression, 0.7 px AA, the stronger edges kept. Background 0.5, line 1.0; tide = smoothstep(0.55, 0.9, A). MOVED from B (spec) to A: thin lines need the full-resolution lossless plane',
      threshold: 0.75,
    },
  ];
}

/**
 * Straighten a stroke that bends: per-column ink centroid (smoothed along x) → shift each column so the
 * centroid sits on one row. Keeps thickening/thinning, removes the wave.
 */
function straighten(ink: Img, smooth: number, weightFloor = 0.15): Img {
  const cy = new Float32Array(ink.w);
  const wt = new Float32Array(ink.w);
  for (let x = 0; x < ink.w; x++) {
    let s = 0;
    let sy = 0;
    for (let y = 0; y < ink.h; y++) {
      const v = Math.max(0, ink.d[y * ink.w + x] - weightFloor);
      s += v;
      sy += v * y;
    }
    cy[x] = s > 0 ? sy / s : ink.h / 2;
    wt[x] = s;
  }
  // columns with little ink (the lifted hairs) inherit the centroid of their inked neighbours
  let last = ink.h / 2;
  const maxW = Math.max(...wt);
  for (let x = 0; x < ink.w; x++) {
    if (wt[x] > maxW * 0.08) last = cy[x];
    else cy[x] = last;
  }
  const cyImg = blur(img(ink.w, 1, cy), smooth, false, 'x');
  const mid = ink.h / 2;
  const out = new Float32Array(ink.w * ink.h);
  for (let y = 0; y < ink.h; y++)
    for (let x = 0; x < ink.w; x++) {
      const sy = y + cyImg.d[x] - mid;
      const y0 = Math.floor(sy);
      const f = sy - y0;
      const a = y0 >= 0 && y0 < ink.h ? ink.d[y0 * ink.w + x] : 0;
      const b = y0 + 1 >= 0 && y0 + 1 < ink.h ? ink.d[(y0 + 1) * ink.w + x] : 0;
      out[y * ink.w + x] = a * (1 - f) + b * f;
    }
  return img(ink.w, ink.h, out);
}

/** Straighten the wavy stroke, crop its band, 2048×256, seamless in x. */
function streaksBase(src: Img): { base: Img; inkLevel: number } {
  const st = straighten(map(src, (v) => 1 - v), 40);
  // band = rows where the stroke is inked at least 12 % of the width
  const rows: number[] = [];
  for (let y = 0; y < st.h; y++) {
    let c = 0;
    for (let x = 0; x < st.w; x++) if (st.d[y * st.w + x] > 0.5) c++;
    if (c / st.w > 0.12) rows.push(y);
  }
  const y0 = rows[0];
  const y1 = rows[rows.length - 1];
  const band = crop(st, 0, y0, st.w, y1 - y0 + 1);
  const r = resize(band, 2048, 256, false);
  return { base: seamless(r, 0.12, 'x'), inkLevel: 0.5 };
}

function streakChannels(base: Img, inkLevel: number): Channel[] {
  const R = equalise(base);
  const G = equalise(blur(base, 64, true, 'x'));
  return [
    {
      img: R,
      name: 'bristle',
      note: "ink density (1 − luminance), one row per bristle, x along the stroke; on = R > threshold (the source's 50 % ink level); scale the threshold by `dry`",
      threshold: levelAfterEq(base, R, inkLevel),
    },
    { img: G, name: 'swell', note: '64 px (σ) horizontal blur of the bristle density: the slow thickening/thinning' },
  ];
}

/**
 * The lifted brush: straightened so the stroke axis runs left → right, cropped to the ink's band, stretched
 * to 512². Alpha = ink with levels: paper → 0, the loaded body → 1 (the render's grey speckle inside the
 * solid ink is clamped so the body is solid and the fray does the work).
 */
function tipAlpha(src: Img): { a: Img; bbox: number[] } {
  const ink0 = map(src, (v) => 1 - v);
  const sorted = Float32Array.from(ink0.d).sort();
  const paper = sorted[Math.floor(sorted.length * 0.5)]; // most of the frame is paper
  const solid = sorted[Math.floor(sorted.length * 0.995)];
  const lo = paper + 0.06;
  const hi = paper + 0.7 * (solid - paper);
  const lv0 = map(ink0, (v) => {
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  });
  const lv = straighten(lv0, 60, 0.3);
  let x0 = src.w;
  let x1 = 0;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++)
      if (lv.d[y * src.w + x] > 0.1) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
  // v extent = the loaded body where the stroke enters (left 12 % of the ink's length), so u = 0 is solid
  // across the full width; stray hairs that sweep outside that band are clipped and feathered (4 % in v).
  const entry = Math.round(x0 + (x1 - x0) * 0.12);
  let by0 = src.h;
  let by1 = 0;
  for (let y = 0; y < src.h; y++) {
    let c = 0;
    for (let x = x0; x < entry; x++) if (lv.d[y * src.w + x] > 0.5) c++;
    if (c / (entry - x0) > 0.5) {
      by0 = Math.min(by0, y);
      by1 = Math.max(by1, y);
    }
  }
  const padX = Math.round((x1 - x0) * 0.02);
  const bx = Math.max(0, x0); // the stroke enters at the frame's left edge: no pad there
  const bw = Math.min(src.w, x1 + padX) - bx;
  const by = by0;
  const bh = by1 - by0 + 1;
  const a = resize(crop(lv, bx, by, bw, bh), 512, 512, false);
  const feather = map(a, (v, i) => {
    const y = Math.floor(i / 512);
    const e = Math.min(y + 0.5, 511.5 - y) / (512 * 0.04);
    const t = Math.min(1, e);
    return v * t * t * (3 - 2 * t);
  });
  return { a: feather, bbox: [bx, by, bw, bh] };
}

// ---------------------------------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------------------------------

type ChanStats = { mean: number; std: number };

/**
 * Wrap seam along one axis for one channel: the step in mean value between the 2-texel strips either side of
 * the wrap edge, averaged over 64-texel windows along the seam (so per-texel grain doesn't count), max over windows; and the same statistic across
 * every interior column/row boundary as the texture's own baseline. Gate: the wrap is no rougher than the
 * texture's roughest own boundary + 2/255 (for grain-like channels the neighbour step is itself 50–80/255, so
 * a flat 2/255 cannot hold anywhere in them); above the 99th percentile is reported as a tail case to look
 * at in the seam close-up. Units: /255.
 */
function seamStep(ch: Uint8Array, w: number, h: number, axis: 0 | 1): { seam: number; interior: number; max: number } {
  const len = axis === 0 ? h : w;
  const n = axis === 0 ? w : h;
  const at = (k: number, t: number) => (axis === 0 ? ch[t * w + k] : ch[k * w + t]);
  // strips of STRIP texels each side of the boundary k0 | k1 (k0 = last of the left strip, k1 = first of the right)
  const STRIP = 2;
  const stepAt = (k0: number, k1: number) => {
    let worst = 0;
    const win = Math.min(64, len);
    for (let t0 = 0; t0 + win <= len; t0 += win >> 1) {
      let s = 0;
      for (let t = t0; t < t0 + win; t++)
        for (let j = 0; j < STRIP; j++) s += at(wrapIdx(k1 + j, n), t) - at(wrapIdx(k0 - j, n), t);
      worst = Math.max(worst, Math.abs(s / (win * STRIP)));
    }
    return worst;
  };
  const seam = stepAt(n - 1, 0);
  const inner: number[] = [];
  for (let k = 1; k < n - 2; k++) inner.push(stepAt(k, k + 1));
  inner.sort((a, b) => a - b);
  return { seam, interior: inner[Math.floor(inner.length * 0.99)], max: inner[inner.length - 1] };
}

function sheetTile(ch: Uint8Array, w: number, h: number, nx: number, ny: number, scale: number): { w: number; h: number; d: Uint8Array } {
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const small = resize(img(w, h, Float32Array.from(ch)), tw, th, true);
  const W = tw * nx;
  const H = th * ny;
  const d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = Math.round(small.d[(y % th) * tw + (x % tw)]);
  return { w: W, h: H, d };
}

function hstack(parts: { w: number; h: number; d: Uint8Array }[], gap = 8): { w: number; h: number; d: Uint8Array } {
  const H = Math.max(...parts.map((p) => p.h));
  const W = parts.reduce((s, p) => s + p.w, 0) + gap * (parts.length - 1);
  const d = new Uint8Array(W * H).fill(40);
  let ox = 0;
  for (const p of parts) {
    for (let y = 0; y < p.h; y++) d.set(p.d.subarray(y * p.w, (y + 1) * p.w), y * W + ox);
    ox += p.w + gap;
  }
  return { w: W, h: H, d };
}

function vstack(parts: { w: number; h: number; d: Uint8Array }[], gap = 8): { w: number; h: number; d: Uint8Array } {
  const W = Math.max(...parts.map((p) => p.w));
  const H = parts.reduce((s, p) => s + p.h, 0) + gap * (parts.length - 1);
  const d = new Uint8Array(W * H).fill(40);
  let oy = 0;
  for (const p of parts) {
    for (let y = 0; y < p.h; y++) d.set(p.d.subarray(y * p.w, (y + 1) * p.w), (oy + y) * W);
    oy += p.h + gap;
  }
  return { w: W, h: H, d };
}

// ---------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------

const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const CH = ['R', 'G', 'B', 'A'] as const;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript('window.__name = (f) => f'); // tsx keepNames wraps local functions
await page.goto('about:blank');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHEETS, { recursive: true });

type Entry = {
  file: string;
  set: string;
  w: number;
  h: number;
  bytes: number;
  channels: Record<string, { name: string; note: string; mean: number; std: number; threshold?: number; mask?: boolean }>;
};
let manifest: {
  version: number;
  note: string;
  target: { mean: number; std: number };
  budget: { desktopBytes: number; phoneBytes: number; totalBytes: number; desktop: number; phone: number; total: number };
  maps: Record<string, { source: string; sha256: string; tile: string; use: string; files: Entry[]; extra?: Record<string, unknown> }>;
};

if (!CHECK_ONLY) {
  const outs: MapOut[] = [];
  const extras: Record<string, Record<string, unknown>> = {};
  const load = async (f: string) => {
    const { w, h, rgba } = await decodeImage(page, readFileSync(f), 'image/png');
    return grey(rgba, w, h);
  };
  const halve = (chs: Channel[], axes: 'xy' | 'x'): Channel[] =>
    chs.map((c) => {
      const small = resize(c.img, c.img.w >> 1, c.img.h >> 1, true);
      if (c.mask) return { ...c, img: small };
      // re-rank at the smaller size so the phone file meets the same target; thresholds keep their rank.
      // RGB data is band-limited again at the new size (see BAND); 1-row-per-bristle streaks are not.
      const field = c.lossless || axes === 'x' ? small : blur(small, BAND, true);
      const eq = equalise(field);
      return { ...c, img: eq, threshold: c.threshold === undefined ? undefined : levelAfterEq(field, eq, c.threshold * 255) };
    });

  // paper
  {
    const base = tileBase(await load(PICKS.paper), 1024, 128);
    const chs = paperChannels(base);
    outs.push({ name: 'paper', set: 'desktop', file: 'paper-1024.webp', w: 1024, h: 1024, channels: chs, format: 'webp', quality: Q.map1024, tile: 'xy' });
    outs.push({ name: 'paper', set: 'phone', file: 'paper-512.webp', w: 512, h: 512, channels: halve(chs, 'xy'), format: 'webp', quality: Q.map512, tile: 'xy' });
    console.log('paper derived');
  }
  // wash
  {
    const base = tileBase(await load(PICKS.wash), 1024, 128);
    const chs = washChannels(base);
    outs.push({ name: 'wash', set: 'desktop', file: 'wash-1024.webp', w: 1024, h: 1024, channels: chs, format: 'webp', quality: Q.map1024, tile: 'xy' });
    outs.push({ name: 'wash', set: 'phone', file: 'wash-512.webp', w: 512, h: 512, channels: halve(chs, 'xy'), format: 'webp', quality: Q.map512, tile: 'xy' });
    console.log('wash derived');
  }
  // streaks
  {
    const { base, inkLevel } = streaksBase(await load(PICKS.streaks));
    const chs = streakChannels(base, inkLevel);
    outs.push({ name: 'streaks', set: 'desktop', file: 'streaks-2048.webp', w: 2048, h: 256, channels: [...chs, null, null], format: 'webp', quality: Q.streaks, tile: 'x' });
    outs.push({ name: 'streaks', set: 'phone', file: 'streaks-1024.webp', w: 1024, h: 128, channels: [...halve(chs, 'x'), null, null], format: 'webp', quality: Q.streaks, tile: 'x' });
    console.log('streaks derived');
  }
  // tip
  {
    const { a, bbox } = tipAlpha(await load(PICKS.tip));
    extras.tip = { sourceBBox: bbox, axis: 'u = x (0 = still loaded at the left edge, 1 = past the last hair), v = y across the stroke' };
    outs.push({
      name: 'tip',
      set: 'shared',
      file: 'tip.png',
      w: 512,
      h: 512,
      channels: [null, null, null, { img: map(a, (v) => v * 255), name: 'ink', note: 'alpha = ink (black ink → 255, paper → 0); not equalised: it multiplies the stroke alpha' }],
      format: 'png-alpha',
      tile: 'none',
    });
    console.log('tip derived');
  }
  // smoke
  {
    const src = await load(PICKS.smoke);
    const dens = map(src, (v) => 1 - v);
    const base = tileBase(dens, 512, 64);
    outs.push({
      name: 'smoke',
      set: 'shared',
      file: 'smoke-512.webp',
      w: 512,
      h: 512,
      channels: [{ img: equalise(base), name: 'smoke', note: 'ink density (1 − luminance) of ink wisps in water; drift flattened (σ 64) so repeats don\'t band; stored grey (R = G = B)' }],
      format: 'webp',
      quality: Q.smoke,
      tile: 'xy',
    });
    console.log('smoke derived');
  }

  manifest = {
    version: 1,
    note: 'Written by scripts/textures.ts (docs/INK2.md §4). Data textures: load with sRGB off, RepeatWrapping (streaks: repeat in x), no premultiply. Stats are measured on the shipped files as WebGL decodes them.',
    target: { mean: TARGET_MEAN, std: TARGET_STD },
    budget: { desktopBytes: BUDGET.desktop, phoneBytes: BUDGET.phone, totalBytes: BUDGET.total, desktop: 0, phone: 0, total: 0 },
    maps: {},
  };
  const USE: Record<string, string> = {
    paper: 'paperAt(): fibre R at 14 units/repeat (+ 1.37× rotated tap), mottle G at 37, grain B at 1.9, flecks A',
    wash: 'TILE_FRAG: pools R at 22 units (+ 1.37× rotated tap), bloom G, tide B, granulation A at 4.5 and 1.9',
    streaks: 'dryBrush() streak sampler: row = hash(k, seed) % 256 (128 on phone), x = S / (rowH·48) wrapped',
    tip: 'AttackArrow / LiveStroke: last 30 % of the stroke alpha × tip alpha, u along the stroke',
    smoke: 'tokens.ts figure smoke: rise / curl',
  };
  for (const o of outs) {
    const n = o.w * o.h;
    let bytes: Buffer;
    const rgba = new Uint8Array(n * 4);
    const chans = o.channels.map((c) => (c ? (c.lossless ? to8(c.img).map((v) => Math.min(255, Math.round(v / A_STEP) * A_STEP)) : to8(c.img)) : null));
    if (o.format === 'png-alpha') {
      const a = chans[3]!;
      const ga = new Uint8Array(n * 2);
      for (let i = 0; i < n; i++) ga[i * 2 + 1] = Math.min(255, Math.round(a[i] / TIP_STEP) * TIP_STEP);
      bytes = png(o.w, o.h, 2, ga);
    } else {
      const grey1 = o.channels.filter(Boolean).length === 1;
      for (let i = 0; i < n; i++) {
        const r = chans[0]![i];
        const g = grey1 ? r : chans[1]![i];
        // filler: B copies G for 2-channel maps (keeps chroma low, fewer bits, less crosstalk into R/G)
        const b = grey1 ? r : chans[2] ? chans[2][i] : g;
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = chans[3] ? chans[3][i] : 255;
      }
      bytes = await encodeWebp(page, o.w, o.h, rgba, o.quality ?? 0.85);
      // The codec trims each lossy channel's fine band a little (std 40 → ~37). Compensate: decode, rescale
      // each equalised RGB channel about 128 by 40 / measured, re-encode (≤ 3 rounds).
      const lossyEq = [0, 1, 2].filter((k) => o.channels[k] && !o.channels[k]!.mask);
      if (grey1) lossyEq.splice(1);
      const gain = [1, 1, 1];
      for (let round = 0; round < 3; round++) {
        const dec = await decodeImage(page, bytes, 'image/webp');
        let worst = 0;
        for (const k of lossyEq) {
          const ch = new Float32Array(n);
          for (let i = 0; i < n; i++) ch[i] = dec.rgba[i * 4 + k];
          const st = meanStd(ch);
          worst = Math.max(worst, Math.abs(st.std - TARGET_STD) / TARGET_STD);
          gain[k] *= TARGET_STD / st.std;
        }
        if (worst < 0.01) break;
        for (const k of lossyEq) {
          const src = chans[k]!;
          for (let i = 0; i < n; i++) {
            const v = Math.min(255, Math.max(0, Math.round(TARGET_MEAN + (src[i] - TARGET_MEAN) * gain[k])));
            rgba[i * 4 + k] = v;
            if (grey1) rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
          }
        }
        bytes = await encodeWebp(page, o.w, o.h, rgba, o.quality ?? 0.85);
      }
      if (lossyEq.length) console.log(`  ${o.file} codec gain ${lossyEq.map((k) => CH[k] + ' ×' + gain[k].toFixed(3)).join(' ')}`);
    }
    if (process.env.TEX_DEBUG && o.tile !== 'none')
      chans.forEach((c, k) => c && console.log('  pre', o.file, CH[k], JSON.stringify(seamStep(c, o.w, o.h, 0)), o.tile === 'xy' ? JSON.stringify(seamStep(c, o.w, o.h, 1)) : ''));
    writeFileSync(`${OUT}/${o.file}`, bytes);
    const m = (manifest.maps[o.name] ??= { source: PICKS[o.name], sha256: sha(PICKS[o.name]), tile: o.tile, use: USE[o.name], files: [] });
    if (extras[o.name]) m.extra = extras[o.name];
    const channels: Entry['channels'] = {};
    o.channels.forEach((c, k) => {
      if (c)
        channels[CH[k]] = {
          name: c.name,
          note: c.note,
          mean: 0,
          std: 0,
          ...(c.mask ? { mask: true } : {}),
          ...(c.threshold !== undefined ? { threshold: +c.threshold.toFixed(4) } : {}),
        };
    });
    m.files.push({ file: `tex/${o.file}`, set: o.set, w: o.w, h: o.h, bytes: bytes.length, channels });
    console.log(`wrote ${o.file} ${bytes.length} B`);
  }
} else {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

// ---- verify: decode every shipped file as WebGL will, measure, sheet ----
let ok = true;
const fail = (msg: string) => {
  ok = false;
  console.log(`FAIL ${msg}`);
};
const sizes = { desktop: 0, phone: 0, total: 0 };
for (const [name, m] of Object.entries(manifest.maps)) {
  for (const f of m.files) {
    const path = `public/${f.file}`;
    const bytes = readFileSync(path);
    f.bytes = bytes.length;
    if (f.set === 'desktop' || f.set === 'shared') sizes.desktop += bytes.length;
    if (f.set === 'phone' || f.set === 'shared') sizes.phone += bytes.length;
    const { w, h, rgba } = await decodeImage(page, bytes, path.endsWith('.png') ? 'image/png' : 'image/webp');
    if (w !== f.w || h !== f.h) fail(`${f.file} is ${w}×${h}, manifest says ${f.w}×${f.h}`);
    const tiles: { w: number; h: number; d: Uint8Array }[] = [];
    const zooms: { w: number; h: number; d: Uint8Array }[] = [];
    const seams: string[] = [];
    for (const [k, c] of Object.entries(f.channels)) {
      const ci = CH.indexOf(k as (typeof CH)[number]);
      const ch = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) ch[i] = rgba[i * 4 + ci];
      const st: ChanStats = meanStd(ch);
      c.mean = +st.mean.toFixed(2);
      c.std = +st.std.toFixed(2);
      const equalised = name !== 'tip' && !(c as { mask?: boolean }).mask;
      if ((c as { mask?: boolean }).mask) {
        let mn = 255;
        for (let i = 0; i < ch.length; i++) mn = Math.min(mn, ch[i]);
        if (mn < 120) fail(`${f.file} ${k} mask floor ${mn} < 120 (premultiply safety)`);
      }
      if (equalised && (Math.abs(st.mean - TARGET_MEAN) > 2 || Math.abs(st.std - TARGET_STD) > 4))
        fail(`${f.file} ${k} mean ${st.mean.toFixed(2)} std ${st.std.toFixed(2)} (target 128 ± 2 / 40 ± 4)`);
      if (m.tile !== 'none') {
        for (const axis of m.tile === 'xy' ? ([0, 1] as const) : ([0] as const)) {
          const s = seamStep(ch, w, h, axis);
          seams.push(`${k}${axis ? 'y' : 'x'} ${s.seam.toFixed(1)}/${s.interior.toFixed(1)}${s.seam > s.interior ? '*' : ''}`);
          if (s.seam > s.max + 2) fail(`${f.file} ${k} seam along ${axis ? 'y' : 'x'}: step ${s.seam.toFixed(2)} > roughest interior ${s.max.toFixed(2)} + 2`);
          (c as Record<string, unknown>)[`seam${axis ? 'Y' : 'X'}`] = { step: +s.seam.toFixed(2), interiorP99: +s.interior.toFixed(2), interiorMax: +s.max.toFixed(2) };
        }
      }
      // seam close-up: the 4-tile junction at 1:1 (x-only maps: the x seam), per channel
      if (m.tile !== 'none') {
        const cw = Math.min(320, w);
        const chh = m.tile === 'xy' ? Math.min(320, h) : h;
        const d = new Uint8Array(cw * chh);
        for (let y = 0; y < chh; y++)
          for (let x = 0; x < cw; x++) {
            const sx = wrapIdx(x - (cw >> 1), w);
            const sy = m.tile === 'xy' ? wrapIdx(y - (chh >> 1), h) : y;
            d[y * cw + x] = ch[sy * w + sx];
          }
        zooms.push({ w: cw, h: chh, d });
      }
      // contact sheet panels
      if (m.tile === 'xy') tiles.push(sheetTile(ch, w, h, 2, 2, (w >= 1024 ? 512 : 256) / w));
      else if (m.tile === 'x') tiles.push(sheetTile(ch, w, h, 2, 1, 1024 / w));
      else tiles.push(sheetTile(ch, w, h, 1, 1, 1));
    }
    const sheet = m.tile === 'x' ? vstack(tiles) : hstack(tiles);
    const sheetName = `${SHEETS}/${f.file.replace('tex/', '').replace(/\.(webp|png)$/, '')}-2x2.png`;
    writeFileSync(sheetName, png(sheet.w, sheet.h, 1, sheet.d));
    if (zooms.length) {
      const z = m.tile === 'x' ? vstack(zooms) : hstack(zooms);
      writeFileSync(sheetName.replace('-2x2.png', '-seam.png'), png(z.w, z.h, 1, z.d));
    }
    console.log(`${f.file.padEnd(22)} ${String(bytes.length).padStart(7)} B  ${Object.entries(f.channels).map(([k, c]) => `${k} ${c.mean}/${c.std}`).join('  ')}  seams(step/P99, * = tail) ${seams.join(' ')}`);
  }
}
sizes.total = readdirSync(OUT).reduce((s, f) => s + statSync(`${OUT}/${f}`).size, 0);
manifest.budget.desktop = sizes.desktop;
manifest.budget.phone = sizes.phone;
manifest.budget.total = sizes.total;
console.log(`budget (bytes): desktop ${sizes.desktop} / 600000 · phone ${sizes.phone} / 250000 · public/tex ${sizes.total} / 850000`);
if (sizes.desktop > BUDGET.desktop) fail('desktop set over budget');
if (sizes.phone > BUDGET.phone) fail('phone set over budget');
if (sizes.total > BUDGET.total) fail('public/tex over budget');
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
await browser.close();
console.log(ok ? 'OK' : 'FAILED');
process.exit(ok ? 0 : 1);
