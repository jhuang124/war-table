# War Table: silver ink on indigo — overhaul plan

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
