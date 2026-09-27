# Risk: War Table — UX and feel spec

Companion to `docs/SPEC.md`. SPEC says **what** to build and owns the contracts. This file says
**how it should feel**: the turn click by click, timings, copy, camera, color, and how a reviewer
scores the result. If the two disagree, SPEC wins and the builder flags the conflict in their report.

Audience: the renderer agent (`src/render/`), the UI agent (`src/ui/`), and whoever owns the
controller (`src/game/`). Section tags: **[render]**, **[ui]**, **[ctrl]**, **[audio]**.

---

## 0. The room

One laptop on a coffee table, or a TV. 1–4 humans, the rest AI. One person drives the mouse; everyone
else watches, heckles, and waits. Some friends last played Risk in 2009. The evening is 60–90 minutes
of actual play, and classic Risk is famous for dragging. So:

- The spectators are half the users. Every important beat has to read from 3 m away.
- Dead time is the enemy: AI turns, setup, hand-offs, and "wait, what happened?" moments.
- The friend who forgot the rules must never be stuck on a click that does nothing.

## 1. The core loop

**The attack beat.** Pick a target, see what the roll decides ("82% · likely · completes South
America"), commit, watch the dice land in front of the whole couch, hear the room react, then decide
whether to push again from the new ground. Everything else either loads that beat or gets out of its
way. Reinforce is loading the gun: 2–5 clicks. Occupy and fortify are bookkeeping: 0–1 click with
smart defaults. Turn changes and AI turns are downtime: under 2 s of ceremony, or a short highlight
reel that shows only what matters to the humans in the room. Around the beat runs a slower social loop
of grudges ("who took Ukraine?!"), continent races, and escalating card sets, and the HUD keeps those
visible so the room can gang up on the leader.

## 2. Experience principles (tie-breakers, in priority order)

1. **The room is the audience.** If it doesn't read from the couch, it doesn't count. Big dice, big
   numbers, plain words.
2. **The driver sets the pace.** Never make anyone wait for something they already understood. On your
   own turn, any click finishes the running animation and then does what you clicked.
3. **Weight follows stakes.** A fight involving a human gets the show. AI-vs-AI is a headline. Routine
   events stay quiet so eliminations and continent swings feel big.
4. **Say it before it happens.** Odds, stakes, and "ends turn" are visible before the commit. The
   labels do the work confirm dialogs would do, so there are no confirm dialogs on routine actions.
5. **Explain, don't punish.** Every refused click answers in one sentence with real names and numbers.
   No dead clicks, no shakes, no "Invalid action".
6. **Hue is ownership; the camera belongs to the driver.** Player colors are the only hues on the
   board. Interaction uses light, height, and ivory. The camera never moves on its own except to show
   something that is off-screen.
7. **Fewer things, finished.** When unsure, cut it. A smaller game done beautifully beats a big one
   done roughly.

---

## 3. The turn, click by click

Targets are mouse-only. "Click" = one pointer press on a tile or button.

### 3.1 Turn start (0 clicks, 0 s forced)

- **Turn banner** [ui], top-center, non-blocking, in the player's color:
  - Line 1 (Cinzel caps): `SAM'S TURN`
  - Line 2 (receipt): `+9 armies · 14 territories → 4 · North America +5`
    (floor case: `8 territories → minimum 3`)
  - Lines 3–4 (recap, §6.2), human seats only, from round 2.
  - Timing: spring in 280 ms, hold 1.1 s (1.9 s with a recap), out 200 ms. Any click dismisses it.
    It never blocks input.
- `turnStart` sound plays on human turns only. It plays a slightly brighter variant when a human turn
  follows one or more AI turns, so the friend on their phone looks up.
- Camera: returns to the home view only if the driver left it displaced (§8.3). No "frame my
  territories" swoop.
- Guard: for 250 ms after a human→human turn change, board clicks are ignored. This stops the
  previous player's double-click landing on the new turn.

### 3.2 Reinforce (target 2–5 clicks)

| Intent | Clicks |
|---|---|
| All on one tile | 2: tile (+1), then the pill `All 8` |
| 6/3 split | 5: tile A, `+5`, tile B ×3 |
| 20/10 split of 30 | 5–6: tile A, `+5` ×3 (or hold), tile B, `All 10` |
| Optional trade | +1: chip `Trade 3 cards · +8` |
| Forced trade | 1: primary `Trade for +10` (best set preselected) |

- Clicking an own tile = +1. The badge and the `+N` ghost update **in the same frame** as the click.
  The drop animation runs alongside and never queues input (§8.1).
- After the first click, a small **pill cluster** anchors under that tile's badge (via
  `getScreenPosition`, HTML): `+5` and `All 8`. It follows the last-clicked tile. Holding `+5` repeats
  every 150 ms.
- Right-click on a tile = −1 of this phase's placements. `Undo` sits in the action bar. Shift = +5 and
  Alt/⌥ = all remaining are keyboard extras only.
- **Implicit exit:** at `remaining === 0` (and not `mustTrade`), clicking an enemy tile dispatches
  `endReinforce` and then runs target-first attack (§3.3). Clicking an own tile that can attack does
  the same and selects it as the source. `Begin attack →` stays for people who want a button.
- Card trade (best set = highest `setValue`, then +2 if a card shows an owned territory, then keep
  wilds): the chip `Trade 3 cards · +8` shows when `validSets` is non-empty. `Choose cards` opens the
  hand for a manual pick. When a trade adds armies, `Cards +8` joins the receipt chips and the counter
  counts up (400 ms).
- Forced trade (`mustTrade`, including `midTurn` after an elimination): the bar's primary becomes
  `Trade for +10`. One click trades.

### 3.3 Attack (target 2 clicks per conquest)

- **Target-first.** Clicking an enemy with no source selected auto-picks your adjacent tile with the
  most armies (≥2; ties go to the one with more enemy-free sides). The arrow draws and the bar arms.
  - Clicking another own eligible tile switches the source.
  - Clicking an enemy the current source can't reach re-picks the best source for it.
  - If no adjacent tile of yours has 2+, the click is refused with copy (§7.3).
- **Source-first still works.** Clicking an own tile with ≥2 armies and an enemy neighbor selects it
  and its targets pulse.
- **Armed:** the battle panel (§5.1) shows the face-off, odds and stakes. Buttons: `Roll` (secondary)
  and `Blitz` (brass primary). Space/B = Blitz. Clicking the armed target again = Roll once with max
  dice. The dice count toggle `3 · 2 · 1` sits small beside Roll (default max). Blitz uses
  `stopAt: 1`.
