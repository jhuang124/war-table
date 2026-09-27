# Foundation reports (engine, map, audio)
Written by the foundation builders; copied here by the lead so later agents can read them.

## engine

### summary
The rules engine and AI are finished and verified. `npm test` passes (10 files, 132 tests), `npm run sim` passes, and `npm run typecheck` shows no errors in my files. Full typecheck fails on another builder's files: src/audio/mixer.ts can't find './music' and './sounds'.

What's in src/engine: seeded mulberry32 dice (rng.ts), setup (random deal, draft, auto or manual placement), cards (44-card deck, set checks, progressive and fixed values with wilds taking the best value, the +2 territory bonus, reshuffle), shared rule helpers, and the reducer. `applyAction` checks the action with `validateAction` (which gives a readable reason), then runs it on a structural copy, so it never mutates input. It is wrapped in try/catch, so it never throws on bad input. The event order the renderer should animate is documented at the top of reducer.ts. Also: legalActionsSummary in summary.ts, exact blitz odds in probability.ts (win chance, expected losses both sides, expected survivors), and three AI levels in ai/.

AI levels (knobs in ai/persona.ts):
- Easy: mostly random placement at the front, attacks only at 88%+ odds, skips fortify 60% of the time, trades only when forced.
- Normal: follows SPEC §4.
- Hard: normal plus a 4-step conquest-chain lookahead, an elimination planner (cash cards, stack next to the victim, attack at lower odds), extra weight on breaking continents and on the leader, sizing garrisons so the strongest neighbor's odds drop below 30%, and holding card sets until needed.

In long games every AI gets gradually more aggressive, so games don't stall. I added that after an easy-vs-easy game grew to 4,329 armies over 286 rounds.

Engine behavior I chose where the spec was silent:
1. When the conquest wins the game, the engine skips the occupy step, moves the maximum in, and goes straight to gameOver.
2. Placing armies is blocked while a forced trade is pending.
3. Fortify is only accepted in the fortify step; the UI sends `endAttack` first.
4. Blitz rolls `min(3, armies − stopAt)` dice, so the attacker never drops below stopAt.
5. Manual setup-place starts with the first player, in draft mode too.
6. `cardsCaptured` is only emitted when the loser held cards.
7. Battles won and lost are counted for defenders as well as attackers.
8. A final timeline point is added at gameOver so the victory chart ends on the final board.
9. `defaultConfig` keeps dominationPercent 100, as the types.ts comment says; UX.md's "Evening 70%" default belongs to the controller.
10. Config clamps: setupBatch ≥ 1, dominationPercent 30–100, turnLimit ≥ 1, startingArmies ≥ ceil(42/n).

Bug found and fixed: `winProbability` read the old odds table before a rebuild, so the first call (and the first call after each table growth) returned `undefined`. The published-odds tests now guard it.

### verification
- `npm test`: 10 files, 132 tests, all pass (about 0.7 s). Every §2 rule on the brief's list has a test, from the draft and deal counts through the turn-limit tiebreaks. On top of those:
  - Every step of four whole AI games runs on a deep-frozen state, and the input is compared byte for byte afterwards, so any mutation fails the test.
  - Same seed plays identical states and events three times over.
  - A state survives a JSON round-trip (save/load).
  - Blitz odds match the engine's own dice over 2,000 random games (within 3.5%).
  - The published single-roll odds tables match exactly.
