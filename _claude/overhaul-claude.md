# War Table: ink & night overhaul (Claude's plan)

## 1. The feeling: stillness, then the cut

A kendō or iaidō bout is almost all stillness, then one decisive cut, then stillness again. That's the shape of this game.

Zen here doesn't mean slow. It means **the drama lives in the contrast between stillness and the strike**. The board at rest is quiet paper: nothing moves, nothing asks for attention. When someone acts, the action is fast, sharp, and final, a brush stroke that can't be taken back. Then there's a beat while the ink settles and the room reacts.

An evening should feel like a long, warm conversation punctuated by sharp moments that make people shout. That's how the "zen = boring party game" trap is avoided: the calm is what makes the strikes land.

The zen ideas I'm drawing on, and what each becomes in the game:

- **Ma (the meaningful gap):** the pause after a strike, the breath at turn change, empty ocean. Space is timing, not only layout.
- **Kanso (simplicity):** one mark per territory, one line of instruction, one primary action.
- **Shibui (quiet beauty):** muted washes, one gold, no gloss.
- **Wabi-sabi:** imperfect brushwork, never imperfect information.
- **Mono no aware and ichi-go ichi-e:** every game is one unrepeatable encounter, and the map remembers it.

## 2. Taste decisions (beyond the visuals)

1. **Stillness is the default state.** Nothing on the board moves unless someone acted. No ambient shimmer, no idle bobbing, no pulsing targets. Motion always means "something happened", so it never has to shout.
2. **Strike and settle.** Every action has two tempos: a fast strike (80–250 ms, expo-out) and a slower settle (400–900 ms, sine) where the ink dries. Fast feels decisive; the settle gives the room time to react. Nothing bounces or overshoots.
3. **The art may be imperfect; the information may not.** Brush edges wobble, washes are uneven, each ensō is drawn slightly differently. Numbers, ownership, and what's clickable are always crisp and unambiguous. This rule settles every future readability argument.
4. **Draw your attack.** On touch and with the mouse, drag from your territory to an enemy, and the arrow is a brush stroke that follows your hand. Releasing arms the attack (board selects, buttons commit, as today). Tap-to-target still works. The core verb becomes a gesture that matches the art, and it's the single most delightful change.
5. **The map remembers.** When a territory changes hands, the previous owner's wash doesn't vanish. A faint ghost stays at the edges, like layered ink. By the late game the map is visibly lived-in and tells the story of the war, capped so it never muddies ownership (older layers fade to at most 12% opacity). This is mono no aware as a mechanic of memory, not decoration.
6. **Every game is named once.** At victory, the game gets a generated three-line title in the shape of a haiku, built from its decisive moment: *"The winter / Siberia fell twice / Cobalt waited."* It's the one poetic moment, the thing people screenshot. Everywhere else, the copy stays plain words.
7. **The pass is a small bow.** Changing players is a ceremony, not a banner. A single ensō draws itself around the next player's name, a rin bell sounds, and "Sam" sits alone in the center for a breath (0.9 s, tap to skip). Pass-and-play gets dignity, and the next player knows it's them.
8. **Silence is the soundtrack.** No music by default. Sound exists only for touch (wood, paper), the strike (taiko), the turn (bell), and the milestones (koto, shakuhachi). Silence between strikes is ma, and it makes each sound matter.
9. **Each player has a pitch.** Seats are tuned to a pentatonic scale. Your placements and conquests ring in your note, and over a game the room learns everyone's sound.
10. **The AI is a calm opponent, not a narrator.** AI turns play as quick, confident brushwork with one line of calligraphy per action ("Cobalt takes Siam"). There's no chatter, no fake personality, and no dice close-up unless a human is defending.
11. **Elimination with dignity.** No red banner. The fallen player's washes fade to bare paper grey over 1.2 s, their name is struck through with one brush stroke, and a bell sounds. People are sad, not humiliated.
12. **Victory is a scroll, not fireworks.** The map slowly drains to paper except the winner's color (4 s). Then a scroll unrolls with the game's name, three lines of what happened, and the winner's seal.
13. **Time passes as seasons.** Rounds move through spring, summer, autumn, and winter as a barely perceptible shift in paper tint, with at most one falling petal, leaf, or snowflake on screen at a time, and none at all during a strike. You feel the game's length without a round counter.
14. **Gold is sacred.** Gold marks only the one thing that matters right now: the selected territory, the brush arrow, the active step. Red never means "error"; mistakes are explained in words.

