export const meta = {
  name: 'risk3d-build',
  description: 'Risk: War Table build — renderer, controller, UI in parallel against the contracts + UX spec, then integrate and verify',
  phases: [
    { title: 'Build', detail: '3D renderer, controller, HTML UI in parallel' },
    { title: 'Integrate', detail: 'wire everything, e2e + feel budgets, fix seams' },
  ],
}

const ROOT = '/Users/jhuang/Desktop/JH-Projects/risk3d'

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you built, 5-15 lines' },
    files: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string', description: 'Exactly what you ran / looked at, and the results (test counts, fps numbers, screenshots viewed)' },
    knownIssues: { type: 'array', items: { type: 'string' } },
    requests: { type: 'array', items: { type: 'string' }, description: 'Changes needed in files you do not own' },
    apiNotes: { type: 'string', description: 'Public API other modules must know (exports, signatures, gotchas)' },
  },
  required: ['summary', 'files', 'verification', 'knownIssues', 'requests', 'apiNotes'],
}

const fmt = (name, r) => r
  ? `### ${name} report\nSummary: ${r.summary}\nAPI notes: ${r.apiNotes}\nKnown issues: ${(r.knownIssues || []).join(' | ') || 'none'}\nRequests: ${(r.requests || []).join(' | ') || 'none'}`
  : `### ${name}: no report available — read the code yourself.`

const FOUNDATIONS = `The engine and map are finished and audio is nearly done. Read ${ROOT}/docs/reports/foundations.md FIRST: the engine, map and audio builders' reports (public APIs, gotchas, sim numbers) plus the lead's notes at the bottom, which override anything above them. Then read the code you depend on.`

const PREAMBLE = `You are one builder in a small fleet making "Risk: War Table", a polished 3D pass-and-play Risk board game for John and up to 3 friends on one computer (laptop or TV). Project root: ${ROOT} (Vite + TypeScript + Three.js, deps preinstalled).
FIRST read ${ROOT}/CLAUDE.md, ${ROOT}/docs/SPEC.md, ${ROOT}/docs/UX.md (the feel spec: click-by-click flow, timing table, camera rules, exact copy, polish checklist, reviewer rubric), and every contract file SPEC lists (src/engine/types.ts, src/engine/mapData.ts, src/map/types.ts, src/render/BoardView.ts, src/shared/palette.ts, src/game/viewModel.ts). SPEC says what; UX.md says how it feels; SPEC wins on conflict (flag it). UX.md tags sections [render] [ui] [ctrl] [audio] — every item tagged with your area is in scope unless marked "Later".
Fleet rules (CLAUDE.md): edit only files you own; contract files additive-only (report any addition); no npm install; no git commit; Playwright from node scripts (Metal flags) for browser checks, never agent-browser or the Browser pane; run your own dev server on your assigned port and kill it when done; LOOK at every screenshot you take with the Read tool.
Quality bar: this ships to people tonight and an Opus reviewer will score it with the UX.md §12 rubric (ship bar ≥ 8 on every axis, ≥ 9 on Flow and Clarity). Finish the whole brief — no TODO stubs. Verify by running it. Your final message is a structured report for the lead.`

// ---------------------------------------------------------------- Build
phase('Build')