- **Occupy** (when min < max) lives in the action bar: a big count, `Min 3` `−` `+` `Max 7`, and the
  mouse wheel adjusts. Enter/Space or the primary `Move 7` confirms. **A board click during occupy
  confirms the default and then handles the click**, so chaining costs 0 extra clicks.
- **Smart occupy default** [ctrl], a pure function of adjacency:

  | `to` borders enemies | `from` borders enemies | Default | Note shown |
  |---|---|---|---|
  | yes | no | max | `Front moves forward` |
  | no | yes | min | `Siberia is safe · keeping your stack in Ural` |
  | yes | yes | max | `Ural keeps 1 · still borders Mongolia` |
  | no | no | max | none |

- **Auto-chain after occupy.** If `to` now has ≥2 armies and enemy neighbors, select it as the source.
  Otherwise keep `from` if it's still eligible. Otherwise clear the selection.
- Card status is always on screen during attack: `No card yet · take 1 territory to earn one`, then
  `Card earned ✓` after the first conquest.
- Exits (ghost buttons, far right): `Fortify →` and `End turn · draw a card` / `End turn · no card`.

### 3.4 Fortify (target 1 click to skip, 4 to move)

- Default primary: `End turn · draw a card` (or `· no card`).
- Click a source (own, ≥2, with a reachable target), then a glowing destination. The count defaults to
  max (all but 1). Primary: `Move 7 · ends turn`.
- No legal moves: `Nothing to move · End turn`.

### 3.5 A typical human turn, totalled

Reinforce all on one tile (2) → three conquests, chained (2 + 2 + 2, occupy defaults 0) → End turn (1)
= **9 clicks**. Budget: **≤ 12 clicks** and **0 s forced waiting**. At 1× with no skipping, the
uninterrupted animation time for a 3-blitz turn is ≤ 10 s.

---

## 4. The evening arc

### 4.1 New game → first click (≤ 3 clicks, ≤ 20 s on Quick deal)

New game screen, top to bottom:

1. **Seats** (2–4): name, color, Human/AI + difficulty. Defaults for seats 1–4: **crimson, cobalt,
   amber, rose**. That is the most color-blind-safe 4-set (§10.1). The last setup is remembered.
2. **Length** (segmented, with honest estimates):
   - `Quick · 60% or 12 rounds · ~40 min`: `dominationPercent 60`, `turnLimit 12`
   - `Evening · 70% of the world · ~60–90 min` (**default**): `dominationPercent 70`
   - `Full conquest · every territory · 2–3 h`: `dominationPercent 100`

   The minute figures are placeholders until the sim reports rounds-to-threshold (SPEC §11.1). Relabel
   them then.
3. **Setup** (segmented):
   - `Quick deal · armies placed for you` (**default**): random deal + auto placement.
   - `Place your own · ~3 min`: random deal + manual placement in **two passes**. The controller sets
     `setupBatch = ceil((startingArmies − floor(42 / n)) / 2)`, which is 10 for 2p and 4p and 11 for
     3p.
   - Draft sits in the House rules drawer with the note `adds ~10 min`.
4. One summary line above Start: `Territories dealt at random · armies placed for you · first to 30
   territories wins`.
5. **Start** (brass). The House rules drawer holds the raw knobs: cards, fortify rule, draft, batch
   size, seed.

Start: the menus crossfade out (360 ms) while the camera eases from attract orbit to home (900 ms).
The deal plays (`territoriesDealt`, waves of flips, ≤ 2.5 s, click to skip), then auto placement
(staggered drops, ≤ 1.2 s spread), then the first turn banner.

### 4.2 Manual setup ("Place your own")

- Staged: clicks add local ghosts (`BoardHighlights.pending`), right-click removes, and the pills work
  as in §3.2. The bar reads `Place 10 armies · 4 left`. Primary: `Confirm placement`, disabled with
  `Place 4 more` until 0 are left. Confirm dispatches the `placeSetup` actions, so misclicks are free.
- AI setup turns play as one reinforce-style beat, ≤ 0.8 s each.
- **No hand-off cover during setup, ever.**
- Targets: 4 humans ≤ 4 min; 1 human + 3 AI ≤ 1 min.

### 4.3 Early game (rounds 1–3)

A land grab. Fights are small and turns short (60–90 s). The HUD's job is to teach: hints on, the
receipt explains income, and the card line explains why taking one territory matters.

### 4.4 Mid game

Continents and cards drive it. The HUD keeps the race visible:
- Roster `24 / 30` with a thin progress bar toward the win threshold.
- The `Next set +10` chip in the top bar pulses once when the value steps up.
- Held continents' ocean labels take the holder's color (`ASIA · +7` in cobalt). At one territory
  short, the label adds `· 1 AWAY` in that player's light tint [render, should].
- Tier-1 banner the first time any player comes within 5 of the goal: `JOHN IS 5 FROM VICTORY` /
  `26 of 30 territories`.

### 4.5 Endgame and escape hatches

- **All humans out**: a non-modal card appears immediately: `All humans are out.` with
  `[Watch the AIs finish · fast]` and `[End game]`. Watch sets AI speed to instant with a 300 ms beat
  per turn.
- **Pause → `End game now`**: a confirm (the only confirm in the game besides Restart):
  `End the game now? Crimson wins on territories (24 of 42).` with `[End game]` and `[Keep playing]`.
  It goes to Victory with the subline `Called in round 14`, ranked by territories, then armies. This
  is controller-level only: the engine isn't told, and the save is cleared.
- **Turn limit**: the round chip reads `Round 9 of 12`, and `Final round` in brass on the last one.

### 4.6 Victory

Winner banner in their color (`CRIMSON RULES THE WORLD`, hold 2.5 s, attract orbit behind it). Then up
to **3 award cards** dealt 250 ms apart (only awards with ≥ 3 supporting events):

- **Nemesis**: the pair with the most territories taken. `Sam took 11 territories from John`
- **Hot dice / Cursed dice**: actual minus expected defender losses, summed over the player's attack
  rolls. `John: +6 armies of pure luck`. Expected defender losses per roll: 3v2 1.079, 3v1 0.660,
  2v2 0.779, 2v1 0.579, 1v2 0.255, 1v1 0.417.
- **Biggest cash-in**: `+20 · round 11`

After that comes the territories-over-time chart. Buttons: `Rematch` (brass; same seats, new seed, one
click), `New setup`, `Title`. The full stats table sits behind `Full stats`.

---

## 5. Drama beats

### 5.1 The battle panel (dice tray + stakes) [render + ui]

One fixed place on screen where every fight happens. It sits bottom-center, just above the action bar.
The home view keeps this band clear of the board (§8.3). The panel never moves: one place to look.

