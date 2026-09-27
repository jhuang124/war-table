# Round 2: intuitive turns, full-screen board, real pieces

Source: John's feedback after playing the simplified build, and two independent reviews of it —
Fable 5.1 (`_claude/review-fable.md`, played it) and Codex gpt-6-astra (`_claude/review-astra.md`,
code + screenshots). Where they disagreed, the lead's call is recorded. **This file overrides
docs/SIMPLIFY.md, docs/UX.md and docs/SPEC.md §6–7 where they conflict.** Rules, engine, AI, audio,
dice, and the AI highlight reel stay.

John's four points: (1) phase changes aren't intuitive — Enter/Space/E to move on feels bad;
(2) the board should take the entire screen; (3) units should be stylized pieces with icons like a
real board game; (4) a lot more can be improved.

---

## A. The Turn Track (one fixed phase control) — HUD + controller

Replace the inert `Place · Attack · Fortify` text **and** every phase-changing button (`Attack →`,
`Fortify →`, `End turn` in the action zone) with one **Turn Track** at the left of the bottom strip:
four segments in a single pill group.

| Segment | Label | States |
|---|---|---|
| 1 | `Place` | done `✓ Place` (ivory 40%) · current: filled in seat colour, ink text, raised |
| 2 | `Attack` | eligible: ivory outline; hover: brightens + lifts 1 px · locked: ivory 25%, no border |
| 3 | `Fortify` | same |
| 4 | `End turn` | brass outline; brass fill when it's the recommended next step |

- Click a **forward** eligible segment to go there. Past segments are inert. From Attack, clicking
  `End turn` skips fortify (1 click). Clicking a locked segment puts the reason in the line for 2 s
  (`Place your 3 armies first`, `Trade cards first`, `Finish moving armies in first`).
- The **recommended next** segment glows (brass edge, slow ease): all armies placed → `Attack`;
  no attacks possible → `End turn`; in Fortify → `End turn`. Enter triggers it (hidden accelerator).
- The track **never disappears or renames** — not while an attack is armed, not while rolling
  (it's disabled, visibly, only during a roll and a mandatory occupy/trade).
- AI turns: the same track shows the AI's colour marker moving through the segments. Setup: one
  segment `Setup` + `Done`.
- On advance (180 ms): the fill slides to the new segment, one wooden clack, and the board answers
  (no camera move): → Attack: tiles that can attack lift slightly with a rim sweep; → Fortify: other
  players' tiles dim; End turn: highlights clear, the turn passes (chip fill slides to the next
  seat, accent sweeps), then the turn banner.
- The **right side of the strip is an action zone only**: the count control and ≤ 2 buttons
  (`Undo` / `Cards N` secondary; `Place 9` / `Roll` + `Blitz` / `Move 8` / `Move 5 · end turn`
  primary). Nothing there changes phase except the fortify `Move N · end turn`, which says so.
- Exactly one brass-filled thing at a time: the pending commit button, or the recommended track
  segment when nothing is pending.

## B. Board clicks select, buttons commit — controller

- A board click only **selects / previews**. Commits are buttons. Remove: click-the-armed-target-to-
  roll, double-click-to-place-all, board-click-confirms-occupy, clicking an enemy to implicitly leave
  Place. (Keyboard accelerators may stay hidden: Enter = primary / recommended segment, Esc = clear.)
- Attack stays target-first: clicking an enemy selects it and auto-picks your strongest adjacent
  source; clicking another of yours switches the source. Clicking empty ocean or Esc clears the
  selection. While armed, the line reads `Ural → Siberia · 82%` with `Roll` + brass `Blitz`.
- Occupy: `Move into Siberia`, count control, brass `Move N`. After moving, the new territory is
  auto-selected as the source if it can keep attacking (as now).
- Count control by range: ≤ 6 options → `− N +` stepper; > 6 → slider. Show the resulting totals on
  both pieces while choosing (Astra).
- Place: click your territory → stepper (default all remaining) → `Place N`; `Undo` after a
  placement. Cards: `Cards N` secondary opens the hand; forced trade → brass `Trade cards +N` is the
  only action and the track is locked.

## C. Full-screen board — renderer (+ HUD insets)

- **Cover, don't contain**: the ocean/board surface extends past every edge of the viewport; no
  visible frame, brass trim or table during play (the table/frame may remain for the title screen's
  attract view). Width-bound slack is ocean, never wood.
- Pitch 64° → ~70°. The land hull fits inside the HUD-free region with ~12 px clearance; never crop
  playable land.
- HUD floats on the ocean: top = seat chips + `≡` as glass pills (no full-width bar); bottom strip
  = floating glass pill, `bottom: 12px`. Report real HUD rectangles via setViewportInsets.
- Dice tray floats above the bottom strip over the southern ocean; tokens never sit under it.
- `Reset view` pill beside `≡` appears only when the player has orbited/zoomed away (Astra).

## D. Unit pieces — renderer

- **One sculpted piece per territory**, standing on a low turned base in the owner's colour, with
  the full army count on a crisp camera-facing plaque (DOM numeral as now, Inter 700 tabular).
- Denominations like physical Risk: **infantry 1–4, cavalry 5–9, artillery 10+**. Procedural,
  low-poly, bevelled, painted silhouettes (soldier with rifle; horse + rider; cannon on wheels),
  readable as distinct shapes from a couch at home zoom. Sized ~38×44 px at 1440×900.
- Base colour = owner (slightly richer than the tile); the sculpt is painted in the owner colour
  with a darker shade and a light edge so it reads against its own tile.
- Motion: place = settle hop (160 ms); crossing a denomination boundary swaps the sculpt with a
  quick pop; loss = recoil; empty = topple; conquest = the loser topples toward the attacker while
  one piece carrying the moved count travels along the arc; no idle motion.
- Rules card gets one line: "Pieces show army size: soldier 1–4, horse 5–9, cannon 10+."

## E. Clarity polish — both

**Must**
- Battle tray fades 300 ms at ~1 s after a decided fight, immediately on a new selection or phase
  change; on conquest the header reads `Siberia captured` before fading.
- Armed attack: only the source, target and arrow are lit; other targets fall back to plain
  selectable; unrelated land dims only ~20%.
- Selectable rim stronger (≈ 0.6 opacity, 2.5 px); check on crimson, amber and emerald tiles.
- Default seats `crimson, cobalt, amber, emerald` (rose and crimson read as the same red).

**Should**
- New game: one colour emblem per seat; clicking it opens the six swatches (instead of 24 swatches).
- Roster chips `John 11` stay; card count only for the current human in the `Cards N` button.
- AI narration says what happened (`Cobalt moves 4 into Indonesia`), never "is reinforcing" out of order.
- Line change: outgoing line slides up while fading; never two lines overlapping.
- Pointer cursor only on clickable tiles and eligible track segments.

## Not doing

No sidebars, tooltips, hints, keycaps, second strip line, confirmation dialogs for phase changes,
unrestricted phase tabs, camera moves on phase change, or per-army figurine groups.
