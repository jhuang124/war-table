# INK: the ink & night overhaul (build spec)

**SOUL.md outranks this file on intent and feel.** This spec is how the soul gets built now. It also outranks
docs/UX.md, SIMPLIFY.md and SPEC.md §6–7 on visuals and motion. Rules, the engine, the Turn Track semantics,
"board clicks select, buttons commit" (docs/ROUND2.md), and the mobile layouts and gestures (docs/MOBILE.md)
still bind unless this file changes them explicitly.

The base is **Fable 5.1's plan** (below, part B), with **the synthesis overrides in part A**. Where they
conflict, part A wins. The moodboard is `_claude/moodboard/`. Look at it.

---

## Part A: synthesis overrides (John-approved, 2026-09-28)

### A1. Living calm replaces stillness (SOUL pillar 1: the calm is the peak)
Part B says "idle = zero tweens, a finished painting". That is **replaced**. The resting board is alive, slow
and cloud-like. It never darts, bounces, or pulses fast.

- **Ink mist:** 3–5 soft, fbm-shaped mist veils over the ocean. They may drift over coasts; they never obscure
  numbers or figures. Opacity 4–8%. They drift 0.4–1.2% of the board width per second and morph slowly.
- **Coastline breath:** the ink layer is sampled with a tiny noise displacement (≤ 0.5 px at home zoom,
  10–16 s periods, spatially varying), and the dry-brush texture breathes ±6% in opacity. The linework lives,
  like wet ink; it must never look like jitter.
- **Wash breath:** each territory's wash shifts ±2% in lightness over 10–18 s, with its own phase.
  Ownership must stay unambiguous.
- **Gold rule glint:** a faint highlight travels the gold rule about every 14 s. The centre ensō breathes
  subtly (opacity ±8%, 8 s).
- **Hierarchy:** ambient motion is always the slowest thing on screen. The moment anything gameplay-related
  moves, the ambient layer yields: it dims by half and never competes with a strike.
- **Budget:** when only ambient motion is running, render at ≤ 30 fps on desktop and ≤ 24 fps on phones, full
  rate during action, and stop when the tab is hidden. After 3 minutes without input, ambient runs at half
  speed. Reduced motion (the setting or the OS) turns ambient off: the board is still.
- **Tests:** "idle board = 0 tweens" becomes "no *gameplay* tweens while idle". The ambient layer reports
  separately.

### A2. Draw your attack (from Claude's plan)
- In your Attack step, **pointer-down on one of your eligible attack sources and drag**: a live gold brush
  stroke follows the pointer. It is tapered and dry-brush, with the tail drying as it grows.
- **Release over an adjacent enemy target** arms that attack. The result is the same as today's
  target-first arm: the line shows the odds, and `Roll`/`Blitz` commit. The stroke settles into the attack
  arrow.
- **Release anywhere else** cancels: the stroke dries out in 200 ms. Nothing is committed by the drag
  itself.
- **Gesture precedence:**
  - On touch, a drag that *starts on an eligible source during your Attack step* draws.
  - A drag starting anywhere else pans, as today.
  - A long-press without movement still shows the name card.
  - With the mouse, a left-drag from an eligible source draws. Other left-drags pan. With the flatter
    camera, orbit is limited or gone (Part B clamps azimuth to ±10°).
- Tap-to-target keeps working exactly as today.
- **Contract:** `BoardView.setStrokeSources?` and `BoardView.onStroke?` (see src/render/BoardView.ts).

### A3. Cuts from part B
- **No ghost wash.** Part B keeps the old owner's wash at 10% "until the round ends". That is cut: ownership
  is unambiguous the moment a flood finishes. The flood itself stays: fbm front, dark leading rim.
- No generated game names, no poetry.

### A4. Sound: a soft ambient score, on by default
Part B has music off with "one low drone". **Replaced:** a soft, generative ambient score plays by default at
about 35% of the effects level, with a toggle and volume in Settings.
- **Character:** warm, slow, sparse. Low bowed pads and a gentle drone, with an occasional distant bowl or
  soft felt-piano note. A few events per minute, long tails, never a melody you could hum.
- **Never** koto or shakuhachi clichés (SOUL pillar 3), and never loops you'd notice. It is seeded per game.
- **Ducking:** the score dips under strikes and the verdict silence, then recovers over 2–3 s.
- Part B's five effect materials (paper, brush, wood, bone, bowl) stay.