- **Header** [ui, HTML]: `JOHN ▲ URAL 8` vs `SAM ● SIBERIA 3`, names in each owner's light tint with
  the seat emblem. Inter 600 caps, 2.2vh.
- **Odds** [ui]: `Blitz · 82% · likely`, 3vh, tabular. Bands: ≥ 85 `almost sure`, 60–84 `likely`,
  40–59 `coin flip`, < 40 `long shot`. The words are always present, and there is never a decimal.
  The percentage respects the `show win chance` setting; the words and stakes always show.
- **Stakes** [ui]: up to 2 lines, highest priority first, from a pure helper
  `attackStakes(state, from, to)` in `src/game/` using `mapData` and state:
  1. `WINS THE GAME` (a conquest reaches `territoriesNeeded`)
  2. `KNOCKS OUT SAM · takes his 4 cards`
  3. `COMPLETES SOUTH AMERICA · +2 a turn`
  4. `BREAKS SAM'S EUROPE · −5 a turn for Sam`
  5. `First conquest this turn · earns a card` (only while `!conqueredThisTurn`)

  Lines 1–2 are brass and 20% larger. With no stakes, show the odds only; never pad.
- **Dice** [render]: a camera-attached group in the main scene (same lights and materials, depth
  cleared, rendered after the board). Size **8vh (min 56 px)**. Attacker dice on the **left** in the
  attacker's base color with ink pips, defender dice on the **right**, both sorted high to low so pairs
  face each other across the middle. Keyframed, no physics, landing on the engine's faces. The
  sequence is in §8.2.
- **Result line** [ui], under the dice, 3vh: `Sam loses 2` / `Each loses 1` / `John loses 2`. With
  hints on, tie columns get a micro-label `tie → defender`.
- **Linger**: the last roll stays until the next roll, a selection change, or 2.5 s after the
  engagement ends, then fades out over 200 ms.
- **Blitz tally** [ui]: `URAL 8 → 5 · SIBERIA 3 → 0 · 58%`. The odds recompute after each roll from
  the displayed counts.
- An AI attack on a human shows the same panel. The human defender's roster row glows in their color
  for the whole exchange.

### 5.2 Announcement ladder [ui + ctrl]

| Tier | Events | Treatment |
|---|---|---|
| 0 routine | conquest, card drawn, trade < 10, placements | sound + board + one log line. No banner, no toast. |
| 1 swing | `continentGained`, a continent broken, trade ≥ 10, upset (§5.3), first time within 5 of the goal, final round | top-center banner: 5vh Cinzel caps + one Inter subline. In 240 ms, hold 1.2 s, out 200 ms. Stinger sound. Never blocks input. |
| 2 elimination | `playerEliminated` | 1.6 s board moment: color wave in the eliminator's color, 150 ms of SFX silence, then the stinger. Input is ignored for the first 500 ms, then a click skips. Banner: `SAM IS OUT` / `Knocked out by John · round 9 · 4 cards taken`. |
| 3 victory | `gameOver` | holds until clicked (clicks ignored for the first 1.5 s). |

Rules:
- At most **1 banner** and **2 toasts** on screen at once. Banners queue with 200 ms gaps.
- During AI turns, tier-1 banners that land within 2 s of each other merge into one line:
  `COBALT TAKES ASIA · AND BREAKS YOUR AUSTRALIA`.
- Banners stay in the top 20% of the viewport, and never cover the action bar or the battle panel.
- No banner or toast *enters* while dice are tumbling. They wait for the verdict.
- Toasts are rare: the card bonus (`+2 on Brazil · you own a traded card's territory`), captured cards,
  and the fallback for unexpected engine errors. In 200 ms, hold 2.5 s, out 160 ms.

Banner copy:
- `JOHN HOLDS SOUTH AMERICA` / `+2 armies a turn`
- `PRIYA BREAKS SAM'S EUROPE` / `−5 a turn for Sam`
- `+15 ARMIES` / `Set #6 · next set is worth 20`
- `JOHN IS 5 FROM VICTORY` / `25 of 30 territories`

### 5.3 Upsets [ctrl, should]

When an engagement starts (the first roll on a from→to pair this turn), record `winProbability`.
- The attacker stops without taking it, and the recorded odds were ≥ 75%:
  `HELD!` / `Sam holds Argentina · John had 84%`
- The attacker takes it at ≤ 30%: `AGAINST THE ODDS` / `John takes Kamchatka at 22%`

Both are tier 1. Log them for the awards.

### 5.4 Sound mapped to drama [audio callers: render + ctrl]

The audio API already takes `volume`, `pan`, and `rate`. These are rules for the callers:
- SFX fire on the **contact frame** of their motion, not at tween start. Tolerance ±30 ms; schedule
  with `AudioContext.currentTime` offsets when the timing is known.
  - `place`: a piece touches down. `diceLand`: each die's first touch. `hit`: the first loser verdict.
  - `conquer`: the flood starts. `march`: the pieces lift off. `turnStart`: the banner begins entering.
  - `whoosh`: only on camera moves > 0.3 board widths.
- `diceShake` lasts as long as the shake. `diceLand` pans −0.3 for the attacker and +0.3 for the
  defender.
- Compressed blitz rolls: one `diceLand` per roll, not per die, with rate +8% per roll up to +40%.
- `cardTrade` rate scales with set value: 1.0 at 4 down to 0.72 at 20+, with +2 dB above 10.
- AI-vs-AI events play at 60% volume; events involving a human play at full volume.
- **No sound on tile hover.** `uiHover` is for buttons only, at −18 dB relative to `uiClick`,
  throttled to one per 90 ms.
- Rapid placements: at most one `place` per 70 ms per tile, rate jitter ±4%, with pitch rising +3% per
  consecutive click up to +15% (chips on felt).
- 2× speed compresses the spacing, never the pitch.

---

## 6. AI turns and turn changes

### 6.1 AI turns as a highlight reel [ctrl]

At `watch` (the default AI speed) the budget is **median ≤ 6 s, p95 ≤ 12 s**. After 10 s, the rest of
the turn plays at instant.

- **Coalesce reinforce.** While the AI's phase is reinforce, loop `chooseAiAction` → `applyAction`
  without awaiting. Collect every `armiesPlaced`/`cardsTraded` and play them as one beat: drops
  staggered 50 ms, ≤ 1.0 s total.
- **Coalesce engagements.** Consecutive attack/blitz actions on the same from→to pair form one
  engagement. Apply the AI's occupy right away (no think time); it plays as the conquest's march.
- **Think time only at decision points**: 350 ms at turn start, 200 ms between engagements, 0 ms
  inside an engagement, during reinforce, or before occupy. No "thinking…" label unless a pause runs
  over 400 ms, which shouldn't happen.
