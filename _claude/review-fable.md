# Risk: War Table — round-2 design review (Fable)

Played two full turns through the real UI at 1440×900 (18 clicks, 2 refused; place split, roll, blitz,
occupy, fortify, a 14.5 s AI round, a chain-occupy), plus layout shots at 1280×800 and 1920×1080.
Screenshots: `_claude/review-fable-shots/` (`log.txt` has the strip text per shot).

## 1. Diagnosis

1. **Phases advance through a button that keeps moving and renaming itself.** `Place 3` → `Attack →` →
   `Fortify →`/`End turn` → `Move 3 · end turn` all share the right-hand slot and vanish when a fight
   is armed (`11-attack-nothing-picked`, `13-attack-armed`, `23-fortify-armed`). There is no fixed
   "where am I / what's next" control, so Enter feels like the only reliable way forward.
2. **The step indicator looks like tabs but is inert.** `Place · Attack · Fortify` is 15 px dim text
   with no click handler (`src/ui/hud/strip.ts:93-131`). Everyone will click it once and learn nothing
   happens.
3. **The board doesn't react to a phase change.** Compare `10-place-all-placed`, `11-attack-nothing-picked`
   and `21-fortify-nothing-picked`: pixel-identical boards. Eligible tiles get a 30 % ivory rim
   (`src/render/tiles.ts:337-339`) that is invisible on red/pink at home zoom. A phase change is a text
   swap, not an event.
4. **A quarter of the screen is frame and table.** At 1440×900 the land ends at y≈750 and the strip
   starts at 825; at 1280×800 land is 85–650 of 800 (`layout-1280x800`). `solveHome` fits the land
   width-bound and centres the vertical slack (`src/render/camera.ts:196-236`), which puts wood, not
   ocean, under the map.
5. **Pieces are poker chips.** One flat disc + a numeral (`tokens.ts`). Strength has one channel
   (the digit); nothing reads as army, cavalry or cannon from a couch.
6. **Two of the four default seats are red.** Crimson `#c63d36` and Rose `#e0679e`
   (`src/shared/palette.ts:21,26,32`); once the board dims for a fight they merge (`13-attack-armed`).
7. **Battle chrome outlives the battle.** The tray and `NEW GUINEA 5 vs EASTERN AUSTRALIA 0` stay 2.5 s
   after the occupy (`controller.ts:2771-2773`) while the strip already says "click an enemy"
   (`18`, `19`, `32`); on an AI hand-off the stale header sits dimmed under a new arrow (`33`).
8. **While armed, every other target keeps pulsing** (`30-turn2-blitz-mid`: China and Siam glow during
   the Afghanistan fight). Attention hierarchy says armed = arrow + odds + Blitz only.
9. **A slider for two values.** Occupy 3…4 renders a 14 rem slider (`17-occupy`; `src/game/strip.ts:209`).
10. Small: the line crossfade overlays two sentences for a frame (`33`); "Cobalt is reinforcing" appears
    *after* Cobalt's attacks (it means fortify); `Cards 1` sits alone as the only button in Place.

## 2. The phase flow: a Turn Track you click

Replace the inert text and the `Attack →`/`Fortify →` buttons with one **Turn Track** at the left of the
bottom strip — four 40 px segments in a single pill group, like a marker moving along a round track:

| Segment | Width | Label | States |
|---|---|---|---|
| 1 | 92 | `1 Place` | done: `✓ Place` ivory-40 · current: filled seat colour, ink text, raised 1 px + shadow |
| 2 | 100 | `2 Attack` | eligible: ivory-40 outline, ivory-90 text; hover: border brightens, lifts 1 px |
| 3 | 100 | `3 Fortify` | locked: ivory-25 text, no border (click → refused line, 2 s) |
| 4 | 104 | `End turn` | brass outline; brass fill when eligible; never "done" |

Rules (controller):
- Click any **forward** segment to go there; Risk never goes back, so past segments are inert.
  Skip fortify = click `End turn` from Attack (1 click, budget kept). `Fortify` from Place with armies
  left → line: `Place your 3 armies first`.
- The **recommended next** segment glows softly (brass edge, 1.5 s ease): all placed → `Attack`; no
  attacks left → `End turn`. Enter still triggers it (hidden accelerator).
- AI turns: the track shows the AI's seat colour marker moving through the same four segments, so
  spectators see the turn structure. Setup: one segment, `Setup`.
- On advance (180 ms): the seat-colour fill slides from the old segment to the new one (a pawn
  sliding, `ease-out`), one wooden clack, and the **board answers** (no camera move):
  - → Attack: my tiles with ≥ 2 armies lift 0.15 and their ivory rim sweeps 0 → 0.6 → 0.45 hold;
    adjacent enemy targets get the static rim.
  - → Fortify: every non-own tile dims to 0.6 over 300 ms (existing `dim` channel); movable sources
    keep the rim. Fortify becomes visibly "your side of the board".
  - End turn: rims drop, dim lifts, the current chip's fill slides to the next chip (200 ms), the
    strip's accent bar sweeps left→right in the new colour (280 ms), then the turn banner.