### A5. Losing stings (SOUL pillar 4)
Part B's elimination is purely gentle. **Changed:**
- **Losing a territory you own** (a human defender): the flood's leading rim is rough and dark, like torn
  paper. A dry *snap* of the brush sounds on contact. Your seat ring dims for 300 ms. Your color is visibly
  eaten.
- **Elimination:**
  - The eliminator's ink sweeps over the victim's last territory; this sweep is the sting.
  - The victim's seat ring empties and cracks faintly.
  - A low bowl sounds with a hard onset.
  - The epitaph names the eliminator: `Sam · taken by John · round 9`.
  - Still no red and no screen shake.
- **Grudges stay visible:** the turn-start line for humans keeps its recap (`John took Ural and Siberia from
  you`) as one serif line under the player's name. The Nemesis award stays on the victory scroll.

### A6. Tempo is fixed; only its feel changes (SOUL pillar 5)
These budgets still hold, measured with `__risk.metrics()`:

| Budget | Limit |
|---|---|
| Single roll, *including* part B's 250 ms verdict silence | ≤ 1.25 s |
| Blitz | ≤ 3.0 s |
| Brief AI-vs-AI engagement | ≤ 0.8 s |
| AI turn at "watch" | median ≤ 6 s, p95 ≤ 12 s |
| Forced wait on your own turn | 0 |
| Clicks for a typical turn | within ±1 of today |

- The turn "breath" is non-blocking, and a tap skips any ceremony.
- If a beat in part B's timing table doesn't fit a budget, compress the beat. Never the budget.

### A7. Palette
Part B's seat names and hexes are approved: Vermilion, Slate, Ochre, Sage, Wisteria, Plum.
- Seat ids stay (`crimson`… keys in src/shared/palette.ts); names, hexes and the brush-drawn emblems change.
- Run the colour-blind check (Machado 2009 at full severity plus CIEDE2000). The worst default-four pair must
  be ≥ 9; adjust lightness, not saturation.

### A8. Units
The unit set is chosen and generated: `public/units/soldier.png`, `rider.png`, `cannon.png` (ivory dry-brush
ink on transparent, 1024², from `_claude/sprites/`).
- Trim and downscale them at build time or in a script to about 256 px each, as WebP or an atlas; they are
  ~2 MB as-is.
- Draw them as camera-facing quads on a small owner-colored wash blot.
- Their motion comes from shaders and transforms: a hop on arrive, a lean toward the target when attacking,
  a smoke dissolve when falling, a stroke-reveal when a denomination changes.
- Ivory reads on every wash. If a figure ever fails to read on a wash, adjust the blot, not the figure.

### A9. Testing: quality, not volume
- Keep the existing unit and e2e suites green; update selectors and expectations to the new DOM.
- Add only three new checks:
  - one gold element on screen at a time;
  - a draw-to-attack flow on desktop and touch;
  - the tempo budgets above.
- Take a screenshot sweep (desktop 1440×900 and 1920×1080; iPhone portrait and landscape) and look at every
  shot.
- Don't build new test infrastructure.

### A10. As built (integration, 2026-09-28): where the build differs from the text above
- **One gold is "now", and it moves.** The HUD holds it (the commit button, else the recommended or the
  current Turn Track segment). While the board's gold is in flight (a stroke being drawn, the dice
  deciding) the HUD's gold steps down to ivory. The **armed arrow at rest is ivory** (as in
  `chosen-silver-ink-board.png`): it inks gold when the dice roll and dries back to ivory at the verdict.
  Gold leaves at once and arrives 100 ms later, so two golds are never on screen together (checked
  every frame across a real turn in `tests/e2e/ink.e2e.ts`). The turn-start seat ring inks in **ivory**,
  not gold. The dice-pair hairlines are ivory. The gold rule and its ensō are the signature and don't
  count.
- **The Turn Track is centred under the ensō** and never moves; the actions sit to its right (the
  moodboard's Blitz). On touch screens each track word's hit area reaches 4 px into the pill's padding,
  so it's a 44 px target without a fatter dock.
- **Blitz** middle rolls share what's left of the 3.0 s budget against the real clock, so a 23-roll
  blitz holds the cap (2.86 s measured) as well as a 5-roll one (≈1.1 s).
- **Units (A8):** the sources live in `_claude/sprites/*-1.png`; `scripts/units.ts` packs
  `public/units/atlas.webp` (43 KB), the only unit file the game or the service worker loads.
- **Waves** sit at 15–20% (not 10–14%) so they read like the moodboard's. At victory the losing washes
  dry to 85%, leaving a faint trace.
- **Phones:** the victory scroll's awards are three stacked lines (MOBILE.md's swipe row hid two of
  three). AI-vs-AI sound plays at 50%.

