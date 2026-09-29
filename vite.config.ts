import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Dev: `npm run dev` on http://127.0.0.1:5273
// `npm run test:e2e` builds with VITE_E2E=1 (src/main.ts keeps the test hooks in that bundle, no service
// worker) and serves the build. Its --dev mode starts a dev server with RISK_E2E=1: no HMR and no file
// watching, so editing a file mid-run can't reload the page under a running flow.
const e2e = !!process.env.RISK_E2E;

/**
 * The offline service worker (public/sw.js, docs/MOBILE.md §2): after the build, stamp dist/sw.js with
 * this build's version (a hash of every output file) and its precache list (every file, relative to
 * the site root so it works under the Pages subpath). A new deploy = a new version = a new cache.
 */
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'war-table-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split(sep).join('/'));
        }
      };
      walk(outDir);
      // Font subsets for other scripts (and the .woff fallbacks) load only if a page needs them; they're
      // cached on first use instead of downloaded up front.
      const lazyFont = (f: string) => /\.woff$/.test(f) || /-(cyrillic|greek|vietnamese)(-ext)?-|latin-ext/.test(f);
      const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('.') && !lazyFont(f)).sort();
      const hash = createHash('sha256');
      for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace("const VERSION = 'dev';", `const VERSION = '${version}';`)
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(precache.map((f) => `./${f}`))};`);
      writeFileSync(swPath, sw);
      this.info?.(`sw.js ${version}: ${precache.length} files precached`);
    },
  };
}

export default defineConfig({
  // Relative asset paths: the same build works at / locally and at /war-table/ on GitHub Pages.
  base: './',
  plugins: [serviceWorkerManifest()],
  server: { host: '127.0.0.1', port: 5273, ...(e2e ? { hmr: false, watch: null } : {}) },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