## 3. Visual system

**Board: flatten the world.** Ink is a 2D art form, and the current extruded tiles fight it.
- Move to a near-top-down 2.5D camera (pitch ~78°), with gentle parallax on pan/zoom only.
- Territories become paper with a hint of relief (a 0.02 bevel), not tiles.
- The depth lives in paper, ink, and shadow, not geometry.

**Paper:** deep indigo washi. A fiber and grain texture (tileable, generated), a low-frequency tone mottling, and a faint vignette toward the corners. The paper never moves.

**Coastlines:** brush-stroke meshes generated from the territory polygons.
- Each coast is a ribbon whose width varies along its length: noise plus a taper at stroke ends, broken into 3–8 "strokes" per coastline so it looks hand-drawn.
- Textured with a dry-brush alpha strip in silver-ivory `#e6dfcc`.
- Borders between territories are thinner (40%), softer strokes.
- All of it is generated once at load, not per frame.

**Washes:** a territory fill shader that adds:
- edge darkening (the watercolor pooling at the border);
- a bokashi fade toward the coast;
- paper grain showing through, and low-frequency noise so no two territories are the same flat color.

Ownership changes animate a bleed front moving across the territory (see §4). Ghost washes (decision 5) are a second, fading layer.

**Palette** (low saturation on indigo `#141b28`):

| Role | Color |
|---|---|
| Seat washes | coral `#c77861`, slate `#6e8fb2`, ochre `#c8a45e`, sage `#809b79` (extra seats: plum `#9a7aa0`, teal `#5f9a97`) |
| Ivory ink | `#e6dfcc` |
| Gold | `#c9a45c`, active only |

**Units: one style, ivory ink figures, everywhere.**
- Soldier (1–4), horse and rider (5–9), cannon (10+), brushed in silver-ivory ink, standing on a small wash dab in the owner's color.
- Ivory reads best on navy, matches the coastlines, and keeps the owner's color as a wash rather than paint on the figure, which is more restrained and more legible.
- Authored as transparent sprites, 3 types × 4 poses: stand, lunge, fall, arrive. Generated in one consistent image session with a shared reference, then cleaned and packed into an atlas.
- Billboarded, drawn crisp, with a tiny ink shadow.
- The expressive, splattery sumi-e style from `units-attack.png` appears only in the battle close-up (§4), so fights get a visual rise the resting board doesn't have.

**Numbers:** Cormorant Garamond lining figures, ≥ 18 px, ivory, inside a brushed ensō ring. Each territory's ring has its own rotation and stroke gap (wabi-sabi), and the number inside is perfectly crisp.

**Type:** one family, Cormorant Garamond, for display, numbers, and UI, with small caps for labels. Body text in sheets is Cormorant at a generous size and line height; no sans anywhere in the game.

**Iconography:** four brush glyphs. Place is an ink drop, Attack a single stroke, Fortify a wave line, End an ensō. The same glyphs appear on the Turn Track, in the rules, and in tutorial marginalia.

**Never allowed:**
- gradients that aren't ink;
- glossy materials, drop-shadowed cards, emoji, or neon;
- more than one gold thing at once;
- decorative scenery on the board (no Mount Fuji, no cherry blossoms, no ships);
- fake calligraphy or pseudo-characters;
- taglines.

## 4. Motion language

**Principles:**
- Stillness by default.
- Strike and settle.
- Motion comes from the brush: strokes draw, washes bleed, smoke rises, ink dries.
- Nothing bounces.
- The camera moves on its own only for the victory push.
- Every beat has a sound that lands on its contact frame.