---

## Part B: Fable 5.1's plan (base)


Written against the live build (played 2026-09-28; captures in `artifacts/overhaul-fable/`),
`docs/ROUND2.md`, `docs/MOBILE.md`, the moodboard and the render/ui source.

## 1. The feeling

An evening with this game should feel like four friends leaning over one painting that changes as
they argue. The screen is quiet enough that the room supplies the noise; the game supplies exactly
three moments of ceremony (a breath at turn start, a beat before the verdict, a scroll at the end)
and gets out of the way everywhere else. The zen ideas do real work, not decoration. **Ma** (the
charged pause) is the 250 ms of silence between the dice settling and the verdict, the empty indigo
ocean, and the rule that nothing enters while something else moves. **Kanso** is one serif, one
line of instruction, one gold thing on screen. **Shibui** is the palette: muted washes that never
shout, so a single gold stroke can. **Seijaku** is the idle board as a finished painting: zero
motion until someone touches it. **Wabi-sabi** is paper grain, uneven brush edges, and a board that
remembers: a conquered territory keeps a ghost of its old wash for a round. **Mono no aware** is how
elimination is treated: a player's ink lifts off the paper and their seat becomes an empty ring,
with a bowl tone, not a fanfare for the killer. **Ichi-go ichi-e** is the ensō drawn once per game
from the game's seed, never the same twice. **Fukinsei** lets the brushwork be uneven while the
layout stays exact. What zen is *not* allowed to mean here: slow. Restraint is in things, not time.

## 2. Taste decisions

1. **One gold.** Gold marks "now": the current Turn Track segment, or the pending commit button, or
   the current seat's ring. Never two at once; an e2e check counts gold elements ≤ 1.
2. **Nothing is filled.** Buttons and pills are hairline outlines on paper; the primary is a gold
   outline with gold text. No brass fills, coloured segments, or glass panels with blur shadows.
3. **Silence is the default; sound is punctuation.** Five materials (paper, brush, wood, bone,
   bowl). No hover sounds, no clicks on the board, nothing scheduled inside the verdict beat.
4. **Ceremony at three points only,** all click-through except the 250 ms beat. Forced wait per
   human turn stays 0.
5. **The board refuses to show:** progress bars, army totals, income receipts, "AWAY" hints, danger
   red, exclamation marks, confetti, screen shake, a compass rose, ocean names, a table.
6. **Turns begin with a breath, not a banner,** and end without comment. The washes dim 8%, the
   gold rule redraws from the ensō outward, one serif line ("John · 3 armies") brushes onto the
   paper and dries. Ending a turn is the track fill sliding plus a paper tick.
7. **Defeat is dignified.** Elimination: the last territory's ink lifts as smoke, the seat ring
   empties, a bowl tone, one epitaph line ("Sam · out in round 9"). No colour wave for the winner.
8. **Victory is a scroll, not fireworks.** Every other wash dries back to paper; the winner's ink
   stays; the scroll shows the ensō, one line, three award lines, the timeline as an ink line.
   Rematch is the only gold.
9. **The AI is another hand at the table.** Same choreography, faster; its think time is a held
   stillness (no spinner, no "thinking"). One narration line, present tense, real names.
10. **Passing the device is turning a page.** On TV the breath does the job. On phones with 2+
    humans the hand-off is a paper sheet: board dims to indigo, "Pass to Sam", one gold ring.
11. **Odds come back as words.** `Kamchatka → Alaska · 64% · likely`, plus at most one stake when
    one exists (`· takes North America`). ≤ 60 characters. No stakes chips.
12. **No Japan-shop.** No kanji, seals, blossoms, torii, Fuji, sun discs, koto stings or proverbs.
    That is what made the sumi-e reference "a mess". Copy stays plain English, names and numbers.

## 3. Visual system

### Board rendering (Three.js, procedural at boot)
- **Flatten.** Tile depth drops to ~0.06 with no bevel; home pitch rises to ~80° (a scroll on a
  table). 3D survives only in hover/select lift, the lacquer tray and contact shadows. Camera
  clamps: pitch 70–85°, azimuth ±10°.
