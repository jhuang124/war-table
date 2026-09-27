# Risk: War Table — build spec

A 3D, pass-and-play Risk for one computer: John plus up to 3 friends around a laptop or TV.
Classic rules, 2–4 seats, any seat can be an AI. No online play, no accounts, no server.
The bar: **John opens it with friends tonight and plays a full game without hitting a bug,
a confusing moment, or a janky animation.**

Contracts already written (read them before anything else):

| File | What it fixes |
|---|---|
| `src/engine/types.ts` | Game state, actions, events: the core contract |
| `src/engine/mapData.ts` | 42 territories, 6 continents, 83 borders, card symbols, starting armies |
| `src/map/types.ts` | Board geometry format (map pipeline → renderer) |
| `src/render/BoardView.ts` | Renderer interface (renderer ↔ controller) |
| `src/shared/palette.ts` | Player colors, seat emblems |
| `src/game/viewModel.ts` | Controller ↔ UI: ViewModel (plain data + finished copy), UiIntent, ControllerApi, MountUi |
| `index.html` | `#board` (canvas container) under `#ui` (HTML overlay); boots `src/main.ts` |

**Renderer, UI and controller builders: read `docs/UX.md` alongside this spec.** It holds the
click-by-click turn, the timing table, camera rules, exact copy, and the reviewer rubric. This spec
says *what*; UX.md says *how it feels*. If they conflict, this spec wins; flag the conflict in your
report. Contract changes the new UX needs are listed in §11 and are applied by the lead.

---

## 1. Architecture

```
src/engine/      pure TS, no DOM. Rules, reducer, setup, RNG, AI. Runs in browser and Node.
src/map/         board.json (generated) + loader. Geometry only.
scripts/         build-map.ts, verify-map.ts, simulate.ts (AI-vs-AI soak)
src/render/      Three.js board: scene, tiles, pieces, dice, effects, camera, picking.
src/game/        controller: event queue, input state machine, AI driver, save/load, hooks, copy.
                 Produces a ViewModel (src/game/viewModel.ts) and consumes UiIntents.
src/ui/          HTML/CSS overlay: renders the ViewModel (menus, HUD, dialogs, cards, log,
                 settings, victory). Never imports the engine. Entry: mountUi(root, api).
src/main.ts      boot: createBoardView(#board) → createController(board) → mountUi(#ui, api).
src/audio/       WebAudio-synthesized SFX (no audio files).
tests/engine/    vitest unit tests.   tests/e2e/   Playwright scripts (node).
```

Data flow, one direction:

```
input (click / key / AI) → Action → engine.applyAction(state, action)
   → { state', events[] } → controller queues events
   → board.playEvent(e) one at a time (awaits animation) + HUD reacts to each event
   → when the queue drains: board.syncState(state'), HUD renders state', autosave, next AI move.
```

The engine is the only thing that changes game state. The renderer and HUD are views.
Input is never simply "locked". Placement events don't block input. On the current human's own turn, a
click during a blocking animation skips it (`board.skipAnimations()`) and then performs the click
("click-through"). During watched turns, a click only skips. Details are in §7 Controller.
The HUD follows the board, not the state: per-event HUD deltas apply when that event's `playEvent`
resolves, so nothing spoils the dice.

---

## 2. Rules (classic Risk; the engine enforces all of it)

**Setup**
- Starting armies: 2p 40, 3p 35, 4p 30 (`STARTING_ARMIES`, overridable).
- First player: chosen by the seeded RNG. Emit `gameStarted`.
- `setupMode: 'random'`: shuffle the 42 territories, deal round-robin starting at the first player,
  1 army each (`territoriesDealt`). `'draft'`: phase `setup-claim`; players take turns claiming one
  unclaimed territory (1 army) until all 42 are claimed.
- Then remaining starting armies (`setupArmies`): `initialPlacement: 'auto'` → engine distributes
  them (favor border territories, some randomness), emits `armiesPlaced` per territory with
  `source: 'setup'`. `'manual'` → phase `setup-place`: each player in turn places
  `min(setupBatch, setupArmies)` armies on their own territories (any split), then play passes to the
  next player with armies left. Emit `setupTurn` at the start of each setup-place turn.
- When every player's `setupArmies` is 0, the first main turn starts with the first player.

**Turn: reinforce**
- Base = `max(3, floor(territoriesOwned / 3))` + continent bonuses (NA 5, SA 2, EU 5, AF 3, AS 7,
  AU 2). Emit `turnStarted` with the breakdown, then `phaseChanged`.
- Cards: holding 5+ at the start of reinforce → `mustTrade` until fewer than 5.
- Valid set: three of one symbol, one of each symbol, or any two + a wild.
- Values, `progressive`: 4, 6, 8, 10, 12, 15, then +5 per set (20, 25, …) — global count across players.
  `fixed`: 3 infantry 4, 3 cavalry 6, 3 artillery 8, one of each 10; a wild takes whichever symbol
  gives the best value.
- Territory bonus: if any traded card shows a territory the player owns, +2 armies go straight onto
  the first such territory (in `cardIds` order). Max one +2 per trade. Emit `cardsTraded`, then
  `armiesPlaced` with `source: 'cardBonus'`.
- Traded cards go to `discard`. When the deck runs out, shuffle the discard into the deck.
- `reinforce` places N (1..remaining) on an owned territory. `unreinforce` takes back armies placed
  this phase (tracked in `phase.placed`) — this is the undo for misclicks. `endReinforce` requires
  `remaining === 0 && !mustTrade`. The phase never auto-advances.