- **Style by stakes** (`playEvent` option `style`, SPEC §11.2):
  - `full`, when the defender is human: telegraph the arrow and battle panel for 400 ms, then dice at
    the blitz timing (§8.2).
  - `brief`, AI vs AI: no dice. Arrow (150 ms), the defender's badge ticks down with hit flashes, then
    the tile flips. **≤ 0.8 s per engagement**, one log line.
- **Camera**: at AI turn start, if the AI's most-engaged region is off-screen, frame it once. After
  that, move only when an engagement's tiles are off-screen (§8.3).
- **Narration** [ui]: the action bar reads one live line in the AI's color:
  - `Cobalt is reinforcing` → `Cobalt attacks Siam from India · Sam defends` → `Cobalt takes Siam` →
    `Cobalt fortifies Ural`
  - Each engagement collapses into one log line: `Cobalt blitzed Siam from India: 9 vs 3 → took it,
    lost 2`.

Other AI speeds: `fast` = 0.4× these budgets, and human-defender fights use `brief` too (median
≤ 2.5 s). `instant` = snap per AI turn with a 300 ms beat, while the turn banner still shows.

The top bar holds the AI speed toggle `AI: watch · fast · skip` whenever at least one AI seat is alive.
It's always clickable, even mid-turn, and applies from the next event. (The human animation speed
lives in Settings, because on your own turn click-through already handles pace.)

### 6.2 "Since your last turn" recap [ctrl + ui]

For each human seat, the controller keeps the events since that seat's last `endTurn`: territories
lost (and to whom), continents lost, eliminations, trades by others worth ≥ 10, and anyone newly within
5 of the goal. It shows up to **2 lines** under the turn banner, pinned in the battle log for that turn:

- `Sam took Ukraine and Ural from you` (group by attacker; name at most 2 territories, then `+3 more`)
- `You lost Europe · −5 a turn`
- `Priya cashed in for 15` / `John is 4 from victory`
- Nothing happened: `Quiet round · nobody touched you`

Shown from round 2 on, human seats only.

### 6.3 Hand-off cover (default OFF) [ui]

On one TV-facing screen the cover can't hide anything from the couch, so it's ceremony that costs a
click about 100 times a night. The **default is the turn banner**. The setting `Hide cards between
turns` turns the cover on. When on, it fires only when the incoming seat is human, 2+ humans are
playing, the incoming player holds ≥ 1 card, and the phase isn't setup.

- Mounted at opacity 1 **in the same frame** the turn ends, before the hand panel renders. Zero frames
  of the next hand may be visible.
- Smoked glass over the live board (12 px blur, so the board stays in view), a 6 px top band in the
  player's color, `Pass to Sam` (Cinzel 44 px), and the subline
  `+9 armies waiting · 3 cards · set ready`.
- Brass button `I'm Sam · start turn` (Enter/Space). Fade out 240 ms, then the turn banner.
  `turnStarted` playback waits until it's dismissed.

---

## 7. The teaching layer

### 7.1 One reasoner [ctrl]

`src/game/explain.ts`:
`explainTerritory(state, ui, t) → { ok: boolean; verb?: string; code?: ReasonCode; text: string }`.
It's built only from existing engine helpers (`attackSources`, `attackTargets`, `fortifyTargets`,
`fortifyPath`, `maxAttackDice`, `validSets`, `mapData`). The hover tooltip, the rejected-click message
and keyboard focus all read from it. The UI **pre-validates every click** and never sends an illegal
action. Engine error strings are a fallback only.

A rejected click:
- The action bar's line 1 swaps to the reason for 2.2 s (fade 120 ms), then restores.
- `uiError` plays at −12 dB (a soft tick, not a buzzer).
- No shake, no toast.
- The third identical rejection in one turn appends `Glowing territories are the ones you can use.` and
  holds for 4 s.

