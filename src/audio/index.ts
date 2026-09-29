// Public surface of the audio module (docs/SPEC.md §8; ink bank: docs/INK.md §6, A4, A5).
//
//   import { createAudio } from './audio';
//   const audio = createAudio({ volume: settings.sfxVolume, music: settings.music });
//   audio.play('place', { pan: -0.2, delay: 0.2 });
//
// Unlocks itself on the first pointerdown/keydown; play() before that is a silent no-op, never throws.
// After unlock a background bank pre-renders variations (~2 s), so play() costs ~0.1–0.3 ms.
// Levels are normalised inside the engine (tiers follow the stakes ladder): call play() at volume 1
// and only scale for context: AI-vs-AI (no human seat involved) plays at volume 0.5.
//
// Five materials: paper (ticks, sheets, the turn breath), brush (dab, sweep, route, flood, the snap,
// the breath of smoke), wood (the dice cup), bone (dice landing), bowl (continent, elimination,
// victory). The ambient score is ON by default at ~35% of the effects level and ducks by itself
// under dice, the verdict beat and conquests.
//
// Silence rules the engine enforces: uiHover never sounds (no hover sounds); at most one cue starts
// per 70 ms (the more important one wins; dice landings are one texture and exempt); nothing new
// starts inside a hush() window (the verdict beat).
//
// Recommended event → sound mapping (1× timings; at 2× halve the delays/durations, floor 80 ms, and
// never use `rate` for speed: "2× compresses the spacing, never the pitch"):
//   button press, selection, dice-count toggle → uiClick        rejected click → uiError
//   armiesPlaced count > 0 → place at contact: { delay: 0.2 }; rapid clicks rate 1 + 0.03·streak (≤ 1.15)
//   armiesPlaced count < 0 (undo) → unplace                     territoryClaimed → place
//   territoriesDealt flips → place { volume: 0.35 } per flip (the engine thins dense bursts)
//   turnStarted (human seats) → turnStart as the line brushes in; { variant: 'bright' } after AI turns
//   drag-to-attack (A2) → const s = audio.stroke?.({ pan }); s?.move(speed, pan) on pointermove
//       (speed 1 ≈ one board width per second); s?.end(true) when it arms, s?.end(false) otherwise
//   attack arrow drawing itself / camera move > 0.3 board widths → whoosh { duration: ms / 1000 }
//   diceRolled, single roll → diceShake { duration } as the cup shakes (not on repeat rolls within 3 s);
//       diceLand per die as it lands { pan: attacker −0.3 / defender +0.3 };
//       as the last die settles → audio.hush?.(250) (the verdict beat: 250 ms of nothing, score dips);
//       hit at the verdict, after the beat { pan toward the side that lost }
//   blitz → one diceShake { duration: 0.1 }; per middle roll one diceLand { rate: min(1.4, 1 + 0.08·k) } + hit
//   territoryConquered → conquer as the flood starts; { variant: 'somber' } whenever the previous
//       owner is human (A5: the dry brush snap, a darker flood); march { duration: 0.5, delay: 0.15 }
//   armiesMoved occupy → march { duration: 0.4 }; fortify → march { duration: min(0.9, 0.22·hops) }
//   continentGained → continent; a human's continent broken → continent { variant: 'somber' } (damped)
//   cardDrawn → cardDraw;  cardsCaptured → cardDraw × min(n, 3), 90 ms apart
//   cardsTraded → cardTrade; rate 1.0 at 4 → 0.75 at 20+ (0.75 = a fourth down, stays in key); volume 1.26 above 10
//   playerEliminated → stopAll(), then eliminated { delay: 0.15 } (low bowl, hard onset)
//   gameOver → stopAll(), then victory (the score ducks under it on its own)
//   new game / continue → audio.setMusicSeed?.(gameSeed) (the score is seeded per game; crossfades)
//   board.skipAnimations() → audio.stopAll()
//   settings: SFX volume → setVolume, score → setMusic / setMusicVolume, M key → setMuted

export { createAudio } from './engine';
export { SFX_NAMES, TIER_TARGET_LUFS } from './types';
export type { AudioEngine, AudioStats, CreateAudioOptions, PlayOptions, SfxName, SfxVariant, StrokeHandle } from './types';