**Turn: attack**
- From an owned territory with ≥2 armies to an adjacent enemy territory.
- Attacker rolls 1–3 dice (≤ armies − 1). Defender always rolls the max it can (1 or 2, ≤ its armies).
- Sort both high → low, compare pairwise over `min(a, d)` pairs; ties go to the defender. Emit `diceRolled`.
- `blitz`: repeat max-dice attacks until the territory falls or the attacker is down to `stopAt`
  (default 1). One `diceRolled` per roll with `blitz: true`.
- Conquest (defender reaches 0): ownership flips, `territoryConquered`, phase → `occupy` with
  `min = dice rolled in the final roll`, `max = from.armies − 1` (min is capped at max). If min === max,
  the engine auto-occupies (emits `armiesMoved` reason `occupy`) and returns to `attack`.
  `continentGained` / `continentLost` when a continent changes hands (after the occupy move).
- Elimination (defender owns 0 territories): `playerEliminated`; the attacker takes all their cards
  (`cardsCaptured`). If that brings the attacker to 6+ cards, after the occupy move the phase becomes
  `reinforce` with `midTurn: true, mustTrade: true` until they hold fewer than 5, then `endReinforce`
  returns to `attack`.
- Win check after every conquest: owning `ceil(42 × dominationPercent / 100)` territories (or being the
  last player standing) → `gameOver`, phase `game-over`.
- `endAttack` → `fortify`. `endTurn` also allowed from attack (skips fortify).

**Turn: fortify**
- One move per turn: from an owned territory to another owned territory, leaving ≥1 behind.
  `fortifyRule: 'connected'` → any chain of owned territories (include the BFS path in the event);
  `'adjacent'` → neighbors only. Fortifying ends the turn. `endTurn` skips.
- End of turn: if `conqueredThisTurn`, draw one card (`cardDrawn`). Next non-eliminated player.
  When play wraps back to `firstPlayer`, `round` increments and a `TimelinePoint` is recorded
  (also record one at round 1 start). If `turnLimit` is set and the limit round has finished → `gameOver`
  with reason `turnLimit` (most territories, tiebreak total armies, then lowest seat).

**Always**
- `setController` may be sent any time for any seat (e.g. "let the AI take over Sam's seat").
- Every action is validated. Invalid → `{ ok: false, error }` with a short human-readable reason,
  state untouched. The engine never throws on bad input.
- Determinism: all randomness comes from `state.rng` (mulberry32 or similar). Same seed + actions →
  identical states. `applyAction` does not mutate its input.

---

## 3. Engine API (`src/engine/index.ts` re-exports everything)

```ts
createGame(config: GameConfig): { state: GameState; events: GameEvent[] }
applyAction(state: GameState, action: Action): ActionResult
defaultConfig(players: PlayerConfig[]): GameConfig      // sensible defaults, random seed
// helpers (used by UI and AI — keep them pure and cheap)
legalActionsSummary(state): { … }                         // what the current player may do now
reinforcementsFor(state, player): ReinforcementBreakdown
validSets(cards: Card[]): [number, number, number][]      // card id triples
setValue(state, cardIds): number                          // armies the next trade of these would give
attackTargets(state, from): TerritoryId[]
attackSources(state, player): TerritoryId[]
fortifyTargets(state, from): TerritoryId[]                // respects fortifyRule
fortifyPath(state, from, to): TerritoryId[] | null
maxAttackDice(state, from): 0 | 1 | 2 | 3
winProbability(attackers: number, defenders: number): number   // attacker takes it by blitzing to 1
territoriesNeeded(state): number
chooseAiAction(state: GameState, player: PlayerId): Action     // src/engine/ai/*
```

---

## 4. AI (`src/engine/ai/`)

Heuristic, fast (< 5 ms per decision), always returns a legal action. Difficulty:

- **easy**: random-ish placement near the front, attacks only with big advantages, often skips fortify.
- **normal**: targets continents it can hold (value ÷ border count), reinforces threatened borders,
  attacks when `winProbability ≥ ~0.6`, grabs one territory per turn for a card when cheap, fortifies
  interior armies to borders, trades cards when forced or when the set is worth it.
- **hard**: normal plus: breaks opponents' continents, eliminates weak players for their cards when
  reachable, times card trades, avoids overextending (keeps borders defensible).

Soak test (`npm run sim`): 200 seeded AI-vs-AI games across 2/3/4 players and all rule variants
must all finish (no illegal action, no stuck loop, under 500 rounds), printing win rates by
difficulty and average game length. Hard should beat easy clearly.

---

## 5. Map (`scripts/build-map.ts` → `src/map/board.json`)

Real geography, stylized. Built once, committed; the app only loads the JSON.

- Source: `world-atlas` (Natural Earth, 50m preferred) via `topojson-client`. Assign each country to a
  territory; split big countries (USA, Canada, Russia, Kazakhstan, China/Indonesia if needed, Australia…)
  with Voronoi seeds (`d3-delaunay`) + `polygon-clipping`. Classic-board liberties are expected:
  Mongolia reaches the Pacific coast (Manchuria), Kamchatka covers the Russian Far East, Ukraine covers
  western Russia to the Urals and the Caucasus, Afghanistan covers Central Asia, etc.
- Projection: something that reads well flat (e.g. Miller or equirectangular with compressed poles),
  cropped to roughly 170°W…190°E, 56°S…80°N. Antarctica out. Pacific is the seam, so Alaska sits at the
  far left and Kamchatka at the far right.
- Simplify outlines for a stylized, readable board (no fractal coastlines), drop specks below a minimum
  area, keep recognizable islands (GB, Ireland, Iceland, Japan, Madagascar, Sri Lanka, New Guinea,
  Borneo/Sumatra/Java, Greenland…). Non-playable land (e.g. New Zealand, Caribbean) → `decorativeLand`.