The right side of the strip becomes an **action zone only**: count control + ≤ 2 buttons (`Undo`/`Cards`
secondary, `Place 3` / `Roll`+`Blitz` / `Move 4` / `Move 3 · end turn` primary). Nothing in that zone
ever changes phase. Words on screen go down (`Attack →`, `Fortify →` disappear).

## 3. Full-screen board

Goal: the map is the wallpaper; the frame and table are never in the home view.

- **Cover, don't contain.** Enlarge the ocean chart/slab by +15 % north-south and +6 % east-west
  (ocean shader plane, tiles unchanged), then make `solveHome` do two things: the *slab* covers the
  viewport (frame off-screen on all four sides) and the *land hull* stays inside the HUD-free region.
  When width-bound with vertical slack, spend the slack on ocean, not wood.
- **Strips float on the ocean.** Top: drop the full-width bar; keep only the chips + `≡` (glass pills,
  44 px row) over the Arctic. Bottom strip stays glass, 64 px, `bottom: 12px`, and overlaps the
  Southern Ocean; extend the existing tray keep-out so no token sits under the strip.
- **Pitch 64° → 70°.** Less foreshortening on the far row (Alaska, Greenland, Siberia are the smallest
  territories today at the most contested latitudes), and the trapezoid fills the rectangle better.
  Still reads as a table.
- Expected land heights: 1280×800 ≈ 680 px (from ≈ 565); 1440×900 ≈ 780 (from ≈ 665); 1920×1080 is
  nearly height-bound already and gains mainly the missing frame.
- Territory names default **on** at TV text size (the space is there now).

## 4. Unit pieces

Keep one piece per territory (the figurine crowds were the clutter), but make it a *game piece*:

- **Disc + denomination piece + number.** The turned wooden disc stays (owner colour), radius
  1.0 → 1.15 (`tokens.ts:16`; Japan clears 1.32). On its top, side by side: a 3D-embossed pictogram
  (ExtrudeGeometry from the card glyphs in `src/ui/hud/pictograms.ts`, 0.08 units high, seat *ink*
  colour) and the existing DOM numeral, 15 px/700, offset +0.35 units right.
- **Denominations = physical Risk:** infantry 1–4, cavalry 5–9, artillery 10+. The pictogram tells the
  band; the number tells the exact count.
- **Stack height = strength.** 1 disc for 1–4, 2 for 5–9, 3 for 10+ (each 0.3 units). From the couch a
  territory reads in three channels before you can read the digit: colour, height, silhouette.
- **Ink pairs:** ivory on crimson/cobalt/emerald/violet, near-black on amber/rose (already in palette).
- **Animation:** place = drop-in hop (existing) and, on crossing a band, the pictogram pops 1 → 1.18 → 1
  in 120 ms while the new disc slides in underneath; loss = flinch (existing), band drop = top disc
  pops off and fades 120 ms; conquest = the loser topples toward the attacker (80° over 260 ms, slide
  0.5) and fades while the traveler disc (carrying the band's pictogram) arcs in; idle = nothing moves.
- Traveler discs and the `+N` staged ghost keep working unchanged.

## 5. Everything else

**Must**
- Tray lifetime — why: stale chrome makes the board lie. Fade out 300 ms at 1.0 s after a decided
  fight, and immediately when a new source is picked or the phase changes.
- Selectable rim 0.3 → 0.6, width 2.5 (`tiles.ts:337`) — why: "what can I click" must be visible at
  home zoom. Verify by screenshot on crimson and rose tiles.
- Default seats `crimson, cobalt, amber, emerald` — why: two reds in the default 4-player game.
- Armed state focus — why: hierarchy. When armed, other targets fall back to `selectable`; only the pair
  and the arrow are lit.
- Count control by range — why: a 2-value slider is silly. Range ≤ 6 → stepper; > 6 → slider.

**Should**
- Phase-change sounds: wooden clack (advance), felt thud (fortify dim), brass tick (end turn).
- Line crossfade: the outgoing sentence slides up 6 px while fading; never two lines at full opacity.
- AI narration copy: "Cobalt moves 4 into Indonesia" instead of "Cobalt is reinforcing".
- Hover cursor: `pointer` on clickable tiles and on eligible track segments only.
- Chips: current chip's fill slides on turn change (see §2) instead of snapping.

**Could**
- Idle-only parallax: ±1.5° camera drift following the mouse when nothing is picked (Catan Universe);
  off under reduced motion, never during a selection.
- Season the disc paint: a 3 % vertex-noise wear so 42 tokens don't look printed.

## 6. What not to do

- No figurine groups again, no per-army pieces — one piece per territory, height carries the count.
- No tooltips, hint lines, keycaps or second line in the strip; the track and the board response are
  the teaching.
- No phase controls on the board, no radial menus, no side panel or roster panel.
- No camera moves on phase change or on arming a fight; the board answering with light and lift is
  the ceremony.
- Don't make the strip taller than 64 px or wider than 1180 px to fit the track — drop the segment
  numbers below 1366 px wide instead.
- Don't keep the `Attack →`/`Fortify →` buttons alongside the track "for safety": two ways to advance
  is the confusion we're removing.