Clicks during a *watched* turn (AI or another human's) do nothing and give no message. Clicks during
your own animations follow click-through (§8.1).

### 7.2 Action bar copy (line 1 always; line 2 = hint, per-seat toggle)

Line 2 is a fixed slot. With hints on, it carries the *why*. With hints off, it carries only status
(card line, occupy note, receipt chips). Hints default **on** for every human seat. The `Hints on`
chip in the bar toggles them for the current seat with one click, stored in UI meta next to the save.

| State | Line 1 | Line 2 (hint) |
|---|---|---|
| setup-claim | `Claim a territory · click any parchment tile` | `Take turns until all 42 are claimed.` |
| setup-place | `Place 10 armies · 4 left` | `Stack them where you'll fight first. Right-click takes one back.` |
| reinforce | `Place 9 armies · click your territories` (live count: `Place 4 more`) | `1 army per 3 territories, plus whole continents. Right-click takes one back.` |
| reinforce, must trade | `Trade a card set first · you hold 5 cards` | `At 5 cards you must trade. Your best set gives +10.` |
| reinforce, 0 left | `All placed · click an enemy to attack` | `Or Begin attack →. Right-click still takes one back.` |
| mid-turn trade | `You knocked out Sam and took 4 cards · trade down to 4, then keep attacking` | none |
| attack, nothing selected | `Attack · click an enemy territory next to yours` | `You need 2+ armies to attack, because 1 always stays behind.` |
| attack, source picked | `Attacking from Ural (8) · click a glowing enemy` | none |
| attack, auto-picked source | `Attack Brazil from Venezuela (6) · click another of yours to switch` | none |
| attack, armed | `Attack Siberia from Ural` | `Blitz keeps rolling until Siberia falls or Ural is down to 1.` |
| attack, no sources | `No attacks left · every border army is down to 1` | none |
| occupy | `You took Siberia · move armies in` | `At least 3, one per die you rolled. 1 stays in Ural.` |
| fortify, nothing selected | `Fortify · one move, then your turn ends` | `Troops travel only through your own territories.` |
| fortify, source picked | `Move from Ural · click a glowing territory` | none |
| fortify, none possible | `Nothing to move · End turn` | none |
| watching | `Cobalt attacks Siam from India · Sam defends` | none |

First-time-only lines. The first time each seat opens a card set, line 2 shows once:
`Three of a kind, or one of each, trades for free armies. Sets grow every time anyone trades.`

### 7.3 Rejection copy (reason codes)

| Code | Copy |
|---|---|
| `not_yours` | `That's Sam's · click one of your territories` |
| `one_army` | `Ural has 1 army · attacking needs 2, because 1 stays behind` |
| `no_source_for_target` | `None of your territories next to Brazil has 2+ armies` |
| `no_enemy_neighbors` | `Everything next to Brazil is already yours` |
| `not_adjacent` | `Peru doesn't border Ural · attack next door (dashed sea lanes count)` |
| `own_as_target` | `That's yours · click an enemy next to Ural` |
| `must_trade_first` | `You hold 5 cards · trade a set first` |
| `none_left` | `All armies placed · click an enemy to attack` |
| `fortify_unreachable` | `Can't reach Peru · troops travel only through your own territories` |
| `fortify_not_adjacent` | `House rule: fortify only to a neighbor` |
| `fortify_one_army` | `Ural has 1 army · 1 has to stay to hold it` |
| `already_claimed` | `Sam already claimed that · pick a parchment tile` |

### 7.4 Tooltip [render + ui]

Appears after 350 ms of stillness. Once it's visible, moving to another tile updates it instantly. It
hides 120 ms after the pointer leaves the board. It sits 18 px up-right of the cursor, flips to stay in
the viewport, and never covers the hovered tile's badge. Contents:
- Name (Inter 600)
- `Europe · +5`
- Owner chip + armies
- One line from `explainTerritory`, either a verb (`Click: +1 army`, `Attack from here · 2 targets`,
  `Attack · 82% · likely`, `Move troops here`) or the reason text.

It's hidden during animations. The tooltip is a bonus: the action bar must be enough on its own.

### 7.5 Cards [ui]

- Card faces use large pictograms for infantry, cavalry, and artillery, plus a star for wild. Shapes
  are distinct, never told apart by color. The territory name is small, with a `yours +2` tag.
- The panel header reads `Next set +8 · then +10`.
- No set: `Need 1 more of any kind, or a third match`.
- Coach line (hints on): `Sets: 3 alike · 1 of each · any 2 + wild`.
- The hand shows face-up for the current human. With the hand-off cover on, it renders empty until the
  cover is dismissed.

### 7.6 Rules card (`?` and Pause → Rules)

One static screen, not a tutorial. Five 2-line blocks (Turn, Armies, Attacking, Cards, Fortify), this
game's house rules and goal, and a shortcut column. Esc closes it. The title's `How to play` opens the
same card.

### 7.7 Tone guide

- Sentence case, verb first, ` · ` as the separator.
- Real names and numbers in every line (`Ural`, `8`, `Sam`), never "the selected territory".
- Describe the rule, not the interface: `At 5 cards you must trade`, not `Click the trade button`.
- No `Error:`, no `Invalid`, no exclamation marks except `HELD!` and the victory banner.
- Minus is U+2212 (`−3`), arrows are `→`, the ellipsis is `…`.
- Numbers are never Cinzel. Every numeral is Inter with `font-variant-numeric: tabular-nums
  lining-nums`.

---

## 8. Feel spec

### 8.1 Input and blocking [ctrl]

- **Non-blocking events** (the controller doesn't await them before taking the next input; they
  overlap freely): `armiesPlaced` (any source), `territoryClaimed`, `setupTurn`, `phaseChanged`,
  `cardDrawn`, `controllerChanged`. Rapid clicks on one tile keep at most 3 drops in flight; extra
  clicks just pop the badge.
- **Blocking events**: `diceRolled`, `territoryConquered`, `armiesMoved`, `continentGained/Lost`,
  `playerEliminated`, `cardsCaptured`, `cardsTraded`, `turnStarted`, `territoriesDealt`, `gameOver`.
- **Click-through on your own turn**: a board click, button click, or commit key during a blocking
  animation calls `skipAnimations()`, waits for the drain and `syncState`, and then handles the input
  normally.
  - Exceptions: the first 500 ms of an elimination and the first 1.5 s of victory ignore input.
- **Watched turns** (AI, or the other human during a hand-off): a click or Space skips the current
  engagement only. It never acts.
- **Space**: commits only (Blitz, confirm occupy, Move, Trade, Confirm placement). It never ends a
  phase or a turn. After a Space press skips an animation, Space is ignored for 300 ms. Held Space
  doesn't repeat.
- Enter = the brass primary, whatever it is. E = the exit button (`Fortify →` / `End turn`).
- **No spoilers**: the HUD follows the board, not the state. Roster counts, card counts, income, log
  lines and the tally apply when that event's `playEvent` resolves. Announcements of something already
  visible (the turn banner, the conquest log line) may fire at event start. `syncState` + a full HUD
  render when the queue drains are only a consistency net: they must cause no visible change.
- **Acknowledgement budget** [render]:
  - Hover highlight lands in the same rAF as the pointermove (≤ 1 frame).
  - Pointer-down on a clickable tile starts the press dip immediately.
  - The action dispatches on pointer-up, and its first visible effect plus its SFX land within 50 ms.
  - Buttons show the pressed state on pointerdown.
  - No spinners anywhere in the game.
- **Gestures** [render]:
  - Click = pointer-up within 6 px and 350 ms of pointer-down on the same tile. Anything else is a
    drag and never a click.
  - Left-drag orbits, right-drag pans, the wheel zooms toward the cursor.
  - A right-click without a drag = −1 in reinforce/setup.
  - The context menu is suppressed on the canvas and the HUD.
  - **No double-click-to-focus** (it collides with +1 and with Roll again); F focuses the selection.
  - During orbit/pan the cursor is `grabbing` and hover is suspended.
- **Stable hover** [render]:
  - Raycast against flat, un-lifted footprint proxies, so the lift never changes what's under the
    cursor.
  - Hysteresis: a new tile takes hover only once the pointer is ≥ 3 px past the shared edge.
  - Cursor: `pointer` on clickable tiles, `default` elsewhere (never `not-allowed`).

### 8.2 Motion timing table (1×; 2× halves board durations, floor 80 ms; instant = 0)

Exits are faster than entrances. Nothing is linear except the target pulse (sine).

**Board [render]**

| Motion | Duration | Easing / detail |
|---|---|---|
| Hover lift | in 90 ms / out 140 ms | easeOutCubic. Lift = 0.15 × tile depth, top face +8% lightness |
| Press dip | 60 ms | −0.05 × depth; release to hover in 90 ms easeOutBack(1.5) |
| Select source | 160 ms | lift 0.35 × depth, easeOutBack(1.4). Ivory rim fades in over 120 ms |
| Dim others | 180 ms | easeOutQuad to value ×0.62, saturation ×0.75 (hue kept) |
| Target outline pulse | 1.2 s period | sine, opacity 0.45↔0.95, no scale. Steady at 0.95 once armed |
| Attack arrow | grow 240 ms / retract 120 ms | easeOutCubic / easeInQuad, arcs from source to target |
| Army drop | 200 ms fall + 90 ms bounce | easeInQuad, 6% bounce. Dust ≤ 6 particles, 350 ms. Badge pops 1→1.18→1 over 160 ms on contact |
| Unplace | 140 ms | easeInQuad, no dust |
| **Single roll** | **1.2 s** | shake 150 → tumble 450 (2–3 rotations, easeOutCubic, 40 ms stagger per die) → settle 100 (micro-bounce, `diceLand`) → pair/align 200 → verdict 300 (winner lifts 4 px + ivory rim; loser drops to 55% brightness, tilts 8°, cracks; `−N` chips on both tiles) |
| Repeat roll, same pair within 3 s | 1.05 s | no shake |
| **Blitz (full)** | **≤ 3.0 s total** | roll 1: 700 ms (short shake + tumble). Middle roll k: max(180, 600 × 0.75^(k−1)) ms, snap without tumble. Final roll: 700 ms with the full verdict. Over the cap, scale middle rolls uniformly (floor 120 ms). One `diceShake` only |
| Brief engagement (AI vs AI) | ≤ 0.8 s total | arrow 150, hit ticks ≤ 400 total, flip 250 |
| `−N` loss chip | 700 ms | rises 18 px, easeOutCubic. Pieces topple in 280 ms easeInBack |
| Conquest | ~650 ms | color flood from the entry edge 600 ms easeInOutCubic + one ripple ring 500 ms. March 500 ms easeInOutCubic starting at +150 ms |
| Occupy move (manual count) | 400 ms | easeInOutCubic |
| Fortify glide | 220 ms / hop, ≤ 900 ms | easeInOutSine. Hops compress beyond 4 |
| Continent flare | 250 in / 400 hold / 500 out | contour brightens in the owner's color |
| Elimination | 1.6 s | color wave across the victim's last tile outward. No camera push |
| Victory | 2.4 s | board wave, then attract orbit at 4°/s |
| Deal | ≤ 2.5 s | flips in waves, 35 ms stagger |
| Multi-tile stagger | 35–50 ms | total spread capped at 1.2 s (compress beyond that) |

**UI [ui]** (never scaled by animation speed)

| Motion | Duration |
|---|---|
| Button hover / press / release | 100 / 60 (scale 0.97 on pointerdown) / 120 ms |
| Panels, drawers | in 220 ms easeOutQuart, 12 px travel / out 140 ms easeInQuad |
| Action bar content change | 160 ms crossfade. The container never resizes |
| Turn banner | spring in 280 ms (one small overshoot, 24 px drop) / hold 1.1 s (1.9 s with recap) / out 200 ms |
| Tier-1 banner | in 240 / hold 1200 / out 200 ms |
| Toast | in 200 / hold 2500 / out 160 ms |
| Count-up (totals ≥ 5) | 400 ms easeOutCubic. Single increments pop instead of counting |
| Rejection line swap | fade 120 ms, hold 2.2 s |
| Screen crossfade | 360 ms |

**Instant speed**: no board tweens. Dice appear static on their final faces with the same linger. The
turn banner still shows (150 / 500 / 150 ms). There's a 250 ms beat after each conquest.

### 8.3 Camera [render]

- **Home view**: the whole board framed inside the HUD-free region (`setViewportInsets`, SPEC §11.2)
  with a 4% margin, pitch 55°, azimuth 0. The bottom inset includes the battle-panel band, so dice
  never cover the board at home.
- The camera moves **on its own only** when:
  1. a turn starts and the driver left it displaced from home by > 10% zoom or pan (ease back home);
  2. during an AI turn, an engagement's tiles are off-screen or the target projects < 24 px wide
     (frame both, *before* the arrow; stay there until the next turn start);
  3. victory (orbit).
- **Never** in response to a human's own click, while a selection is armed, or during dice or conquest.
- Limits for all automatic moves:
  - Duration `500 + 400 × (distance / boardWidth)` ms, clamped to 500–900, easeInOutCubic.
  - Rotation ≤ 45°/s, pitch change ≤ 8°.
  - No roll, no overshoot, no shake, constant FOV.
- User clamps: pitch 35°–80°, azimuth ±25° (labels stay upright), zoom 0.9×–3.5× of home, pan clamped
  so the board center stays on screen. Damping 0.12.
- A board event waits until the camera has finished ≥ 80% of its move.

### 8.4 Attention hierarchy (the single brightest or most moving thing per step)

| Step | Focus |
|---|---|
| Setup / reinforce | the armies-left counter + your tiles (static ivory rim) |
| Attack, nothing selected | your eligible sources (static rim) |
| Source picked | the pulsing targets |
| Armed | the arrow + the battle panel odds + `Blitz` |
| Rolling | the dice |
| Conquest | the flooding tile |
| Occupy | the count stepper |
| Fortify | the route |
| Turn change | the banner + the player chip |

Layering rules:
- Camera, then board event, then UI announcement; they never all move at once.
- UI may move alongside board motion only when it's a direct readout of that motion (a badge pop, the
  tally, the counter).

