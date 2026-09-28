// `npm run test:e2e [flow ...]`: starts its own Vite dev server on :5290, runs every Playwright flow in
// tests/e2e/*.e2e.ts (or just the named ones) against the REAL renderer + REAL HUD, one at a time,
// then stops the server. Logs go to artifacts/e2e/<flow>.log. Exit code 1 if any flow fails.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const PORT = Number(process.env.E2E_PORT ?? 5290);
const URL = `http://127.0.0.1:${PORT}/`;
const LOGS = 'artifacts/e2e';
mkdirSync(LOGS, { recursive: true });

// Fast, focused flows first; the long soak last.
const ORDER = ['smoke', 'reasons', 'budgets', 'flow', 'track', 'keys', 'feel', 'hotseat', 'handoff', 'setup', 'game', 'endgame', 'round', 'autoplay'];
const all = readdirSync('tests/e2e')
  .filter((f) => f.endsWith('.e2e.ts'))
  .map((f) => f.replace(/\.e2e\.ts$/, ''));
const wanted = process.argv.slice(2);
const flows = (wanted.length ? wanted : all).sort((a, b) => {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});
for (const f of flows) if (!all.includes(f)) throw new Error(`no such flow: tests/e2e/${f}.e2e.ts`);

async function up(): Promise<boolean> {
  try {
    const r = await fetch(URL);
    return r.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  if (await up()) {
    console.error(`Port ${PORT} is already serving something; stop it or set E2E_PORT.`);
    return 1;
  }
  const server: ChildProcess = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, RISK_E2E: '1' },
  });
  let serverLog = '';
  server.stdout?.on('data', (d) => (serverLog += d));
  server.stderr?.on('data', (d) => (serverLog += d));
  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.on('SIGINT', () => (stop(), process.exit(130)));
  try {
    const t0 = performance.now();
    while (!(await up())) {
      if (performance.now() - t0 > 30_000) {
        console.error('Vite did not start:\n' + serverLog);
        return 1;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    // Warm the module graph once so the first flow doesn't pay Vite's cold transform.
    await fetch(URL + 'src/main.ts').catch(() => undefined);

    let failed = 0;
    const summary: string[] = [];
    for (const f of flows) {
      const t = performance.now();
      process.stdout.write(`== ${f} … `);
      const r = spawnSync('npx', ['tsx', `tests/e2e/${f}.e2e.ts`], {
        env: { ...process.env, RISK_URL: URL },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15 * 60_000,
      });
      const out = (r.stdout ?? '') + (r.stderr ?? '');
      writeFileSync(`${LOGS}/${f}.log`, out);
      const secs = ((performance.now() - t) / 1000).toFixed(0);
      const last = out.trim().split('\n').pop() ?? '';
      if (r.status === 0) {
        console.log(`ok (${secs} s) ${last}`);
        summary.push(`PASS ${f} (${secs} s) ${last}`);
      } else {
        failed++;
        console.log(`FAILED (${secs} s)`);
        for (const l of out.split('\n').filter((l) => /^FAIL|Error|error/.test(l)).slice(0, 12)) console.log('   ' + l);
        console.log('   ' + last);
        summary.push(`FAIL ${f} (${secs} s) ${last}`);
      }
    }
    writeFileSync(`${LOGS}/summary.txt`, summary.join('\n') + '\n');
    console.log(`\n${flows.length - failed}/${flows.length} flows passed (logs in ${LOGS}/)`);
    return failed ? 1 : 0;
  } finally {
    stop();
  }
}

process.exit(await main());
