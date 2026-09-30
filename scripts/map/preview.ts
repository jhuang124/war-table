// SVG preview of the board (continent colours with per-territory tints, badge circles, names, lanes,
// labels) + Playwright screenshots into artifacts/map/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTINENTS, TERRITORIES, TERRITORY_IDS } from '../../src/engine/mapData';
import type { ContinentId } from '../../src/engine/types';
import type { BoardGeometry, PolygonGeom } from '../../src/map/types';

const CONT_COLORS: Record<ContinentId, [number, number, number]> = {
  north_america: [38, 62, 58],
  south_america: [8, 55, 52],
  europe: [215, 45, 55],
  africa: [28, 55, 45],
  asia: [110, 32, 45],
  australia: [285, 30, 55],
};

function hsl([h, s, l]: [number, number, number]) {
  return `hsl(${h} ${s}% ${l}%)`;
}

function pathOf(pg: PolygonGeom, H: number): string {
  const ring = (r: [number, number][]) =>
    'M' + r.map(([x, y]) => `${x.toFixed(3)},${(H - y).toFixed(3)}`).join('L') + 'Z';
  return ring(pg.outer) + pg.holes.map(ring).join('');
}

export function boardSvg(b: BoardGeometry, opts: { viewBox?: [number, number, number, number]; pxWidth: number; minClear: number }) {
  const H = b.height;
  const vb = opts.viewBox ?? [0, 0, b.width, b.height];
  const pxH = Math.round((opts.pxWidth * vb[3]) / vb[2]);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.pxWidth}" height="${pxH}" viewBox="${vb.join(' ')}" ` +
      `font-family="Georgia, 'Times New Roman', serif">`,
  );
  parts.push(`<rect x="-5" y="-5" width="${b.width + 10}" height="${b.height + 10}" fill="#0d2a33"/>`);
  parts.push(`<rect x="0" y="0" width="${b.width}" height="${b.height}" fill="#123a45" stroke="#b08d4a" stroke-width="0.12"/>`);
  // graticule every 10 units
  for (let x = 10; x < b.width; x += 10) parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#1d4d5a" stroke-width="0.04"/>`);
  for (let y = 10; y < H; y += 10) parts.push(`<line x1="0" y1="${H - y}" x2="${b.width}" y2="${H - y}" stroke="#1d4d5a" stroke-width="0.04"/>`);
  for (const pg of b.decorativeLand) parts.push(`<path d="${pathOf(pg, H)}" fill="#6f6a58" stroke="#4d493c" stroke-width="0.05" fill-rule="evenodd"/>`);
  // territories
  const contIndex = new Map<string, number>();
  for (const t of TERRITORY_IDS) {
    const c = TERRITORIES[t].continent;
    const k = contIndex.get(c) ?? 0;
    contIndex.set(c, k + 1);
    const [h, s, l] = CONT_COLORS[c];
    const tint: [number, number, number] = [h + ((k * 7) % 5) * 3 - 6, s, l + ((k % 4) - 1.5) * 5];
    const tg = b.territories[t];
    for (const pg of tg.polygons)
      parts.push(`<path d="${pathOf(pg, H)}" fill="${hsl(tint)}" stroke="#1b1b1b" stroke-width="0.07" stroke-linejoin="round" fill-rule="evenodd"/>`);
  }
  // lanes
  for (const lane of b.seaLanes)
    for (const seg of lane.segments)
      parts.push(
        `<polyline points="${seg.map(([x, y]) => `${x},${H - y}`).join(' ')}" fill="none" stroke="#f3e7c6" stroke-width="0.12" stroke-dasharray="0.35 0.25" stroke-linecap="round" opacity="0.9"/>`,
      );
  // anchors (badge circle at the required clearance)
  for (const t of TERRITORY_IDS) {
    const tg = b.territories[t];
    const [x, y] = tg.anchor;
    parts.push(`<circle cx="${x}" cy="${H - y}" r="${opts.minClear}" fill="none" stroke="#fff8" stroke-width="0.06" stroke-dasharray="0.2 0.12"/>`);
    parts.push(`<circle cx="${x}" cy="${H - y}" r="0.62" fill="#12151a" stroke="#f0e6cc" stroke-width="0.12"/>`);
    parts.push(`<text x="${x}" y="${H - y + 0.24}" font-size="0.66" font-family="Helvetica, Arial" font-weight="700" fill="#f4ecd8" text-anchor="middle">3</text>`);
    const [lx, ly] = tg.labelAnchor;
    parts.push(
      `<text x="${lx}" y="${H - ly + 0.2}" font-size="0.55" fill="#161310" text-anchor="middle" font-weight="600" letter-spacing="0.02">${TERRITORIES[t].name.toUpperCase()}</text>`,
    );
  }
  // continent + ocean labels
  for (const c of Object.keys(b.continents) as ContinentId[]) {
    const cg = b.continents[c];
    const [x, y] = cg.labelAnchor;
    if (cg.labelRoom) parts.push(`<rect x="${x - cg.labelRoom / 2}" y="${H - y - 0.65}" width="${cg.labelRoom}" height="1.3" fill="#ffffff08" stroke="#ffffff22" stroke-width="0.04"/>`);
    parts.push(
      `<text x="${x}" y="${H - y + 0.4}" font-size="1.1" fill="${hsl(CONT_COLORS[c])}" text-anchor="middle" letter-spacing="0.12" font-weight="700"${cg.labelRoom ? ` textLength="${Math.min(cg.labelRoom, 0.78 * (CONTINENTS[c].name.length + 5))}" lengthAdjust="spacingAndGlyphs"` : ''}>${CONTINENTS[c].name.toUpperCase()} · +${CONTINENTS[c].bonus}</text>`,
    );
  }
  for (const o of b.oceanLabels)
    parts.push(
      `<text x="${o.at[0]}" y="${H - o.at[1] + o.size * 0.35}" font-size="${o.size}" fill="#7fa6ad" font-style="italic" text-anchor="middle" letter-spacing="0.2">${o.text}</text>`,
    );
  parts.push('</svg>');
  return parts.join('\n');
}