- Anchors: `polylabel` pole of inaccessibility on the main polygon, hand-overridable.
- **Adjacency must match `BORDERS` exactly** (`npm run verify:map`):
  - territories whose geometry touches must be a border in `BORDERS` (no extra land borders),
  - every border in `BORDERS` either touches in geometry or has a `seaLanes` entry,
  - sea lanes are short, plausible crossings (Alaska–Kamchatka wraps the edge),
  - all 42 present, polygons valid (no self-intersections), CCW outers.
- Verify writes a preview image (`artifacts/map/preview.png`, via Playwright rendering an SVG) with
  owners colored, anchors, labels, lanes. Look at it.

---

## 6. Renderer (`src/render/`, implements `BoardView`)

### Art direction: "the war table"
A premium physical board game on a dark wooden table under warm lamplight: a tactile object you want
to touch, not a sci-fi hologram and not a flat web map.

- **Table & board**: dark walnut table (procedural grain), vignette at the edges. The board is a thick
  slab with a gilded/brass-trimmed frame. Inside: a deep ink-teal ocean with a slow, subtle shimmer,
  faint engraved graticule lines, a compass rose, italic ocean labels.
- **Territories**: raised tiles with a small bevel (ExtrudeGeometry, `bevelOffset = −bevelSize` so
  neighbors meet at the base and form a V-groove). Top face in the owner's color (matte painted
  finish, desaturated ≤ 20% so colors stay distinct), darker sides, a thin light edge highlight. Unclaimed = parchment.
  Continents read as groups: a soft colored contour around each continent + a label on the ocean
  ("ASIA · +7") in engraved serif caps. Territory names optional (toggle), small, legible.
- **Armies**: each territory shows a miniature piece group in the owner's color (e.g. infantry/cavalry/
  artillery figurines or a banner-topped stack, height grows with strength) **plus a count badge that is
  always legible** from the default camera.
  - Badges are **DOM elements** in an overlay, positioned each frame from the projected anchors, with
    transform writes batched (< 1 ms/frame for 42).
  - Style: a near-black pill `#12151a`, a 2.5 px ring in the owner's base color, the seat **emblem**
    (inline SVG) in the owner's light tint, and ivory Inter 700 tabular numerals.
  - Height ≥ 22 CSS px at the home view on 1280×800, scaling with zoom (0.85–1.3×) and with
    `setUiScale`.
  - A change pops the badge (1→1.18→1, 160 ms) on the contact frame. Pending placements show as an
    ivory `+N` ghost chip.
- **Sea lanes**: dashed, softly glowing ivory arcs over the ocean. Alaska–Kamchatka runs off the left
  edge and back in on the right.
- **Lighting**: warm key light with soft shadows (PCFSoft), cool fill, hemisphere ambient, ACES tone
  mapping, sRGB output. Optional subtle bloom only on highlights. Cap devicePixelRatio at 2.
- **Held continents**: the ocean label and contour take the holder's color (`ASIA · +7` in cobalt).
  At one territory short, the label adds `· 1 AWAY` in that player's light tint (should).
  Crossfade the change over 300 ms.
- **Camera**: perspective ~35–40° FOV.
  - **Home view** frames the whole board inside the HUD-free region (`setViewportInsets`, §11.2) with a
    4% margin, at pitch 55° and azimuth 0. The bottom inset includes the battle-panel band.
  - User controls: left-drag orbits, right-drag pans, the wheel zooms toward the cursor.
    Clamps: pitch 35–80°, azimuth ±25°, zoom 0.9–3.5× of home, pan so the board center stays on
    screen. Damping 0.12.
  - **The camera moves on its own only** when:
    1. a turn starts and the user left it > 10% away from home (ease back to home);
    2. during an AI turn, an engagement's tiles are off-screen or the target projects < 24 px wide
       (frame both, before the arrow);
    3. victory.
  - It never moves because of a human's click, while a selection is armed, or during dice or conquest.
  - Automatic moves take `500 + 400 × distance/boardWidth` ms, clamped to 500–900, easeInOutCubic.
    Rotation ≤ 45°/s, pitch change ≤ 8°, no roll, no overshoot, no shake.
  - `focusTerritories` follows the same limits. **No double-click-to-focus**; F focuses the selection.
- **Picking**: raycast against flat, un-lifted footprint proxies, so hover lift never changes the hit.
  - Hover hysteresis: 3 px past a shared edge.
  - A click is pointer-up within 6 px and 350 ms of pointer-down on the same tile; anything else is a
    drag.
  - A right-click without a drag is reported as `button: 2`. Suppress the context menu.
  - Hover highlight lands in the same rAF as the pointermove.

### Color semantics and noise
- On the board, **hue means ownership only**. Interaction states use light, height and **ivory
  `#f3ead8`** outlines (with a 1 px dark under-stroke):
  - selectable = a static ivory rim at 30% (no pulse)
  - selected = raised + a full ivory rim
  - targets = a pulsing ivory outline, others dimmed (value ×0.62, saturation ×0.75)
  - the attack arrow = attacker color with an ivory core; the fortify route = ivory dashed
- Brass is UI-only. There is no "danger red".
- An idle board has **zero moving elements** except the ocean shimmer. Bloom: threshold ≥ 0.9,
  strength ≤ 0.35, sourced only from the selected rim, dice verdicts and continent flares.
- Particles ≤ 40 alive. No screen shake, chromatic aberration, lens flare, or vignette pulsing.

### Animations (all interruptible by `skipAnimations`, scaled by speed)
Durations at 1× (2× halves them, floor 80 ms; 0 = no tweens). The full table with easings is in UX.md
§8.2. Exits are faster than entrances; nothing is linear except the target pulse.
- **Hover**: lift 0.15 × tile depth, in 90 ms / out 140 ms. **Selected**: lift 0.35 × depth over
  160 ms, easeOutBack. **Targets**: ivory outline pulse, 1.2 s sine. **Dim others** when choosing a
  target.
