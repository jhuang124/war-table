# Risk: War Table

Classic Risk for 2 to 4 players around one computer — a laptop on the coffee table or a TV. Any seat
can be an AI. A 3D board on a walnut table, real dice in a tray, and a HUD that always says what to do
next. No accounts, no server, no online play: everything runs in the browser and saves to it.

## Start

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5273** in Chrome, Edge, Safari or Firefox (any browser with WebGL 2).
Plug the laptop into the TV if you have one, and pick **Text size · TV** on the title screen.

For a production build: `npm run build`, then `npm run preview` (http://127.0.0.1:5274).

## Playing

**New game.** Name the seats (2–4), pick each seat's color and Human/AI (Easy · Normal · Hard). Pick a
length and a setup, then **Start**. The line above Start says exactly what you picked.

| Length | Goal | Estimate |
|---|---|---|
| Quick | 60% of the world, or most territories after 12 rounds (2 players: 75%) | shown on the button, from your seats |
| Evening (default) | 70% of the world (2 players: 80%) | ″ |
| Full conquest | every territory | ″ |

The estimates come from 200 simulated games (`npm run sim`) times the measured length of an AI turn
(about 5 s) and about 80 s per human turn, so a table of four humans sees longer numbers than one human
against three AIs.

| Setup | What happens |
|---|---|
| Quick deal (default) | Territories dealt at random, armies placed for you. You're playing in seconds. |
| Place your own | Territories dealt at random; you place your starting armies in two passes. Clicks stage armies, right-click takes one back, **Confirm placement** commits them. |

**A turn.** The bar at the bottom always says what to do, in words, with real names and numbers.

1. **Reinforce.** Click your territories to place armies (+1 per click). After the first click, `+5`
   and `All N` pills appear under the tile. Right-click takes one back. Holding a card set? The
   `Trade 3 cards · +8` chip trades your best set in one click (at 5 cards you must trade first).
2. **Attack.** Click an enemy next to you — the game picks your strongest neighbour as the attacker
   (click another of yours to switch). The battle panel shows the odds and what's at stake. **Blitz**
   (Space) keeps rolling until it falls; **Roll** (or clicking the target again) rolls once. After a
   win, just click your next target: the move-in uses a sensible default. Take at least one territory
   to earn a card.
3. **Fortify.** One move through your own territories, then the turn ends. Or **End turn**.

AI turns play as a short highlight reel: fights against a human get the full dice, AI-vs-AI fights are
headlines. The top bar's `AI: watch · fast · skip` toggle changes the pace at any time. A click during
an AI turn skips the current fight; a click during your own animation finishes it and does what you
clicked.

**Ending.** First to the goal wins, or Pause (Esc) → **End game now** calls it for whoever holds the
most territories. Victory shows awards (Nemesis, Hot/Cursed dice, Biggest cash-in), a territories
chart, and **Rematch** (same seats, new dice).

The game autosaves after every action. Close the tab, come back, press **Continue**.

## Controls

| Input | Does |
|---|---|
| Click a tile | The action the bar describes (hover a tile to see what a click will do) |
| Right-click a tile | Take back one army placed this turn |
| Left-drag / right-drag / wheel | Orbit / pan / zoom the camera (it returns home at your next turn) |
| Enter | The brass button |
| Space | Blitz · confirm a move or placement (never ends a phase) |
| E | Fortify → / End turn |
| B · 1 2 3 | Blitz · number of dice |
| Shift / Alt + click | +5 / all remaining |
| Tab · F | Cycle clickable tiles · focus the selection |
| L · M · ? | Territory names · mute · rules card |
| Esc | Back out one step, then pause |

## House rules (New game → House rules)

- **Draft territories**: take turns claiming territories instead of a random deal (adds ~10 min).
- **Card sets**: Growing (4, 6, 8, 10, 12, 15, then +5; the default) or Fixed (4 / 6 / 8 / 10).
- **Fortify**: along any connected chain of yours (default) or to a neighbour only.
- **Armies per setup turn** (Place your own): two passes (default), or 3 / 5 / 8 per turn.
- **Seed**: the same seed gives the same deal and dice.

## Settings (title screen or Pause → Settings)

Text size (Laptop · Couch · TV), animation speed for your own turns (1× · 2× · Instant), AI speed
(Watch · Fast · Skip), sound volume, mute, music (a quiet ambient bed, off by default), territory
names on the board, show win chance, **Hide cards between turns** (a pass-the-laptop cover between two
humans, off by default because on one TV everyone can see anyway), return camera home each turn, and
reduce motion (also follows the system setting).

## Troubleshooting

- **Blank or black screen**: the board needs WebGL. Check `chrome://gpu` (or try another browser);
  on some machines hardware acceleration is turned off in the browser's settings. As a fallback,
  `http://127.0.0.1:5273/?stub` plays on a flat 2D board.
- **No sound**: browsers only start audio after the first click or key press. Check the mute toggle (M)
  and the volume in Settings.
- **Port 5273 is busy**: another dev server is running. Stop it, or run `npx vite --port 5280`.
- **Everything is tiny on the TV**: Text size → TV on the title screen (or Settings).
- **The camera got lost**: it returns home when your next turn starts; F frames your selection.
- **Start over**: Pause → Restart, or clear the site's storage (`risk3d.*` keys in localStorage).

## For developers

| Command | What it does |
|---|---|
| `npm run dev` | Dev server, http://127.0.0.1:5273 |
| `npm test` | Unit tests (engine rules, AI, controller, pure helpers) |
| `npm run test:e2e` | Every Playwright flow in `tests/e2e/` against the real board and HUD (starts its own server on :5290; logs in `artifacts/e2e/`) |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build to `dist/` |
| `npm run sim -- 200` | AI-vs-AI soak: every game must finish legally; prints win rates and rounds-to-threshold |
| `npm run verify:map` | Checks board geometry against the classic borders and writes `artifacts/map/preview.png` |
| `npm run verify:audio` | Offline + live checks of the synthesized sound effects |
| `npm run gallery` | The HUD fixture gallery (`ui-gallery.html`) |

Dev pages: `render-sandbox.html` (the board alone, with an AI game and every animation on buttons),
`audio.html` (every sound), `ui-gallery.html` (every HUD state). `window.__risk` is the test API
(SPEC §9). The design lives in `docs/SPEC.md` (what) and `docs/UX.md` (how it feels).
