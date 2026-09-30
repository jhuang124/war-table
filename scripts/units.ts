// Unit sprites → atlas (docs/INK.md A8). Run once after the source sprites change:
//   npx tsx scripts/units.ts
// Reads _claude/sprites/{soldier,rider,cannon}-1.png (the chosen sprites; kept out of public/ so the
// service worker never precaches them) (ivory dry-brush ink on transparent, 1024², ~2 MB),
// trims each to its ink, downscales it (longest side 256 px) into one 3-cell atlas and writes
// public/units/atlas.webp (~43 KB) and src/render/unitsAtlas.json (each sprite's rect in
// the atlas, its aspect and where its feet are). Uses the Playwright Chromium (already a dev dependency)
// as the image tool, so there is nothing new to install.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = ['soldier', 'rider', 'cannon'] as const;
const CELL = 256;
const PAD = 10;

const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage();
// tsx (esbuild keepNames) wraps local functions in __name(): give the page a no-op.
await page.addInitScript('window.__name = (f) => f');
await page.goto('about:blank');
const srcs = NAMES.map((n) => `data:image/png;base64,${readFileSync(`_claude/sprites/${n}-1.png`).toString('base64')}`);
const out = await page.evaluate(
  async ({ srcs, CELL, PAD }) => {
    const load = (s: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = s;
      });
    const atlas = document.createElement('canvas');
    atlas.width = CELL * srcs.length;
    atlas.height = CELL;
    const ax = atlas.getContext('2d')!;
    ax.imageSmoothingEnabled = true;
    ax.imageSmoothingQuality = 'high';
    const cells: { x: number; y: number; w: number; h: number; aspect: number; stats: Record<string, number> }[] = [];
    for (let k = 0; k < srcs.length; k++) {
      const im = await load(srcs[k]);
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const cx = c.getContext('2d')!;
      cx.drawImage(im, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width;
      let y0 = c.height;
      let x1 = 0;
      let y1 = 0;
      const stats = { ivory: 0, dark: 0, semi: 0 };
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const a = d[i + 3];
          if (a > 24) {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
          }
          if ((x & 3) === 0 && (y & 3) === 0) {
            if (a > 200) {
              if (d[i] > 170) stats.ivory++;
              else if (d[i] < 90) stats.dark++;
            } else if (a > 20) stats.semi++;
          }
        }
      const tw = x1 - x0 + 1;
      const th = y1 - y0 + 1;
      // longest side → CELL − 2·PAD; feet on the cell's bottom margin, centred
      const s = (CELL - 2 * PAD) / Math.max(tw, th);
      const w = Math.round(tw * s);
      const h = Math.round(th * s);
      const ox = k * CELL + Math.round((CELL - w) / 2);
      const oy = CELL - PAD - h;
      // Downscale in halving steps (a single 4× drawImage aliases the dry-brush streaks).
      let cur: HTMLCanvasElement = c;
      let sx = x0;
      let sy = y0;
      let sw = tw;
      let sh = th;
      while (sw / 2 > w * 1.01) {
        const n = document.createElement('canvas');
        n.width = Math.ceil(sw / 2);
        n.height = Math.ceil(sh / 2);
        const nx = n.getContext('2d')!;
        nx.imageSmoothingQuality = 'high';
        nx.drawImage(cur, sx, sy, sw, sh, 0, 0, n.width, n.height);
        cur = n;
        sx = 0;
        sy = 0;
        sw = n.width;
        sh = n.height;
      }
      ax.drawImage(cur, sx, sy, sw, sh, ox, oy, w, h);
      cells.push({ x: ox, y: oy, w, h, aspect: w / h, stats });
    }
    return { cells, webp: atlas.toDataURL('image/webp', 0.92), W: atlas.width, H: atlas.height };
  },
  { srcs, CELL, PAD },
);
await browser.close();
const b64 = (u: string) => Buffer.from(u.split(',')[1], 'base64');
writeFileSync('public/units/atlas.webp', b64(out.webp));
const meta = {
  width: out.W,
  height: out.H,
  sprites: Object.fromEntries(
    NAMES.map((n, i) => {
      const c = out.cells[i];
      return [n, { x: c.x, y: c.y, w: c.w, h: c.h, aspect: +c.aspect.toFixed(4) }];
    }),
  ),
};
writeFileSync('src/render/unitsAtlas.json', JSON.stringify(meta, null, 2) + '\n');
for (let i = 0; i < NAMES.length; i++) console.log(NAMES[i], out.cells[i]);
console.log('atlas.webp', b64(out.webp).length, 'bytes');