- **Place armies**: 200 ms drop + 90 ms bounce, dust ≤ 6 particles, the badge pops on contact.
  Placements are non-blocking and overlap freely (≤ 3 in flight per tile).
- **Attack**: the arrow grows 240 ms from attacker to defender. Dice play in the **battle tray**, a
  camera-attached group in the main scene (same lights, depth cleared, drawn after the board).
  - Position: fixed bottom-center just above the action bar, inside `trayBand`. It never moves.
  - Size: 8vh (min 56 px). Attacker dice on the left, defender dice on the right, each in its owner's
    color with ink pips, sorted high to low so pairs face each other.
  - Keyframed (no physics), landing on the engine's faces.
  - **Single roll 1.2 s**: shake 150 → tumble 450 → settle 100 → pair 200 → verdict 300. The winner
    lifts with an ivory rim; the loser dims to 55%, tilts, and cracks. `−N` chips rise on both tiles
    and pieces topple.
  - A repeat roll on the same pair within 3 s skips the shake (1.05 s).
  - The result lingers until the next roll, a selection change, or 2.5 s after the engagement.
  - **Blitz ≤ 3.0 s total** at any length: the first roll 700 ms, middle rolls
    `max(180, 600 × 0.75^(k−1))` ms without a tumble, the final roll 700 ms with the full verdict.
    Scale the middle rolls down to fit the cap. The renderer uses `opts.seq` (§11) to know the roll
    index and count.
  - `opts.style === 'brief'` (AI vs AI): no dice. The arrow shows, the defender's badge ticks down with
    hit flashes, then the tile flips. **≤ 0.8 s per engagement.**
- **Conquest**: the color floods from the entry edge (600 ms) with one ripple ring. The pieces march
  along an arc (500 ms, starting at +150 ms).
- **Fortify**: pieces glide along the owned path, 220 ms per hop, ≤ 900 ms total.
- **Continent gained**: the contour flares in the owner's color (250 in / 400 hold / 500 out).
- **Elimination**: a 1.6 s color wave in the eliminator's color. No camera push.
- **Victory**: a 2.4 s board wave, then an attract orbit at 4°/s behind the victory screen.
- **Deal**: flips in waves, ≤ 2.5 s. Multi-tile staggers use 35–50 ms per tile, with the total spread
  capped at 1.2 s.
- **Instant (speed 0)**: no tweens, but dice still appear on their final faces and linger.
- **Reduced motion**: steady outlines instead of pulses; no automatic camera moves; dice fade in on
  their faces; the flood becomes a 250 ms crossfade. Every animated signal keeps a static cue.
- SFX fire on the **contact frame** (±30 ms), not at tween start. See UX.md §5.4 for volume, pan and
  rate rules. No sound on tile hover.

### Boot
- `index.html` sets `background: #0c0f13` inline. Fonts are preloaded.
- `renderer.compile()` runs on every material, and one hidden dice + flood frame renders at boot, so
  the first roll never stutters.
- The canvas fades in over 400 ms. One BoardView lives for the whole session: menus float over the
  attract-mode board.
- Tweens use a clamped delta (≤ 50 ms per step), so a hidden tab never hangs the queue.

### Performance budget
60 fps at 1440p on an Apple-silicon MacBook (measure headless with the Metal flags in §9);
P95 frame < 20 ms during a blitz. Instance or merge where it matters; no per-frame allocations in hot paths;
dispose GPU resources.

### Sandbox
`render-sandbox.html` + `src/render/sandbox.ts`: loads the board and plays a scripted/AI event stream so
the renderer can be exercised without the UI.

---

## 7. Controller + UI (`src/game/`, `src/ui/`)

### Look
Same world as the board: smoked-glass dark panels (`rgba(12,15,19,.72)`, backdrop blur), hairline
muted-brass borders, warm ivory text, and a brass accent.
- **Brass (`#c2a062`) fills at most one primary button per state.** In "click the board" states no
  button is brass.
- Cinzel is for titles, banners, the hand-off name, and continent labels, **never numbers**. Every
  numeral is Inter with `tabular-nums lining-nums`. Minus is `−` (U+2212).
- All sizes are in rem. Minimums at 100%: action line 1 20 px, body/roster 15 px, log 13 px.
- UI motion follows UX.md §8.2: panels 220 ms in / 140 ms out, buttons press on pointerdown. UI motion
  is never scaled by animation speed. Respect reduced motion (UX.md §10.4).
- Use the `frontend-design` skill for direction. Nothing may look like a default web form: no text
  selection, no mouse-click focus rings, no context menu on HUD panels.
- Seat **emblems** (crimson ▲, cobalt ●, emerald ■, amber ◆, violet ★, rose ✚, inline SVG) appear
  wherever a seat does: badge, roster, player chip, banners, battle panel, log, and hand-off.

### Screens
1. **Title**: game name over the board in attract mode. New game · Continue (if a save exists) · How to
   play (opens the rules card) · Settings · Text size.
2. **New game** (copy and defaults are in UX.md §4.1):
   - **Seats**: 2–4, each with name, color (unique), Human/AI + difficulty. Default colors for seats
     1–4 are **crimson, cobalt, amber, rose**.
   - **Length**:
     - `Quick · 60% or 12 rounds` (`dominationPercent 60`, `turnLimit 12`)
     - **`Evening · 70% of the world` (default)**
     - `Full conquest · every territory` (100)
     - Each option shows a time estimate (placeholder until §11.1 lands).
   - **Setup**:
     - **`Quick deal` (default)**: random deal + auto placement.
     - `Place your own · ~3 min`: random deal + manual placement in two passes, with
       `setupBatch = ceil((startingArmies − floor(42/n)) / 2)`.
   - A one-line summary above the big Start button. The House rules drawer holds draft, card values,
     fortify rule, batch, and seed.
   - Remembers the last setup.
