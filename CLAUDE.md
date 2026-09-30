# risk3d — Risk: War Table

Read SOUL.md first, and run its "Before you plan" checklist before you plan, delegate, or call a build done. On intent and feel it outranks every spec and the code: when they disagree, change the build or raise it with John, never the soul.

3D pass-and-play Risk (Vite + TypeScript + Three.js). Read `docs/SPEC.md` first; the contracts are
`src/engine/types.ts`, `src/engine/mapData.ts`, `src/map/types.ts`, `src/render/BoardView.ts`,
`src/shared/palette.ts`.

## Commands
- `npm run dev` — dev server at http://127.0.0.1:5273
- `npm test` — vitest (engine, controller, pure helpers)
- `npm run test:e2e:quick` — the quick tier (smoke, a full human turn, setup, resume; about a minute).
- `npm run test:e2e [flow ...]` — every Playwright flow in `tests/e2e/` (or just the named ones) on the
  real board + HUD: builds the game with its test hooks (`VITE_E2E=1`), serves it on a free port, runs
  the logic lane in parallel at instant speed, then the timing lane one flow at a time at real speed
  (lanes in `tests/e2e/lanes.ts`; logs and `summary.txt` in `artifacts/e2e/`). `--serial` runs one flow
  at a time, `--dev` uses the Vite dev server instead of the build; `E2E_CONCURRENCY` / `E2E_PORT`
  override. Tools, not in the suite: `tests/e2e/screens.ts` (screenshot sweep), `tests/e2e/perf.ts`
  (frame times); both need a server on `RISK_URL`.
- `npm run typecheck` — tsc
- `npm run build:map` / `npm run verify:map` — regenerate / check `src/map/board.json`
- `npm run sim [games]` — AI-vs-AI soak + rounds-to-threshold table (paste into `src/game/presets.ts`)
- `npm run build` — production build to `dist/`

## Test tiers
- Iterate with `npm run test:e2e:quick`; run the full `npm run test:e2e` at integration and when you
  verify a build. Both leave the machine quiet for the timing lane, so don't run two suites at once.
- A new flow goes in `tests/e2e/lanes.ts`. `logic` (parallel, instant speed) is for anything that doesn't
  assert on wall-clock time; `timing` (serial, real speed) is for ms / fps / tempo budgets. A logic flow
  that needs one real animation calls `realtime(page)` from `tests/e2e/lib.ts`. Unlisted flows run as timing.
- A flow run by hand (`npx tsx tests/e2e/<flow>.e2e.ts`, server on `RISK_URL`) runs at its lane's speed;
  `E2E_SPEED=real` watches a logic flow at 1×.

## Rules for agents working here
- Stay inside the files your brief says you own. Need a change elsewhere? Put it under
  "Requests" in your final report instead of editing.
- Contract files: additive optional fields only, and say so in your report.
- Do NOT `npm install` (dependencies are preinstalled; parallel installs corrupt node_modules).
  If something is truly missing, report it.
- Do NOT `git commit`; the lead commits.
- Browser checks: Playwright from a node script with
  `chromium.launch({ args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio'] })` (always mute: the score is on by default and headless browsers play through John's speakers).
  Never agent-browser (shared daemon wedges with parallel agents) or the Browser pane.
- Run your own dev server on the port in your brief (`npx vite --port <p> --strictPort`, in the
  background) and kill it when you finish.
- Screenshots → `artifacts/<area>/`. Look at them with the Read tool before claiming a visual works.
- Engine code is pure: no DOM, no Date.now()/Math.random() for game logic (use `state.rng`).