- **Washi ground** (`scene.ts` shader, rewritten): indigo `#101a30` → `#0b1224` with anisotropic
  fbm fibres (6:1 in x), a 12% vignette, and 6–8 calligraphic wave strokes drawn once into a
  2048×1024 canvas, seeded by the game seed, ivory at 10–14%. Graticule, compass, labels, table and
  frame: deleted.
- **Ink layer** (new `ink.ts`): one 4096×2048 canvas (2048 on phones) with every ring stroked as
  dry brush: 5–7 passes offset ±1.5 px through a bristle-noise alpha mask, width modulated by noise
  along the path (coast 3–5 px; interior borders 1.5–2.5 px at 40%), plus a 12 px feather at 6%.
  Sampled by the ground and by tile tops so strokes sit on the wash. Sea lanes become ink dabs.
- **Washes** (`tiles.ts`): owner colour × paper grain × edge darkening. A data texture stores tile
  id and distance-to-border; the top shader darkens 18% in the outer 8% of each tile and adds two
  fbm blotches at ±6% lightness. Alpha 0.92 so indigo breathes through.
- **Ink flood** (reuse `uFlood*`): the front radius is fbm-perturbed (±12%), a darker rim leads it,
  the old wash stays underneath at 10% until the round ends, then dries in 600 ms.
- **Continents:** the halo contour is replaced by tinting the continent's outer coastline stroke in
  the holder's wash. The label stays, serif, quieter.

### Units: one style
Pick **pale silver-ivory silhouettes with a small wash blot at the feet** (the `units-place.png`
read). Reject the two drifts: dark ink figures (`units-board.png`) vanish on slate and sage at 3 m;
the charging illustrations (`units-attack.png`) are animation frames, not board state. Build: three
authored SVG silhouettes (soldier with spear 1–4, horse and rider 5–9, cannon 10+; ~12 strokes
each, under `src/render/ink/`), rasterised at boot into a 1024 atlas with a dry-brush pass, drawn
as instanced camera-facing quads ~34×40 px at home on 1440×900, facing the last target. The count
sits to the figure's right in a brushed ensō ring (DOM overlay as now, ≥ 22 px, serif 600 lining
figures). Owner colour lives in the blot and ring; the figure stays ivory so it reads on every wash.

### Palette, type, marks
| Role | Value |
|---|---|
| Paper | `#101a30` base · `#0b1224` deep · `#1b2a48` fibre |
| Ink | `#e2ddcf` coast · `#c9c3b4` @40% borders · `#f0ebe0` text |
| Gold (only accent) | `#c9a961` · hairlines @55% |
| Seats (ids kept; hex and names change) | crimson→**Vermilion** `#b9574a` · cobalt→**Slate** `#5b7ea3` · amber→**Ochre** `#b8974f` · emerald→**Sage** `#6f8f6a` · violet→**Wisteria** `#8b7db3` · rose→**Plum** `#a6607f` |

Re-run the Machado/CIEDE2000 check before Phase 1 ships; adjust lightness, never saturation, until
the worst default-four pair is ≥ 9. Emblems stay, drawn as brush marks.

**Type:** one family, Cormorant Garamond Variable (already a dependency). Body 500 at ≥ 16 px, the
line 600 at ≥ 18 px, numerals `'lnum' 'tnum'` 600 at ≥ 20 px on tokens. Cinzel and Inter go. Small
caps with 0.08 em tracking for the track and titles. **Iconography:** emblems and the ensō only;
mobile phase icons go.

**The ensō:** drawn once per game from `state.rng` (variable width, bristle gaps, a tail, gap near
1 o'clock) into a 256 px texture. Uses: the title mark (draws itself over 900 ms at boot, replacing
the brass line), the centre of the gold rule, the menu button, the seat rings, the victory mark.

**Never allowed:** bloom, glows, text shadows, particles beyond ink dots, saturated hues, fills,
red for loss, gradients, drop-shadowed panels, a second gold, any motif in decision 12.

## 4. Motion language

Things appear by being *drawn* (a stroke reveal or mask sweep) and leave by *drying* (alpha fade),
never by sliding or scaling. Brush easing `cubic-bezier(.2,.9,.2,1)` in; `easeInQuad` out, always
shorter. Nothing overshoots except dice. One thing moves on the board at a time. After any beat,
250 ms of stillness before the next thing enters (the blitz cap overrides). Idle = zero tweens.