3. **In game HUD** (layout in UX.md §9)
   - **Top bar**:
     - player chip (color, emblem, name)
     - round chip (`Round 7` / `Round 7 of 12` / brass `Final round`)
     - phase stepper Reinforce → Attack → Fortify
     - `Next set +10` chip (pulses once when the value steps up)
     - AI speed toggle `AI: watch · fast · skip` (shown while an AI seat is alive; always clickable)
     - menu
   - **Roster** (left, ≤ 220 px), per seat:
     - emblem, name, AI tag
     - territories as `24 / 30` with a thin progress bar toward `territoriesNeeded`
     - armies, income, continents held
     - a card-count chip: brass at 4, `must trade` at 5+
     - Eliminated seats stay as an epitaph: `SAM · out in round 7 · by John`.
     - Clicking a row highlights that seat's territories. During an AI attack on a human, the human's
       row glows in their color.
   - **Right rail**: collapsed (≤ 56 px) by default. **Cards** (badge `Set ready +8`) and the
     **battle log** open as drawers. The log shows one line per engagement.
   - **Battle panel** (bottom-center, above the action bar), shown whenever an attack is armed or
     rolling, including AI attacks on a human:
     - header `JOHN ▲ URAL 8` vs `SAM ● SIBERIA 3`
     - odds in number + word: `Blitz · 82% · likely` (≥ 85 almost sure, 60–84 likely, 40–59 coin
       flip, < 40 long shot)
     - ≤ 2 **stakes** lines from a pure `attackStakes(state, from, to)` in `src/game/`: wins the game
       › knocks out a player › completes a continent › breaks a continent › first conquest earns a
       card
     - the result line (`Sam loses 2`) and the blitz tally (`URAL 8 → 5 · SIBERIA 3 → 0 · 58%`)
     - The renderer draws the dice inside this panel's band.
   - **Action bar** (bottom center):
     - Fixed size: height 5.25 rem, width `min(920px, 94vw)`, a 3 px top edge in the player's color.
       It never resizes between phases.
     - **Line 1** always says what to do, with real names and numbers. **Line 2** carries the *why*
       when the seat's Hints are on (default on for humans; a chip in the bar toggles them), otherwise
       status only.
     - Buttons that don't apply are disabled with a reason on hover, never removed. Every button shows
       its keycap. Full copy table: UX.md §7.2.
     - Reinforce:
       - armies-left counter and receipt chips (`14 territories → 4` · `North America +5` ·
         `Cards +8`)
       - `Undo`
       - trade chip `Trade 3 cards · +8` with one click trading the preselected best set; when
         forced, the primary becomes `Trade for +10`
       - `Choose cards` for a manual pick
       - `Begin attack →`
     - Attack:
       - `Roll` (secondary) and `Blitz` (brass primary)
       - a small dice toggle `3 · 2 · 1` (default max)
       - card status `No card yet · take 1 territory to earn one` / `Card earned ✓`
       - exits `Fortify →` and `End turn · draw a card` / `End turn · no card`
     - Occupy (only when min < max):
       - big count, `Min` `−` `+` `Max`, mouse wheel
       - smart default (UX.md §3.3) with its one-line note
       - primary `Move 7`
     - Fortify:
       - default primary `End turn · draw a card`
       - after picking a source and destination: count (default max) and `Move 7 · ends turn`
     - Watching (an AI turn): one live narration line in the AI's color
       (`Cobalt attacks Siam from India · Sam defends`).
     - Empty states have their own copy: `No attacks left · every border army is down to 1`,
       `Nothing to move · End turn`, `Need 1 more of any kind, or a third match`.
   - **Territory tooltip** after 350 ms still (instant between tiles once visible):
     - name, `Europe · +5`, owner, armies
     - one line from `explainTerritory`: what a click does now, or why it can't
     - hidden during animations
   - **Announcements** (ladder in UX.md §5.2):
     - **Tier 0**: conquest, card drawn, small trade: sound + board + log only.
     - **Tier 1**: continent gained or broken, a trade ≥ 10, an upset (`HELD!` / `AGAINST THE ODDS`),
       the first time a player is within 5 of the goal, the final round. Top-center banner, 1.2 s
       hold, never blocks input.
     - **Tier 2**: elimination (1.6 s).
     - **Tier 3**: victory.
     - Rules: ≤ 1 banner and ≤ 2 toasts at once. Nothing enters while dice tumble. AI-turn banners
       within 2 s merge into one line.
   - **Turn banner** (every turn, non-blocking; in 280 ms, hold 1.1 s or 1.9 s with a recap, out
     200 ms; any click dismisses it):
     - `SAM'S TURN`
     - `+9 armies · 14 territories → 4 · North America +5`
     - for human seats from round 2, ≤ 2 recap lines built by the controller from the event stream
       since that seat's last turn: `Sam took Ukraine and Ural from you` / `Quiet round · nobody
       touched you`
4. **Hand-off cover** (setting `Hide cards between turns`, **default off**). When on, it fires only if
   the incoming seat is human, 2+ humans play, they hold ≥ 1 card, and it isn't setup.
   - Mounted at full opacity in the same frame the turn ends, so zero frames of the next hand show.
   - Blurred live board behind it, `Pass to Sam`, `+9 armies waiting · 3 cards`, and
     `I'm Sam · start turn`.
   - `turnStarted` playback waits for it.
