// The sound registry: every SfxName → how it's built, how loud it sits, and how it behaves under load.
// Ink bank (docs/INK.md §6, A4, A5): five materials, nothing else.
//   paper  uiClick, uiError, cardDraw, cardTrade, turnStart
//   brush  whoosh, place, unplace, march, hit (the breath of smoke), conquer (the flood; somber = snap)
//   wood   diceShake (dice in a lacquer cup)
//   bone   diceLand (one die in the tray)
//   bowl   continent, eliminated, victory
// uiHover is silent (no hover sounds). `trimDb` values are measured, not guessed: run the lab's
// "Analyze" (or `npm run verify:audio`), which suggests the trim that lands each sound on its tier.

import type { SfxMeta, SfxName } from '../types';
import { diceLand } from './bone';
import { continent, eliminated, victory } from './bowl';
import { conquer, hit, march, place, unplace, whoosh } from './brush';
import { cardDraw, cardTrade, turnStart, uiClick, uiError, uiHover } from './paper';
import { diceShake } from './wood';

export const SFX: Record<SfxName, SfxMeta> = {
  uiHover: {
    fn: uiHover, label: 'Hover (silent)', group: 'UI', tier: 'micro', trimDb: -18, wet: 0,
    maxDur: 0.06, maxVoices: 1, minGapMs: 90, priority: 0, silent: true,
  },
  uiClick: {
    fn: uiClick, label: 'Paper tick', group: 'UI', tier: 'ui', trimDb: 9.1, wet: 0.04,
    maxDur: 0.1, maxVoices: 2, minGapMs: 40, priority: 1, densityDb: 2, densityMaxDb: 4,
  },
  uiError: {
    fn: uiError, label: 'Refused (two pats)', group: 'UI', tier: 'ui', trimDb: -12.4, wet: 0.05,
    maxDur: 0.31, maxVoices: 1, minGapMs: 200, priority: 3,
  },
  whoosh: {
    fn: whoosh, label: 'Brush sweep (camera, arrow)', group: 'UI', tier: 'ui', trimDb: -6.5, wet: 0.1,
    maxDur: 0.67, maxVoices: 2, minGapMs: 150, priority: 1, duration: [0.2, 1.5, 0.6],
  },
  place: {
    fn: place, label: 'Ink dab (place)', group: 'Board', tier: 'board', trimDb: 5.4, wet: 0.08,
    maxDur: 0.21, maxVoices: 4, minGapMs: 40, priority: 2, densityDb: 1.5, densityMaxDb: 5,
  },
  unplace: {
    fn: unplace, label: 'Brush lift (take back)', group: 'Board', tier: 'board', trimDb: 7.2, wet: 0.08,
    maxDur: 0.17, maxVoices: 2, minGapMs: 40, priority: 2, densityDb: 1.5, densityMaxDb: 4,
  },
  march: {
    fn: march, label: 'Brush route (march)', group: 'Board', tier: 'board', trimDb: 4.1, wet: 0.1,
    maxDur: 0.63, maxVoices: 2, minGapMs: 80, priority: 2, densityDb: 2, densityMaxDb: 4,
    duration: [0.12, 1.2, 0.5],
  },
  diceShake: {
    fn: diceShake, label: 'Wood cup shake', group: 'Battle', tier: 'board', trimDb: -4.0, wet: 0.08,
    maxDur: 0.25, maxVoices: 1, minGapMs: 80, priority: 3, duration: [0.06, 1.5, 0.15], duckDb: 3,
  },
  diceLand: {
    fn: diceLand, label: 'Bone die lands', group: 'Battle', tier: 'die', trimDb: -0.5, wet: 0.1,
    maxDur: 0.17, maxVoices: 6, minGapMs: 12, priority: 3, densityDb: 0.8, densityMaxDb: 3,
    duckDb: 3, texture: true,
  },
  hit: {
    fn: hit, label: 'Breath of smoke (a figure falls)', group: 'Battle', tier: 'board', trimDb: -11.0, wet: 0.16,
    maxDur: 0.45, maxVoices: 2, minGapMs: 70, priority: 3, densityDb: 2.5, densityMaxDb: 6, duckDb: 4,
  },
  conquer: {
    fn: conquer, label: 'Ink flood (somber: the snap)', group: 'Stingers', tier: 'cue', trimDb: -1.4, wet: 0.14,
    maxDur: 0.79, maxVoices: 2, minGapMs: 150, priority: 4, duckDb: 5, densityDb: 3, densityMaxDb: 6,
  },
  cardDraw: {
    fn: cardDraw, label: 'Sheet drawn', group: 'Cards', tier: 'board', trimDb: -0.2, wet: 0.06,
    maxDur: 0.31, maxVoices: 3, minGapMs: 70, priority: 2, densityDb: 1.5, densityMaxDb: 4,
  },
  cardTrade: {
    fn: cardTrade, label: 'Sheets fanned (trade)', group: 'Cards', tier: 'cue', trimDb: 4.2, wet: 0.1,
    maxDur: 0.51, maxVoices: 1, minGapMs: 250, priority: 4, duckDb: 3,
  },
  turnStart: {
    fn: turnStart, label: 'Turn breath (sheet)', group: 'Stingers', tier: 'board', trimDb: -1.6, wet: 0.12,
    maxDur: 0.75, maxVoices: 1, minGapMs: 400, priority: 4, duckDb: 2,
  },
  continent: {
    fn: continent, label: 'Bowl · continent (A4)', group: 'Stingers', tier: 'swing', trimDb: 0, wet: 0.26,
    maxDur: 4.61, maxVoices: 1, minGapMs: 400, priority: 5, duckDb: 7, musical: true,
  },
  eliminated: {
    fn: eliminated, label: 'Bowl · elimination (D3)', group: 'Stingers', tier: 'drama', trimDb: 0, wet: 0.3,
    maxDur: 5.01, maxVoices: 1, minGapMs: 600, priority: 6, duckDb: 12, musical: true,
  },
  victory: {
    fn: victory, label: 'Bowl · victory (D5)', group: 'Stingers', tier: 'finale', trimDb: 0, wet: 0.3,
    maxDur: 6.61, maxVoices: 1, minGapMs: 2000, priority: 7, duckDb: 14, musical: true,
  },
};