### 8.5 Color semantics [render + ui]

1. On the board, **hue means only ownership**. The six player colors, parchment, ocean teal, walnut,
   and the brass frame are the only hues.
2. Interaction uses luminance, height, **ivory `#f3ead8`** outlines, and motion:
   - selectable = a static ivory rim at 30% opacity
   - hover = lift + lightness
   - selected = raised + a 100% ivory rim (the only bloom source besides dice verdicts and continent
     flares)
   - targets = a pulsing ivory outline, with other tiles dimmed
   - ivory outlines get a 1 px dark under-stroke so they read on amber and rose
3. **Brass `#c2a062`** is UI-only: it marks the single primary button (at most one brass fill per
   state), priority stakes lines, the `Next set` chip, and `Final round`. It's never used on board
   tiles.
4. The current player shows as their color on the player chip, a 3 px top edge on the action bar, and
   the attack arrow (attacker color with an ivory core). The fortify route is ivory dashed.
5. **No danger red.** A loss reads as an ivory `−N` on a dark chip plus a topple or crack. Errors read
   as copy.

### 8.6 Army badges [render]

- DOM elements in an overlay inside the container, positioned each frame from the projected anchors.
  Batch the transform writes: 42 badges must cost < 1 ms/frame. Crisp at any DPR, real Inter tabular
  figures.
- Style:
  - a near-black pill `#12151a` at 90%, with a 2.5 px ring in the owner's base color
  - the seat **emblem** (§10.2) in the owner's light tint, left of the number
  - ivory numerals, 15 px / 700 at 100% UI scale (contrast 15:1 regardless of seat color)
  - a soft shadow
- Height ≥ 22 CSS px at the home view on 1280×800. Scales with zoom (0.85×–1.3×) and with the UI size
  setting.
- Always drawn above the pieces. On change, it pops 1→1.18→1 over 160 ms on the contact frame.
- A pending reinforce shows as an ivory ghost chip `+3` attached to the right of the badge.

