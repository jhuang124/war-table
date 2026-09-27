// Public surface of the audio module (docs/SPEC.md §8; caller rules in docs/UX.md §5.4).
//
//   import { createAudio } from './audio';
//   const audio = createAudio({ volume: settings.sfxVolume, music: settings.music });
//   audio.play('place', { pan: -0.2, delay: 0.2 });
//
// Unlocks itself on the first pointerdown/keydown; play() before that is a silent no-op, never throws.
// After unlock a background bank pre-renders variations (~2 s), so play() costs ~0.1–0.2 ms.
// Levels are normalised inside the engine (tiers follow the stakes ladder): call play() at volume 1
// and only scale for context (AI-vs-AI 0.6). uiHover is already −18 dB under uiClick and throttled
// to one per 90 ms — don't attenuate it again.
//
// Recommended event → sound mapping (1× timings from UX §8.2; at 2× halve the delays/durations,
// floor 80 ms, and never use `rate` for speed — "2× compresses the spacing, never the pitch"):
//   button hover (buttons only, never tiles) → uiHover
//   button press, selection, dice-count toggle → uiClick        rejected click → uiError
//   armiesPlaced count > 0 → place at contact: { delay: 0.2 }; rapid clicks rate 1 + 0.03·streak (≤ 1.15)
//   armiesPlaced count < 0 (undo) → unplace                     territoryClaimed → place
//   territoriesDealt flips → place { volume: 0.35 } per flip (the engine thins dense bursts)
//   turnStarted (human seats) → turnStart as the banner enters; { variant: 'bright' } after AI turns
//   diceRolled, single roll → diceShake { duration: 0.15 } at start (not on repeat rolls within 3 s);
//       diceLand per die at settle { delay: 0.6 + 0.04·i, pan: attacker −0.3 / defender +0.3 };
//       hit at the verdict { delay: ~0.9, pan toward the side that lost }
//   blitz → one diceShake { duration: 0.1 }; per middle roll one diceLand { rate: min(1.4, 1 + 0.08·k) } + hit
//   territoryConquered → conquer as the flood starts ({ variant: 'somber' } when a human loses it to an AI);
//       march { duration: 0.5, delay: 0.15 }
//   armiesMoved occupy → march { duration: 0.4 }; fortify → march { duration: min(0.9, 0.22·hops) }
//   continentGained / tier-1 swing → continent; your continent broken or "HELD!" → continent { variant: 'somber' }
//   cardDrawn → cardDraw;  cardsCaptured → cardDraw × min(n, 3), 90 ms apart
//   cardsTraded → cardTrade; rate 1.0 at 4 → 0.75 at 20+ (0.75 = a fourth down, stays in key); volume 1.26 above 10
//   playerEliminated → stopAll(), then eliminated { delay: 0.15 }   (UX: 150 ms of SFX silence)
//   gameOver → stopAll(), then victory (music ducks 12 dB under it on its own)
//   camera move > 0.3 board widths → whoosh { duration: moveMs / 1000 }
//   board.skipAnimations() → audio.stopAll()
//   settings: SFX volume → setVolume, music → setMusic, M key → setMuted

export { createAudio } from './engine';
export { SFX_NAMES, TIER_TARGET_LUFS } from './types';
export type { AudioEngine, AudioStats, CreateAudioOptions, PlayOptions, SfxName, SfxVariant } from './types';