| Beat | Choreography | Timing |
|---|---|---|
| **Turn start** | An ensō draws around the player's name (center, over paper); the rin bell; the player's territories brighten once and settle | 0.9 s, tap to skip |
| **Select** | A small brush circle draws under the territory; its name appears in serif small caps | 0.2 s strike |
| **Place** | An ink drop falls (0.12 s), blooms outward into the wash (0.45 s), the figure fades up out of the bloom (0.3 s), and the number ticks. A wood tap in the player's pitch | 0.9 s total, overlappable |
| **Attack arm** | The brush arrow follows the drag, or sweeps source → target on tap. Tapered start, dry-brush tail, gold | 0.18 s |
| **Dice** | A black lacquer tray slides up from the bottom edge (0.2 s). Bone dice are thrown in and settle (0.4 s). Winning pairs are joined by a gold hairline; losing dice crack with an ink crack | ~1.0 s per roll; blitz compresses to ≤ 2.5 s total |
| **Loss** | The defender figure recoils; a small ink splatter at the border; lost armies flick off as tiny ink dots | 0.25 s |
| **Conquest** | The defender dissolves into rising ink smoke (0.6 s). The attacker's wash bleeds in from the shared border (0.9 s bleed front). The figure steps across (0.4 s). Taiko hit at bleed start. A ghost layer of the old owner remains | ~1.3 s |
| **Continent captured** | One continuous gold stroke traces the whole continent's outline (1.2 s), then cools to ivory. A koto chord | 1.6 s |
| **Elimination** | The player's washes fade to paper grey (1.2 s); a brush strike through their name; a low bell | 1.6 s |
| **Fortify** | A thin ink line travels the path; the figure glides along it | 0.5 s + 0.12 s/hop |
| **AI turns** | The same beats at 0.6× duration; no dice close-up unless a human defends; one calligraphy line per action | median ≤ 5 s |
| **Victory** | The world drains to paper except the winner's color (4 s, one slow camera push); a scroll unrolls (1.2 s); a shakuhachi phrase | ~6 s, skippable after 1.5 s |
| **Screen transitions** | An ink wipe: a noise-masked dissolve, like wet ink spreading | 0.5 s |
| **Idle** | Nothing | — |

## 5. UI/UX overhaul

- **Title.** Black-indigo paper. An ensō draws, "War Table" fades in beneath it, and one line of text reads **Begin**. **Continue** (when a save exists) is a quiet line under it. Settings is a small ensō in the corner. Nothing else.
- **New game: a single calm column.**
  - Each seat is a name written on a strip of paper, with an ink-stone color picker and Human/AI as two words.
  - Length is three plain choices (A short game · An evening · The whole world).
  - Begin is the ensō button.
  - House rules sit behind one "More" line.
- **In-game HUD: two hairlines and nothing else.**
  - **Top:** the seats as small ink dots with their territory count; the current seat's dot wears the ensō.
  - **Bottom:** below the gold rule, the Turn Track as four brush glyphs with words; the one line; the primary action as a quiet serif word in a pill.
  - No panels, cards, or borders beyond hairlines.
- **Battle.** The dice tray appears only during fights, and the rest of the board dims to 70%. The line reads "Ural → Siberia · 82%". Stakes are one word ("takes Asia") when it matters.
- **Sheets.** Menu, cards, log and settings are paper sheets that slide up with a paper-rustle sound. The log reads like a chronicle ("Round 7 · Cobalt took Siam").
- **Learning: Apprentice mode** for the first game on a device.
  - Brush-italic marginalia appear in the ocean margin next to the relevant place: "your armies arrive here", "draw from here to attack". Each appears once, then never again.
  - The rules are one folding scroll with five panels, illustrated in the game's own style.
- **Victory.** The scroll, with:
  - the game's generated name;
  - three lines of what happened;
  - three awards as brushed seals: Nemesis, Hot/Cold dice, Biggest cash-in;
  - the territory chart drawn as ink lines;
  - Rematch as the ensō button.
