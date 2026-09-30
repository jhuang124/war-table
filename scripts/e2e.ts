// `npm run test:e2e [flow ...]`: builds the game once (VITE_E2E=1: a production bundle that keeps the test
// hooks, src/main.ts) into a temp dir, serves it, and runs the Playwright flows in tests/e2e/*.e2e.ts
// against the REAL renderer + REAL HUD, sorted by tests/e2e/lanes.ts:
//   1. the logic lane in parallel: E2E_CONCURRENCY workers (default min(5, cpus − 2)), one shared Chromium
//      per worker and a fresh context per open(), at instant speed unless lanes.ts marks the flow realtime;
//   2. then the timing lane, one flow at a time on the quiet machine, at real speed, a fresh Chromium per
//      open().
// `npm run test:e2e:quick` (or --quick) runs the quick tier; named flows run in their own lanes.
//   --serial   the logic lane one flow at a time too (debugging)
//   --dev      the Vite dev server (RISK_E2E=1, no HMR) instead of the build
// E2E_PORT pins the server port (default: any free port, so parallel checkouts never collide). A hung flow
// is killed and marked failed after 180 s (logic) / 300 s (timing); E2E_FLOW_TIMEOUT=<s> overrides. Logs:
// artifacts/e2e/<flow>.log and artifacts/e2e/summary.txt. Exit code 1 if any flow fails.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { cpus, tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium, type BrowserServer } from 'playwright';
import { FLOWS, QUICK, laneOf, speedOf, type Lane } from '../tests/e2e/lanes';

const LOGS = 'artifacts/e2e';
const TIMINGS = `${LOGS}/timings.json`;
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']; // = lib.ts GPU_ARGS
const BIN = (name: string) => resolve('node_modules/.bin', name);
/** A flow still running after this is killed and marked failed (E2E_FLOW_TIMEOUT=<s> overrides both). */
const FLOW_TIMEOUT_S: Record<Lane, number> = {
  logic: Number(process.env.E2E_FLOW_TIMEOUT ?? 180),
  timing: Number(process.env.E2E_FLOW_TIMEOUT ?? 300),
};
mkdirSync(LOGS, { recursive: true });

// --- What to run -------------------------------------------------------------------------------------
const die = (msg: string): never => {
  console.error(msg);
  process.exit(2);
};
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
for (const f of flags) if (!['--quick', '--serial', '--dev'].includes(f)) die(`unknown flag ${f} (--quick, --serial, --dev)`);
const named = args.filter((a) => !a.startsWith('--'));
const all = readdirSync('tests/e2e')
  .filter((f) => f.endsWith('.e2e.ts'))
  .map((f) => f.replace(/\.e2e\.ts$/, ''));
for (const f of all) if (!FLOWS[f]) console.log(`note: ${f} is not in tests/e2e/lanes.ts, so it runs in the timing lane`);
const wanted = named.length ? named : flags.has('--quick') ? QUICK : all;
for (const f of wanted) if (!all.includes(f)) die(`no such flow: tests/e2e/${f}.e2e.ts`);

// The logic lane longest-first (last run's times, else lanes.ts order) so the pool packs well; the timing
// lane in lanes.ts order.
const last: Record<string, number> = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, 'utf8')) : {};
const declared = (f: string) => {
  const i = Object.keys(FLOWS).indexOf(f);
  return i < 0 ? 999 : i;
};
const logic = wanted.filter((f) => laneOf(f) === 'logic').sort((a, b) => (last[b] ?? 0) - (last[a] ?? 0) || declared(a) - declared(b));
const timing = wanted.filter((f) => laneOf(f) === 'timing').sort((a, b) => declared(a) - declared(b));
const workers = flags.has('--serial') ? 1 : Math.max(1, Math.floor(Number(process.env.E2E_CONCURRENCY ?? Math.min(5, cpus().length - 2))) || 1);

