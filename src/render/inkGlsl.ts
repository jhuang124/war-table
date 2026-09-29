// Shared shader code and uniforms for the painted board: washi paper, the ink layer (with its breathing
// displacement), mist veils, contact shadows of lifted tiles, and the continent re-ink sweep. The ground
// and every tile top use the same functions, so a coastline stroke reads as one stroke across the seam.
//
// All colour math is in display (sRGB) space and written out as is (the materials are unlit and not
// tone-mapped), so the palette's hexes land on screen exactly.
import * as THREE from 'three';
import type { InkLayer } from './ink';
import { GOLD, INK_BORDER, INK_COAST, IVORY, PAPER, PAPER_DEEP, PAPER_FIBRE, hexToRgb, unclaimedRgb, type RGB } from './util';

const v3 = (hex: string | RGB) => {
  const c = typeof hex === 'string' ? hexToRgb(hex) : hex;
  return new THREE.Vector3(c[0], c[1], c[2]);
};

export interface SharedUniforms {
  [k: string]: THREE.IUniform;
  uInk: { value: THREE.Texture };
  uField: { value: THREE.Texture };
  uNoise: { value: THREE.Texture };
  uTerr: { value: THREE.DataTexture };
  uBoard: { value: THREE.Vector2 };
  uFieldSize: { value: THREE.Vector2 };
  uInkSize: { value: THREE.Vector2 };
  /** Ambient clock, seconds (advances only while the living calm runs; half speed when idle long). */
  uTime: { value: number };
  /** Ambient motion amplitude: 1 = at rest, 0.5 = yielding to gameplay, 0 = off (reduced motion). */
  uAmb: { value: number };
  /** Mist opacity factor: 1 at rest, 0.5 while gameplay moves. */
  uMist: { value: number };
  /** The coastline breath's reach in ink texels: 0.5 CSS px at the home zoom (set by the board on layout). */
  uWob: { value: number };
  /** Drawing-buffer size, px (screen-space vignette). */
  uRes: { value: THREE.Vector2 };
  uPaper: { value: THREE.Vector3 };
  uPaperDeep: { value: THREE.Vector3 };
  uFibre: { value: THREE.Vector3 };
  uInkCoast: { value: THREE.Vector3 };
  uInkBorder: { value: THREE.Vector3 };
  uIvory: { value: THREE.Vector3 };
  uGold: { value: THREE.Vector3 };
  uUnclaimed: { value: THREE.Vector3 };
  /** Lifted tiles casting a contact shadow: (territory index, lift in board units); index 0 = none. */
  uLiftA: { value: THREE.Vector2 };
  uLiftB: { value: THREE.Vector2 };
  /** The turn "breath": washes dim 8 % at 1. */
  uBreath: { value: number };
  /** Continent coast tint: colour per continent (CONTINENT_IDS order). */
  uContColor: { value: THREE.Vector3[] };
  /** Continent sweep: (centre bx, centre by, progress 0..1 clockwise from north, amount 0..1). */
  uContSweep: { value: THREE.Vector4[] };
}