- **Mobile.** Everything above scales to phones:
  - Drawing an attack with a finger is the natural gesture.
  - The bottom rule and track sit in the thumb zone.
  - Sheets are native-feeling bottom sheets.
  - Portrait keeps the front-line framing.
- **Feedback everywhere:** touch-down dims a territory within one frame, and a soft paper sound plays; a refused action shows plain words in the line, with no shake and no red.

## 6. Sound direction

Everything is synthesized in code, like today's sounds. Silence is the default.

| Moment | Sound |
|---|---|
| Place | a wood block in the player's pitch |
| Select | a soft paper tap |
| Arrow | a brush swish |
| Dice | bone dice in a lacquer tray |
| Conquest | a low taiko |
| Continent | a koto chord in the player's key |
| Turn | a rin (singing bowl) bell |
| Elimination | a lower bell |
| Victory | a short shakuhachi phrase |
| Sheets | paper rustle |

- **Optional ambient** (off by default): a sparse koto and shakuhachi bed, a few notes per minute, with long silences.
- **Tuning:** the four seats take notes from a pentatonic scale, so sounds never clash.
- **Volume rule:** sound volume follows the stakes. Routine touches are near-silent; the taiko and the bells carry.

## 7. What to cut and what stays

**Cut:**
- the 3D sculpted figures and extruded tiles;
- the walnut table, frame, and brass;
- the ivory rim highlights (brush strokes replace them);
- bloom, dust particles, and the current synthesized "war table" sound set (replaced);
- Inter;
- glass pills, which become paper and hairlines.

**Stays:**
- the rules engine, AI, and map geometry (the source for the brush meshes);
- the controller flows: Turn Track, board selects and buttons commit, the AI highlight reel, click-through;
- the mobile gestures and layouts, and the PWA;
- the e2e suite, updated for the new DOM.

## 8. Phasing

1. **Ink board.** Paper, washes, brush coastlines, ensō numbers, palette, typography, the flatter camera, and the UI reskin (hairlines, glyph track, serif). Ships as a playable, quieter game.
2. **Units and the strike.**
   - Ivory figure sprites.
   - The place bloom, brush-arrow attack (tap), dice tray, and conquest (smoke, bleed, step).
   - The turn ensō, and the new sound set.
3. **Delight.**
   - Draw-to-attack.
   - The map remembers (ghost washes).
   - The continent gold stroke, dignified elimination, and the victory scroll with the named game.
   - Seasons and player pitches.
4. **Teaching and polish.** Apprentice marginalia, the rules scroll, mobile tuning, performance on phones, and an Opus review against a new rubric.

**Risks, and how this fails:**
- **Too slow.** Hard budgets keep it snappy: a strike ≤ 250 ms, every beat skippable, AI median ≤ 5 s.
- **Muddy readability.** The ink texture competes with information. Contrast tests on every seat color; the imperfect-art/perfect-information rule is enforced in review.
- **Pretentious.** Plain copy everywhere; the one poetic moment is the victory name. No pseudo-Japanese.
- **The ghost layers clutter the board.** Capped at 12% and faded after two ownership changes.
- **Phone performance.** The ink shaders and brush meshes are built at load and cheap per frame; render-on-demand stays.
- **Inconsistent sprites.** All units come from one image session with a locked reference, and each is checked side by side before it lands.

---

## John's feedback (2026-09-28): applied in the final plan

- **Stillness becomes living calm.** Not pure stillness: slow, cloud-like motion. Linework breathes and wobbles very slightly, washes drift and fade, highlights fade in and out. Everything moves slowly and continuously; nothing darts. The strike still contrasts, because that calm is still slow.
- **"The map remembers" is cut.** Ghost washes muddy the reading of ownership.
- **The generated haiku game-name is cut.**
- He likes the overall approach, and tends to prefer Fable's taste. Weigh Fable's plan heavily in the merge.