5. **Pause menu** (Esc): Resume, Settings, Rules, Save & quit to title, Restart, and **End game now**.
   End game now confirms `End the game now? Crimson wins on territories (24 of 42).`, then goes to
   Victory with `Called in round 14`, ranked by territories, then armies. It is controller-only: the
   engine isn't told, and the save is cleared.
   - When every human is eliminated, show the non-modal card `All humans are out.` with
     `[Watch the AIs finish · fast]` and `[End game]`.
6. **Victory**:
   - the winner banner in their color (2.5 s)
   - ≤ 3 award cards: **Nemesis** (most territories taken from one player), **Hot/Cursed dice**
     (actual minus expected defender losses; expected values per roll are in UX.md §4.6),
     **Biggest cash-in**
   - the territories-over-time chart from `timeline`
   - `Rematch` (same seats, new seed, one click) / New setup / Title
   - the full stats table behind `Full stats`
7. **Rules card** (`?`, Pause → Rules, and the title's How to play): one static screen with five
   2-line blocks, this game's house rules and goal, and the shortcuts.

### Input model
- Click-to-select; the board highlights legal choices at every step (`setHighlights`).
- Every click is **pre-validated** by `src/game/explain.ts`, which is built only from engine helpers.
  A refused click swaps action-bar line 1 to the reason for 2.2 s, with a soft `uiError`. No shake, no
  toast. Reason codes and copy are in UX.md §7.3. Engine errors are a fallback only.
- Setup-place (manual): clicks stage local ghosts (`pending`), right-click removes one, and
  `Confirm placement` dispatches the `placeSetup` actions, so misclicks are free.
- Reinforce:
  - Click an own tile = +1, applied immediately. Right-click = −1 of this phase's placements.
  - After the first click, an HTML pill cluster `+5` · `All 8` anchors under that tile's badge; hold
    `+5` to repeat. Shift = +5 and Alt/⌥ = all are keyboard extras.
  - At 0 remaining, clicking an enemy (or an own tile that can attack) sends `endReinforce` and
    continues as an attack click.
- Attack:
  - **Target-first**: clicking an enemy picks your adjacent tile with the most armies (≥ 2) as the
    source and arms the attack. Clicking another own tile switches the source.
  - Source-first also works.
  - Clicking the armed target again = Roll once (max dice). Space/B = Blitz (`stopAt: 1`).
  - After occupy, auto-select `to` as the next source if it can attack, else keep `from` if eligible.
  - **A board click during occupy confirms the default count and then performs the click.**
- Occupy / fortify: count controls in the action bar, defaulting as specified. Enter/Space confirms.
- Keyboard:
  - **Enter** = the brass primary.
  - **Space** = commit only (Blitz, confirm occupy/move/trade/placement). It never ends a phase, and
    it's ignored for 300 ms after it skips an animation.
  - **E** = the exit button (`Fortify →` / `End turn`).
  - B = blitz, 1/2/3 = dice, Esc = back out one level, then pause.
  - Tab = cycle the currently clickable tiles. F = focus the selection. L = labels, M = mute,
    ? = rules card.
- For 250 ms after a human→human turn change, board clicks are ignored.

### Controller (`src/game/`)
- Owns the `GameState`, applies actions via the engine, queues events, drives `BoardView.playEvent`,
  updates the HUD per event, then syncs.
- **Event classes**:
  - **Non-blocking** (not awaited before the next input): `armiesPlaced`, `territoryClaimed`,
    `setupTurn`, `phaseChanged`, `cardDrawn`, `controllerChanged`.
  - **Blocking** (everything else): on the current human's turn, any click or commit key calls
    `skipAnimations()`, waits for the drain + `syncState`, then processes the input (click-through).
    Exceptions: the first 500 ms of an elimination and the first 1.5 s of victory ignore input.
  - During watched turns a click only skips.
- **No spoilers**: roster, cards, income, log and tally deltas apply when each event's `playEvent`
  resolves. The drain-time `syncState` + HUD render must produce no visible change.
- **AI driver (highlight reel)**. Budget at `watch`: median AI turn ≤ 6 s, p95 ≤ 12 s. After 10 s, the
  rest of the turn plays at instant.
  - Reinforce and trades: loop `chooseAiAction` → `applyAction` without animating, then play the
    collected placements as one staggered beat ≤ 1.0 s.
  - Consecutive attacks on the same from→to pair form one engagement. The AI's occupy applies at once
    and plays as the march.
  - Think time only at decision points: 350 ms at turn start, 200 ms between engagements, 0 inside an
    engagement.
  - Engagements where the defender is human play `style: 'full'` (400 ms telegraph of the arrow +
    battle panel, then the dice). AI vs AI plays `style: 'brief'` (≤ 0.8 s, no dice).
  - At turn start, frame the AI's first engagement region once if it's off-screen.
  - AI speeds: `watch` (default) · `fast` (0.4× budgets, all fights brief) · `instant` (snap per turn,
    300 ms beat, the turn banner still shows).
- **Recap ledger**: per human seat, collect the events since their last `endTurn` (territories lost
  and to whom, continents lost, eliminations, trades ≥ 10, anyone newly within 5 of the goal) for the
  turn banner (UX.md §6.2).
- **Upsets** (should): record `winProbability` when an engagement starts. If it fails at ≥ 75% →
  `HELD!`. If it succeeds at ≤ 30% → `AGAINST THE ODDS`.
- **Award ledger**: collect `diceRolled` / `territoryConquered` / `cardsTraded` for the Victory awards.
- Pure helpers in `src/game/`, all derived from state + `mapData` + engine helpers, with unit tests:
  - `explainTerritory`
  - `attackStakes`
  - `bestSet` (max `setValue`, then +2 territory bonus, then keep wilds)
  - `occupyDefault`
  - `autoSource`
  - `oddsWord`
- Autosave to `localStorage` (`risk3d.save.v1`) after every applied action; Continue restores it. UI
  meta (per-seat hints, first-time flags) is saved alongside in `risk3d.ui.v1`.

### Settings (persisted, `risk3d.settings.v1`)
- Animation speed (1× / 2× / instant; board only), AI speed (watch / fast / instant), text size
  (Laptop 1.0 / Couch 1.25 / TV 1.5; drives rem and `setUiScale`)
- Territory labels, `Hide cards between turns` (off), SFX volume, music on/off (default off), reduce
  motion, show win chance (on)
- "Auto-camera" now means only: return home at turn start if the user moved it.

---

## 8. Audio (`src/audio/`)

WebAudio synthesis only (noise bursts, filtered oscillators, envelopes): no audio files.
Unlock the context on the first user gesture.

```ts
export type SfxName = 'uiClick' | 'uiHover' | 'uiError' | 'place' | 'unplace' | 'diceShake' |
  'diceLand' | 'hit' | 'conquer' | 'march' | 'cardDraw' | 'cardTrade' | 'continent' |
  'eliminated' | 'victory' | 'turnStart' | 'whoosh';
export interface AudioEngine {
  unlock(): void;
  play(name: SfxName, opts?: { volume?: number; pan?: number; rate?: number }): void;
  setVolume(v: number): void;   // 0..1 master for SFX
  setMuted(m: boolean): void;
  setMusic(on: boolean): void;  // optional ambient bed
}
export function createAudio(): AudioEngine;
```
Tasteful and short: wooden clacks, felt thuds, brassy stingers. No harsh or piercing sounds; normalize
loudness across effects. `audio.html` dev page with a button per sound.

---

## 9. Test hooks and verification

`window.__risk` (always present; cheap):

```ts
{
  getState(): GameState | null
  newGame(config?: Partial<GameConfig> & { players?: PlayerConfig[] }): void   // skips menus
  dispatch(action: Action): { ok: boolean; error?: string }
  isIdle(): boolean                  // no queued/running animations, no pending AI think
  waitIdle(timeoutMs?: number): Promise<void>
  setSpeed(animation: number, ai?: 'watch' | 'fast' | 'instant'): void
  autoplay(on: boolean): void        // AI plays every seat (for soak/e2e)
  screenPos(t: TerritoryId): { x: number; y: number } | null
  stats(): BoardStats                // incl. activeTweens, cameraMoving, particles (§11.2)
  ui(): {
    screen: string
    actionBarText: string            // line 1
    actionBarSub: string             // line 2 ('' when empty)
    primary: string | null           // label of the brass button, if any
    buttons: { label: string; enabled: boolean; why?: string }[]
    banners: string[]; toasts: string[]
    battle: { header: string; odds: string | null; stakes: string[]; result: string | null } | null
    recap: string[]                  // current turn banner's recap lines
    tooltip: string | null
    hints: boolean                   // current seat
  }
  explain(t: TerritoryId): { ok: boolean; code?: string; text: string }   // explainTerritory now
  metrics(): {
    turns: { player: PlayerId; kind: 'human' | 'ai'; ms: number; clicks: number; rejected: number;
             forcedWaitMs: number }[]    // turnStarted → next turnStarted
    rolls: { blitz: boolean; count: number; ms: number; style: 'full' | 'brief' }[]  // per engagement
    maxCameraDegPerSec: number; cameraMovesDuringHumanInput: number
    inputDropped: number             // clicks received but not applied or skipped
  }
  resetMetrics(): void
}
```
Clicks in e2e go through real pointer events at `screenPos(t)`, so click counts and the gesture rules
are exercised for real. Add Playwright flows for: the §10 click budgets, a 1-human + 3-AI round timed
by `metrics().turns`, every reason code via `explain` + a real click, and resume mid-occupy.

Headless browser checks: use Playwright directly from a node script (NOT agent-browser, NOT the Browser
pane). For real GPU numbers launch with
`chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })`.
Save screenshots under `artifacts/<your-area>/` and open them with the Read tool — look at your work.
Start your own dev server on the port assigned in your brief (`npx vite --port <p> --strictPort`) and
stop it when done.

## 10. Definition of done (whole game)

- A 4-human hot-seat game and a 1-human-vs-3-AI game are fully playable start to victory with only the
  mouse.
- Every rule in §2 is enforced and unit-tested; the 200-game soak passes. The §7 pure helpers
  (`explainTerritory`, `attackStakes`, `bestSet`, `occupyDefault`, `autoSource`) are unit-tested.
- Always obvious what to do next: `ui().actionBarText` is never empty across a 4-seat autoplay soak.
  Every refused click shows reason-code copy (never a raw engine string, never a shake).
- 60 fps; no console errors; resume after reload works mid-turn, including mid-occupy and
  mid-reinforce.
- Looks like a premium board game in screenshots at 1440×900 and 1920×1080; readable on a 1280×800
  laptop, and at TV text size on 1920×1080.
- **Feel budgets** (measured with `__risk.metrics()`, 1× / `watch`):
  - Clicks, mouse only:
    - all reinforcements on one tile = 2; a 2-way split ≤ 5
    - attack + conquer from nothing selected = 2 (+0 occupy when chaining)
    - skip fortify = 1
    - a typical full turn (reinforce, 3 conquests, end) ≤ 12
  - Forced wait on a human's own turn = 0 (click-through works everywhere except the elimination and
    victory holds).
  - 10 clicks in 1.5 s on one tile = exactly +10 (`inputDropped` 0).
  - Timings:
    - single roll ≤ 1.2 s
    - any blitz ≤ 3.0 s
    - brief AI-vs-AI engagement ≤ 0.8 s
    - AI turn median ≤ 6 s, p95 ≤ 12 s; a full round with 3 AIs ≤ 25 s
  - From Start (Quick deal) to the first reinforce click ≤ 20 s. Manual setup with 1 human + 3 AI
    ≤ 1 min.
  - `cameraMovesDuringHumanInput` = 0; automatic camera ≤ 45°/s.
  - Hover ≤ 1 frame; click → first visible effect ≤ 50 ms.
  - The idle board reports `activeTweens` 0.
  - ≤ 1 banner and ≤ 2 toasts on screen at any time.
  - Badges ≥ 22 px tall at home on 1280×800; dice ≥ 56 px; no frame > 50 ms on the first roll after a
    cold load.