| Beat | Choreography | Timing (ms) |
|---|---|---|
| Turn start | washes dim 8%; gold rule redraws from the ensō outward; seat ring inks gold; one serif line brushes in, holds, dries | 300 · 400 · 240 / 900 / 300 |
| Place | wash +6% and coastline brightens on pick; on commit N ink dots fall and soak (≤ 12 alive), the number re-inks; denomination change = old figure dries, new stroke-reveals feet→head | 120 · 180 each, 40 stagger · 160 + 280 |
| Select | source lifts with a contact shadow, coastline full ivory; eligible borders breathe 0.5↔0.8 (the only pulse); others dim 15% | 140 · 2.4 s sine · 180 |
| Attack 1 · arrow draws | one gold brush stroke, tip-first, thick→thin, ending in a flick | 260 |
| Attack 2 · dice land | lacquer tray rises; dice (owner wash, ivory pips) shake → tumble → settle → **silence** → verdict: losers dim to 50% under an ink splash, pairs joined by a gold hairline | 220 · 120 → 380 → 100 → 250 → 260 (≤ 1.2 s) |
| Attack 3 · defender falls | −N re-inks; at 0 the figure dissolves upward as smoke | 320 |
| Attack 4 · ink floods | new wash spreads from the entry edge behind a dark rim; traveller walks the arrow; arrow dries from the tail; old wash ghosts 10% for the round | 600 · 400 (+120) · 140 |
| Blitz | first and last rolls full, middle rolls snap with the tally re-inking; the final roll keeps the silence beat | ≤ 3.0 s, as built |
| Continent gained | the continent's coastline re-inks in the holder's wash clockwise from north; one bowl tone | 600 · 400 hold |
| Elimination | last ink lifts as smoke; seat ring empties; 150 silence, then a low bowl; epitaph line; the board holds still | 1.6 s, input ignored 500 |
| Fortify | a dotted ink route draws ahead of the walking figure and dries behind | 220/hop, ≤ 900 |
| AI turn | same beats at watch; brief = arrow 150, re-ink, flood 250; think time is stillness | ≤ 0.8 s brief |
| Victory | other washes dry to paper, staggered by distance from the winner's largest continent; winner's ink stays; board dims 40%; the scroll rises | 1200 · 600 · 400 |
| Screens / sheets | dry out, brush in; phone sheets spring with ≤ 2% overshoot | 160 / 240 · 280 |
| Idle | nothing. The board is a finished painting | 0 |

Reduced motion: strokes become 150 ms fades, the breathing border a steady 0.7, smoke a fade, the
flood a 250 ms crossfade. Every animated state keeps a static cue.

## 5. UI/UX overhaul

**Title.** The painting, flat, no table. "War Table" in serif small caps, the ensō drawing itself
beneath, the gold rule. Three lines: New game · Continue · How to play; Settings and Text size fold
under one "Settings" word. One gold: Continue when a save exists, else New game.

**New game.** Right shape already; restyle. Seat rows: an ensō ring in the seat's wash (tap → six
swatches), serif name, `Human · AI` and difficulty as words with the active one gold-underlined.
Length and Setup as segmented words. Summary line, `Start` as the gold outline pill.

**In-game HUD.** Top: seat rings with the territory count (`John 11`); the current ring gold-inked;
eliminated rings empty; the ensō at top right is the menu. Bottom: the gold hairline rule across the
width with the ensō centred; below it one outlined pill holding the Turn Track words (current = gold
outline and text; done = ivory 40%; locked = ivory 25%); action pills to its right (Roll, Blitz; a
pending commit takes the gold and the segment drops to bright ivory); the count control as `− 3 +`
or a hairline slider. The one line sits on the paper just above the rule, serif, no panel. The
lacquer tray floats above the line over the southern ocean, header `Kamchatka 6 · Alaska 4`.

**Menus and sheets.** Paper sheets: indigo at 96%, hairline ivory border at 20%, serif title, items
as words with generous spacing; focus is a gold hairline underline. The board dims 40%, blur 6 px.

**Rules / learning.** "How to play" is one scroll: five short blocks, each with a tiny ink
illustration (the three figures with their ranges, dice pairing, the track). In play, the one line
teaches, refused clicks replace it for 2 s (kept), and the odds word teaches probability without a
lecture. No tooltips, hint line or coach text.