/** Per-territory data (64×1 RGBA8): R = coast glow 0..1, G = ink dim 0..1, B = continent index, A = spare. */
export function makeTerrTexture(ink: InkLayer): THREE.DataTexture {
  const d = new Uint8Array(64 * 4);
  for (let i = 1; i <= 42; i++) d[i * 4 + 2] = ink.continentIndex(i);
  d[2] = 255;
  const t = new THREE.DataTexture(d, 64, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function makeSharedUniforms(ink: InkLayer, boardW: number, boardH: number): SharedUniforms {
  return {
    uInk: { value: ink.ink },
    uField: { value: ink.field },
    uNoise: { value: ink.noise },
    uTerr: { value: makeTerrTexture(ink) },
    uBoard: { value: new THREE.Vector2(boardW, boardH) },
    uFieldSize: { value: new THREE.Vector2(ink.fieldW, ink.fieldH) },
    uInkSize: { value: new THREE.Vector2(ink.inkW, ink.inkH) },
    uTime: { value: 0 },
    uAmb: { value: 0 },
    uMist: { value: 1 },
    uWob: { value: 1.7 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPaper: { value: v3(PAPER) },
    uPaperDeep: { value: v3(PAPER_DEEP) },
    uFibre: { value: v3(PAPER_FIBRE) },
    uInkCoast: { value: v3(INK_COAST) },
    uInkBorder: { value: v3(INK_BORDER) },
    uIvory: { value: v3(IVORY) },
    uGold: { value: v3(GOLD) },
    uUnclaimed: { value: v3(unclaimedRgb()) },
    uLiftA: { value: new THREE.Vector2(0, 0) },
    uLiftB: { value: new THREE.Vector2(0, 0) },
    uBreath: { value: 0 },
    uContColor: { value: Array.from({ length: 6 }, () => new THREE.Vector3(1, 1, 1)) },
    uContSweep: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
}

export const INK_GLSL = /* glsl */ `
uniform sampler2D uInk;
uniform sampler2D uField;
uniform sampler2D uNoise;
uniform sampler2D uTerr;
uniform vec2 uBoard;
uniform vec2 uFieldSize;
uniform vec2 uInkSize;
uniform float uTime;
uniform float uAmb;
uniform float uMist;
uniform float uWob;
uniform vec2 uRes;
uniform vec3 uPaper;
uniform vec3 uPaperDeep;
uniform vec3 uFibre;
uniform vec3 uInkCoast;
uniform vec3 uInkBorder;
uniform vec3 uIvory;
uniform vec3 uGold;
uniform vec3 uUnclaimed;
uniform vec2 uLiftA;
uniform vec2 uLiftB;
uniform float uBreath;
uniform vec3 uContColor[6];
uniform vec4 uContSweep[6];

vec2 bUV(vec2 bp) { return vec2(bp.x / uBoard.x, 1.0 - bp.y / uBoard.y); }
bool inBoard(vec2 bp) { return bp.x > 0.0 && bp.y > 0.0 && bp.x < uBoard.x && bp.y < uBoard.y; }
vec4 nz(vec2 p) { return texture2D(uNoise, p); }
vec4 fieldAt(vec2 bp) { return texture2D(uField, bUV(bp)); }
float idAt(vec2 bp) {
  vec2 uv = bUV(bp);
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  ivec2 c = ivec2(uv * uFieldSize);
  return floor(texelFetch(uField, c, 0).b * 255.0 + 0.5);
}
/** The territory under a board point, land only (sea texels carry their nearest coast's id; this ignores them). */
float landIdAt(vec2 bp) {
  vec2 uv = bUV(bp);
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  vec4 f = texelFetch(uField, ivec2(uv * uFieldSize), 0);
  return f.a > 0.5 ? floor(f.b * 255.0 + 0.5) : 0.0;
}
vec4 terrAt(float id) { return texelFetch(uTerr, ivec2(int(id + 0.5), 0), 0); }

// Washi: indigo, a little deeper toward the edges, long anisotropic fibres (6:1), soft mottling, fine grain.
vec3 paperAt(vec2 bp) {
  vec2 c = (bp - uBoard * 0.5) / (uBoard * vec2(0.62, 0.78));
  float r = length(c);
  vec3 col = mix(uPaper, uPaperDeep, smoothstep(0.2, 1.25, r));
  float a = clamp((nz(bp / 37.0).r - 0.5) * 3.0, -1.0, 1.0);
  float b = clamp((nz(bp / 8.5 + 0.37).g - 0.5) * 3.0, -1.0, 1.0);
  float f1 = nz(bp / 5.5 + 0.71).b;
  float f2 = nz(vec2(bp.y, -bp.x) / 7.5 + 0.23).b;
  col *= 1.0 + 0.055 * a + 0.03 * b;
  col = mix(col, uFibre, 0.3 * smoothstep(0.56, 0.84, f1) + 0.14 * smoothstep(0.6, 0.88, f2));
  col *= 0.975 + 0.05 * nz(bp / 1.9 + 0.5).a;
  return col;
}

// Screen-space vignette, 12 % at the corners.
float vignette() {
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  q.x *= uRes.x / max(1.0, uRes.y) * 0.62;
  return 1.0 - 0.12 * smoothstep(0.22, 0.78, length(q));
}

// The ink layer, sampled through a slow, spatially varying sub-pixel drift (wet ink breathing: up to 0.5 px at
// the home zoom, 14-16 s periods), its dry-brush opacity breathing ±6 % with its own phase from place to place.
vec4 inkAt(vec2 bp) {
  vec2 uv = bUV(bp);
  float a = uAmb;
  vec4 k;
  if (a > 0.001) {
    float t = uTime;
    vec2 q = bp / 47.0;
    // two slow sines per axis, phased by a broad noise field: every stretch of coast drifts on its own
    vec4 ph = nz(q * 0.37 + 0.19) * 6.2831853;
    vec2 d = vec2(
      0.6 * sin(t * 0.42 + ph.r * 2.0) + 0.4 * sin(t * 0.395 + ph.g * 3.0),
      0.6 * sin(t * 0.45 + ph.b * 2.0) + 0.4 * sin(t * 0.405 + ph.a * 3.0)
    );
    k = texture2D(uInk, uv + d * a * uWob / uInkSize);
    float br = sin(t * 0.47 + nz(bp / 61.0 + 0.53).g * 12.566) * 0.7 + 0.3 * sin(t * 0.39 + nz(bp / 23.0).r * 12.566);
    k.rgb *= 1.0 + 0.06 * a * br;
  } else {
    k = texture2D(uInk, uv);
  }
  return k;
}

// The coast stroke, blurred ~0.3 board units (a coarse mip): the wet feather where the ivory ink bled into
// the wash beside it.
float coastSoft(vec2 bp) {
  return textureLod(uInk, bUV(bp), log2(0.3 * uInkSize.x / uBoard.x)).r;
}

// Mist veils (A1): large fbm veils, 3-5 on the board at a time, drifting east ~0.7 % of the board width
// a second (the board is 100 units wide) and morphing slowly. x = the veils that keep to the sea (thinner
// near the coasts), y = the two that cross coasts, so the land breathes too. Peak opacity is 7-8 %.
vec2 mistAt(vec2 bp) {
  // ~0.8 % of the board width a second: clearly drifting at couch distance, never hurrying
  float t = uTime * 0.65;
  vec2 w = vec2(nz(bp / 260.0 + vec2(t * 0.0011, -t * 0.0008)).r, nz(bp / 210.0 + vec2(0.41 - t * 0.0009, 0.17 + t * 0.001)).r) - 0.5;
  float f = nz(bp / 26.0 + vec2(-t * 1.1 / 26.0, 0.33)).g - 0.5;
  float m1 = nz(bp / 170.0 + vec2(-t * 1.1 / 170.0, t * 0.1 / 170.0) + w * 0.3).r + 0.05 * f;
  float m2 = nz(bp / 140.0 + vec2(0.37 - t * 1.0 / 140.0, 0.61 - t * 0.12 / 140.0) - w.yx * 0.26).r + 0.05 * f;
  float m3 = nz(bp / 190.0 + vec2(0.73 - t * 1.15 / 190.0, 0.29 + t * 0.06 / 190.0) + w * 0.24).r + 0.05 * f;
  float m4 = nz(bp / 155.0 + vec2(0.13 - t * 1.05 / 155.0, 0.83 - t * 0.05 / 155.0) - w * 0.2).r + 0.05 * f;
  float sea = max(smoothstep(0.585, 0.64, m1), smoothstep(0.6, 0.655, m2) * 0.85);
  float over = max(smoothstep(0.6, 0.655, m3), smoothstep(0.61, 0.665, m4) * 0.8);
  // wisps inside the veils
  float wisp = 0.8 + 0.4 * (nz(bp / 11.0 + vec2(-t * 1.1 / 11.0, 0.7)).a);
  return vec2(sea, over) * wisp;
}
const vec3 MIST = vec3(0.78, 0.82, 0.9);

// The coast's ink colour here: ivory, or the continent holder's wash where it has re-inked (swept clockwise
// from north), brightened by a territory's glow.
vec3 coastColor(float id, vec2 bp, out float glow) {
  vec3 c = uInkCoast;
  glow = 0.0;
  if (id > 0.5) {
    vec4 td = terrAt(id);
    glow = td.r;
    int ci = int(td.b * 255.0 + 0.5);
    if (ci < 6) {
      vec4 sw = uContSweep[ci];
      if (sw.w > 0.001) {
        vec2 d = bp - sw.xy;
        float ang = fract(atan(d.x, d.y) / 6.2831853 + 1.0);
        float m = sw.z >= 0.999 ? 1.0 : 1.0 - smoothstep(sw.z - 0.035, sw.z, ang);
        c = mix(c, uContColor[ci], sw.w * m);
      }
    }
    c = mix(c, uIvory, glow * 0.7);
  }
  return c;
}

// Contact shadow of a lifted tile (the only sign of a lift on the flat board): its footprint, offset
// south-east by the lift, softened with a few taps.
float liftShadow(vec2 bp, vec2 L, float own) {
  if (L.x < 0.5 || L.y <= 0.001 || abs(L.x - own) < 0.5) return 0.0;
  vec2 o = vec2(0.8, -1.1) * L.y;
  float s = 0.0;
  s += landIdAt(bp - o) == L.x ? 0.3 : 0.0;
  s += landIdAt(bp - o * 0.72 + vec2(0.035, 0.02)) == L.x ? 0.25 : 0.0;
  s += landIdAt(bp - o * 1.25 - vec2(0.03, -0.035)) == L.x ? 0.2 : 0.0;
  s += landIdAt(bp - o * 0.9 + vec2(-0.04, -0.03)) == L.x ? 0.25 : 0.0;
  return s * clamp(L.y / 0.08, 0.0, 1.0);
}
`;

/** Ground (the whole sea, past every board edge). */
export const GROUND_VERT = /* glsl */ `
uniform vec2 uBoard;
varying vec2 vBP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vBP = vec2(w.x + uBoard.x * 0.5, uBoard.y * 0.5 - w.z);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const GROUND_FRAG = /* glsl */ `
${INK_GLSL}
varying vec2 vBP;
void main() {
  vec2 bp = vBP;
  vec3 c = paperAt(bp);
  float seaD = 4.0;
  if (inBoard(bp)) {
    vec4 f = fieldAt(bp);
    seaD = f.g * 4.0;
    float id = idAt(bp);
    // decorative (non-playable) land: raw paper, a shade lighter
    if (f.a > 0.5 && id < 0.5) c = mix(c, uUnclaimed, 0.55);
    // the coast's wet edge feathering into the sea
    c = mix(c, uInkCoast, 0.06 * exp(-seaD / 0.22) * (1.0 - f.a));
    vec4 k = inkAt(bp);
    float glow;
    vec3 cc = coastColor(id, bp, glow);
    c = mix(c, uInkCoast * 0.96, k.b * 0.55);
    c = mix(c, cc, clamp(k.r * (1.0 + 0.5 * glow), 0.0, 1.0) * 0.92);
    float sh = max(liftShadow(bp, uLiftA, -1.0), liftShadow(bp, uLiftB, -1.0));
    c *= 1.0 - 0.34 * sh;
  }
  // mist: the sea's own veils thin out near the coasts; the crossing veils run on over the land
  vec2 mv = mistAt(bp);
  float mist = max(mv.x * mix(0.35, 1.0, smoothstep(0.0, 0.8, seaD)), mv.y);
  c = mix(c, MIST, min(mist, 1.0) * 0.072 * uMist);
  c *= vignette();
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Tile tops: the wash. Local positions are relative to the tile's pivot (its anchor). */
export const TILE_VERT = /* glsl */ `
uniform vec2 uBoard;
uniform vec2 uAnchorW;
varying vec2 vBP;
void main() {
  vBP = vec2(position.x + uAnchorW.x + uBoard.x * 0.5, uBoard.y * 0.5 - (position.z + uAnchorW.y));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TILE_FRAG = /* glsl */ `
${INK_GLSL}
uniform vec3 uColor;
uniform vec3 uDeep;
uniform float uId;
uniform float uDim;
uniform float uLight;
uniform float uFlash;
uniform float uGlow;
uniform float uDry;
uniform float uPhase;
uniform float uPeriod;
uniform float uSeed;
uniform vec2 uRim;
uniform float uFloodOn;
uniform float uFloodR;
uniform float uFloodMode;
uniform float uFloodTorn;
uniform float uFloodSeed;
uniform vec2 uFloodOrigin;
uniform vec2 uFloodDir;
uniform vec3 uFloodColor;
uniform vec3 uFloodDeep;
varying vec2 vBP;

void main() {
  vec2 bp = vBP;
  vec4 f = fieldAt(bp);
  float prox = f.r;
  vec3 paper = paperAt(bp);
  vec3 wash = uColor;
  vec3 deep = uDeep;

  // Ink flood: the new wash soaks in behind an fbm-perturbed front with a darker, wetter leading rim.
  // Torn (a human's territory falling): a rougher, darker rim, paper fibres showing past it.
  float fresh = 0.0;
  if (uFloodOn > 0.5) {
    vec2 d = bp - uFloodOrigin;
    float r = uFloodMode > 0.5 ? dot(d, uFloodDir) : length(d);
    float ang = uFloodMode > 0.5 ? dot(d, vec2(-uFloodDir.y, uFloodDir.x)) * 0.12 : atan(d.y, d.x) * 0.55;
    float n = nz(vec2(ang, r * 0.045) + uFloodSeed).g - 0.5;
    float ragged = nz(bp / 2.3 + uFloodSeed * 1.7).a - 0.5;
    float fine = nz(bp / 0.9 + uFloodSeed * 2.9).a - 0.5;
    float front = uFloodR * (1.0 + 0.24 * n) + ragged * (0.22 + 0.5 * uFloodTorn) + fine * 0.5 * uFloodTorn;
    float soft = mix(0.22, 0.06, uFloodTorn);
    float k = 1.0 - smoothstep(front - soft, front, r);
    // the wet front: a dark tide line right at the edge, fading back into the fresh wash behind it
    float rimW = mix(0.75, 0.5, uFloodTorn);
    float rim = smoothstep(front - rimW, front - soft * 0.5, r) * k;
    rim = pow(rim, 1.6) * (0.75 + 0.5 * (ragged + 0.5));
    vec3 fc = mix(uFloodColor, uFloodDeep, clamp(rim * mix(0.95, 1.25, uFloodTorn), 0.0, 1.0));
    wash = mix(wash, fc, k);
    deep = mix(deep, uFloodDeep, k);
    // torn paper: a thin pale fringe just past the dark rim, where the old colour is being eaten
    float fringe = uFloodTorn * smoothstep(front - 0.02, front + 0.03, r) * (1.0 - smoothstep(front + 0.06, front + 0.22, r));
    wash = mix(wash, uIvory * 0.82, fringe * 0.42);
    fresh = rim;
  }

  // Watercolour: broad pools where the pigment settled, medium blotches, backrun blooms (a paler pool with
  // a darker tide line where a wetter patch pushed the pigment out), pigment granulating in the paper's
  // tooth, fibres showing through, and a darker edge where the wash dried against its border.
  float b1 = clamp((nz(bp / 23.0 + uSeed).r - 0.5) * 3.2, -1.0, 1.0);
  float b2 = clamp((nz(bp / 7.0 + uSeed * 1.7).g - 0.5) * 3.0, -1.0, 1.0);
  float bm = nz(bp / 13.0 + uSeed * 0.61 + 0.29).g;
  float bloom = smoothstep(0.56, 0.66, bm);
  float tide = 1.0 - smoothstep(0.0, 0.028, abs(bm - 0.575));
  float gr = nz(bp / 3.6 + uSeed * 2.3).a;
  float gr2 = nz(bp / 1.7 + uSeed * 0.9 + 0.4).a;
  wash *= 1.0 + 0.085 * b1 + 0.05 * b2;
  wash *= 1.0 + 0.05 * bloom - 0.07 * tide;
  wash *= 0.93 + 0.1 * smoothstep(0.28, 0.74, gr) + 0.04 * smoothstep(0.35, 0.7, gr2);
  wash *= 0.97 + 0.06 * nz(bp / 5.5 + 0.71).b;
  float edge = smoothstep(0.45, 1.0, prox);
  wash = mix(wash, deep, 0.26 * edge * edge + 0.1 * smoothstep(0.93, 1.0, prox));
  // wash breath: ±2 % lightness (L*), its own slow phase
  wash *= 1.0 + 0.035 * uAmb * sin(uTime * 6.2831853 / uPeriod + uPhase);
  wash *= 1.0 - 0.08 * uBreath;

  vec3 c = mix(paper, wash, 0.92);
  c = mix(c, mix(paper, uUnclaimed, 0.6), uDry);
  // recede toward the paper
  c = mix(c, paper, 0.3 * uDim) * (1.0 - 0.05 * uDim);
  c *= 1.0 + 0.07 * uLight;
  c = mix(c, uIvory, 0.14 * uFlash);
  // the crossing veils drift over the land too (thinner there, never over a number: those sit above)
  vec2 mv = mistAt(bp);
  c = mix(c, MIST, min(1.0, mv.y * 0.6 + mv.x * 0.12) * 0.08 * uMist);

  // the coast's wet feather bleeding into the wash (pale, soft, uneven with the grain)
  float cs = coastSoft(bp);
  c = mix(c, uInkCoast, 0.3 * smoothstep(0.03, 0.55, cs) * (0.75 + 0.5 * gr));

  // ink: interior borders at 40 %, the coast in full
  vec4 k = inkAt(bp);
  float glow;
  vec3 cc = coastColor(uId, bp, glow);
  glow = max(glow, uGlow);
  c = mix(c, uInkBorder, clamp(k.g * (0.4 + 0.25 * uLight + 0.5 * glow), 0.0, 1.0));
  c = mix(c, cc, clamp(k.r * (1.0 + 0.5 * glow + 0.25 * uLight), 0.0, 1.0) * 0.92);

  // selection rim: a screen-constant ivory line just inside the territory's own border
  if (uRim.x > 0.001) {
    float fw = max(fwidth(prox), 1e-4);
    float dpx = (1.0 - prox) / fw;
    float rim = 1.0 - smoothstep(uRim.y - 0.75, uRim.y + 0.75, dpx);
    c = mix(c, uIvory, rim * uRim.x);
  }

  float sh = max(liftShadow(bp, uLiftA, uId), liftShadow(bp, uLiftB, uId));
  c *= 1.0 - 0.3 * sh;
  c *= vignette();
  gl_FragColor = vec4(c, 1.0);
}
`;

export const SIDE_FRAG = /* glsl */ `
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor * 0.55, 1.0); }
`;
export const SIDE_VERT = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
