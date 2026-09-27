**Prioritize turn flow, then board framing, then pieces.** Preserve the map, rules, AI, and dice. This plan deliberately revises SIMPLIFY’s single-row strip, numbered discs, and implicit click shortcuts. Review is based on the supplied screenshots and source; I did not run the game.

**1. Diagnosis**

- **Phase progress looks like navigation but cannot be clicked.** `Place · Attack · Fortify` consists of spans ([strip.ts:104](/Users/jhuang/Desktop/JH-Projects/risk3d/src/ui/hud/strip.ts:104)).
- **Selecting an attack hides the exit.** `Fortify →` and `End turn` are replaced by `Roll / Blitz`; leaving requires discovering deselection ([strip.ts:197](/Users/jhuang/Desktop/JH-Projects/risk3d/src/game/strip.ts:197)).
- **Board clicks have inconsistent consequences.** They select, roll on a repeated target click, implicitly leave Place, or commit occupation ([explain.ts:103](/Users/jhuang/Desktop/JH-Projects/risk3d/src/game/explain.ts:103), [explain.ts:175](/Users/jhuang/Desktop/JH-Projects/risk3d/src/game/explain.ts:175)).
- **The presentation spends space on furniture.** `place-1440x900.png` has a thick bottom frame and table bands; `place-1920x1080.png` enlarges the map while the controls remain comparatively small.
- **Armies read as annotations.** Colored numbered circles blend into similarly colored territories (`place-1440x900.png`).
- **Conquest still looks like combat.** Broken dice and `SIBERIA 0` dominate while the player must decide movement (`occupy-1440x900.png`).
- **Selection overpowers geography.** Heavy dimming and multiple equally bright borders weaken source/target hierarchy (`attack-armed`, `fortify`).
- **Setup front-loads configuration.** Twenty-four color swatches compete with names and player types (`newgame-1440x900.png`).

**2. The phase flow**

Use one floating, two-row **turn dock**. Its upper row contains `1 Place → 2 Attack → 3 Fortify`, with the current step emphasized and completed steps checked. These are progress labels. At the upper right, a **persistent phase button** provides the mouse path forward.

The lower row contains the instruction on the left, count control where needed, and action buttons on the right. Buttons have 44px minimum targets. Only one button is gold: the immediate commit action, or the phase button when no commit is pending.

| State | Lower row and board behavior | Persistent phase button |
|---|---|---|
| Place, unselected | `9 armies remaining · choose your territory`. Clicking owned land selects it. | `Start attacking →`, disabled until all armies are placed. |
| Place, selected | `Ural · 9 remaining`; `− 9 +`; gold `Place 9`. After placement, show `Undo` immediately left of the commit button. Repeat until empty. | Same location and label; becomes enabled and gold at zero. |
| Place, complete | `All armies placed`; `Undo` remains available. | Click `Start attacking →` to enter Attack. |
| Attack, unselected | `Choose an enemy territory`. Clicking an eligible enemy selects it and the strongest eligible adjacent source; clicking another eligible friendly source changes the origin. | `Finish attacking →`, enabled even with a target selected. Enters Fortify and clears selection. |
| Attack, selected | `Ural → Siberia · 99% conquest chance`; secondary `Auto-roll`, gold `Roll dice`. Auto-roll invokes existing Blitz behavior. | Same button; never disappears. |
| Rolling | Replace instruction with `Rolling…`; show dice. Disable combat and phase commitments until the result is actionable. Never queue a second commitment. | Visible, disabled. |
| Occupy | `Move into Siberia`; slider with selected count; gold `Move 15`. Preview resulting totals on both pieces, e.g. `Ural 1`, `Siberia 15`. Click commits, then returns to Attack with the advancing source selected. | Visible, disabled until occupation is resolved. |
| Fortify, unselected | `Choose armies to move, or end your turn`. Click source, then reachable friendly destination. If none exist: `No moves available`. | Gold `End turn`. |
| Fortify, selected | `Siberia → Ukraine`; slider; gold `Move 14 & end turn`. Show resulting totals on both pieces. | Secondary `End turn without moving`; discards the preview and ends the turn. |

Add a quiet **`Clear selection`** control beside the lower-row instruction during optional selections. It clears selection without changing phase. Ocean clicks do the same. Occupation is mandatory and has no cancel.

Board clicks select and preview; buttons commit. Remove repeated-click rolling, double-click placement, implicit phase advancement, and occupation-by-board-click. Keep keyboard equivalents optional.

Cards occupy one stable lower-row utility slot during Place: `Cards 3` opens the hand sheet, with `Trade for +4` and `Close`. Mandatory trading replaces the placement controls with gold `Trade cards +4`; placement and advancement remain disabled.

