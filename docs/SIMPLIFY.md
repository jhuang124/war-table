# Simplify pass: the board is the UI

John played it (2026-09-27) and called the UI "overdone and confusing". Diagnosed with the `off`
menu, he picked **every** overdone symptom (too much text, too many controls, too many pop-ups,
crowded board) and three confusion symptoms (what to click next, too many ways to do it, turn
structure unclear). Reference: **a physical board game — the map dominates, one thin strip says the
one thing to do now, almost no chrome. Ticket to Ride digital's restraint.**

Instruction:

> Reduce density: one primary action per step, one visible path per intent, progressive disclosure
> for everything else. Cut hint lines, receipt/stakes chips, upset banners, toasts, hover tooltips,
> the +5/All pills, the dice toggle, keycaps, the side rail and the roster panel.

**This file overrides docs/UX.md and docs/SPEC.md §7 wherever they conflict.** The engine, map,
rules, AI, audio, and the core loop (pick a target → see the odds → roll → watch the dice → push on)
do not change. When in doubt, cut: every element on screen must earn its place for a person who
has never played.

---

## 1. Layout (1280×800 up to 1920×1080)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▲ John 14  ● Cobalt 11  ◆ Amber 9  ✚ Rose 8                    ≡     │  top strip ~44 px
│                                                                      │
│                                                                      │
│                    THE BOARD (fills everything)                      │
│                                                                      │
│              [ dice tray appears here only during a fight ]          │
│ ① Place  ② Attack  ③ Fortify │ Attack Siberia from Ural · 82%  [Roll] [Blitz] │  bottom strip ~64 px
└──────────────────────────────────────────────────────────────────────┘
```

- **Top strip = the roster.** One chip per seat, in turn order: emblem, name, territory count.
  The current player's chip is filled in their color; others are outlined. Eliminated seats are
  struck through and dimmed. A small card count (`🂠 3`, a card glyph + number) appears on a chip only
  when that player holds ≥ 3 cards. No armies total, no income, no progress bars, no AI tag (AI
  seats show a subtle `AI` superscript at most). Menu button `≡` at the far right. Nothing else up
  here: no round chip, no Next-set chip, no AI speed toggle, no `?`.
- **The board fills the space between the strips**, edge to edge (minus a small margin). No left
  roster panel, no right rail. The home view frames the land to that region.
- **Bottom strip** (one row, fixed height, full width up to ~1100 px, centered):
  - left: the **step indicator** `Place · Attack · Fortify` — current step lit in the player's
    color, done steps dimmed, future steps muted. During setup it reads `Setup`. During an AI turn:
    `Cobalt's turn` in their color.
  - center: **one line** of instruction, ≤ ~50 characters, real names and numbers. No second line.
  - right: the controls for this step (at most one count control) and **at most two buttons**:
    one primary (brass fill) and one secondary. No keycap labels on buttons.
- **Dice tray**: appears just above the bottom strip only while a fight is armed or rolling, then
  fades out. Above the tray, one header line: `URAL 12  vs  SIBERIA 5`. Below it, nothing — the odds
  live in the bottom strip line.
- **Cards**: a `Cards 3` secondary button lives in the bottom strip during your Place step (only
  when you hold cards). It opens a simple sheet with your hand; a set shows one `Trade for +8`
  button. When you hold a valid set it's suggested in the strip (see §2). No rail, no badge.
- **Menu (`≡` / Esc)**: Resume · Rules · Settings · Log · Save & quit · End game now · Restart.
  The battle log moves here (read-only list, newest first). AI speed moves into Settings.

## 2. The turn, one path per intent

| Step | Line (examples) | Controls | Buttons (primary first) |
|---|---|---|---|
| Place | `Place 9 armies · click a territory` | — | `Trade cards +8` (only if a set exists; primary when forced) · `Cards 3` |
| Place, territory picked | `Place on Ural` | stepper `− 9 +` (default = all remaining) | `Place 9` · `Undo` (only after a placement) |
| Place, all placed | `All placed · attack next` | — | `Attack →` · `Undo` |
| Attack, nothing picked | `Click an enemy territory to attack` | — | `End turn` · `Fortify →` |
| Attack, armed | `Attack Siberia from Ural · 82%` | — | `Blitz` · `Roll` |
| Occupy | `Move armies into Siberia` | slider min…max (smart default) | `Move 8` |
| Fortify | `Move armies once, or end your turn` | — | `End turn` |
| Fortify, picked | `Move from Ural to Siberia` | slider | `Move 5 · end turn` |
| AI turn | `Cobalt attacks Siam` (live narration) | — | — |