const renderP = agent(`${PREAMBLE}

${FOUNDATIONS}

YOUR AREA: the 3D renderer. You own src/render/** (BoardView.ts is the contract), render-sandbox.html, artifacts/render/**. Dev server port: 5281.

Implement \`createBoardView\` (src/render/index.ts) satisfying every BoardView method — including playEvent's opts (style 'full'|'brief', seq for blitz compression), setViewportInsets (home view frames the board inside the HUD-free region), setUiScale — following SPEC §6 and every [render] item in UX.md (§5.1 dice, §8.1 acknowledgement/gestures/stable hover, §8.2 board timing table, §8.3 camera, §8.5 color semantics, §8.6 DOM army badges with seat emblems from EMBLEM_PATHS, §8.7 noise budget, §8.8 warmup, §10.4 reduced motion — expose a setter or read a flag the controller passes; add it additively to BoardView and report it).
Suggested modules: scene/lighting/table, board slab + ocean shader, territory tiles (ExtrudeGeometry, bevelOffset = -bevelSize; smooth color transitions; flat un-lifted footprint proxies for picking), continent contours + ocean labels (held-continent recolor, "· 1 AWAY"), sea lanes, army piece groups (crafted-looking procedural low-poly figurines or banner stacks, instanced where it helps), DOM badge overlay (batched transforms, < 1 ms/frame for 42), dice tray, effects (dust, hit flashes, −N chips, conquest flood + ripple ring, continent flare, elimination wave, victory wave), camera controller (damped orbit/pan/zoom-to-cursor with the clamps and automatic-move limits), picking (click vs drag rules, hysteresis, right-click, no context menu), an animation scheduler (tweens with easing, speed multiplier, clamped delta, skipAnimations snapping everything to end state; promises ALWAYS resolve).
THE BATTLE TRAY — coordination with the UI agent (building the HTML at the same time): the band spans y = H − insets.bottom … H − insets.bottom + insets.trayBand (CSS px from the top of the viewport), horizontally centered, width ≈ min(720px, 70vw). You draw the physical tray (felt-lined, wood-rimmed, matching the table) and the dice in 3D, in the middle ~56% of the band height: attacker dice left of center, defender dice right, sorted high→low so pairs face each other, a gap ≥ 1 die width between the sides. The UI draws text only (header above, odds/stakes/result/tally below and at the sides) and never puts an opaque background over the tray's middle. The tray appears when a 'full' engagement starts and lingers per UX.md §5.1, and is hidden otherwise.
playEvent must handle EVERY GameEvent type (some resolve instantly), keep displayed owners/armies correct per event, and never desync; syncState fully corrects drift. Non-blocking events (UX.md §8.1) must return quickly and overlap.
Build render-sandbox.html + src/render/sandbox.ts: loads BOARD, runs a 4-AI engine game, plays events with style full/brief and seq, with on-page controls (speed, skip, pause, focus, labels, insets preset, ui scale, reduced motion, highlight demo incl. pending ghosts and arrows, attract, stats). Use it for screenshots.
Visual iteration is the job: screenshots at 1440x900 and 1280x800 (home view, Europe zoom, mid-dice single roll, blitz final roll, brief AI engagement, conquest mid-flood, highlights: selectable/selected/targets/arrow/pending, continent held + 1 AWAY, victory). Critique each against SPEC §6 and UX.md like an art director; at least three improve-and-reshoot rounds. Measure fps + P95 frame ms with the Metal-flag launch during a sandbox blitz stretch at 1440x900; report numbers. Zero console errors. Self-check the [render] items of the UX.md §11 checklist and report each pass/fail.`, { label: 'renderer', phase: 'Build', schema: REPORT, effort: 'high' })

const ctrlP = agent(`${PREAMBLE}

${FOUNDATIONS}

YOUR AREA: the game controller. You own src/game/** (viewModel.ts is the contract), src/main.ts, tests/game/**, tests/e2e/**. Dev server port: 5284.
Two other agents are building RIGHT NOW: the renderer (src/render/**, implements BoardView) and the HTML UI (src/ui/**, implements MountUi from viewModel.ts). Don't edit their files.

Implement \`createController(opts: { board: BoardView; audio: AudioEngine }): ControllerApi\` per src/game/viewModel.ts, SPEC §7 (Controller, Input model, Settings) and every [ctrl] item in UX.md: event queue driving board.playEvent with per-event HUD deltas (no spoilers), blocking vs non-blocking events, click-through on your own turn, watched-turn skip-only, the input state machine for every phase (claim, staged setup placement with Confirm, reinforce with pills/+5/All/right-click undo/implicit exit, trade incl. forced and mid-turn, target-first attack with autoSource, source-first, dice toggle, roll/blitz, occupy with smart default + board-click-confirms, auto-chain, fortify), keyboard map (Enter primary, Space commit-only with the 300 ms guard, E exit, B, 1/2/3, Esc, Tab, F, L, M, ?), the 250 ms turn-change guard, the AI highlight reel (coalesced reinforce beat, engagements, think time only at decisions, full vs brief by stakes, 10 s cap, watch/fast/instant), camera requests to the board per UX.md §8.3 (turn-start home, AI off-screen framing), the recap ledger, upsets, awards, announcements ladder (≤ 1 banner, ≤ 2 toasts, no entry while dice tumble, AI-turn merges), turn banner, hand-off cover logic (default off), all-humans-out, End game now (controller-level), Rematch, new-game draft → GameConfig mapping (length/setup presets, setupBatch 'auto' formula, DEFAULT_SEAT_COLORS, remembers last setup), autosave/continue (risk3d.save.v1 + risk3d.ui.v1, resumes mid-occupy/mid-reinforce exactly), settings (risk3d.settings.v1) pushed to the board (speed, labels, uiScale, reduced motion) and audio, SFX calls per UX.md §5.4 for controller-owned sounds.
ALL copy comes from you, exactly per UX.md §7.2/§7.3/§5.2/§6.2/§4 tables (real names and numbers, tone guide §7.7). Pure helpers in src/game/ with vitest unit tests in tests/game/: explainTerritory (reason codes §7.3), attackStakes, bestSet, occupyDefault, autoSource, oddsWord, plus the recap and award builders. Build the ViewModel at most once per animation frame; keep identity of unchanged subtrees.
window.__risk hooks EXACTLY per SPEC §9 including ui(), explain(), metrics(), resetMetrics() (clicks counted from real pointer events; forcedWaitMs; camera stats from the board).
src/main.ts boots: createAudio() → createBoardView(#board) → createController → mountUi(#ui, api). Until the other agents land their entry points, use fallbacks you own: src/game/stubBoard.ts (a 2D canvas BoardView drawn from src/map BOARD polygons: clickable tiles, counts, highlights, instant events) and src/game/debugHud.ts (renders the ViewModel as plain HTML: every line, chip, button, counter, banner, battle panel text, cards, log — clickable, sending intents). main.ts tries dynamic imports of '../render/index' and '../ui/index' and falls back to yours, so integration is a no-op.
Verify with Playwright flows in tests/e2e/ against your dev server (stub board + debug HUD is fine): the SPEC §10 click budgets via real pointer events at __risk.screenPos, click-through during a blitz, 10 clicks in 1.5 s = +10, a 1-human + 3-AI round timed via metrics() (AI median ≤ 6 s at watch — the stub board's instant events won't prove animation budgets, so also unit-test the reel's scheduling with fake timers), every reason code via explain() + a real click, resume mid-occupy and mid-reinforce, all-AI autoplay to victory with zero console errors, ui().actionBarText never empty across the autoplay. Report the controller architecture, hook details, and any contract additions.`, { label: 'controller', phase: 'Build', schema: REPORT, effort: 'high' })

