# Overhaul brief: War Table, ink & night

**Game:** War Table (`/Users/jhuang/Desktop/JH-Projects/risk3d`) is a 3D pass-and-play world-conquest game in the Risk mold.
- Vite + TypeScript + Three.js.
- Live at https://jhuang124.github.io/war-table/ (push to main deploys).
- Desktop + mobile (PWA).
- Played by John and up to 3 friends on one device.
- Current design docs: `docs/ROUND2.md` (Turn Track, board clicks select / buttons commit) and `docs/MOBILE.md`.

**The rules stay. So does the core loop:** pick a target, see the odds, roll, watch, push on.

## What John asked for

He picked a direction from a moodboard: **"Silver ink on indigo."** The board is a deep indigo washi-paper ground. Coastlines are feathered dry-brush strokes in silver-ivory ink. Territories carry soft, muted ink washes. The type is one elegant serif. Gold appears only on the active element. A thin gold rule is centered on a brushed ensō. Units are ink figures: a foot soldier for small armies, a horse and rider for medium, a cannon for large.

He wants this used as **inspiration for an ambitious visual and UX overhaul**, with:
- more fully featured animations;
- a delightful UI/UX experience;
- a UI/UX overhaul that matches the *intention* of the theme (Japanese zen), not just its surface. His words: "not just you overfitting on the aesthetics."
- **taste decisions, not just visual ones**: how it should *feel* to play, pace, sound, interaction, ceremony, restraint, and what to remove.

## Moodboard

All in `/Users/jhuang/Desktop/JH-Projects/risk3d/_claude/moodboard/`. Look at every image.

- `chosen-silver-ink-board.png`: the chosen direction.
- `units-board.png`, `units-attack.png`, `units-storyboard.png`, `units-place.png`, `units-phone.png`: the direction with units and animation beats.
  - The unit style drifts between these shots. That is an open decision.
- `john-ref-1-gold-rule.png`: John's reference. A hairline gold rule with a ring motif on navy.
- `john-ref-2-portrait-site.webp`: John's reference. Warm off-white, a soft ink-and-watercolor portrait, a Cormorant-like serif, a pastel pill toggle, delicate gold rings.
- `john-ref-3-sumie-liked-but-messy.webp`: a sumi-e board John "liked in some ways" but found "not cohesive and a bit of a mess".
- He also cited **Komorebi** as a "simplistic, beautiful app" he likes, while noting its UI isn't right for a game.

His standing taste signals from other projects:
- Chose a charming "GBA hi-bit" look for a roguelike.
- Wants atmosphere, material and craft; rejected flat, generic art.
- Called a dense UI "atrocious". Likes Apple HIG, one idea per screen, and monochrome plus one accent.
- The UI was cut down to "the board is the UI" after he called it overdone. Don't re-add clutter.

## Deliverable

An **ambitious but buildable overhaul plan**: concrete enough that builder agents could execute it in Three.js/WebGL + HTML/CSS, desktop and mobile. Cover:

1. **The feeling.** One paragraph on how an evening with this game should feel, and which zen ideas you're drawing on (e.g. ma, kanso, shibui, wabi-sabi, fukinsei, yūgen, seijaku, mono no aware, ichi-go ichi-e), translated into *game* decisions, not decoration.
2. **Taste decisions.** The 8–15 calls that define the experience beyond visuals. Examples of the kind of thing: pacing and ceremony; what the game refuses to show; how turns begin and end; how victory, defeat and elimination are treated; sound and silence; how the AI's presence feels; how friends passing the device feels.
3. **Visual system.**
   - Board rendering: ink linework, washes, paper, and how they're achieved in WebGL.
   - Units: pick one consistent style and justify it.
   - Palette, typography, iconography, the ensō motif, and what's never allowed.
4. **Motion language.** The principles, then the choreography of every key beat:
   - turn start, place, select, attack (the storyboard), dice, conquest, continent, elimination, fortify, AI turns, victory;
   - screen transitions, and idle/ambient motion.

   Give timings and easing intentions.
5. **UI/UX overhaul.**
   - Every screen: title, new game, in-game HUD, menus/sheets, rules/learning, victory.
   - Mobile.
   - How interaction feels: touch, hover, feedback.
   - How it teaches.
6. **Sound direction.** Instruments and texture, when there is silence, and how sound follows the motion.
7. **What to cut or change** from the current build, and what stays.
8. **Phasing.** 3–4 phases, each shippable. Risks, and what would make this fail: the ways "zen" becomes boring, slow or pretentious in a party game.

Be opinionated. Keep it under ~2,500 words.
