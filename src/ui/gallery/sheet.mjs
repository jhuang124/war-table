// Contact sheet: stitch PNGs from a folder into one image (for reviewing many crops at once).
//   node src/ui/gallery/sheet.mjs <dir> <out.png> [cols] [id,id,...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [dir, out, colsArg, only] = process.argv.slice(2);
const cols = Number(colsArg ?? 1);
let files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
if (only) files = only.split(',').map((id) => `${id}.png`).filter((f) => files.includes(f));
const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}"><figcaption>${f}</figcaption></figure>`).join('');
const html = `<html><body style="margin:0;background:#222;color:#ccc;font:12px sans-serif"><div style="display:grid;grid-template-columns:repeat(${cols},max-content);gap:6px;padding:6px">${imgs}</div><style>figure{margin:0}img{display:block}</style></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 300 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out, files.length);