const uiP = agent(`${PREAMBLE}

${FOUNDATIONS}

YOUR AREA: the HTML UI. You own src/ui/**, index.html (keep #board, #ui and the /src/main.ts script; you may add font preloads and inline boot styles), ui-gallery.html, public/**. Dev server port: 5282.
Two other agents are building RIGHT NOW: the renderer (src/render/**) and the controller (src/game/**, which produces the ViewModel and all copy). You never import the engine; you render src/game/viewModel.ts and send UiIntents. Don't edit their files.

Implement \`mountUi: MountUi\` in src/ui/index.ts: render every ViewModel field per SPEC §7 (Look, Screens) and every [ui] item in UX.md (§3 pills, §4.1 new game, §4.5-4.6 endgame + victory with awards and a territories-over-time SVG chart, §5.1 battle panel text, §5.2 banners/toasts, §6.2 recap in the turn banner, §6.3 hand-off cover, §7.4 tooltip placement/flip, §7.5 cards with shape-coded pictograms, §7.6 rules card, §8.2 UI timing table, §8.5 brass/ivory semantics, §8.9 fixed-size action bar with zones/keycaps/control states, §9 HUD layout, §10.2 emblems from EMBLEM_PATHS everywhere a seat appears, §10.3 text sizes via root rem, §10.4 reduced motion). Efficient DOM: diff against the previous ViewModel (subtrees keep identity when unchanged), no layout shift, no DOM churn per frame. Position the reinforce pills each rAF from api.screenPos(territory). Report HUD-covered edges via api.setViewportInsets (ResizeObserver on the top bar, roster, right rail, action bar + battle band; trayBand = the battle band height).
THE BATTLE PANEL — coordination with the renderer: the band spans y = H − insets.bottom … H − insets.bottom + trayBand, horizontally centered, width ≈ min(720px, 70vw). The renderer draws the 3D tray and dice in the middle ~56% of the band height (attacker left, defender right). You draw TEXT ONLY around it: the header ('JOHN ▲ URAL 8' vs 'SAM ● SIBERIA 3', names in each owner's light tint, emblems) in the top strip, odds + stakes + result + tally in the bottom strip / sides. Never an opaque background over the tray's middle; a soft text shadow or a smoked-glass strip only on your text rows.
Look: invoke the frontend-design skill for direction first, then hold to SPEC §7 Look + UX.md (smoked glass, brass used sparingly, Cinzel for titles only, Inter tabular numerals, U+2212 minus). Fonts via @fontsource imports. Nothing may look like a default web form. UI sounds via api.audio ('uiClick', throttled 'uiHover' on buttons only, 'uiError' is the controller's).
Build ui-gallery.html + src/ui/gallery/: mounts your UI with a fake ControllerApi and fixture ViewModels covering EVERY screen and state — title (with/without save), new game (2 and 4 seats, problems, house rules open), each action-bar mode (setup-claim, setup-place, reinforce with receipt chips + trade chip, forced trade, reinforce 0 left, attack nothing/auto-source/armed with dice toggle, no sources, occupy with counter + note, fortify both, watching narration, rejection swap), battle panel (armed with stakes, rolling, result, blitz tally), cards open (set suggested / forced / none), log open with expandable engagement lines, tier-1/tier-2 banners, toasts, turn banner with recap, tooltip near each edge, pills, hand-off cover, all-humans-out card, confirm dialogs, pause/rules/settings overlays, victory with awards + chart + full stats, and the TV text size of each. ?state=<id> selects a fixture so screenshots are scriptable; a hidden-by-default index lists all. Behind the UI use a static board screenshot if one exists under artifacts/render/ (else a dark walnut/teal backdrop) so you judge the UI in context.
Visual iteration is the job: screenshot every fixture at 1440x900, and the key ones at 1280x800, 1920x1080, and TV text size on 1920x1080; LOOK at each; at least three polish rounds on anything generic, cramped, misaligned, or noisy. Self-check the [ui] items of the UX.md §11 checklist (14, 16, 17, 22, 24, 26, 27 and the UI halves of others) and report each pass/fail.`, { label: 'ui', phase: 'Build', schema: REPORT, effort: 'high' })