Manual setup uses the same placement pattern, ending with `Finish placement`. Human handoff shows `Pass to Rose` and `Start Rose’s turn`; AI turns replace controls with the existing live narration.

Phase changes animate the progress highlight over **180ms**, with one soft click. Do not add interstitials or mandatory celebration waits.

**3. Full-screen board**

Render ocean and land behind the entire viewport. Remove the gameplay frame, brass perimeter, table exposure, and full-width top-bar background. Preserve restrained tile depth and ocean texture.

| Viewport | Floating dock | Insets | Default text / army count |
|---|---:|---:|---:|
| 1280×800 | 1184×104px | 12px | 18 / 22px |
| 1440×900 | 1200×104px | 16px | 18 / 24px |
| 1920×1080 | 1440×136px in TV mode | 20px | 24 / 32px |

Dock sits bottom-center. Roster floats top-left; a labeled `Menu` button floats top-right. Use opaque charcoal behind controls, restrained shadows, and no surrounding panel spanning the viewport.

Change camera fitting from full-width strip insets to **actual HUD exclusion rectangles**. Fit all territory outlines and piece footprints with 12px clearance; extend ocean beyond the viewport. Start at **72° pitch**, retaining perspective and tile thickness. Never crop playable land to achieve edge-to-edge coverage.

Place the transient dice tray above the dock, centered in southern ocean: maximum 640×132px on laptops, 800×170px on TV. Include it in layout collision checks. Resolve collisions during layout, without camera movement when a fight starts.

When the user pans or zooms away, show `Reset view` beside Menu. Restore home framing on click.

**4. Unit pieces**

Use **one sculpted piece per territory**: painted, beveled silhouettes on low oval bases, with contact shadows and a camera-facing ivory count plaque.

Reference physical Risk’s infantry, cavalry, and artillery vocabulary. Its pieces represent army denominations ([Hasbro rules](https://www.hasbro.com/common/instruct/risk.pdf)). Here, use infantry for totals 1–4, cavalry for 5–9, artillery for 10+, always displaying the **complete numeric total**. Explain in Rules that silhouettes indicate stack size, with identical combat rules.

- Laptop footprint approximately **38×44px**; TV **50×60px**. Count plaque expands for three digits.
- Owner color covers the sculpt; the base carries the roster’s matching emblem for redundant identification.
- Keep counts horizontal and crisp through the existing DOM overlay. Validate crowded anchors, especially Japan and central Europe; adjust anchors within territories before shrinking text.
- Placement: **160ms** settle. Movement: one representative piece travels along the route in **280ms**, carrying the moved count. Casualties: **120ms** recoil and immediate count update.
- No idle bouncing. Reduced motion uses short fades and immediate totals.

**5. Everything else, ranked**

**Must**

- **Make battle outcomes readable:** after dice settle, pair compared dice for 350ms and update casualties; on conquest, replace the versus header with `Siberia captured`, then fade the tray within 250ms. Movement controls become available immediately.
- **Clarify selection:** source gets a solid ivory outline; selected target gets an arrowhead and stronger outline; other legal targets get thin edges. Limit unrelated-land dimming to 15%.
- **Protect readability:** reflow large-text controls instead of silently shrinking TV mode. Allow two-line instructions before truncating names; preserve visible focus and disabled states.
- **Verify the complete mouse path:** cover trading, placement undo, armed-attack exit, compulsory occupation, fortify skipping, AI, and human handoff. Test rapid clicks for unintended commitments.

**Should**

- **Simplify setup:** show one selected color emblem per seat; clicking opens six swatches. Retain name, Human/AI, and conditional difficulty. Keep duration and setup choices.
- **Explain roster numbers:** use `John · 11 territories`; current player remains filled. Move card counts into the active player’s Cards control.
- **Improve surfaces:** retain the title’s serif identity, reduce heavy vignette during play, and make modal backgrounds opaque enough that map details do not compete with text.

**Could**

- Add distinct, quiet placement/movement/capture sounds using existing audio.
- Offer a skippable three-action practice turn from `How to play`.

Build in that order: flow in `game/strip.ts`, `viewModel.ts`, `explain.ts`, and `controller.ts`; dock/layout; camera/scene; pieces/overlay; polish. Then run tests, typecheck, build, and mouse-only visual checks at all three resolutions. Preserve 60fps, existing AI pacing, and Blitz’s ≤3-second budget.

**6. What not to do**

Do not restore sidebars, permanent logs, tutorial bubbles, duplicate odds, or armies-total dashboards. Do not make phase labels unrestricted tabs. Do not hide progression behind deselection, add automatic camera sweeps, or scatter individual soldiers across territories. Keep ordinary phase advancement free of confirmation dialogs.