- The UX.md §11 polish checklist passes, and an Opus review with the UX.md §12 rubric scores ≥ 8 on
  every axis and ≥ 9 on Flow and Clarity.

---

## 11. Engine and contract follow-ups (the lead applies these; builders don't edit contracts)

Everything else in the UX plan is derived UI-side from existing state, events and helpers. These are
the only contract or tooling changes it needs. All are additive.

### 11.1 Sim: rounds to threshold (`scripts/simulate.ts`; APPLIED at integration)
Print the mean and p90 of the rounds until any player first reaches 60% / 70% / 100% of territories,
split by 2 / 3 / 4 players, for normal-difficulty AIs. The New game length estimates are relabeled from
these × measured seconds per round.
- As built: `npm run sim` prints mean / median / p90 for 60 / 70 / 75 / 80 / 100% (75/80 are the
  2-player presets) over `max(40, N/2)` random-deal games per player count. The table is pasted into
  `src/game/presets.ts` (`ROUNDS`); the estimate multiplies it by 80 s per human turn and 5 s per AI
  turn (measured at `watch`).

### 11.2 `src/render/BoardView.ts` (APPLIED by the lead)
```ts
export interface PlayEventOptions {
  /** 'full' (default): dice tray + full timings. 'brief': AI-vs-AI; no dice, ≤ 0.8 s per engagement. */
  style?: 'full' | 'brief';
  /** For consecutive diceRolled events of one engagement (blitz or repeated rolls): 0-based index and
   *  total count, so the renderer can compress to the blitz cap and slow the final roll. */
  seq?: { index: number; count: number };
}
// BoardView:
playEvent(event: GameEvent, stateAfter: GameState, opts?: PlayEventOptions): Promise<void>;
/** HUD-covered edges in CSS px. The home view frames the board inside the rest; the dice tray sits
 *  just above `bottom − trayBand`. */
setViewportInsets(insets: { top: number; right: number; bottom: number; left: number; trayBand: number }): void;
/** UI text-size multiplier (1, 1.25, 1.5) for badges, the dice tray and DOM labels. */
setUiScale(scale: number): void;
// BoardStats: add optional
activeTweens?: number; cameraMoving?: boolean; particles?: number;
```
The controller already knows the whole event batch, so it passes `seq`. The renderer also needs the
emblem (from palette) and player names (from `stateAfter`) for the tray; no other contract change is
needed.