- `npx tsc --noEmit`: no errors in src/engine, tests/engine or scripts/simulate.ts. The only errors are in src/audio/mixer.ts (another builder's missing './music' and './sounds').
- `npm run sim` (200 games): PASS. 200/200 finished; 185 by domination, 13 by percent, 2 by turn limit.
  - Rounds: average 14.5, median 11, max 81.
  - Every AI move was legal on the first try (the backup move was never needed) and the invariants held after every action: 44 cards, no duplicate cards, no empty territory, no territory held by an eliminated player.
  - Wins versus a fair share: easy 0.25×, normal 1.20×, hard 1.43×.
  - Head-to-head, 40 games each, seats alternated: hard beats easy 39/40, normal beats easy 37/40, hard beats normal 23/40 (57.5%).
  - Four normals in 4p: median 17 rounds, range 6–50, 21 of 40 within 15–60.
  - One hard among three normals in 4p: hard wins 16/40 (40%; a fair share is 25%).
  - AI decision time over 233,890 decisions: mean 0.007 ms, p99 0.039 ms, max 1.01 ms (budget is 5 ms).
- `npm run sim -- 12`: PASS, confirming the game-count argument works.
- Hard-AI tuning, run in the scratchpad: random parameter search, then 800-game checks per variant across four seed sets. Hard vs normal averaged about 61% in 2p and 33% in 4p. The lookahead added about 7 points in 2p; the elimination planner about 5 points in 4p.
- Rounds until someone first holds 60 / 70 / 100% of the board (normal AIs, median / p90):
  - 2p: 1/2, 2/5, 6/11
  - 3p: 5/10, 7/14, 11/22
  - 4p: 8/14, 10/29, 17/34

### knownIssues
- Two-player games are a race: with no neutral army, the first player won 76 of 100 normal-vs-normal games, which lasted 5–17 rounds. A 2p neutral-army house rule would need a contract change; worth considering later.
- UX.md's 'Quick · 60%' length is broken for 2 players: each side is dealt 21 territories (50%), so someone reaches 60% in round 1 (median). For 2p, use at least 70%, or make Quick turn-limit only.
- Hard's edge over normal is real but modest (about 61% in 2p, 33–40% in 4p where 25% is fair). It crushes easy (97.5%). 4p results vary a lot between seed sets, so trust 800-game numbers over any single 40-game line.
- AI-vs-AI games run faster than human games will: AIs attack whenever the odds clear their threshold. UX minute estimates should scale the rounds-to-X% table up for human turn time rather than use it raw.
- `npm run typecheck` currently fails only because another builder's src/audio/mixer.ts can't find './music' and './sounds'. That is outside my area.

### requests
- Lead / contract: I made one additive optional change to src/engine/types.ts. The occupy phase now has `previousOwner?: PlayerId`, engine bookkeeping for continent diffing. Consumers can ignore it.
- UX.md §4.1 length labels: please relabel from the sim's rounds-to-threshold table, and give 2-player games a different Quick setting (at least 70%, or turn-limit only), since 60% is reached in round 1.
- Controller: pre-validate with `validateAction(state, action)`; it returns the engine's reason string, or null if legal, without running anything. Use `legalActionsSummary(state)` for highlights. The attack/fortify target helpers take a source territory. For the victory 'Hot dice' award use `expectedRollLosses(attackDice.length, defendDice.length)`; for 'Next set +8 · then +10' use `upcomingSetValues(state)`.
- Controller: the reinforce step accepts no placements while `mustTrade` is true (the summary returns an empty `placeable`). The fortify action is only accepted after `endAttack`. When a conquest wins the game there is no occupy step; the events go straight to armiesMoved → continent events → gameOver.

### apiNotes
Import everything from `src/engine` (index.ts re-exports all of types.ts and mapData.ts plus the functions below).

Core:
- `createGame(config: GameConfig): { state; events }`. Throws only for configs `validateConfig` rejects; call that first.
- `applyAction(state, action): ActionResult`. Never throws, never mutates input.
- `validateAction(state, action): string | null`. Same checks as applyAction, nothing executed.
- `defaultConfig(players)`: random deal, auto placement, setupBatch 5, progressive cards, connected fortify, dominationPercent 100, no turn limit, random seed.
- `validateConfig(config): string | null`, `sanitizeConfig(config)`, `cloneState(state)`.

Setup event order: gameStarted → territoriesDealt → armiesPlaced(setup)×N → turnStarted → phaseChanged. Manual placement ends with phaseChanged(setup-place) → setupTurn instead; draft starts with phaseChanged(setup-claim).

`legalActionsSummary(state): LegalSummary`, about 0.01 ms per call. All territory arrays are in TERRITORY_IDS order.
```ts
interface TradeOption { cardIds: [number, number, number]; value: number; bonusTerritory: TerritoryId | null }
interface LegalSummary {
  player: PlayerId;            // current player (the winner after game over)
  phase: PhaseKind;
  isAi: boolean;
  claimable: TerritoryId[];    // setup-claim
  placeable: TerritoryId[];    // setup-place / reinforce (empty while mustTrade or nothing left)
  unplaceable: TerritoryId[];  // reinforce: armies placed this phase can be taken back
  toPlace: number;             // setup-place toPlace | reinforce remaining | 0
  mustTrade: boolean;
  midTurn: boolean;
  tradeSets: TradeOption[];    // reinforce only, best value first
  hasSetInHand: boolean;       // any phase, for the card badge
  canEndReinforce: boolean;
  attackSources: TerritoryId[];
  canEndAttack: boolean;
  occupy: { from: TerritoryId; to: TerritoryId; min: number; max: number } | null;
  fortifySources: TerritoryId[];
  canEndTurn: boolean;
  gameOver: { winner: PlayerId; reason: 'domination' | 'percent' | 'turnLimit' } | null;
}
```
Targets: `attackTargets(state, from)`, `fortifyTargets(state, from)` (follows fortifyRule), `fortifyPath(state, from, to)` (path includes both ends, or null).

Rule helpers:
- `reinforcementsFor(state, p)`, `attackSources(state, p)`, `fortifySources(state, p)`, `connectedPath`.
- `maxAttackDice(state, from)`, `defendDiceFor(armies)`, `territoriesNeeded(state)`.
- `territoryCount`, `totalArmies`, `ownedTerritories`, `ownsContinent`, `continentsOwned`, `continentOwners`.
- `checkWinner`, `turnLimitWinner`, `alivePlayers`, `isTerritoryId`, `territoryName`, `isBorder`, `enemyNeighborArmies`.

Card helpers:
- `validSets(cards)`: id triples, ascending ids within each.
- `setValue(state, cardIds)`: base value, no +2; 0 if not a set. Also `setValueFor(config, tradeCount, symbols)`.
- `fixedSetValue(symbols)`, `progressiveValue(n)` (n is 1-based), `isValidSetSymbols`.
- `bonusTerritoryFor(state, p, cards)`, `upcomingSetValues(state, n = 2)` (empty in fixed mode), `buildDeck()`, `WILD_CARD_IDS` (42, 43). Card id i is the card for TERRITORY_IDS[i].

Probability:
- `winProbability(attackers, defenders)`: attackers = armies in the territory, not dice; blitz to 1.
- `winProbabilityStopAt(a, d, stopAt)`: matches the engine's capped dice.
- `blitzOdds(a, d)`: `{ win, expectedAttackersLeft, expectedDefendersLeft, expectedAttackerLosses, expectedDefenderLosses, expectedAttackersLeftIfWin }`.
- `rollOutcomes(k, m)`, `expectedRollLosses(k, m)`.

AI:
- `chooseAiAction(state, player): Action`. Deterministic, pure, always legal. If `player` isn't the one to move, it returns a no-op `setController` that keeps the seat's current controller.
- Also `fallbackAction`, and `PERSONAS` / `Persona` (difficulty knobs).
- The AI blitzes rather than rolling single attacks, and usually places all its armies in one or two actions, so an AI turn takes few steps.

Also exported: `nextRandom`.

Gotchas:
- Events come only from engine actions; phase changes always emit phaseChanged, except an auto-occupy that stays in attack.
- A winning conquest skips occupy.
- `unreinforce` emits armiesPlaced with a negative count and source 'undo'.
- The +2 card bonus lands immediately and is not part of `phase.placed`, so it can't be undone.
- The final timeline point, added at gameOver, repeats the current round number.

## map

### summary
Built the board geometry pipeline. `npm run build:map` writes src/map/board.json (168 KB, runs in about 1.3 s, and two runs give byte-identical output). `npm run verify:map` PASSES.

What the map is:
- A 100 × 49.5 unit board with all 42 territories.
- Adjacency matches BORDERS exactly: 58 land borders plus 25 sea lanes = 83.
- Every anchor has at least 1.31 units of clearance (the tightest are Japan 1.32, Irkutsk 1.35 and Egypt 1.38).

How it's built:
1. Natural Earth 50m countries are assigned to territories (scripts/map/assign.ts). Big countries are split with lon/lat rules: USA, Canada, Russia, Kazakhstan, China/Manchuria, Australia, Indonesia/Papua, Malaysia.
2. Projection is Miller with the Pacific seam, plus smooth monotone lenses that enlarge crowded regions. Because the lenses never fold or tear the map, they can't create or destroy a land contact.
3. The world is drawn onto a 20 px/unit grid. There the pipeline smooths coasts, stretches islands along their shape, grows small islands slightly, carves water gaps and drops tiny specks.
4. It then traces the borders back into polygons. Each shared border is traced once and used by both neighbours, so borders are vertex-identical: no slivers, no gaps. Outlines are simplified and softened for a stylized look.
5. Last it places anchors (polylabel), name anchors, sea lanes, and continent and ocean labels.

All the requested classic-board liberties are in:
- Mongolia includes Manchuria and Korea, giving it the Pacific coast.
- Kamchatka covers the whole Russian Far East plus Sakhalin, so it touches Mongolia and Irkutsk.
- Ukraine runs west of the Urals and includes the Baltics, Belarus, Moldova and the Caucasus.
- Kazakhstan is split three ways, so Ural and Siberia both touch China and Ural touches Afghanistan.
- Middle East is Turkey, Arabia, Iran and Cyprus; India includes Pakistan, Bangladesh, Nepal, Bhutan and Sri Lanka.
- Siam includes peninsular Malaysia; Malaysian Borneo and Brunei go to Indonesia; New Guinea is the whole island.
- Central America includes Mexico and the Caribbean.

Judgment calls I made:
- Baffin Island, Southampton Island and the west shore of Hudson Bay are part of Ontario. That gives Greenland–Ontario a short, honest Davis Strait crossing.
- Ireland stays a separate island inside Great Britain.
- Philippines, NZ, Svalbard, Hawaii, the Falklands, Canaries and Fiji are decorative (non-playable) land.

I looked at preview.png and the Europe, SE Asia and Americas close-ups. It reads like a real Risk board: Europe is enlarged but recognizable, and GB, Ireland, Iceland, Madagascar, Japan and New Guinea are chunky enough for a badge without turning into blobs.

### verification
- `npx tsx scripts/build-map.ts`: builds cleanly with no clearance warnings.
- Determinism: shasum of board.json was identical across two separate builds (ed277d46… before the final lens tweak; re-verified after).
- `npx tsx scripts/verify-map.ts`: exit 0, "PASS: geometry valid, adjacency == BORDERS, anchors clear, lanes plausible". Checks passed:
  - 42 territories present.
  - No self-intersecting or crossing segments anywhere.
  - Outer rings wind counter-clockwise, holes clockwise (there are no holes).
  - No territory overlaps another.
  - No point-touch contacts, and no near contacts under 0.25 units.
  - 58 land borders plus 25 lanes equal the 83 BORDERS exactly: no extras, none missing.
  - All anchors are inside their main polygon with at least 1.3 clearance; polygons[0] is the largest.
  - Lanes have coast-to-coast endpoints, are at most 6.6 long, and cross at most 0.13 units of unrelated land (East Africa–Madagascar grazes the Comoros area).
  - The wrap lane runs off both edges.
  - Continent and ocean labels all sit on water.
- `npx tsc --noEmit -p .`: exit 0 across the whole project.
- Screenshots opened with Read: artifacts/map/preview.png (2400 px full board) and the preview-europe, preview-seasia and preview-americas close-ups. The Playwright launch used the Metal flags.
- No dev server was started, so there was nothing to kill.

### knownIssues
- Japan is recognizable but stylized: a fat curved Honshu with Hokkaido attached, Kyushu and Shikoku merged in. It has to be this thick to fit a badge; its anchor clearance is 1.32, the tightest on the board.
- Great Britain's anchor sits in northern England/Scotland, because that is the widest part after the Channel gap was carved. GB is 3 polygons: Britain, Ireland and a Hebrides blob.
- The Great Lakes are not shown. The Natural Earth countries layer has no lake holes, so the US–Canada land border runs straight through them. Hudson Bay, the Caspian and the Black Sea are real water.
- Sumatra and Java read as one strip, and Denmark is Jutland only (Zealand was lost when water was carved between Denmark and Sweden). Both are deliberate simplifications.
- The Northwest Territory has 14 polygons and 1013 vertices (the Arctic archipelago). It is the heaviest mesh on the board; everything else is 55–415 vertices.
- Short sea lanes (the minimum water gap for lane pairs is 0.8) are about 0.75 units long: GB–Western Europe, Denmark–Sweden, Gibraltar, Siam–Indonesia and others. They are visible as 2–3 dashes, but the renderer should not trim lane ends by more than about 0.1.
- labelAnchor positions for territory names assume a name about 0.55 units tall and about 0.36 units per character. Long names (Western United States, Northwest Territory) spill slightly over neighbours or water; the renderer may want a smaller font or two lines for those.
- The spec suggested d3-delaunay plus polygon-clipping for splitting countries. I used lon/lat rules drawn onto a grid and a shared-border vector tracer instead, because clipping each territory separately cannot guarantee identical shared borders.

### requests
- Lead: src/map/types.ts has one additive optional field, `ContinentGeom.labelRoom?: number`. It gives the width (board units) of clear water centred on the continent labelAnchor, for about a 1.3-unit-tall line of text. Please note it in SPEC §5/§11.
- Renderer: after the lead commits, import `BOARD` from src/map/index.ts rather than reading board.json directly.
- No other files outside my ownership were touched.

### apiNotes
src/map/index.ts exports:
- `BOARD: BoardGeometry` (static JSON import)
- `territoryAnchor(t): Vec2`
- `ANCHOR_CLEARANCE = 1.3`
- `seaLaneBetween(a, b): SeaLaneGeom | null`
- a re-export of all types from ./types

BOARD facts:
- width 100, height 49.5. Units are board units, origin bottom-left, +y north (flip y if drawing in SVG or screen space).
- Every territory has a guaranteed clear disc of radius 1.3 around its `anchor`, inside polygons[0]. Size the badge and piece group within that. Actual clearances are 1.32–3.84.
- polygons[0] is always the largest (main) landmass. Outers are counter-clockwise, there are no holes, and there is no closing duplicate point.
- Shared borders are vertex-identical between neighbours: same coordinates in reverse order. Extrude each territory independently and neighbours meet exactly at the base; there are no T-junctions.
- Land that must not touch has at least 0.4 units of water between it. Sea-lane pairs have at least 0.8.
- Totals: 9827 territory vertices, 88 territory polygons, 6 decorativeLand polygons (NZ, Philippines, Svalbard, Falklands, Fiji etc.; each 22–73 vertices, at least 0.4 from any territory). Coordinates are rounded to 3 decimals.
- Vertex counts per territory: NWT 1013 (14 polygons), Ontario 463, Kamchatka 415, Greenland 404, Ukraine 404; all others 55–350.

Sea lanes (25):
- Each non-wrap lane is 1 segment: a gentle quadratic arc of 9–17 points from coast to coast.
- Alaska–Kamchatka has `wrap: true` and 2 segments: Alaska's west tip to x=0, and x=100 to Chukotka's east tip, meeting both edges at the same y. Each segment is about 2.4–3 units.
- Lane list: alaska–kamchatka (wrap), NWT–greenland, greenland–ontario (Davis Strait, from Baffin, which belongs to Ontario), greenland–quebec, greenland–iceland, brazil–north_africa (5.8, the longest), iceland–great_britain, iceland–scandinavia (6.6), great_britain–scandinavia, northern_europe–scandinavia (Denmark–Sweden), great_britain–northern_europe, great_britain–western_europe, western_europe–north_africa (Gibraltar), southern_europe–egypt, southern_europe–north_africa, east_africa–madagascar, south_africa–madagascar, east_africa–middle_east (Bab-el-Mandeb), kamchatka–japan (Sakhalin), mongolia–japan (Korea Strait), siam–indonesia (Malacca), indonesia–new_guinea, indonesia–western_australia, new_guinea–eastern_australia (Torres Strait), new_guinea–western_australia.

Labels:
- Continent labelAnchors sit on open water with `labelRoom` (NA 14.75, SA 15.25, Europe 7.5, Africa 11.75, Asia 7, Australia 9).
- oceanLabels: 6 entries (two PACIFIC, ATLANTIC, INDIAN, ARCTIC, SOUTHERN) with `size` = suggested text height in board units.

Projection (also stored in `BOARD.projection`):
- Miller cylindrical, lon −169.2°…190.8° squeezed into x 2.4…97.6, lat about 56°S…84°N.
- Lenses: Europe ×1.5, Central America ×1.4, SE Asia ×1.45, Andes ×1.32, Japan ×1.58, New Guinea ×1.35.
- Island stretches (along/across the island's long axis): Iceland 1.5/2.3, GB 1.3/1.75, Japan 1.05/3.4, Madagascar 1.15/2.15.
- All tunables live in scripts/map/config.ts. Run `npm run build:map && npm run verify:map` after any change. `verify:map -- --no-preview` skips the Playwright screenshots.

## Lead notes (2026-09-27, after reviewing the above)

- Map preview reviewed: passes. Recognizable classic board; keep it.
- **Length presets for 2 players:** each side is dealt 50%, so `Quick · 60%` ends in round 1. For 2 players,
  Quick = `dominationPercent 75` + `turnLimit 12`; Evening = 80%. 3–4 players keep 60%/12 and 70%.
  Relabel the minute estimates from the rounds-to-threshold table above (integration applies SPEC §11.1).
- **2-player first-mover advantage** (76% in AI sims): known issue, deferred. A classic neutral-army
  house rule may be added in the review loop; do not build it now.
- Pre-validate with `validateAction`; highlights from `legalActionsSummary`; `upcomingSetValues` for the
  Next-set chip; `expectedRollLosses` for the dice awards. Fortify requires `endAttack` first. A winning
  conquest skips occupy.
- The audio report may land after you start; the API in `src/audio/types.ts` is stable.
