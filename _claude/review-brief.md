# UI/UX review brief: Risk: War Table (round 2)

You are reviewing "Risk: War Table", a 3D pass-and-play Risk (Vite + TypeScript + Three.js) at
/Users/jhuang/Desktop/JH-Projects/risk3d, for John and up to 3 friends on one laptop or TV.
It was just simplified ("the board is the UI": docs/SIMPLIFY.md). Current screenshots of every
state are in `_claude/review-shots/` (title, new game, place, attack armed, attack rolling, occupy,
fortify, AI turn, menu at 1440x900 and 1920x1080; `report.txt` lists the on-screen words).
The live build is at http://127.0.0.1:5274 (a production build of commit aaf2023).

## John's feedback after playing (this is the brief)

1. **"UI still doesn't feel intuitive."** Changing phase (Place → Attack → Fortify → end turn) feels
   bad; relying on Enter / Space / E to move on "doesn't feel great". Moving between phases should be
   obvious and satisfying on screen, with the mouse.
2. **"The board should probably take the entire screen."** No wasted margins, frame or empty table.
3. **"Stylize units with icons like a real game board."** Armies are currently plain numbered
   discs. He wants pieces that read like a real board game: unit icons (e.g. infantry / cavalry /
   artillery, or equivalent), not just numbers.
4. **"There's a lot that can be improved."** Look for everything else that would make this feel
   like a great, intuitive, premium board game.

The rules engine, AI, and core loop (pick a target → see the odds → roll big dice → push on) stay.
Everything about presentation, layout, flow and feedback is open.

## What to deliver

A prioritized improvement plan, written so a builder agent can execute it:

1. **Diagnosis** (≤ 10 bullets): what makes it feel unintuitive or cheap today, with evidence
   (screenshot name, or file:line if you read code).
2. **The phase flow**: your concrete design for how a player moves through a turn with the mouse.
   Name every on-screen element, its label, where it sits, and what happens on click.
3. **Full-screen board**: how to lay out the board and HUD so the board fills the screen at
   1280x800, 1440x900, 1920x1080, and where the HUD elements float.
4. **Unit pieces**: the design of the army pieces (shape, icon set, how counts are shown, how
   they stay readable at a glance and from a couch), and how they animate.
5. **Everything else**, ranked must / should / could, each with a one-line "why" and a concrete spec.
6. **What not to do**: things that would make it worse (avoid re-adding clutter).

Be specific (labels, sizes, positions, timings) and ruthless about priority. Cite real games as
references where they help (Risk: Global Domination, Ticket to Ride, Catan Universe, Polytopia,
Civilization, Board Game Arena, physical Risk). Keep it under ~1,500 words.