export async function renderPreviews(b: BoardGeometry, outDir: string, minClear: number) {
  mkdirSync(outDir, { recursive: true });
  const shots: { name: string; viewBox?: [number, number, number, number]; px: number }[] = [
    { name: 'preview', px: 2400 },
  ];
  // Close-ups: find territory bboxes and frame them.
  const frame = (ids: string[], pad: number): [number, number, number, number] => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const bb = b.territories[id as keyof typeof b.territories].bbox;
      x0 = Math.min(x0, bb[0]);
      y0 = Math.min(y0, bb[1]);
      x1 = Math.max(x1, bb[2]);
      y1 = Math.max(y1, bb[3]);
    }
    x0 -= pad;
    x1 += pad;
    y0 -= pad;
    y1 += pad;
    // SVG viewBox is y-down
    return [x0, b.height - y1, x1 - x0, y1 - y0];
  };
  shots.push({ name: 'preview-europe', viewBox: frame(['iceland', 'great_britain', 'western_europe', 'southern_europe', 'scandinavia', 'northern_europe'], 2), px: 1600 });
  shots.push({ name: 'preview-seasia', viewBox: frame(['siam', 'indonesia', 'new_guinea', 'japan', 'india'], 1.5), px: 1600 });
  shots.push({ name: 'preview-americas', viewBox: frame(['western_us', 'eastern_us', 'central_america', 'venezuela', 'quebec'], 1.5), px: 1600 });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const s of shots) {
      const svg = boardSvg(b, { viewBox: s.viewBox, pxWidth: s.px, minClear });
      writeFileSync(resolve(outDir, `${s.name}.svg`), svg);
      const m = /height="(\d+)"/.exec(svg)!;
      await page.setViewportSize({ width: s.px, height: Number(m[1]) });
      await page.setContent(`<html><body style="margin:0;background:#0d2a33">${svg}</body></html>`);
      await page.screenshot({ path: resolve(outDir, `${s.name}.png`) });
    }
  } finally {
    await browser.close();
  }
  return shots.map((s) => resolve(outDir, `${s.name}.png`));
}