// --- Cleanup (servers, browsers, running flows, the build) -----------------------------------------------
const cleanups: (() => void | Promise<void>)[] = [];
const running = new Set<ChildProcess>();
const killGroup = (p: ChildProcess, sig: NodeJS.Signals = 'SIGTERM') => {
  try {
    if (p.pid) process.kill(-p.pid, sig);
  } catch {
    /* already gone */
  }
};
let stopping = false;
/** Kill the running flows, then close everything at once (a stuck close can't keep the rest open). */
async function cleanup(): Promise<void> {
  for (const p of running) killGroup(p, 'SIGKILL');
  const all = cleanups.splice(0).map((c) => Promise.resolve().then(c).catch(() => undefined));
  await Promise.race([Promise.all(all), new Promise((r) => setTimeout(r, 5000))]);
}
const onSignal = (code: number) => () => {
  if (stopping) return;
  stopping = true;
  void cleanup().then(() => process.exit(code));
};
process.on('SIGINT', onSignal(130));
process.on('SIGTERM', onSignal(143));

// --- The server ----------------------------------------------------------------------------------------
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** `vite build` with the test hooks kept, into a temp dir. */
function build(): string {
  const out = mkdtempSync(join(tmpdir(), 'risk3d-e2e-'));
  cleanups.push(() => rmSync(out, { recursive: true, force: true }));
  const b = spawnSync(BIN('vite'), ['build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], {
    encoding: 'utf8',
    env: { ...process.env, VITE_E2E: '1' },
  });
  if (b.status !== 0) throw new Error(`vite build failed:\n${b.stdout}${b.stderr}`);
  return out;
}

/** A static server for the build, in this process (it goes when the runner goes). */
async function serveBuild(root: string, port: number): Promise<string> {
  const files = new Map<string, Buffer>();
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const rel = normalize(path.endsWith('/') ? `${path}index.html` : path).replace(/^[/\\]+/, '');
    const file = join(root, rel);
    if (!file.startsWith(root + sep)) return void res.writeHead(403).end();
    let body = files.get(file);
    if (!body) {
      if (!existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end();
      body = readFileSync(file);
      files.set(file, body);
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok());
  });
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createTcpServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    });
  });
}

/** --dev: the Vite dev server, as the suite used before the build (no HMR, no file watching). */
async function serveDev(port: number): Promise<string> {
  const url = `http://127.0.0.1:${port}/`;
  if (await up(url)) throw new Error(`Port ${port} is already serving something; stop it or set E2E_PORT.`);
  const server = spawn(BIN('vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, RISK_E2E: '1' },
  });
  cleanups.push(() => killGroup(server));
  let log = '';
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  const t0 = performance.now();
  while (!(await up(url))) {
    if (performance.now() - t0 > 30_000) throw new Error('Vite did not start:\n' + log);
    await new Promise((r) => setTimeout(r, 200));
  }
  // Warm the module graph once so the first flow doesn't pay Vite's cold transform.
  await fetch(url + 'src/main.ts').catch(() => undefined);
  return url;
}

// --- Running flows -------------------------------------------------------------------------------------
interface Result {
  flow: string;
  lane: Lane;
  ok: boolean;
  secs: number;
  last: string;
  out: string;
}

function runFlow(flow: string, url: string, ws: string | null): Promise<Result> {
  const lane = laneOf(flow);
  const t = performance.now();
  return new Promise((done) => {
    const env: NodeJS.ProcessEnv = { ...process.env, RISK_URL: url, E2E_LANE: lane, E2E_SPEED: speedOf(flow) };
    if (ws) env.E2E_WS = ws;
    else delete env.E2E_WS;
    const p = spawn(BIN('tsx'), [`tests/e2e/${flow}.e2e.ts`], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    running.add(p);
    let out = '';
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (out += d));
    let timedOut = false;
    let settled = false;
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(p);
      writeFileSync(`${LOGS}/${flow}.log`, out);
      const secs = Math.round((performance.now() - t) / 1000);
      done({ flow, lane, ok: code === 0 && !timedOut, secs, last: out.trim().split('\n').pop() ?? '', out });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      out += `\nFAIL timed out: the e2e runner killed the flow after ${FLOW_TIMEOUT_S[lane]} s (${lane} lane limit)\n`;
      killGroup(p, 'SIGKILL');
      // A process wedged in the kernel can take its time to die; don't let it hold the lane.
      setTimeout(() => settle(null), 5000).unref();
    }, FLOW_TIMEOUT_S[lane] * 1000);
    p.on('close', settle);
  });
}