renderP.then(r => log(r ? 'renderer done' : 'renderer returned nothing'))
ctrlP.then(r => log(r ? 'controller done' : 'controller returned nothing'))
uiP.then(r => log(r ? 'UI done' : 'UI returned nothing'))

const [ren, ctrl, ui] = await Promise.all([renderP, ctrlP, uiP])

// ---------------------------------------------------------------- Integrate
phase('Integrate')
log('builders finished — integrating')

const integ = await agent(`${PREAMBLE}

YOUR AREA: integration. The builders are done; you now own the WHOLE repo (any file, including contracts when truly needed — keep them coherent and update SPEC/UX docs if you change one). Dev server port: 5273 (\`npm run dev\`).
Reports: the foundation reports + lead notes are in ${ROOT}/docs/reports/foundations.md (read it; if the audio section is missing, read src/audio yourself). Build-phase reports:
${fmt('renderer', ren)}
${fmt('controller', ctrl)}
${fmt('ui', ui)}

Job:
1. main.ts boots the REAL renderer and REAL UI by default (stub board / debug HUD only behind a ?debug flag if useful). Resolve every builder request and still-real known issue. Make the battle tray (renderer) and battle panel text (UI) line up exactly; make insets/home view/tray band agree.
2. Apply SPEC §11.1 (sim prints rounds-to-60/70/100% by player count; then relabel the New game length estimates from sim rounds × measured seconds per round) and §11.4 (AI prefers bulk reinforce + blitz) — keep \`npm run sim\` passing.
3. Make the whole game work end to end with the real board and UI. \`npm run test:e2e\` (add it: starts its own dev server on port 5290, runs every Playwright flow in tests/e2e/, stops the server) must pass, covering SPEC §9 flows and the §10 feel budgets through real pointer events: all-AI 4-seat autoplay to victory (zero console errors, actionBarText never empty); 1 human + 3 AI from the title via clicks through setup, reinforce (pills, right-click undo), a trade, target-first attack, roll, blitz, occupy default + chain, fortify, end turn, then AI turns returning control within budget; manual 'Place your own' setup; 2 humans with the hand-off setting on (zero frames of the next hand); reload mid-occupy and mid-reinforce restores exactly; End game now → victory with awards + chart → Rematch; click-through during a blitz; 10 clicks in 1.5 s = +10.
4. Walk the UX.md §11 polish checklist end to end with the real game; fix every miss you can; report each item pass/fail with evidence.
5. Screens: 1280x800, 1440x900, 1920x1080, and TV text size on 1920x1080 — home, reinforce, armed attack with dice, blitz result, AI turn narration, cards open, victory. LOOK at each and fix what looks wrong, not just what errors.
6. Performance with the Metal flags at 1440x900 during a blitz-heavy AI stretch: fps and P95 frame ms; fix anything under ~55 fps.
7. \`npm test\`, \`npm run typecheck\`, \`npm run build\`, \`npm run verify:map\`, \`npm run sim -- 50\` all pass.
8. README.md: start (\`npm install\`, \`npm run dev\` → http://127.0.0.1:5273), how to play, controls, house rules, settings, troubleshooting. Update docs where reality diverged.
Report honestly: what passes, what you fixed, remaining issues ranked by severity, fps numbers, checklist results, key screenshot paths.`, { label: 'integrate', phase: 'Integrate', schema: REPORT, effort: 'high' })

return { renderer: ren, controller: ctrl, ui, integrate: integ }