**Victory.** The scroll (decision 8): ensō in the winner's wash, `John holds the world`, `Round 14 ·
31 territories`, three award lines, one ink timeline per player with no grid, then Rematch (gold) ·
New setup · Title.

**Mobile.** `docs/MOBILE.md` layouts stay; the dock becomes rule + pill + line (portrait two rows,
landscape one). Phase icons go; the ensō menu is 44 px; sheets restyle as paper; haptics stay (they
are the theme's physical texture). PWA icon: the ensō in gold on indigo.

**Interaction feel.** Touch/hover: the coastline brightens in the same frame plus a hairline lift;
a light haptic on select. Buttons: text dims 20% on press, no scale. The long-press name card is a
serif line on the paper above the finger.

## 6. Sound direction

Five materials, synthesised as now, replacing the felt/plastic bank: **paper** (turn breath, sheets,
segment change), **brush** (a filtered noise sweep that follows the arrow and the flood,
duration-matched), **wood** (dice shaken in a lacquer cup, low and dry), **bone** (dice landing: two
short clicks, panned −0.3/+0.3), **bowl** (a struck rin at three pitches: continent, elimination low,
victory high, 4 s tails). Loss is the smoke: a breath of noise, no thud. Silence rules: nothing
inside the verdict beat; no hover sounds; ≤ 1 cue per 70 ms; AI-vs-AI at 50%. Music stays off by
default; the optional bed becomes one low drone with 30–60 s gaps. Cues fire on contact frames.

## 7. Cut, change, keep

**Cut:** walnut table, slab, brass frame and trim, compass, graticule, ocean names, continent halo
contours, tile bevels and depth, 3D sculpted pieces and bases, felt/wood dice tray, dice cracks,
Cinzel and Inter, brass fills and coloured segments, the red top edge, glass panels and blur
shadows, boxed banners, the elimination colour wave, the victory wave and attract orbit, ocean
shimmer, dust particles, mobile phase icons, the boot brass line.

**Change:** palette values and names (contract file, lead applies), badges → ensō rings, banners →
lines on paper, tray → lacquer, arrow → gold stroke, flood → ink with ghost, elimination and
victory treatments, the odds line gains the word and one stake.

**Keep:** engine, rules, AI, map; the Turn Track; board clicks select / buttons commit;
target-first attack; blitz ≤ 3 s; click-through; no spoilers; the one line and reason copy;
stepper/slider and smart occupy; the mobile gesture model, sheets, PWA, haptics; fitted UI scale;
e2e hooks and flows; awards ledger; contact-frame sound rules; emblems; save and Continue.

## 8. Phasing

**Phase 1 · Paper and ink.** Flatten tiles, washi ground, ink layer, wash materials, ink flood, cut
furniture/compass/graticule/labels, new palette, Cormorant everywhere, hairline pills, gold rule
with a static ensō. Ships as: the live game looks like the chosen board. Gate: legibility at
1280×800 and 390×844 from 3 m; palette ΔE ≥ 9; idle tweens 0.

**Phase 2 · Figures and the beat.** Ink sprites and ensō rings, the four-step attack storyboard,
lacquer tray and silence beat, smoke fall, ghost wash, turn breath, the five-material sound bank.
Ships as: the core loop feels new. Gate: roll ≤ 1.2 s, blitz ≤ 3 s, first-roll frame < 50 ms,
sprites cheaper than sculpts on iPhone 13.

**Phase 3 · Ceremony and screens.** Seeded self-drawing ensō, title, new game, paper sheets, rules
scroll, victory scroll with ink timeline, elimination and continent treatments, mobile restyle and
PWA icon. Ships as: the whole evening.

**Phase 4 · Restraint audit.** One-gold e2e check, ≤ 20 words on screen in a typical Attack state,
noise budget, reduced motion, TV size, colour-blind re-sim, perf sweep.

**How this fails.** *Boring:* muted washes plus silence read as dead. Defence: contrast at the
beat; the gold stroke, tray and bowl are the only bright things, and the verdict lands inside
1.2 s. *Slow:* ceremony creep. Rule: added forced time per human turn = 0
(`metrics().forcedWaitMs`). *Pretentious:* props instead of restraint; decision 12 and the
plain-copy tone guide are hard gates. *Illegible:* small Cormorant and slate on indigo at 3 m; the
minimums are gates, and washes get lighter, never more saturated. *Clip-art figures:* gate each
silhouette against `units-place.png`; if the brush pass fails, ship plain ivory silhouettes.