### 8.7 Noise budget [render]

- An idle board (nothing selected, no event) has **zero moving elements** except the ocean shimmer
  (≤ 2% lightness variation, period ≥ 6 s). The renderer reports `activeTweens === 0`.
- Pulsing is only for attack/fortify targets. Selectable tiles are static.
- Bloom: threshold ≥ 0.9, strength ≤ 0.35, radius ≤ 0.4. The brass frame, badges and text never
  bloom.
- Particles: ≤ 40 alive globally, none persistent. The conquest ripple is a ring, not particles.
- No screen shake, chromatic aberration, lens flare, or vignette pulsing. No text glow in the UI.
- At most 2 simultaneous emphasis types on the board (e.g. the target pulse + the arrow).

### 8.8 Loading and warmup [render + ui]

- `index.html` sets `background: #0c0f13` inline. Cinzel and Inter are preloaded (`font-display:
  block`, ≤ 300 ms).
- At boot, run `renderer.compile()` on a scene holding every material (tiles, pieces, dice, arrow,
  flood, ripple, dust, contour flare), and render one hidden frame of the dice tray and a flood. The
  first dice roll must not stutter.
- The canvas fades in from black over 400 ms. If boot takes > 600 ms, show `RISK · WAR TABLE` in
  Cinzel with a 1 px brass line filling underneath (no spinner).
- **One persistent canvas**: Title and New game float over the attract-mode board. Pause blurs the
  board 8 px and dims it to 70%.
- Tab hidden mid-animation: tweens use a clamped delta (max 50 ms per step) and finish when the tab
  returns. The queue must never hang.

### 8.9 Action bar layout [ui]

- Fixed height 5.25 rem (84 px at 100%), fixed width `min(920px, 94vw)`, centered, with a 3 px top edge
  in the current player's color. It **never resizes or moves** between phases.
- Zones:
  - left: line 1 (20 px / 600) and line 2 (15 px, ivory at 70%), with an ellipsis on overflow
  - middle: context controls (receipt chips, dice toggle, occupy stepper, trade chip, hints chip)
  - right: `[secondary][primary]` in reserved slots, then the exit group (up to 2 ghost buttons)
- Within a phase, buttons that don't apply are disabled, not removed. Disabled buttons explain why on
  hover (`Place 3 more`, `Pick a target first`).
- In "click the board" states (attack with no target, reinforce), no button is brass; the board is the
  primary.
- Every button shows its keycap inline (`Space`, `Enter`, `E`).
- Control states:

  | State | Look |
  |---|---|
  | rest | default |
  | hover | +6% lightness, 100 ms |
  | pressed | scale 0.97, −6% lightness, on pointerdown |
  | focus-visible | 2 px ivory ring, keyboard only |
  | disabled | 40% opacity |
  | busy | a 2 px brass underline sweeps; input is ignored |

---

## 9. HUD layout [ui]

- **Top bar** (56 px):
  - player chip (color, emblem, name)
  - round chip (`Round 7` / `Round 7 of 12` / `Final round`)
  - phase stepper `Reinforce → Attack → Fortify`
  - `Next set +10` chip (progressive; `Sets 4–10` when fixed)
  - AI speed toggle (when an AI is alive)
  - menu
- **Roster** (left, ≤ 220 px, compact), one row per seat:
  - emblem + color chip, name, `AI` tag
  - territories as `24 / 30` with a thin progress bar in the seat color
  - armies, income `+9`, continent abbreviations (`NA · AU`)
  - a card count chip: brass border at 4, `must trade` at 5+
  - Eliminated seats stay listed as an epitaph, greyed with a strike: `SAM · out in round 7 · by John`.
  - Clicking a row highlights that seat's territories.
- **Right rail**: collapsed to ≤ 56 px by default, with icons for Cards (badge `Set ready +8`) and
  Log. Each opens as a drawer over the board.
  - The log collapses each engagement into one expandable line.
- **Battle panel**: bottom-center above the action bar (§5.1).
- **Action bar**: §8.9.
- The home-view insets are: top bar, roster width, right-rail width, and at the bottom, the action bar
  plus the battle-panel band.

---

## 10. Accessibility

### 10.1 Palette check (done 2026-09-27)

I simulated the palette with Machado 2009 at full severity, 20% desaturation (the tile finish), and
CIEDE2000:

- **Cobalt vs violet: ΔE 2.7 (protan), 2.8 (deutan). Indistinguishable.** Every other pair is ≥ 9.
- Proposed fix (SPEC §11.3): violet `#8a5ad6` → `#b48be8`, with ink `#1c1030` (6.7:1). That lifts
  cobalt/violet to 12.1 (protan) and 18.3 (deutan).
  - Do **not** lighten emerald: `#2cb574` drops emerald/amber to 9.2 under protan.
- Default seats **crimson, cobalt, amber, rose**: the worst pair across protan and deutan is ΔE 14.4,
  the best of any 4-set. The old implicit order (crimson, cobalt, emerald, …) has a 9.4 pair
  (crimson/emerald, deutan).

### 10.2 Seat emblems (must)

Ownership never relies on color alone. Emblems are drawn as shared inline SVG paths
(`EMBLEM_PATHS`, SPEC §11.3), not font glyphs:

| Seat color | Emblem |
|---|---|
| crimson | ▲ |
| cobalt | ● |
| emerald | ■ |
| amber | ◆ |
| violet | ★ |
| rose | ✚ |

The emblem shows on the army badge, roster row, player chip, banners, battle-panel header, log lines,
and the hand-off cover. Attacker and defender dice are separated in space (left/right) and labeled, so
matching hue never decides whose dice are whose.

### 10.3 UI size

Settings → `Text size: Laptop · Couch · TV` = root font scale 1.0 / 1.25 / 1.5. It's also on the title
screen.
- All HUD sizes are in rem. The badges follow via `setUiScale`.
- Minimums at 1.0: action line 1 20 px, body 15 px, roster 15 px, log 13 px, nothing below 13 px.
- At TV on 1920×1080, nothing overlaps and all HUD text is ≥ 20 px.

### 10.4 Reduced motion (`prefers-reduced-motion` or the setting) [should]

- Targets become a steady outline + dimming (no pulse). No lift overshoot.
- No automatic camera moves; a 200 ms crossfade cut only where framing is required.
- Dice appear on their final faces with a 150 ms fade, then still pair and compare.
- The conquest flood becomes a 250 ms crossfade. Banners fade without travel.
- Sound is unchanged.
- **Rule**: every state an animation conveys also has a static cue (outline, dim, badge, or text).

---

## 11. Polish checklist (the builder self-checks before reporting done)

