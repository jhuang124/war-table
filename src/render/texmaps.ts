// The pigment maps (docs/INK2.md §4): real paper and wash textures, packed by scripts/textures.ts into
// public/tex/ and described by texmaps.json (channel layout, stats, thresholds; the manifest is
// authoritative over INK2 §4.1's table).
//
// Everything here is data, not colour: loaded with premultiplyAlpha off, NoColorSpace (no sRGB decode) and
// no browser colour conversion, so a texel's byte is the value the pack script measured. The alpha planes
// are masks (background 128, "set" 255), not equalised noise.
//
// - `loadTexmap(name, size)`: one GPU texture by map name, cached (Phase A's `tip` / `smoke` use this).
// - `loadStreaks(size)`: the dry-brush streak map as CPU bytes (the coasts are drawn on a canvas at boot).
// - `loadTexMaps(renderer, { small })`: the board's paper + wash set for the device; null on any failure.
//
// Textures are uploaded with flipY off: v = 0 is the image's top row (tip: u = x left → right along the
// stroke, v = y across it).
import * as THREE from 'three';
import manifest from './texmaps.json';

export type TexmapName = 'paper' | 'wash' | 'streaks' | 'tip' | 'smoke';

interface ChannelInfo {
  name: string;
  mean: number;
  std: number;
  threshold?: number;
  mask?: boolean;
}
interface FileInfo {
  file: string;
  set: string;
  w: number;
  h: number;
  bytes: number;
  channels: Record<string, ChannelInfo>;
}
interface MapInfo {
  tile: 'xy' | 'x' | 'none';
  files: FileInfo[];
}

const MAPS = (manifest as unknown as { maps: Record<TexmapName, MapInfo> }).maps;

/** The manifest's entry for a map at a size (the width; `tip`/`smoke` have one size, 512). */
export function texmapFile(name: TexmapName, size?: number): FileInfo | null {
  const m = MAPS[name];
  if (!m) return null;
  if (size == null) return m.files[0] ?? null;
  return m.files.find((f) => f.w === size) ?? null;
}

const base = (): string => ((import.meta.env?.BASE_URL as string | undefined) ?? './');

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(file: string): Promise<HTMLImageElement> {
  let p = imgCache.get(file);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        // decode() off the main thread where the browser can; the upload then doesn't stall a frame on it
        const done = () => resolve(img);
        if (typeof img.decode === 'function') img.decode().then(done, done);
        else done();
      };
      img.onerror = () => reject(new Error(`[texmaps] ${file} failed to load`));
      img.src = `${base()}${file}`;
    });
    // a failed load may be retried later (e.g. offline for a moment)
    p.catch(() => imgCache.delete(file));
    imgCache.set(file, p);
  }
  return p;
}

const texCache = new Map<string, Promise<THREE.Texture | null>>();

/**
 * One map as a GPU texture: data (NoColorSpace, no premultiply, no colour conversion), mipmapped,
 * RepeatWrapping on the axes the map tiles on (`streaks`: x only; `tip`: clamped), flipY off. Cached per
 * name and size, so every caller shares one texture. Resolves null if the file is missing or fails.
 */
export function loadTexmap(name: TexmapName, size?: number): Promise<THREE.Texture | null> {
  const info = texmapFile(name, size);
  if (!info) return Promise.resolve(null);
  const key = info.file;
  let p = texCache.get(key);
  if (!p) {
    const tile = MAPS[name].tile;
    p = loadImage(info.file).then(
      (img) => {
        const t = new THREE.Texture(img);
        t.name = `tex:${name}-${info.w}`;
        t.colorSpace = THREE.NoColorSpace;
        t.premultiplyAlpha = false;
        t.flipY = false;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = tile === 'none' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        t.wrapT = tile === 'xy' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        t.needsUpdate = true;
        return t;
      },
      (err) => {
        console.warn(String(err));
        texCache.delete(key);
        return null;
      },
    );
    texCache.set(key, p);
  }
  return p;
}

/** The streak map on the CPU: R = bristle ink density (one row per bristle, x along the stroke), G = swell. */
export interface StreakData {
  w: number;
  h: number;
  /** RGBA bytes, row 0 = the image's top row. */
  data: Uint8ClampedArray;
  /** `on` = R > threshold at the source's 50 % ink level (0..1), from the manifest. */
  threshold: number;
}

const streakCache = new Map<number, Promise<StreakData | null>>();

/** The dry-brush streaks (2048×256 desktop, 1024×128 phone) decoded to bytes. Null on any failure. */
export function loadStreaks(size: 2048 | 1024): Promise<StreakData | null> {
  let p = streakCache.get(size);
  if (!p) {
    const info = texmapFile('streaks', size);
    p = !info
      ? Promise.resolve(null)
      : loadImage(info.file).then(
          (img) => {
            const c = document.createElement('canvas');
            c.width = info.w;
            c.height = info.h;
            const ctx = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' } as CanvasRenderingContext2DSettings);
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0, info.w, info.h);
            const data = ctx.getImageData(0, 0, info.w, info.h).data;
            c.width = c.height = 1;
            return { w: info.w, h: info.h, data, threshold: info.channels.R?.threshold ?? 0.45 };
          },
          (err) => {
            console.warn(String(err));
            streakCache.delete(size);
            return null;
          },
        );
    streakCache.set(size, p);
  }
  return p;
}

/** The board's paper and wash maps for the device (docs/INK2.md §4.2). */
export interface TexMaps {
  paper: THREE.Texture;
  wash: THREE.Texture;
  /** Map width (1024 desktop, 512 phone). */
  size: number;
  /** Bytes on the GPU including mips (RGBA8). */
  vramBytes: number;
}

/**
 * Load the paper + wash set: 512 on phone GPUs (`small`), 1024 otherwise; anisotropy 4 desktop / 1 phone.
 * With a renderer, the textures are uploaded as soon as they decode (not on the next frame that draws
 * them). Resolves null on any failure: the board then keeps its procedural look (the fallback ladder's L0).
 */
export async function loadTexMaps(renderer: THREE.WebGLRenderer | null, opt: { small: boolean }): Promise<TexMaps | null> {
  const size = opt.small ? 512 : 1024;
  try {
    const [paper, wash] = await Promise.all([loadTexmap('paper', size), loadTexmap('wash', size)]);
    if (!paper || !wash) return null;
    const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    for (const t of [paper, wash]) {
      t.anisotropy = Math.min(opt.small ? 1 : 4, Math.max(1, maxAniso));
      if (renderer) {
        try {
          renderer.initTexture(t);
        } catch {
          /* uploads on first use instead */
        }
      }
    }
    return { paper, wash, size, vramBytes: Math.round(2 * size * size * 4 * (4 / 3)) };
  } catch (err) {
    console.warn('[texmaps]', err);
    return null;
  }
}
