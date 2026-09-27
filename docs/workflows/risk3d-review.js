export const meta = {
  name: 'risk3d-review-round',
  description: 'One review round for Risk: War Table — Opus 5.5 reviewer plays and scores (UX.md §12 rubric), area fixers address findings, verifier re-runs every check and commits',
  phases: [
    { title: 'Review', detail: 'Opus 5.5 plays the game and scores it 1-10 per axis', model: 'opus' },
    { title: 'Fix', detail: 'one fixer per owning area, in parallel' },
    { title: 'Verify', detail: 'all checks green, seams fixed, commit' },
  ],
}

const ROOT = '/Users/jhuang/Desktop/JH-Projects/risk3d'
const ROUND = (args && args.round) || 1
const PRIOR = (args && args.priorIssues) || []
const LEAD_NOTES = (args && args.leadNotes) || ''
const SKIP_FIX = !!(args && args.reviewOnly)

const AREAS = {
  render: 'src/render/**, render-sandbox.html',
  ctrl: 'src/game/**, src/main.ts, tests/game/**, tests/e2e/**',
  ui: 'src/ui/**, index.html, ui-gallery.html, public/**',
  core: 'src/engine/**, tests/engine/**, src/map/**, scripts/**, src/audio/**, audio.html',
}

const ISSUE = {
  type: 'object',
  properties: {
    id: { type: 'string', description: `R${ROUND}-NN` },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'polish'] },
    area: { type: 'string', enum: ['render', 'ctrl', 'ui', 'core'] },
    axis: { type: 'string', enum: ['flow', 'fun', 'polish', 'clarity', 'visuals', 'correctness'] },
    title: { type: 'string' },
    detail: { type: 'string', description: 'What is wrong and why it matters to the players in the room' },
    repro: { type: 'string', description: 'Exact steps / hook calls / viewport to reproduce' },
    evidence: { type: 'string', description: 'Screenshot path(s), metric values, console lines' },
    fix: { type: 'string', description: 'Suggested fix, concrete; name files if you diagnosed the root cause' },
  },
  required: ['id', 'severity', 'area', 'axis', 'title', 'detail', 'repro', 'evidence', 'fix'],
}

const REVIEW = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: {
        flow: { type: 'number' }, fun: { type: 'number' }, polish: { type: 'number' },
        clarity: { type: 'number' }, visuals: { type: 'number' }, correctness: { type: 'number' },
      },
      required: ['flow', 'fun', 'polish', 'clarity', 'visuals', 'correctness'],
    },
    overall: { type: 'number', description: '1-10 overall: would John enjoy this with friends tonight, and does it feel premium' },
    verdict: { type: 'string', description: '3-6 sentences, plain English' },
    worstMoment: { type: 'string' },
    bestMoments: { type: 'array', items: { type: 'string' } },
    metrics: { type: 'string', description: 'Key numbers from __risk.metrics(), fps/P95, click counts, AI turn times' },
    checklist: { type: 'array', items: { type: 'string' }, description: 'UX.md §11 items: "N pass|fail — note"' },
    priorIssueStatus: { type: 'array', items: { type: 'string' }, description: 'For each prior issue id: fixed | still broken | regressed — note' },
    issues: { type: 'array', items: ISSUE },
    screenshots: { type: 'array', items: { type: 'string' }, description: 'The most representative screenshot paths' },
  },
  required: ['scores', 'overall', 'verdict', 'worstMoment', 'bestMoments', 'metrics', 'checklist', 'priorIssueStatus', 'issues', 'screenshots'],
}