1. Every clickable tile lifts on hover within one frame; non-clickable tiles don't react.
2. No hover flicker sliding along Ukraine/Ural or Brazil/Venezuela.
3. An orbit drag released over a tile never triggers a click. A right-drag pans; a right-click removes
   one placed army; no browser context menu anywhere.
4. 10 clicks in 1.5 s on one tile place exactly +10, and the counter matches every frame.
5. A click during your own blitz finishes it and then performs the click.
6. The dice always appear in the same screen spot, land on the engine's faces, and stay readable until
   the next roll or selection change.
7. A blitz of any length at 1× is ≤ 3.0 s, shows a running tally, slows for the final roll, and
   produces no toast.
8. Roster, log and card counts never change before the matching animation resolves.
9. The camera never moves on its own during a human's input, and never overshoots, rolls or shakes.
10. An AI attack on an off-screen tile frames it before the arrow; on-screen AI attacks don't move the
    camera.
11. No banner or toast enters while dice tumble. At most one banner is on screen.
12. The idle board has nothing moving except the ocean.
13. There are no hues on the board beyond player colors, parchment, ocean, walnut, brass frame, and
    ivory outlines.
14. At most one brass-filled button in any state; every disabled button says why.
15. Every illegal click shows reason-code copy in line 1. There's never a shake or a raw engine
    string.
16. The action bar's bounding rect is identical across every phase.
17. All numerals are tabular Inter; minus signs are `−`; no numbers in Cinzel.
18. Badges are crisp at DPR 1 and 2, never hidden by pieces, and ≥ 22 px tall at home on 1280×800.
19. There's no tile-hover sound. Place, `diceLand` and conquer line up with their visual contact
    (±30 ms, judged on a 60 fps capture).
20. A cold load has no white flash, no font swap, and no stutter on the first roll.
21. With the hand-off cover on, zero frames of the next hand are visible (frame-step a capture).
22. Enter triggers the primary in every state; Space never ends a phase; focus rings appear on keyboard
    use only.
23. At instant speed, the turn banner still shows and dice results are still readable.
24. The empty states (no attack sources, no fortify moves, no valid set) each show specific copy and one
    obvious next button.
25. Reloading mid-occupy or mid-reinforce restores the exact step, highlights, and line 1.
26. At TV size on 1920×1080, all HUD text is ≥ 20 px and nothing overlaps.
27. Browser defaults never leak: no text selection on double-click, no blue focus ring on mouse click,
    no default form controls.

---

## 12. Reviewer rubric (Opus reviewer, score 1–10 per axis)

**How to review.**
1. Run a 1-human-vs-3-normal-AI game from the title to round 6 at the default settings.
2. Run a 2-human + 1-AI game with manual setup through 2 rounds.
3. Use `__risk.autoplay` to finish one game and see the endgame and victory.
4. Capture screenshots at 1280×800 and 1920×1080 (TV text size), plus a 60 fps capture of one blitz
   and one AI turn.
5. Pull numbers from `__risk.metrics()`.
6. Score each axis, name the single worst moment, and give the fix. A score needs evidence (a
   screenshot, a metric, or a step to reproduce).

| Axis | 4 | 6 | 8 | 9 | 10 |
|---|---|---|---|---|---|
| **Flow** (pacing, clicks, waits) | Turns need 20+ clicks; input waits on animations; AI turns take 20 s+; setup drags | Works, but a turn takes ~15 clicks or some waits are forced; AI turns ~10 s | Metrics hit: ≤ 12 clicks per turn, 0 s forced wait, AI median ≤ 6 s; one or two rough transitions | All budgets met; chaining feels like momentum; the evening fits the length preset | You forget the UI exists. The room's talk, not the software, sets the pace. |
| **Fun / drama** | Dice are small or off-board; every event weighs the same; nothing to react to | Dice readable; banners exist but inflate or stack; stakes unclear | The battle panel shows odds + stakes; the tiers are distinct; upsets and eliminations land | Spectators react before the driver speaks; the recap starts grudges; awards start an argument | People ask for a rematch unprompted |
| **Polish / feel** | Hover flicker, eaten clicks, camera whiplash, layout shift, default web controls | Mostly smooth; a few timing mismatches, a noisy idle board, or sound out of sync | Passes the §11 checklist with ≤ 3 misses; consistent easing; calm idle board | Checklist clean; sounds hit contact frames; nothing feels linear or floaty | Indistinguishable from a shipped premium digital board game |
| **Clarity / teaching** | Clicks silently fail; the rules must be explained aloud; "why do I get 7?" | Line 1 always says what to do, but refusals are generic or the receipt is missing | Every refusal has reason copy; the receipt, card status and "ends turn" labels are present; a rusty player finishes turn 1 alone | A first-timer plays turn 2 without asking anything; watchers learn from the narration | The rules card is never opened because nothing ever needs it |
| **Visuals** | Flat web map with gradients; illegible badges; hues fighting | Premium intent visible; some cheap effects (bloom, particles) or unreadable text at TV size | War-table look holds at both resolutions; badges readable from 3 m; hue = ownership holds | Every screenshot looks like marketing art; the HUD and board read as one world | A stranger would believe it's a boxed product |
| **Correctness** | Any rules bug, stuck state, or console error in a normal game | Rules correct; rare glitch (desynced badge, stale bar) recovered by `syncState` | No glitches in the review runs; resume after reload works mid-turn | Soak + e2e clean; every edge state has copy | Zero defects under adversarial clicking |

A **7** sits between the 6 and 8 anchors. Ship bar: **≥ 8 on every axis, ≥ 9 on Flow and Clarity**
(those two decide whether the evening works).

---

## 13. Later (cut from tonight's build, in rough priority)

- An auto-offered "call it" card when one player holds ≥ 60% of all armies. The Pause →
  `End game now` covers it for now.
- Hold-to-fast-forward on AI turns (the top-bar AI speed toggle covers it).
- Eliminated human takes over an AI seat, or calls the winner.
- The world-share strip under the top bar (the roster progress bars cover it).
- A 60-second "How to play" on the live board (the rules card covers it).
- Full keyboard parity (+/− in reinforce, a keyboard-only e2e). Tab cycling of the clickable tiles
  stays in the build.
- Target-first fortify.
- The continent-nudge hint (`You're 1 territory from Australia`).
- Optional embossed emblem patterns on tile tops.
- More awards: The Wall, Comeback, Luckiest defender.
- The `1 AWAY` dashed outline on the missing territory (the label suffix stays, as a should).
- Auto-suggesting TV text size on large screens.
- Recovering from a lost WebGL context via re-init from the autosave (for now: a cover with
  `The table got bumped · reload to continue`).
- A heavier stinger variant for upsets.
