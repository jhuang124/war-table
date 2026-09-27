# risk3d — Risk: War Table

3D pass-and-play Risk (Vite + TypeScript + Three.js). Read `docs/SPEC.md` first; the contracts are
`src/engine/types.ts`, `src/engine/mapData.ts`, `src/map/types.ts`, `src/render/BoardView.ts`,
`src/shared/palette.ts`.

## Commands
- `npm run dev` — dev server at http://127.0.0.1:5273
- `npm test` — vitest (engine)
- `npm run typecheck` — tsc
- `npm run build:map` / `npm run verify:map` — regenerate / check `src/map/board.json`
- `npm run sim` — AI-vs-AI soak
- `npm run build` — production build to `dist/`

## Rules for agents working here
- Stay inside the files your brief says you own. Need a change elsewhere? Put it under
  "Requests" in your final report instead of editing.
- Contract files: additive optional fields only, and say so in your report.
- Do NOT `npm install` (dependencies are preinstalled; parallel installs corrupt node_modules).
  If something is truly missing, report it.
- Do NOT `git commit`; the lead commits.
- Browser checks: Playwright from a node script with
  `chromium.launch({ args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] })`.
  Never agent-browser (shared daemon wedges with parallel agents) or the Browser pane.
- Run your own dev server on the port in your brief (`npx vite --port <p> --strictPort`, in the
  background) and kill it when you finish.
- Screenshots → `artifacts/<area>/`. Look at them with the Read tool before claiming a visual works.
- Engine code is pure: no DOM, no Date.now()/Math.random() for game logic (use `state.rng`).