Rules:
- **Place = click a territory, then place.** Clicking your territory selects it; the strip shows a
  stepper defaulting to all remaining armies and a `Place N` button. Clicking another of yours moves
  the selection. `Undo` takes back the last placement (engine `unreinforce`). Placement is committed
  on `Place`, so misclicks are free. Right-click, +1 clicks, Shift/Alt and the +5/All pills are gone.
  (Double-clicking a territory places all remaining there, as an invisible accelerator.) The same
  pattern runs setup ("Place your own").
- **Card trade = one button.** If you must trade, the primary is `Trade cards +10` and nothing else
  is enabled. If you may trade, `Trade cards +8` is the primary until you place anything. The best
  set is chosen for you. The Cards sheet is only for looking.
- **Attack = click an enemy.** Clicking an enemy territory picks your strongest adjacent territory as
  the source (as now); clicking another of yours switches the source. Then `Blitz` (primary) or
  `Roll` (one roll, max dice). Clicking the target again also rolls once. **The 3·2·1 dice toggle is
  gone: always the maximum dice.** In Attack with nothing armed the buttons are `End turn`
  (primary) and `Fortify →` (secondary). Clicking empty ocean or Esc disarms. The card you earn by
  conquering is drawn automatically at end of turn; no label needs to mention it.
- **Occupy** keeps the smart default and the chain behaviour (a board click confirms the default).
  The control is one slider; `Move N` confirms. No Min/−/+/Max, no note.
- **Fortify**: click a source, click a destination, slider, `Move N · end turn`. Or `End turn`.
- Keyboard stays as a hidden accelerator (Enter = primary, Space = Blitz/confirm, Esc = back/menu),
  but it is never shown on screen.

## 3. What gets cut

Remove the element, its view-model fields, its controller logic, and its tests/e2e expectations
(replace them with the new flow). Don't leave dead code behind feature flags.

- Action bar line 2, the hints system and `Hints on` chip, first-time coach lines.
- Receipt chips (`14 territories → 4 · North America +5`), card-status chips, stakes lines.
- The +5 / All pills, right-click undo, +1 click placement, Shift/Alt modifiers.
- The dice-count toggle. The Choose cards / Begin attack / Min / Max / −/+ buttons.
- Keycaps on every button.
- Hover tooltips over territories. Hovering a clickable tile still lifts it and shows its name
  (see §4); the strip's line says what a click will do only when something is picked.
- Upset banners (HELD! / AGAINST THE ODDS), "within 5 of victory" banners, big-trade banners,
  final-round banners, every toast. Keep their data for the victory awards and the log.
- The right rail, the left roster panel, the Next-set chip, the round chip, the AI speed toggle in
  the top bar, the `?` button.
- Refused-click copy stays (it's how people learn), but it replaces the one line for 2 s — no sound
  beyond the soft tick, and nothing else changes.

## 4. The board (renderer)

- **One army token per territory**: a round disc (like a wooden game token) with the number,
  owner-colored fill, crisp tabular number, sized to be readable at 3 m but small enough that the
  tile around it shows. No emblem, no ring, no pill, no ghost chips except the pending `+N` while a
  placement is staged. Remove the infantry/cavalry/artillery figurine groups (they were invisible at
  home and are the main source of clutter).
- **Territory names off by default**; the hovered tile (and the picked source/target) shows its
  name. Settings keeps a `Territory names` toggle. Continent labels stay on the ocean (name + bonus)
  but quieter. Remove the ocean labels (PACIFIC OCEAN…) and the "· 1 AWAY" suffix.
- Keep: tiles, owner colors, the hover lift, selectable/target highlights, the attack arrow, sea
  lanes, dice tray, conquest flood, continent flare, elimination and victory moments, the table,
  frame and ocean. Nothing new gets added.
- Framing: the home view fills the region between the top strip and the bottom strip (insets come
  from the UI as before). The board should span nearly the full window width at 1440×900.

## 5. Banners (the whole list)

- **Turn banner**: center-top, `JOHN'S TURN` + `+9 armies` (one line). Human turns only, ≤ 1.2 s,
  never blocks. From round 2, one recap line only if you lost territory: `Cobalt took 2 of yours`.
- **Continent captured**: `JOHN HOLDS ASIA · +7` (human involvement only; AI-vs-AI just flares).
- **Elimination**: `SAM IS OUT`.
- **Victory** screen: unchanged (it's good).
Nothing else. At most one on screen.

## 6. Done means

- Screenshots at 1280×800, 1440×900, 1920×1080: the board covers most of the window; the only
  chrome is the top strip, the bottom strip, and the dice tray during fights.
- A first-time player can play a full turn reading only the bottom strip.
- Every e2e flow is rewritten to the new paths and passes; `npm test`, typecheck, build pass.
- Feel budgets still hold: AI turn median ≤ 6 s, blitz ≤ 3 s, no forced waits, 60 fps.
- Word count on screen in a typical Attack state ≤ 25 words (top strip + bottom strip + tray).
