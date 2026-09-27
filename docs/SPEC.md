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
| `src/shared/palette.ts` | Player colors |

---

## 1. Architecture

```
src/engine/      pure TS, no DOM. Rules, reducer, setup, RNG, AI. Runs in browser and Node.
src/map/         board.json (generated) + loader. Geometry only.
scripts/         build-map.ts, verify-map.ts, simulate.ts (AI-vs-AI soak)
src/render/      Three.js board: scene, tiles, pieces, dice, effects, camera, picking.
src/game/        controller: event queue, input state machine, AI driver, save/load, hooks.
src/ui/          HTML/CSS overlay: menus, HUD, dialogs, cards, log, settings, victory.
src/audio/       WebAudio-synthesized SFX (no audio files).
src/main.ts      boot.
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
Input is locked while events are animating, except "skip" (Space/click-to-skip) which calls
`board.skipAnimations()`.

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
  finish, slightly desaturated), darker sides, a thin light edge highlight. Unclaimed = parchment.
  Continents read as groups: a soft colored contour around each continent + a label on the ocean
  ("ASIA · +7") in engraved serif caps. Territory names optional (toggle), small, legible.
- **Armies**: each territory shows a miniature piece group in the owner's color (e.g. infantry/cavalry/
  artillery figurines or a banner-topped stack, height grows with strength) **plus a count badge that is
  always legible** from the default camera (billboarded, high contrast, tabular numerals).
- **Sea lanes**: dashed, softly glowing ivory arcs over the ocean. Alaska–Kamchatka runs off the left
  edge and back in on the right.
- **Lighting**: warm key light with soft shadows (PCFSoft), cool fill, hemisphere ambient, ACES tone
  mapping, sRGB output. Optional subtle bloom only on highlights. Cap devicePixelRatio at 2.
- **Camera**: perspective ~35–40° FOV, default framing the whole board tilted ~50–60° from horizontal.
  Orbit (limited: never under the table), zoom (limits), pan (clamped to the board), all damped.
  Scroll zooms toward the cursor. `focusTerritories` eases (~600 ms). Double-click a tile to focus it.

### Animations (all interruptible by `skipAnimations`, scaled by speed)
- **Hover**: tile lifts ~15%, brightens; cursor pointer. **Selected**: lifted + rim glow.
  **Targets**: pulsing outline. **Dim others** when choosing a target.
- **Place armies**: pieces drop in with a small bounce + dust puff; badge ticks up.
- **Attack**: an arrow arcs from attacker to defender. 3D dice (attacker in the attacker's color,
  defender in the defender's color, readable pips) tumble and land on the engine's predetermined faces;
  pairs line up and compare (winner glows, loser cracks/fades); loss hits flash on the tiles and pieces
  topple. Blitz: the same, faster, with the running tally — never a 40-second wait.
- **Conquest**: the tile's color floods from the attack direction to the new owner's color with a
  ripple; pieces march along an arc into the new territory.
- **Fortify**: pieces glide along the owned path.
- **Continent gained**: the continent contour flares in the owner's color.
- **Elimination / victory**: a dramatic board-wide moment (color wave, camera push). Victory: attract-mode
  orbit behind the victory screen.
- **Turn start**: the camera eases to frame the current player's territories (setting: auto-camera).

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
muted-brass borders, warm ivory text, brass accent. Display serif caps for titles/banners
(Cinzel is installed; Fraunces / Cormorant also installed), Inter Variable with tabular numerals for data.
UI motion 160–320 ms ease-out; banners can spring. Respect `prefers-reduced-motion`.
Use the `frontend-design` skill for direction. Nothing may look like a default web form.

### Screens
1. **Title**: game name over the board in attract mode. New game · Continue (if a save exists) · How to play · Settings.
2. **New game**: 2–4 seats (add/remove), each: name, color (unique), Human/AI + difficulty. "House rules"
   drawer: setup mode, placement (manual/auto + batch), card values, fortify rule, win condition
   (World domination / 70% / turn limit), seed (hidden under advanced). Big Start button.
   Remembers the last setup.
3. **In game HUD**
   - Top: current player chip (color, name), round, phase stepper Reinforce → Attack → Fortify, with the
     current step lit.
   - Left: player roster — color, name, AI badge, territories, armies, cards held (count), reinforcement
     income, continents held (icons); eliminated players greyed with a skull/strike. Clicking a player
     highlights their territories.
   - Bottom center: the **action bar**, context-specific and always telling the player what to do next
     in one line ("Place 7 armies · click your territories", "Choose a territory to attack from").
     - Reinforce: armies left, Undo last / right-click a tile to remove, Trade cards button (badge when a
       set is available, forced when 5+), "Begin attack →".
     - Attack: selected from/to, dice 1/2/3 (default max), live win chance for a blitz, Attack, Blitz,
       "End attack →" / "End turn".
     - Occupy: slider/stepper min..max with quick buttons (min / half / max), default max, Move.
     - Fortify: from/to, count slider, Move, End turn.
   - Right: **cards** (hand face-up for the current human; select 3 to see the set value; valid sets
     suggested) and a collapsible **battle log** with readable event lines.
   - Territory tooltip on hover: name, continent (+bonus), owner, armies, "adjacent to …" on hold.
   - Toasts/banners: turn start ("Sam's turn · +9 armies"), continent captured, player eliminated,
     card earned.
4. **Hand-off screen** (hot-seat privacy): when the turn passes to a different human and 2+ humans are
   playing, a full-screen "Pass to Sam" cover hides the hand until they click "I'm Sam — start turn".
   Setting to turn it off.
5. **Pause menu** (Esc): Resume, Settings, Rules, Save & quit to title, Restart.
6. **Victory**: winner banner in their color, stats table (conquered, battles won/lost, armies destroyed/
   lost, cards traded, peak territories), a territories-over-time chart from `timeline`, Play again /
   New setup / Title.

### Input model
- Click-to-select; the board highlights legal choices at every step (`setHighlights`).
- Reinforce: click own tile = +1 (shift +5, alt/⌥ = all remaining); right-click = −1 of this phase's placements.
- Attack: click source (own, ≥2), click adjacent enemy = target → action bar arms Attack/Blitz.
  Clicking the target again = attack once with max dice. Esc clears the selection.
- Occupy / fortify: count controls in the action bar.
- Keyboard: Space/Enter = primary action of the current step, B = blitz, 1/2/3 = dice, Esc = cancel/pause,
  Tab = cycle own territories, F = focus the camera on the current selection, L = toggle labels,
  M = mute, ? = shortcuts overlay. Shortcuts are listed in the help overlay.
- Animation speed control (1× / 2× / instant) always reachable; Space skips a running animation.

### Controller (`src/game/`)
- Owns the `GameState`, applies actions via the engine, queues events, drives `BoardView.playEvent`,
  updates the HUD per event, then syncs.
- AI driver: when the current player is AI and the queue is idle, think ~250–600 ms (scaled by speed),
  dispatch `chooseAiAction`, repeat. Settings: AI speed (watch / fast / instant).
- Autosave to `localStorage` (`risk3d.save.v1`) after every applied action; Continue restores it.
- Errors from the engine surface as a gentle shake + toast, never a console-only failure.

### Settings (persisted, `risk3d.settings.v1`)
Animation speed, AI speed, auto-camera on turn start, territory labels, hand-off screen, SFX volume,
music on/off (optional ambient bed, default off), reduce motion, show win chance.

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
  stats(): BoardStats
  ui(): { screen: string; actionBarText: string; toasts: string[] }
}
```

Headless browser checks: use Playwright directly from a node script (NOT agent-browser, NOT the Browser
pane). For real GPU numbers launch with
`chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })`.
Save screenshots under `artifacts/<your-area>/` and open them with the Read tool — look at your work.
Start your own dev server on the port assigned in your brief (`npx vite --port <p> --strictPort`) and
stop it when done.

## 10. Definition of done (whole game)

- A 4-human hot-seat game and a 1-human-vs-3-AI game are fully playable start to victory with only the mouse.
- Every rule in §2 is enforced and unit-tested; the 200-game soak passes.
- Always obvious what to do next; illegal moves explain themselves.
- 60 fps; no console errors; resume after reload works mid-turn.
- Looks like a premium board game in screenshots at 1440×900 and 1920×1080; readable on a 1280×800 laptop.