const FIXREPORT = {
  type: 'object',
  properties: {
    outcomes: { type: 'array', items: { type: 'string' }, description: '"<issue id>: fixed|partial|not fixed — what you did, how you verified"' },
    files: { type: 'array', items: { type: 'string' } },
    requests: { type: 'array', items: { type: 'string' }, description: 'Needed changes outside your area' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['outcomes', 'files', 'requests', 'risks'],
}

const shipBar = (s) => s && ['flow', 'fun', 'polish', 'clarity', 'visuals', 'correctness'].every(k => s[k] >= 8) && s.flow >= 9 && s.clarity >= 9

// ---------------------------------------------------------------- Review
phase('Review')
const review = await agent(`You are the reviewer for "Risk: War Table" (${ROOT}), a 3D pass-and-play Risk that John will play tonight with up to 3 friends on one laptop or TV. This is review round ${ROUND}. You are Opus 5.5, a demanding game critic and QA lead. Your job is to PLAY it like the people in that room would, then score it honestly and hard. A generous score wastes John's evening; a precise list of what's wrong is the most useful thing you can produce.
Read first: ${ROOT}/docs/UX.md §11 (polish checklist) and §12 (rubric + how to review), docs/SPEC.md §9-§10, README.md, CLAUDE.md. Skim the code only as needed to diagnose root causes of problems you OBSERVE — the score comes from playing, not reading.
${PRIOR.length ? `Prior round issues (verify each: fixed / still broken / regressed), but score independently of them:\n${PRIOR.map(i => `- ${i.id} [${i.severity}/${i.area}] ${i.title}: ${i.repro}`).join('\n')}` : 'This is the first review.'}
${LEAD_NOTES ? `Lead notes for this round: ${LEAD_NOTES}` : ''}

How to review (you may not edit any source file; write only under ${ROOT}/artifacts/review/r${ROUND}/):
1. Start your own dev server: \`cd ${ROOT} && npx vite --port 5295 --strictPort\` in the background; kill it when done. Drive it with Playwright from node scripts, launched with args ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] (never agent-browser or the Browser pane).
2. Follow UX.md §12 "How to review": a 1-human vs 3-normal-AI game from the title to round 6 at default settings; a 2-human + 1-AI "Place your own" game through 2 rounds; __risk.autoplay to finish one game and see the endgame + victory; screenshots at 1280x800 and at TV text size on 1920x1080; metrics() numbers.
3. Play like a human: click through the real UI with real pointer events (use __risk.screenPos(t) only to find where a territory is on screen, the way a person's eyes would). Before each click, read what the screen tells you (take a screenshot, read the action bar via __risk.ui()); decide from that. If you ever need getState() or the code to know what to do, that is a Clarity failure — log it.
4. Judge motion, not just stills: capture frame sequences (e.g. screenshots every ~60 ms, or Playwright recordVideo + the ffmpeg under ~/Library/Caches/ms-playwright/ffmpeg-*/ to extract frames) of a single roll, a blitz, a conquest, and an AI turn; look at them. Check timing against UX.md §8.2 and camera rules §8.3. Measure fps/P95 during a blitz-heavy stretch.
5. Walk every UX.md §11 checklist item and mark pass/fail with evidence. Watch the console for errors the whole time.
6. Try to break it: rapid clicks, clicking during animations, Esc mid-step, resizing, reloading mid-occupy and mid-reinforce, switching text size mid-game, a seat set to AI mid-game, the hand-off setting on.
7. LOOK at every screenshot you take with the Read tool. Judge the visuals against SPEC §6 art direction ("premium physical board game on a war table") and the reference bar in the rubric.
Scoring: use the UX.md §12 anchors per axis (flow, fun, polish, clarity, visuals, correctness), 1-10, with evidence for each. 10 = indistinguishable from a shipped premium digital board game. Overall = would John and his friends have a great evening with this tonight, and does it feel premium. Then list issues ranked most severe first — each with severity, owning area (render = src/render; ctrl = src/game + main.ts + e2e; ui = src/ui + index.html; core = engine/map/audio/scripts), axis, exact repro, evidence, and a concrete fix. Include polish-level items; they are how a 7 becomes a 9. No padding: every issue must be real and reproducible.`, { label: `review r${ROUND}`, phase: 'Review', schema: REVIEW, model: 'opus', effort: 'high' })

if (!review) return { round: ROUND, review: null, note: 'reviewer returned nothing' }
const s = review.scores
log(`round ${ROUND}: overall ${review.overall}/10 · flow ${s.flow} fun ${s.fun} polish ${s.polish} clarity ${s.clarity} visuals ${s.visuals} correctness ${s.correctness} · ${review.issues.length} issues (${review.issues.filter(i => i.severity === 'blocker').length} blocker, ${review.issues.filter(i => i.severity === 'major').length} major)`)

const passes = shipBar(s) && !review.issues.some(i => i.severity === 'blocker' || i.severity === 'major')
if (passes || SKIP_FIX) return { round: ROUND, review, passes, fixes: null, verify: null }

// ---------------------------------------------------------------- Fix
phase('Fix')
const byArea = {}
for (const i of review.issues) (byArea[i.area] = byArea[i.area] || []).push(i)
const areas = Object.keys(byArea)
log(`fixers: ${areas.map(a => `${a} (${byArea[a].length})`).join(', ')}`)

const fixes = await parallel(areas.map(area => () => agent(`You are fixing review findings for "Risk: War Table" (${ROOT}), review round ${ROUND}. Read CLAUDE.md, docs/SPEC.md, docs/UX.md (the feel spec) and the contracts it lists before changing anything.
You own ONLY: ${AREAS[area]}. Other fixers are working in parallel on: ${areas.filter(a => a !== area).map(a => AREAS[a]).join(' ; ') || 'nobody'}. Do not edit their files; put cross-area needs under "requests". No npm install, no git commit. Dev server port: ${5300 + areas.indexOf(area)} (\`npx vite --port <p> --strictPort\` in the background; kill it when done). Playwright with the Metal flags for any browser check; LOOK at your screenshots with Read.
The reviewer's verdict: ${review.verdict}
Worst moment: ${review.worstMoment}
Your issues (most severe first):
${byArea[area].map(i => `- ${i.id} [${i.severity}, ${i.axis}] ${i.title}\n  Detail: ${i.detail}\n  Repro: ${i.repro}\n  Evidence: ${i.evidence}\n  Suggested fix: ${i.fix}`).join('\n')}
For each issue: reproduce it first, find the root cause, fix it properly (no band-aids that the next reviewer will catch), then prove it's gone the same way it was observed (screenshot, frame sequence, metric, or test). Keep every existing test and e2e flow green in your area (npm test; the e2e flows you touch). Don't regress the feel budgets in SPEC §10. Report per-issue outcomes honestly.`, { label: `fix:${area}`, phase: 'Fix', schema: FIXREPORT, effort: 'high' })))

// ---------------------------------------------------------------- Verify
phase('Verify')
const fixText = areas.map((a, k) => fixes[k] ? `### ${a}\n${fixes[k].outcomes.join('\n')}\nRequests: ${fixes[k].requests.join(' | ') || 'none'}\nRisks: ${fixes[k].risks.join(' | ') || 'none'}` : `### ${a}: fixer returned nothing`).join('\n\n')

const verify = await agent(`You are the verifier for review round ${ROUND} of "Risk: War Table" (${ROOT}). The fixers are done; you own the whole repo now. Read CLAUDE.md, docs/SPEC.md, docs/UX.md.
Fixer reports:
${fixText}
Job:
1. Apply every cross-area request that is still needed. Resolve conflicts between fixers' changes.
2. Run and make green: \`npm test\`, \`npm run typecheck\`, \`npm run build\`, \`npm run verify:map\`, \`npm run sim -- 30\`, \`npm run test:e2e\`. Fix what breaks (root causes).
3. Re-check each round-${ROUND} issue marked fixed with a quick real repro (dev server on port 5299, Playwright with the Metal flags; look at the screenshots). Note any that are not actually fixed.
4. Commit: \`git add -A && git commit -m "Review round ${ROUND}: <short summary>"\` with the trailer line "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" (you are explicitly allowed to commit this round).
Report per-issue verified status, check results, and anything still broken.`, { label: `verify r${ROUND}`, phase: 'Verify', schema: FIXREPORT, effort: 'high' })

return { round: ROUND, review, passes: false, fixes, verify }