### 11.3 `src/shared/palette.ts` (APPLIED by the lead)
- Add `emblem: 'triangle' | 'circle' | 'square' | 'diamond' | 'star' | 'cross'` to `PlayerPalette`:
  crimson triangle, cobalt circle, emerald square, amber diamond, violet star, rose cross. Render and UI
  draw them as the same inline SVG paths; export them as `EMBLEM_PATHS: Record<emblem, string>`
  (24×24 viewBox).
- Violet: `base '#b48be8'`, `deep '#6a45a8'`, `light '#dccbf6'`, `ink '#1c1030'`. The current
  `#8a5ad6` is ΔE00 2.7 from cobalt for protanopes (UX.md §10.1). Do not change emerald.
- Add `export const DEFAULT_SEAT_COLORS: PlayerColorId[] = ['crimson', 'cobalt', 'amber', 'rose'];`

### 11.4 AI behavior (soft request; VERIFIED at integration; no contract change)
Prefer one `reinforce` with a count over many single-army actions, and `blitz` over repeated single
attacks when the intent is "take it". The controller coalesces either way; fewer events just means
fewer log lines and simpler replays.
- As built: the engine AI already does both. `npm run sim` now prints the action shape and fails if
  single rolls exceed 5% of blitzes (200-game run: 9.1 armies per reinforce action, 128 454 blitzes,
  0 single rolls).

### 11.5 As built (integration notes; where the build differs from the letter above)
- **Dice tray**: its own pixel-mapped scene drawn after a depth clear (not a camera-attached group in
  the main scene), with matching lights, so it sits exactly in the UI's CSS-px band. The UI sizes the
  band (`solveBand` in `src/ui/index.ts`) with the renderer's tray formula (`src/render/dice.ts`
  `layout()`); change both together. `tests/e2e/feel` checks the alignment at every target size.
- **Shadows**: three r186 removed `PCFSoftShadowMap`; shadows use `PCFShadowMap` with a blur radius.
- **Bloom**: not built (optional); rims, dice verdicts and the continent flare use emissive/ivory.
- **Long blitzes** (~15+ rolls): the 3.0 s cap wins over the 120 ms middle-roll floor.
- **Pan clamp**: keeps the look-at point on the board (a literal "board centre on screen" would forbid
  inspecting corners at 3.5×). The ≤ 8° pitch limit applies to framing moves; the turn-start return
  home restores home pitch (≤ 45°/s peak).
- **Territory names** (setting on by default): a name that would overlap another badge or name sits
  above its badge instead, or hides; hover tooltips always name the tile.
- **Test hooks**: dev builds also expose `window.__board` (the BoardView, for its `__debug` layout
  data) and `window.__audio`. `npm run test:e2e` runs every flow in `tests/e2e/` on the real board and
  HUD (own server on :5290).
