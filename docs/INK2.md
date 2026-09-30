# INK2: the fight, the ink dock, the pigment (v2 build spec)

**SOUL.md outranks this file on intent and feel.** docs/INK.md Part A (John's overrides) and its as-built
notes still bind except where this file changes them; ROUND2 (the Turn Track, "board clicks select, buttons
commit"), MOBILE (layouts, gestures, PWA) and SIMPLIFY (what the board refuses to show) still bind.
Where INK.md Part B and this file disagree, this file wins.

What this file changes in INK.md, by name: **A10** "the Turn Track is centred under the ensō and never
moves" → the words stay centred; the ensō now travels the rule to the current word. **B §4 Attack 1** the
arrow's brushed wedge head → a brush that lifts. **B §4 Attack 2** the lacquer tray → an ink ring on the
paper. **B5** "hairline pills" everywhere → no pills anywhere. **B2.2 "Nothing is filled"** stays.

Decided by John, 2026-09-29: the hero pieces are `_claude/v2-frames/3-the-fight-v2.png` and
`5-ui-dock.png`. Frames 1, 2 and 4 are not built (frame 1 may lend texture ideas only). The map is a
texture pass on the existing `src/map/board.json` geometry; textures come from `imagegen`, applied in the
shaders. Nothing else in v2.

---

## 1. What v2 is

SOUL's moment, round 6 on the couch: Sam drags Ural toward Siberia and a gold brush stroke follows his
finger; bone dice click into the tray; John's figure dissolves into ink smoke; Sam's colour soaks across the
border; the board settles back into its drift. v1 built that sentence. v2 makes the three things you look
at *in* that sentence read as ink rather than as software: the stroke is a brush that lifts, not a pointer;
the dice land on the paper inside an ink ring, not in a black object set on the painting; and the dock
that says Place / Attack / Fortify / End turn is words on a gold hairline, not pills. Underneath, the
washes become wet pigment (blooms, back-runs, granulation, tide lines) and the coasts swell and break like
a real dry brush. Tempo, rules, readability and the mobile layouts do not move.

---

## 2. The fight

The timeline is the one in `src/render/dice.ts` (`tray.roll` modes) and `src/render/index.ts`
(`case 'diceRolled'`, `case 'territoryConquered'`). **No beat gets longer.** Everything new below plays
inside a beat that already exists. Measured with `__risk.metrics()`: single roll ≤ 1.25 s including the
250 ms silence, 23-roll blitz ≤ 3.0 s, brief ≤ 0.8 s, forced wait 0.

### 2.1 Before the roll: the armed stroke (frame 3's stroke)

The attack arrow and the live draw-to-attack stroke share one brush profile, set in screen px at the home
view on 1440×900 (scale with `homePxPerUnit`, as today):

| Along the stroke (u) | Width | Ink |
|---|---|---|
| 0 → 0.08 (leaves the source figure) | 4 → 8 px, a round landing | loaded, solid |
| 0.08 → 0.70 | 8 → 9 → 7 px, a slow swell, ±8 % bristle wobble | solid, faint bristle streaks |
| 0.70 → 0.92 (crossing the border into the target) | 7 → 3 px | thinning, dry gaps begin |
| 0.92 → 1.0 (inside the target, short of the defender's figure) | splits into 3–5 bristle hairs of 0.6–1.2 px, each ending on its own | the brush lifts: dry |

- **No arrowhead, no wedge, no flick.** Direction reads from where the brush lifted. The stroke still
  draws tip-first over 240 ms (the existing constant; don't change it) and bows the same way it does now.
- The last 30 % of the stroke's alpha is multiplied by the **brush-tip texture** (§4, `tip`), u-mapped
  along the stroke, so the fray is real bristle hair, not noise.
- The **live stroke** (A2) is the same brush with the wet end at the finger: loaded under the pointer,
  drying toward the source. On release over a target it **settles** (160 ms, as today): the finger end
  dries into the lifted-brush hairs and the stroke becomes the armed arrow. Cancel: dries out 200 ms.
- Colour rules stay (INK A10): ivory at rest while Blitz holds the gold; gold from `Roll`/`Blitz` until the
  verdict; ivory again (240 ms) when decided. Wrap-around pairs stay two short strokes fading at the edge.
- Reduced motion: the stroke fades in whole (150 ms), same profile.

### 2.2 The roll, beat by beat (single roll at 1×, `mode: 'single'`)

| t (ms) | Existing beat | What renders now | Files |
|---|---|---|---|
| 0 | `Roll`/`Blitz` pressed; `rolling++`; arrow inks gold (120) | The **ink ring brushes itself onto the paper** clockwise from the west (220 ms; replaces the lacquer tray rising). Inside it a **deep-paper wash** (`#0b1224` at 30 %, 12 px feather) fades in with it, so the dice have ground over ocean or land. The **rest of the board recedes**: every territory not in the pair goes to `uDim` 1.3 on desktop (1.0 on phones) over 180 ms; the pair stays at 0; count rings never drop below 60 % opacity. Ambient yields (existing). | dice.ts, index.ts, shared/tray.ts |
| 0–120 | shake (wood) | unchanged | |
| 120–500 | tumble (380), bone clicks on landing | Dice land **on the paper** inside the ring, matte, seat-wash faces with ivory pips (as today). Contact shadow stays; it is the only thing that says they are objects. | dice.ts |
| 500–600 | settle (100) | unchanged | |
| 600–850 | **silence** (250) | Nothing moves. Ring, stroke, dice, figures all still. Score ducks (existing). | |
| 850–1110 | verdict (260): ivory hairlines join pairs from the winner; losers dim 50 % under a splash; `applyLosses` re-inks −N | **The losing figure puffs**: each side that lost a die gets `smoke` 0 → 0.3 → 0 over the verdict's 260 ms (ink lifts a little off the figure and settles). A defender at 0 starts the **full dissolve** on the verdict frame (existing 320 ms `fall`; it runs into the conquest beat, as today). | tokens.ts, index.ts |
| 1110 | done; `rolling--` | ≤ 1250 ✓ (unchanged: 120+380+100+250+260) | |
| decided +~1 s | tray lingers (`TRAY_DECIDED_MS`) then fades 300 | Ring and inside wash **dry out** (300 ms, alpha only); dice fade with them; the board's washes come back (300 ms). Stroke dries to ivory (240) or hides if the target still stands and the arrow was event-sourced (existing). | dice.ts, index.ts |

- **`repeat`** (another single roll on the same pair within 3 s): ring already up, no shake, same beats.
- **Blitz** (`first` 660 / `middle` durMs / `final` 850): the ring stays up across rolls; the board stays
  receded; puffs play only when `applyLosses` re-inks (`mode !== 'middle' || count <= 6`, existing);
  the final roll keeps the silence. 23 rolls ≤ 3.0 s is unchanged because nothing here is on the critical
  path of a middle roll.
- **Brief** (AI vs AI): no ring, no dice, no recession, as today; the stroke uses the new profile at
  150 ms; the defender's dissolve at 0 stays.
- **Reduced motion**: ring fades in 150 ms, no puffs, dissolve → fade, recession → instant.
- **Sound**: the five materials stay (paper, brush, wood, bone, bowl). Wood is the cup, bone is the
  landing on the paper; no new cue. Nothing inside the silence.

### 2.3 The ink ring (the tray, `src/render/dice.ts`, `src/shared/tray.ts`)

- **Geometry**: `inkTrayGeometry` stays the bounding box (~420×90 px at 1440×900; ≤ 44 % width on a
  landscape phone, ≤ 72 % portrait). `inkTrayTop` stays the anchor rule (portrait drops to open ocean).
  The ring is an ellipse inscribed in that box with 6 % overshoot on the long axis.
- **The mark**: one closed brush ellipse, drawn with the `sweep` brush from `src/shared/enso.ts` (add an
  exported `brushRing(seed, aspect, opts)` there; additive) into a 512×256 canvas texture once per size
  (cache by size, like the count rings). Weight 1.4–3 px at home on desktop, breathing along the loop, one
  dry patch where the brush ran thin. **No gap**: the gap is the ensō's, and the ensō is the signature.
  Colour `#e2ddcf` (`--coast`) at 38 % alpha: silver on indigo.
- **Inside**: a feathered deep-paper wash, `#0b1224` at 30 %, radial 12 px feather. No floor mesh, no rim
  mesh, no extrusion, no lacquer, no `RoomEnvironment` reflections on the tray. Delete `lacquerTexture` and
  the walnut plumbing from `textures.ts`/`scene.ts` if nothing else reads them.
- **Reveal**: a small shader on the ring quad, `uProgress` 0 → 1 clockwise from the west over 220 ms
  (brush easing); the wash fades in alongside. Hide: alpha → 0 over 300 ms (`hide(ms)` as today).
- **Header** `Kamchatka 6 · Alaska 4` (`src/ui/hud/battle.ts`) keeps resting on the tray top, which is now
  the ring's top; the `.bt-head::before` halo stays.
- **Dice**: unchanged materials. They cast a contact shadow onto the ring's wash; there is no depth to
  fall into, so the tumble's final z is the paper plane.

Acceptance (2.1–2.3):
- `__risk.metrics()` after a real turn: max single roll ≤ 1250 ms, max blitz ≤ 3000 ms, brief ≤ 800 ms,
  `forcedWaitMs` 0 (the existing `ink`, `game`, `budgets` flows assert these; they must stay green).
- A phone-landscape screenshot mid-roll: every count ring on the board still reads (opacity ≥ 0.6, number
  legible); the pair's tiles are at `dim` 0; the ring lies over ocean or the tray band, never over a
  count ring.
- Screenshot of the armed stroke at 1440×900: no arrowhead; the last third of the stroke shows separate
  bristle hairs; width mid-stroke 8–9 px.
- The `ink` flow's one-gold sampler still passes (the ring is ivory, never gold).

---

## 3. UI as ink

**Rule:** no rounded rectangle and no pill anywhere in the game, on any screen, at any size. Controls are
words, hairlines and brush marks on the paper. Visible ink sits inside an **invisible hit box ≥ 44×44 CSS
px** (≥ 8 px between neighbouring boxes) on every form factor; the box is the button element itself, made
transparent, or its `::after`. Circles drawn as brush rings (the ensō, seat rings, swatches, the slider
knob) are ink, not boxes, and are allowed. Straight-edged rectangles are allowed only for things that *are*
rectangles in the world: a paper sheet, a card.

The grammar has four marks, all already in the codebase or one helper away:
- **the hairline** (`1px` ivory 20–28 %, or the gold rule) — structure;
- **the word** (Cormorant, ivory 78 % quiet / ivory current / gold for the one gold) — the control;
- **the brush underline** (`brushMark` from `src/shared/enso.ts` along a slightly bowed line, 1.1× the
  word's width, 3–4 px varying) — "this one";
- **the brush ring** (`brushRing`, new in enso.ts: a closed brush ellipse round a word, aspect up to 3:1,
  one dry patch, no gap) — "press this".

Add to `src/ui/dom.ts`: `underlineEl(seed, color)` and `ringEl(seed, aspect, color)` returning inline
SVGs filled with `currentColor`. Seeds are stable per element (hash of testid or label) so a control's
brushwork never changes under the pointer.

### 3.1 The dock (frame 5) — `src/ui/hud/strip.ts`, `styles.css`, `mobile.css`

The dock **is** the Turn Track, restyled. Same segments, same intents, same `TrackVM` states, same
`GoldVM` precedence, same testids (`track`, `seg-*`, `action-zone`, `strip`, `btn-*`).

| Element | Today | v2 |
|---|---|---|
| The one line `.st-line` | serif line on the paper above the rule | unchanged |
| The gold rule `.st-rule` | hairline across the width, ensō fixed at the centre, glint every ~14 s | hairline across the width, **the ensō sits on the rule above the current segment's word** and slides there on advance (180 ms, brush easing; a cut, not a slide, when the turn changes hands, using the existing `turnKey` logic). Turn start: the rule redraws outward from wherever the ensō is (`.sr-l`/`.sr-r` grow from its x, not from 50 %). Glint unchanged. The ensō stays the signature and does not count as a gold thing. |
| Track pill `.track` (999 px border), separators `.tr-sep`, marker `.tr-fill` | outlined pill; hairline marker slides | **No border, no separators, no `.tr-fill`.** Four words centred as a group under the rule's centre (the group never moves; ROUND2 §A). Word states: done ivory 40 % · current ivory 100 % 600 · eligible ivory 78 % · locked ivory 28 %. **Current word gets a brush underline**: gold when the track holds the one gold (`GoldVM.kind === 'segment'`), ivory 70 % otherwise (a commit button is pending, a sheet is open, an AI is playing). A recommended-next segment carrying the gold: gold word + gold underline (the current word's underline is then ivory). Underline draws in left → right 180 ms; the old one dries out 140 ms. Hover on eligible: word → ivory, a 1 px hairline underline appears (not the brush). |
| Hit areas | words with `::after` slop 4 px on touch | each `.tr-seg` is a transparent button ≥ 44 px tall on every form factor (desktop `--pill-h` 46 px already), `min-width` 88 px desktop / the word + 24 px on phones, ≥ 8 px apart. `data-slop` stays. |
| Action buttons `.btn` (hairline pills; gold outline + gold text for the one gold) | | **Words.** The primary (`role-primary`) gets a **brush ring** behind it: gold when it holds the one gold, ivory 55 % otherwise; the secondary is a bare word at ivory 78 %. Press: word dims 20 % (existing), no scale. `is-busy`: the ring redraws itself once (stroke-dash on its spine) instead of the underline sweep. The element keeps class `btn` and its `data-id`; box ≥ 44 px tall, ≥ 88 px wide, transparent, no border, no radius. |
| Stepper `.stepper-ctl` | pill with − N + | `−  3  +` as words, no border. − and + are 44 px transparent hit boxes; the number ivory 600. |
| Slider `.count-slider` | hairline with a bordered circle knob | hairline stays; the knob becomes a small brush ring (`ringEl`, aspect 1) in ivory; the fill stays ivory 78 %. |
| Seat mark (new) | — (desktop's left third of the '. track zone' row is empty) | **Desktop only**: at the far left of the track row, a brush dab in the current seat's `base` colour (`brushMark`, seeded per seat, ~2.2rem × 1rem) and the seat's name in ivory 78 %, serif 500. That is all: no number (see §6 Q3). During an AI turn it is the AI's dab and name. Grid areas become `'say say say' 'rule rule rule' 'seat track zone'`. Phones: not shown (the top ring already names the current seat). |
| Battle header `.battle` | words on the paper on the tray top | unchanged, resting on the ring (§2.3) |
| Banner / announce | serif line brushes in and dries | unchanged |

Phone layouts (MOBILE §4 stays):
- **Landscape** (`.form-phone.landscape .strip`, `'rule rule rule' 'track say zone'`): the four words at
  left with the ensō above the current one; the line in the middle; the primary's ring word at right.
  Words 17 px, underline 2.5–3 px. Everything in one row ≤ 64 px plus the safe area.
- **Portrait** (`.dock-stacked .strip`, `'say' 'rule' 'track' 'zone'`): four equal-width words, the ensō
  above the current one, the action row below with the primary's ring word taking the remaining width
  (the ring stretches to aspect ≤ 3:1; beyond that the ring stays 3:1 centred on the word).
- The `.hud::after` bottom gradient stays: it is the paper deepening toward the dock, not a panel.

### 3.2 Top strip — `src/ui/hud/topstrip.ts`

| Element | Today | v2 |
|---|---|---|
| Seat rings `.sc-ring` + name + count | brushed ensō rings, hairline underline on the current name | unchanged |
| `Reset view` `.pill.ts-reset` | hairline pill | the words `Reset view` with a 1 px hairline underline, ivory 78 %; hit box 44 px |
| Menu `.ts-menu` | the ensō | unchanged |

### 3.3 Sheets, dialogs, covers — `src/ui/overlays.ts`, `sheet.ts`, `hud/cards.ts`, `styles.css`, `mobile.css`

The **paper sheet**: a straight-edged rectangle of deeper paper (`--paper-96`) with **one hairline rule
(ivory 20 %) across its top edge**; the title sits on that rule the way the phase words sit on the gold
rule. No border on the sides or bottom, `border-radius: 0` everywhere (`.panel`, `.sheet`, `.ng-sheet`,
`.pause-sheet`, `.cards-sheet`, `.log-sheet`, `.swatch-pop`, `.confirm-box`, `.ho-box`, `.sw-sheet`, and
every `1.25rem 1.25rem 0 0` in mobile.css). Scrims unchanged (the board dims and softens). Phone bottom
sheets rise as today; the grab handle is already a hairline.

| Element | Today | v2 |
|---|---|---|
| Menu (Resume · Rules · Settings · Log · Save & quit · End game now · Restart) | words on a sheet | words on the paper sheet; focus = gold hairline underline (existing) |
| Settings `Switch` `.switch-track` (pill toggle) | pill with a round knob | a short hairline (2.4rem) with a small brush ring knob that slides; on = knob ivory 100 % and the hairline brightens to ivory 55 %; off = knob ivory 40 % |
| Settings `Slider` | hairline with a bordered knob | knob → brush ring (as the count slider) |
| Confirm (`End game now` / `Restart`) | sheet, two pills | paper sheet; two words; the safe one (`Keep playing`) carries the gold ring, the destructive one is a bare word |
| Cards sheet `.card` (0.5rem radius, hairline border) | | a card is a card: straight-edged, hairline border stays (ivory 28 %; in-set ivory 78 %), radius 0. `Trade for +8` → gold ring word (`GoldVM 'cardsTrade'`). |
| Log sheet | lines | unchanged |
| Rules sheet illustration `.ra-track`, `.ra-track span.on`, `.ra-card` | pills that depict the old track | redraw: four words, a tiny gold rule with the ensō over `Attack`, a brush underline; the card as a straight-edged hairline rectangle |
| Hand-off cover `.handoff` / `.ho-box` | deep cover, ensō in the seat colour draws itself, `Pass to Sam`, subline, big gold pill button | same cover; the button becomes the words `I'm Sam · start turn` inside a **gold brush ring** (the cover's own gold, `GoldVM 'handoff'`). Phones: `.ho-box` is a paper sheet (top hairline, radius 0); drag-down still accepts. |
| Name card `.name-card` (0.75rem box, border) | | serif lines on the paper above the finger with a soft radial deepening behind them (as `.bt-head::before`), no border, no radius |
| `Reloading the board…` `.board-lost` (pill) | | one serif line on the paper, breathing as today |
| Rotate hint | already a line | unchanged |

### 3.4 Screens — `src/ui/screens/title.ts`, `newgame.ts`, `victory.ts`

| Screen | Today | v2 |
|---|---|---|
| **Title** | lockup + rule + ensō; `.title-item` pills (gold border on the primary; Continue a taller pill with a sub-line) | lockup unchanged. Items are words: the primary (`Continue` when a save exists, else `New game`) inside a gold brush ring; Continue's save summary sits under the word inside the same ring (aspect grows to fit, ≤ 3:1); `New game`/`How to play` bare words ivory 90 %; `Settings` quiet ivory 55 %. Arrival choreography unchanged. Portrait phone: full-width ring words in the thumb zone. |
| **New game** (`.ng-sheet`, seat rows, `Segmented`, `Switch`, `swatch-pop`) | sheet with radius; seat emblem rings; name inputs underline-only; segmented words with underline; house-rule switches; `Start` gold pill | paper sheet (top hairline). Seat rows unchanged except the swatch popover: no radius/border, six brush-ring swatches on a patch of deeper paper with a top hairline. `Segmented` stays words + underline; the active option's underline becomes the brush underline (ivory 70 %), the gold stays on `Start`: a gold ring word. Switches as §3.3. Fix F8 while here: focus the name field without `select()`. |
| **Victory** | scroll: ensō, title, subline, awards, ink timeline, standings, stats table, `Rematch` gold pill | same scroll on the paper sheet grammar; `Rematch` gold ring word, `New setup` / `Title` bare words. Fit the stats table to the sheet (F9). |

### 3.5 What the one-gold check must now see

`tests/e2e/ink.e2e.ts`'s sampler counts gold by CSS `color`, `border`, `box-shadow`, `fill`. The brush
ring and underline are inline SVGs filled with `currentColor`: the sampler must read the SVG's computed
`fill`/`color` (it does for `fill`; confirm the ring's `<path>` resolves to the gold rgb). The gold rule
and the ensō are excluded as today, wherever the ensō sits on the rule.

Acceptance (§3):
- New logic-lane check **`ink2`** (see §5, Phase D): across title, new game, game (Place picked / Attack
  armed / Occupy), the menu, Settings, Cards, the hand-off cover and Victory, on desktop and both phone
  orientations, **zero visible rounded rectangles**: no element with `border-radius > 0` that also has a
  non-transparent background or a border width > 0 (brush-ring SVGs and `.sc-ring` are SVG and pass;
  `.swatch` etc. must have transparent backgrounds and no CSS border).
- Every `button` and `[role=button]` in the HUD, dock and sheets has a bounding box ≥ 44×44 on
  `iphone` and `iphone-land` (extend the existing target-size check in `mobile-turn`; do not write a
  second one).
- Existing suites green after selector updates (`.tr-fill` is gone: `track`/`polish`/`keys` flows that read
  the marker read the ensō's `translateX` or the `.is-current` word instead).
- Words on screen in a typical armed Attack state ≤ 25 (existing `feel` check) — the seat mark adds one
  word on desktop; it fits.

---

## 4. Texture pass

Today the paper and the washes are procedural: a 256² 4-channel tileable value-noise texture (`ink.noise`,
`nz()` in `src/render/inkGlsl.ts`) feeds `paperAt` (fibre, mottle, grain) and `TILE_FRAG` (pools `b1/b2`,
bloom `bm`, tide, granulation `gr/gr2`, edge darkening). The coasts are drawn once at boot into a 4096
canvas by `dryBrush()` in `src/render/ink.ts`, with bristle on/off and width from 1-D value noise. The pass
keeps every one of those code paths and **swaps the noise for real pigment**, tap for tap, at the same
coefficients. The amplitude stays the guard on contrast; the maps only change the character.

### 4.1 The maps (one `imagegen` render each; channels derived in the pack script)

All prompts end with the same tail: `Flat, evenly lit, no shadows, no vignette, no border, no text, no
objects, fills the frame edge to edge, seamless tileable, high detail, greyscale.` Generate 3 candidates
each (`--n 3`) into `_claude/tex-src/<name>/`, look at them with the Read tool, pick one, record its sha in
the manifest. Command shape:

```
node ~/Desktop/JH-Projects/imagegen/bin/imagegen.mjs generate -p "<brief>" --aspect 1:1 --n 3 \
  --out-dir /Users/jhuang/Desktop/JH-Projects/risk3d/_claude/tex-src/<name> < /dev/null
```

| Map | Brief (before the tail) | Shipped as | Channels the script derives |
|---|---|---|---|
| `paper` | "Macro texture of handmade washi paper: long fine fibres running mostly left-to-right (about 6:1 anisotropy), a few crossing fibres, soft mottling, a scattering of tiny flecks. Very subtle, low contrast." | 1024² (desktop) · 512² (phone), 4-ch WebP q85 | R = raw (long fibres) · G = 24 px blur (mottle) · B = high-pass 2 px (grain) · A = flecks (top 1 % threshold, dilated 1 px) |
| `wash` | "Macro of a watercolour wash drying on cold-press paper: pigment pooled unevenly, cauliflower back-run blooms with pale centres and a darker tide line round each, granulation settling into the paper tooth. Mid grey overall." | 1024² · 512², 4-ch WebP q85 | R = raw (pigment density) · G = bloom mask (16 px blur, then `smoothstep(0.56, 0.66)`) · B = tide lines (Sobel edge of the 16 px blur, thinned) · A = granulation (high-pass 3 px) |
| `streaks` | "A single very long straight horizontal dry-brush stroke of black ink on white paper, viewed close: bristle streaks with gaps where hairs lifted, the stroke thickening and thinning slowly along its length, some hairs breaking off and rejoining." `--aspect 16:9`, then the script crops to the stroke's band | 2048×256 (desktop) · 1024×128 (phone), 2-ch (RG) WebP | R = raw (bristle on/off along x, one row per bristle) · G = 64 px horizontal blur (slow swell) |
| `tip` | "The very end of a single dry brush stroke of black ink on white paper where the brush lifted off: the stroke thins and splits into a few separate bristle hairs that fade out, each ending on its own. Stroke enters from the left, ends toward the right." `--aspect 1:1` | 512×512, 1-ch alpha PNG (transparent), stroke axis left → right | A = raw, black = ink |
| `smoke` | "Black ink dropped into still water, photographed against white: soft rising wisps and curls, thinning at the top, fine tendrils." | 512², 1-ch WebP, tileable | R = raw |

The pack script **`scripts/textures.ts`** (Playwright Chromium as the image tool, like `scripts/units.ts`;
nothing to install): load the chosen candidate → greyscale → **make seamless** (offset by half and
cross-blend a 12 % margin with a smooth window; for `streaks` along x only; `tip` is not tiled) → derive
the channels above → **equalise** each channel to mean 128, standard deviation 40 (so the shader's
existing coefficients mean the same thing they did with `nz()`) → write `public/tex/<name>-1024.webp` and
`<name>-512.webp` (`tip.png`, `smoke-512.webp`) → write `src/render/texmaps.json` (per map: files, per-channel
mean/std after equalisation, source sha). Payload budget: **desktop set ≤ 600 KB, phone set ≤ 250 KB,
everything under `public/tex` ≤ 850 KB** (the service worker precaches it).

### 4.2 Applying them in-engine

New module **`src/render/texmaps.ts`**: `loadTexMaps(renderer, { small }): Promise<TexMaps | null>` loads
the size set for the device (`phoneGpu` → 512), sets `RepeatWrapping`, mipmaps, anisotropy 4 desktop / 1
phone, sRGB off (data), and resolves `null` on any failure. `buildInk()` (ink.ts) awaits it in parallel
with its canvas work and returns it on `InkLayer` as `maps?: TexMaps` (additive), so tiles.ts and scene.ts
read it from the layer they already receive. Shared uniforms (inkGlsl.ts) gain `uPaperTex`, `uWashTex`,
`uTexOn` (0 = procedural, 1 = maps; the fallback ladder animates it) and `uTexTaps` (1 or 2).

| Where | Today | v2 |
|---|---|---|
| `paperAt()` fibre `f1`, `f2` | `nz(bp/5.5).b`, rotated `nz(bp/7.5).b` | `uPaperTex` R at 14 board units per repeat (7 repeats across the 100-unit board), plus a second tap at 1.37× scale rotated 90° for `f2`; mottle from G at 37 units; grain from B at 1.9 units; flecks A add `uFibre` at 0.25 where set. Same coefficients (0.3 / 0.14 / 0.05). |
| `TILE_FRAG` pools `b1`, `b2` | two `nz` taps | `uWashTex` R at 22 units, offset by `uSeed` per territory (already a uniform) so neighbours never share blooms; second tap at 1.37× rotated (`uTexTaps` 2) averaged in. Same `0.085 / 0.05`. |
| bloom `bm` → `bloom`, `tide` | `nz` + smoothsteps | G (bloom mask) and B (tide lines) from the same taps. Same `+0.05 / −0.07`. |
| granulation `gr`, `gr2` | `nz` taps | A at 4.5 units and at 1.9 units. Same `0.93 + 0.1·… + 0.04·…`. |
| edge darkening `edge` | `smoothstep(0.45, 1.0, prox)` | the band's inner edge wanders with the tide channel: `smoothstep(0.45 − 0.12·(B − 0.5), 1.0, prox)`, so the dried edge pools unevenly. Coefficients unchanged (`0.26`, `0.1`). |
| wash breath, flood, torn rim, `uDry`, `uDim` | | unchanged |
| `coastSoft` (wet feather) | blurred mip of the coast | unchanged |
| `dryBrush()` in ink.ts: bristle `on[i]` and width `w` | `n1()` value noise along S | optional `streak?: (sPx: number, k: number) => { on: number; swell: number }` on `BrushOpts`; ink.ts builds it from `streaks` (row = `hash(k, seed) % 256`, x = `S / (rowH·48)` wrapped): `on` = R > threshold (the existing `dry` scales the threshold), width `w *= 0.7 + 0.6·swell` (G). Without the map (load failed) the noise path runs as today. **This is where coastlines get line-weight swell and dry-brush breaks.** |
| the wave strokes (`ink.waves`) | `dryBrush` | the same sampler, so the open-sea strokes match the coasts |
| `AttackArrow` / `LiveStroke` frag (fx.ts) | `uNoise` bristle | last 30 % × `tip` alpha (§2.1); body bristle unchanged |
| figure smoke (tokens.ts) | `uNoise` | `smoke` map for `rise`/curl; same amplitudes |
| mist (`mistAt`) | `nz` | unchanged (it is already right at scale) |

**Contrast guard.** The total texture modulation on a wash stays where it is today: ≤ ±9 % lightness
(the sum of the coefficients above). Because each channel is equalised to mean 128, a territory's *mean*
colour is the palette hex, so the colour-blind result in `src/shared/palette.ts` (worst default-four pair
ΔE 9.84) is untouched. Do not raise a coefficient to make a texture "read more"; pick a better render.

**Boot.** Textures load after the first painted frame; until they arrive `uTexOn` is 0 (today's look),
then it eases 0 → 1 over 400 ms ("the paper dries in"). `Start → first click` does not move.

### 4.3 Performance budget and the fallback ladder

| Measure | Desktop 1440×900 @ DPR 2 | Phone (iPhone 13 class) landscape |
|---|---|---|
| Fragment taps added per wash pixel | ≤ 5 at L3 (paper 2 + wash 2 + grain 1) | ≤ 3 at L2 |
| Idle (ambient only) | drawn fps cap 30 (existing); GPU ≤ 6 ms/frame | cap 24 (existing); GPU ≤ 10 ms |
| During a 7-roll blitz (`tests/e2e/perf.ts`) | p95 frame ≤ 16.7 ms | p95 ≤ 33 ms, never a sustained stretch < 30 fps (MOBILE §7) |
| First roll after a cold load (`feel` flow) | worst frame ≤ 50 ms (existing gate) | same |
| Texture VRAM | ≤ 16 MB | ≤ 4 MB |
| Boot cost | 0 ms before first paint (async) | same |

Ladder (in `src/render/index.ts`'s adaptive-DPR block, one call: `ink.setQuality(level)`; never steps back
up within a session):
- **L3** desktop default: 1024 maps, 2 wash taps, anisotropy 4.
- **L2** `phoneGpu` default: 512 maps, 2 taps, anisotropy 1.
- **L1** frame budget missed for 2 s (the existing DPR 1.5 trigger): 1 wash tap, paper fibre tap only
  (mottle and grain from `nz()` as today).
- **L0** missed for a further 4 s, or the maps failed to load, or a second context loss: `uTexOn → 0` over
  300 ms; today's procedural board. Never a flat or blank wash.

Acceptance (§4):
- `public/tex` within the payload budget; `npm run build` passes; the PWA flow (`pwa`) still boots offline.
- Screenshot sweep at 1440×900 and 1920×1080: washes show blooms with darker tide rims and granulation;
  coasts show weight swell and breaks; no visible tiling (look at the Pacific and Africa, the two biggest
  uniform areas; if a repeat is visible, change the 1.37× second-tap scale or the per-territory offset,
  not the coefficients).
- Owner and count read from 3 m in the 1280×800 shot (INK gate); the wash coefficients in `TILE_FRAG`
  are unchanged from today's values (diff the shader).
- `perf.ts` numbers at DPR 2 reported in the phase report, against the table above.

---

## 5. Build phases

Sized for parallel Opus agents. Each brief pastes SOUL's Intent, the moment and the five pillars (SOUL
"Before you plan" #6), names the owned files, and forbids the rest (CLAUDE.md: "Requests" in the report
for anything else). **Start Phases A–C only after the phone-landscape agent currently in `src/` has landed;
the lead names the free files then.** No agent runs `npm install`, commits, or runs two e2e suites at once.
Dev servers: A on 5371, B on 5372, C on 5373, D on 5374.

### Phase 0 · Pigment (one agent, first; ~1 h)
- **Owns**: `scripts/textures.ts`, `public/tex/`, `src/render/texmaps.json`, `_claude/tex-src/`.
- Runs the five briefs (§4.1), looks at every candidate, picks, packs, writes the manifest.
- **Accept**: the five shipped files exist at both sizes within budget; each is seamless (the script's own
  wrap check: max luminance step across the seam ≤ 2/255 after blend); per-channel mean 128 ± 2, std 40 ± 4.
- **Screenshots**: a 2×2 tiled contact sheet per map at 512 px per tile (`artifacts/ink2/tex/`), looked at.

### Phase A · The fight (render)
- **Owns**: `src/render/fx.ts`, `src/render/dice.ts`, `src/render/tokens.ts`, `src/shared/tray.ts`,
  `src/shared/enso.ts` (additive: `brushRing`), `src/render/textures.ts` (remove lacquer/walnut, add the
  ring canvas), `src/render/index.ts` (the fight recession in `case 'diceRolled'`, the ring wiring; nothing
  else in that file), `src/ui/hud/battle.ts` (if the header needs a nudge).
- Builds §2 end to end. Uses `public/tex/tip.png` and `smoke-512.webp` from Phase 0 via a local loader
  until Phase C's `texmaps.ts` lands (then switches; a 3-line change).
- **Accept**: §2 acceptance list; `npm run test:e2e ink game budgets feel` green; screenshots below looked at.
- **Screenshots** (`artifacts/ink2/fight/`, 1440×900 and `iphone-land`): armed stroke at rest (ivory);
  mid-draw live stroke; ring brushing in at ~120 ms; dice at the silence; the verdict frame with a puff;
  the defender's full dissolve at ~+200 ms; the decided ring drying out; a 23-roll blitz at 1.5 s.

### Phase B · UI as ink (ui)
- **Owns**: `src/ui/styles.css`, `src/ui/mobile.css`, `src/ui/dom.ts` (additive helpers),
  `src/ui/controls.ts`, `src/ui/hud/strip.ts`, `src/ui/hud/topstrip.ts`, `src/ui/hud/mobile.ts`,
  `src/ui/hud/cards.ts`, `src/ui/overlays.ts`, `src/ui/sheet.ts`, `src/ui/screens/*.ts`,
  `src/ui/gallery/*` (update fixtures if they break). Not `src/shared/enso.ts` (Phase A adds `brushRing`;
  B calls it — if B is ready first, B adds it and A rebases; the lead decides at kickoff).
- Builds §3 end to end. Keeps every testid and `data-id`; keeps `btn`, `tr-seg`, `is-current`, `gold`,
  `role-primary` classes so the sampler and flows keep working.
- **Accept**: §3 acceptance list; `npm run test:e2e:quick` green plus `ink track mobile-turn mobile-sheets
  handoff endgame` green (selector updates are in scope for B: `.tr-fill` readers → the ensō/`.is-current`).
- **Screenshots** (`artifacts/ink2/ui/`, 1440×900, `iphone`, `iphone-land`): title; new game with the swatch
  popover open; game in Place (picked, stepper up); Attack armed (Blitz gold ring, Attack underline ivory);
  Attack with nothing armed (Attack underline gold); Occupy slider; menu; Settings; Cards sheet; confirm;
  hand-off cover; victory. A 200 ms-cadence capture of one Turn Track advance (the ensō sliding, the
  underline redrawing).

### Phase C · The texture pass (render shaders)
- **Owns**: `src/render/inkGlsl.ts`, `src/render/ink.ts`, `src/render/tiles.ts`, `src/render/scene.ts`,
  `src/render/texmaps.ts` (new). Not `index.ts`: the ladder hook is one `ink.setQuality(level)` call the
  lead wires (put the exact line under "Requests").
- Builds §4.2 with the `uTexOn` cross-fade and the ladder as methods on the ink layer; verifies with a
  temporary `?tex=0|1|2|3` query hook in its own dev server (removed before handoff, or kept behind
  `VITE_E2E` if useful to D).
- **Accept**: §4 acceptance list; `npm run test:e2e feel pwa` green; `perf.ts` at 1440×900 DPR 2 reported.
- **Screenshots** (`artifacts/ink2/tex/`): 1440×900 idle at L3 and at L0 side by side; Africa and the
  Pacific at 2× zoom; a coast close-up (Scandinavia) showing swell and breaks; `iphone-land` at L2; the
  1280×800 legibility shot.

### Phase D · Integration and the checks (lead, or one agent after A–C)
- **Owns**: `src/render/index.ts` (the ladder hook, Phase C's request, the final `tip`/`smoke` switch),
  `tests/e2e/lanes.ts`, new `tests/e2e/ink2.e2e.ts`, edits to `tests/e2e/ink.e2e.ts` (sampler),
  `tests/e2e/mobile-turn.e2e.ts` (44 px check covers the new controls), `tests/e2e/screens.ts` (add the
  fight and dock states), `docs/INK.md` (a two-line "superseded by INK2 §…" note at A10/B5).
- **New checks (all of them):**
  - `ink2` — `lane: 'logic', realtime: true` (it samples one real roll): (a) zero visible rounded
    rectangles across the screens in §3 acceptance; (b) mid-roll on `iphone-land`, every count ring's
    opacity ≥ 0.6 and the pair's `dim` is 0; (c) the ensō's x on the rule equals the current word's centre
    x ± 2 px after an advance.
  - The existing `ink` flow's tempo and one-gold checks, unchanged in intent, updated to see SVG fills.
  - The existing `mobile-turn` target-size check, extended to every `button` in the dock and sheets.
  - Nothing else. Frame-time and ΔE are looked at in the sweep and the perf probe, not gated.
- **Accept**: `npm run test:e2e` all green; `npm test`, `npm run typecheck`, `npm run build` pass; the
  full screenshot sweep (desktop 1440×900 + 1920×1080, `iphone`, `iphone-land`) looked at shot by shot;
  §7's checklist re-run against the build and pasted into the report.

---

## 6. Risks and open questions for John

Risks the phases carry, with the guard:
- **Tiling shows** on the big uniform areas → two taps at 1.37× rotated plus the per-territory offset;
  fixed by changing scale/offset, never coefficients.
- **Texture eats contrast** → equalised channels and unchanged coefficients; the ΔE result in palette.ts
  stands by construction. If a sweep shot looks muddier, the render is wrong, not the palette.
- **The ring reads as another ensō** → no gap, one dry patch, ivory not gold; if it still reads as a
  signature in the sweep, thin it to 1–2 px.
- **Phones can't read the board during a fight** → recession 1.0 on phones (the armed dim only), rings
  ≥ 60 %; the `ink2` check (b) gates it.
- **Selector churn breaks flows** → testids and the core classes are frozen (Phase B); `.tr-fill` is the
  only removed hook.
- **imagegen renders aren't tileable or greyscale** → the pack script normalises everything; expect to
  discard 1–2 candidates per map.
- **INK review F1** (the living calm is below perception) is *not* v2 work; it stays an INK.md polish item
  for the lead. Textured washes will make the wash breath more visible for free, but don't count on it.

**Answered by John, 2026-09-29** (these bind; the list below is kept for the reasoning):
1. The ensō slides along the rule to the current word. 2. One gold, and it moves (Blitz's ring while a
commit is pending, the underline otherwise). 3 + 4. The seat mark stays as brush dab + name, no number.
5. Phone-landscape behaviours from the 2026-09-29 fix (commit `45a6402`):
   - **Keep**: the AI camera stays at home on landscape phones unless a piece is actually hidden.
   - **Revert**: the dice tray no longer moves between fights (`placeTrayFor` / `--tray-shift`). It has one
     fixed spot per layout; the ink ring's translucent inside wash (§2.3) is what keeps figures under it
     readable. Phase A owns this.
   - **Revert**: territory names no longer hide when crowded. A name still never covers an army count;
     when no nearby spot is clear, it steps down in size (to 80 %) and searches farther out before
     giving up, and gives up only if even that fails. Phase A owns this (`src/render/overlay.ts`).

Questions that needed John (each had a default; now answered above):
1. **The ensō as the phase marker.** Default: the ensō slides along the gold rule to sit over the current
   word (frame 5's ring at the current phase). Alternative: the ensō stays fixed at the centre and a second,
   smaller gold ring marks the phase. I think two gold circles on one hairline is one too many.
2. **One gold in frame 5.** The frame shows gold on both the Attack underline and the Blitz ring. Default:
   one gold, per INK A10 — Blitz's ring while a commit is pending, the underline otherwise. Say if the frame's
   two golds are what you want and I'll relax the rule for the dock only.
3. **"Vermilion · 12 armies".** Default: the dock's seat mark is the brush dab and the name only. The
   number is already in the line and on the `Place 9` button, and SIMPLIFY bans army totals. Say if you want
   a number there and which one (armies to place, or the seat's territory count).
4. **The seat mark at all.** Default: desktop only, since the top strip already names the current seat.
   Say "drop it" if it reads as duplicate on the sweep.

---

## 7. SOUL checklist (run against this plan)

1. **Against the moment and pillars.** Moment: SERVES — §2.1 makes "a gold brush stroke follows his
   finger" a brush; §2.2–2.3 make "bone dice click into the tray" land on the paper; the dissolve and soak
   are kept. Pillar 1 (the calm is the experience): IGNORES — v2 adds nothing to the idle board's motion
   (F1 stays open, §6). Pillar 2 (readable, not decorated): SERVES — §3's rule removes chrome, §4's guard
   pins contrast, §2.2 keeps count rings ≥ 60 % mid-fight. Pillar 3 (linework as structure): SERVES — the
   dock's marks are the board's own brush (`brushMark`/`sweep`), the ring is drawn not modelled, textures are
   the material of paper and pigment, never a motif. Pillar 4 (losing stings): SERVES — the puff on every
   lost die and the full dissolve on the verdict frame; the torn rim and grudge line are kept. Pillar 5
   (feel of the tempo, not the tempo): SERVES — §2.2's table adds 0 ms to any beat and the budgets are gates.
2. **Five inherited choices.** (a) The DOM count ring beside each figure — SOUL wants owner and count to
   read instantly, not a ring: *open*, kept. (b) The Turn Track's four words and order — ROUND2 binds:
   *cited*. (c) The tray's band and anchor rules (`inkTrayTop`) — SOUL's moment has "the tray": *cited*;
   its position is *open*, kept. (d) Coasts drawn once into a 4096 canvas at boot — SOUL "Open" says the
   renderer is how this build works: *open*, kept because the texture pass is designed to sit on it. (e) The
   gold rule with a ring as the UI's signature — Touchstones (John's gold-rule reference): *cited*.
3. **Guesses.** Three: the ensō as the marker, the seat mark's copy, and the seat mark's existence. All
   in §6 with defaults; none is built without John seeing the question.
4. **Closest Misread.** 2026-09-28 sumi-e "props, not linework": the texture pass and the paper sheets are
   the nearest edge (torn edges, decorative blooms). Guard: textures modulate material only at today's
   amplitudes; sheets are straight-edged with one hairline; no torn-paper masks. Runner-up: 2026-09-27
   "panels and chips": §3.3 keeps the sheets but strips their boxes.
5. **Ranking.** One plan; John ranked the frames.
6. **Delegating.** Every phase brief in §5 pastes Intent, the moment and the pillars.
