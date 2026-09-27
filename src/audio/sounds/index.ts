// The sound registry: every SfxName → how it's built, how loud it sits, and how it behaves under load.
// `trimDb` values are measured, not guessed: run the lab's "Analyze" (or the verify script), which
// renders each sound offline and suggests the trim that lands it on its tier's loudness target.

import type { SfxMeta, SfxName } from '../types';
import { hit } from './battle';
import { cardTrade, conquer, continent, eliminated, turnStart, victory } from './brass';
import { diceLand, diceShake } from './dice';
import { cardDraw, whoosh } from './paper';
import { march, place, uiClick, uiError, uiHover, unplace } from './wood';

export const SFX: Record<SfxName, SfxMeta> = {
  uiHover: {
    fn: uiHover, label: 'UI hover', group: 'UI', tier: 'micro', trimDb: -16.8, wet: 0.02,
    maxDur: 0.07, maxVoices: 1, minGapMs: 90, priority: 0,
  },
  uiClick: {
    fn: uiClick, label: 'UI click', group: 'UI', tier: 'ui', trimDb: -5.7, wet: 0.04,
    maxDur: 0.11, maxVoices: 3, minGapMs: 25, priority: 2, densityDb: 2, densityMaxDb: 4,
  },
  uiError: {
    fn: uiError, label: 'UI error', group: 'UI', tier: 'ui', trimDb: -14.3, wet: 0.06,
    maxDur: 0.41, maxVoices: 1, minGapMs: 150, priority: 3,
  },
  whoosh: {
    fn: whoosh, label: 'Whoosh (camera)', group: 'UI', tier: 'ui', trimDb: -9.9, wet: 0.1,
    maxDur: 0.67, maxVoices: 2, minGapMs: 120, priority: 1, duration: [0.2, 1.5, 0.6],
  },
  place: {
    fn: place, label: 'Place army', group: 'Board', tier: 'board', trimDb: -8.6, wet: 0.1,
    maxDur: 0.31, maxVoices: 5, minGapMs: 30, priority: 2, densityDb: 1.2, densityMaxDb: 5,
  },
  unplace: {
    fn: unplace, label: 'Take army back', group: 'Board', tier: 'board', trimDb: -5.5, wet: 0.08,
    maxDur: 0.23, maxVoices: 3, minGapMs: 30, priority: 2, densityDb: 1.2, densityMaxDb: 4,
  },
  march: {
    fn: march, label: 'March / fortify', group: 'Board', tier: 'board', trimDb: -8.3, wet: 0.1,
    maxDur: 0.67, maxVoices: 3, minGapMs: 60, priority: 2, densityDb: 2, densityMaxDb: 4,
    duration: [0.12, 1.2, 0.5],
  },
  diceShake: {
    fn: diceShake, label: 'Dice shake', group: 'Battle', tier: 'board', trimDb: -4.1, wet: 0.08,
    maxDur: 0.25, maxVoices: 1, minGapMs: 80, priority: 2, duration: [0.06, 1.5, 0.15],
  },
  diceLand: {
    fn: diceLand, label: 'Die lands (one die)', group: 'Battle', tier: 'die', trimDb: -2.8, wet: 0.1,
    maxDur: 0.25, maxVoices: 6, minGapMs: 12, priority: 3, densityDb: 0.6, densityMaxDb: 2.5,
  },
  hit: {
    fn: hit, label: 'Hit (distant cannon)', group: 'Battle', tier: 'cue', trimDb: -9.8, wet: 0.22,
    maxDur: 1.11, maxVoices: 3, minGapMs: 60, priority: 3, densityDb: 2.5, densityMaxDb: 6,
  },
  conquer: {
    fn: conquer, label: 'Conquer', group: 'Stingers', tier: 'cue', trimDb: -10.7, wet: 0.25,
    maxDur: 1.3, maxVoices: 2, minGapMs: 150, priority: 4, duckDb: 3, densityDb: 3, densityMaxDb: 6, musical: true,
  },
  cardDraw: {
    fn: cardDraw, label: 'Card drawn', group: 'Cards', tier: 'board', trimDb: 0.7, wet: 0.06,
    maxDur: 0.31, maxVoices: 3, minGapMs: 50, priority: 2, densityDb: 1.5, densityMaxDb: 4,
  },
  cardTrade: {
    fn: cardTrade, label: 'Cards traded', group: 'Cards', tier: 'cue', trimDb: -9.5, wet: 0.14,
    maxDur: 1.0, maxVoices: 1, minGapMs: 250, priority: 4, duckDb: 3, musical: true,
  },
  turnStart: {
    fn: turnStart, label: 'Turn start', group: 'Stingers', tier: 'cue', trimDb: -11.6, wet: 0.25,
    maxDur: 1.0, maxVoices: 1, minGapMs: 400, priority: 4, duckDb: 3, musical: true,
  },
  continent: {
    fn: continent, label: 'Continent', group: 'Stingers', tier: 'swing', trimDb: -12.5, wet: 0.3,
    maxDur: 2.7, maxVoices: 1, minGapMs: 400, priority: 5, duckDb: 6, musical: true,
  },
  eliminated: {
    fn: eliminated, label: 'Player eliminated', group: 'Stingers', tier: 'drama', trimDb: -8.8, wet: 0.32,
    maxDur: 2.4, maxVoices: 1, minGapMs: 600, priority: 6, duckDb: 8, musical: true,
  },
  victory: {
    fn: victory, label: 'Victory', group: 'Stingers', tier: 'finale', trimDb: -12.7, wet: 0.3,
    maxDur: 7.0, maxVoices: 1, minGapMs: 2000, priority: 7, duckDb: 12, musical: true,
  },
};