function report(r: Result): void {
  const tag = `${r.ok ? 'ok  ' : 'FAIL'} ${r.flow.padEnd(14)} ${String(r.secs).padStart(4)} s  [${r.lane}${speedOf(r.flow) === 'instant' ? ', instant' : ''}]`;
  console.log(`${tag}  ${r.last}`);
  if (!r.ok) for (const l of r.out.split('\n').filter((l) => /^FAIL|Error|error/.test(l)).slice(0, 12)) console.log('       ' + l);
}

/** A worker pool over `flows`; each worker keeps one Chromium (a browser server) for all its flows. */
async function pool(flows: string[], n: number, url: string): Promise<Result[]> {
  const queue = [...flows];
  const results: Result[] = [];
  const worker = async () => {
    let browser: BrowserServer | null = null;
    try {
      for (let f = queue.shift(); f && !stopping; f = queue.shift()) {
        if (!browser) {
          const b = await chromium.launchServer({ args: GPU_ARGS });
          cleanups.push(() => b.close());
          browser = b;
        }
        const r = await runFlow(f, url, browser.wsEndpoint());
        if (stopping) break;
        report(r);
        results.push(r);
      }
    } finally {
      await browser?.close().catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, flows.length) }, worker));
  return results;
}

async function serial(flows: string[], url: string): Promise<Result[]> {
  const results: Result[] = [];
  for (const f of flows) {
    if (stopping) break;
    const r = await runFlow(f, url, null);
    if (stopping) break;
    report(r);
    results.push(r);
  }
  return results;
}

// --- Main ----------------------------------------------------------------------------------------------
async function main(): Promise<number> {
  const t0 = performance.now();
  const secs = (from: number) => Math.round((performance.now() - from) / 1000);
  let url: string;
  let buildSecs = 0;
  if (flags.has('--dev')) {
    url = await serveDev(process.env.E2E_PORT ? Number(process.env.E2E_PORT) : await freePort());
    console.log(`dev server ${url} (RISK_E2E=1)`);
  } else {
    const tb = performance.now();
    const out = build();
    buildSecs = secs(tb);
    url = await serveBuild(out, Number(process.env.E2E_PORT ?? 0));
    console.log(`e2e build in ${buildSecs} s, served at ${url}`);
  }

  const tl = performance.now();
  let results: Result[] = [];
  if (logic.length) {
    console.log(`\nlogic lane: ${logic.length} flow(s), ${Math.min(workers, logic.length)} at a time`);
    results = results.concat(await pool(logic, workers, url));
  }
  const logicSecs = secs(tl);
  const tt = performance.now();
  if (timing.length && !stopping) {
    console.log(`\ntiming lane: ${timing.length} flow(s), one at a time`);
    results = results.concat(await serial(timing, url));
  }
  const timingSecs = secs(tt);
  const total = secs(t0);

  const failed = results.filter((r) => !r.ok);
  const lanes = `${flags.has('--dev') ? 'dev server' : `build ${buildSecs} s`} · logic lane ${logicSecs} s (${logic.length} flows, ${Math.min(workers, logic.length || 1)} workers) · timing lane ${timingSecs} s (${timing.length} flows) · total ${total} s`;
  writeFileSync(
    `${LOGS}/summary.txt`,
    results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.flow} (${r.lane}, ${r.secs} s) ${r.last}`).join('\n') + `\n\n${lanes}\n`,
  );
  writeFileSync(TIMINGS, JSON.stringify({ ...last, ...Object.fromEntries(results.map((r) => [r.flow, r.secs])) }, null, 2) + '\n');
  console.log(`\n${results.length - failed.length}/${results.length} flows passed (logs in ${LOGS}/)${failed.length ? ` · failed: ${failed.map((r) => r.flow).join(', ')}` : ''}`);
  console.log(lanes);
  return failed.length ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}
process.exit(code);
