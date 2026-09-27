// Difficulty knobs. Everything the three AIs do differently is expressed here.

import type { AiDifficulty } from '../types';

export interface Persona {
  /** Minimum blitz win probability for an ordinary attack. */
  attackThreshold: number;
  /** Minimum win probability to grab one territory for the turn's card. */
  cardGrabThreshold: number;
  /** Weight on moving toward the continent we want to hold. */
  goalWeight: number;
  /** Bonus multiplier when a conquest completes a continent. */
  completeWeight: number;
  /** Multiplier on an opponent's continent bonus for breaking it. */
  breakWeight: number;
  /** Value of pushing toward eliminating a weak player (scaled by their cards). */
  elimWeight: number;
  /** Extra value on territories of the strongest opponent (anti-runaway). */
  leaderWeight: number;
  /** Share of each reinforcement spent shoring up owned-continent borders. */
  defenseShare: number;
  /** Penalty for leaving a freshly conquered territory exposed. */
  overextendCare: number;
  /** Keep armies home when attacking out of a threatened continent border. */
  keepReserve: boolean;
  /** Probability of bothering to fortify at all. */
  fortifyChance: number;
  /** Multiplicative noise on scores (0 = deterministic best). */
  noise: number;
  /** 'forced' = trade only when made to; 'eager' = whenever worthwhile; 'timed' = hold for need/value. */
  trade: 'forced' | 'eager' | 'timed';
  /** Easy spreads placements around instead of concentrating on one stack. */
  concentrate: boolean;
  /** Conquest-chain lookahead depth used to pick staging territories and attacks (0 = one step). */
  lookahead: number;
  /** Plan eliminations: commit reinforcements, cards, and lower attack thresholds to finish a weak player. */
  hunt: boolean;
  /** Size border garrisons so the strongest neighbor's blitz odds fall below this (0 = rough rule). */
  deter: number;
}

export const PERSONAS: Record<AiDifficulty, Persona> = {
  easy: {
    attackThreshold: 0.88,
    cardGrabThreshold: 0.93,
    goalWeight: 0.4,
    completeWeight: 0.6,
    breakWeight: 0.2,
    elimWeight: 0.3,
    leaderWeight: 0,
    defenseShare: 0,
    overextendCare: 0,
    keepReserve: false,
    fortifyChance: 0.4,
    noise: 0.6,
    trade: 'forced',
    concentrate: false,
    lookahead: 0,
    hunt: false,
    deter: 0,
  },
  normal: {
    attackThreshold: 0.6,
    cardGrabThreshold: 0.72,
    goalWeight: 1,
    completeWeight: 1.5,
    breakWeight: 0.6,
    elimWeight: 1,
    leaderWeight: 0.3,
    defenseShare: 0.35,
    overextendCare: 0.3,
    keepReserve: false,
    fortifyChance: 1,
    noise: 0.12,
    trade: 'eager',
    concentrate: true,
    lookahead: 0,
    hunt: false,
    deter: 0,
  },
  hard: {
    attackThreshold: 0.58,
    cardGrabThreshold: 0.66,
    goalWeight: 1.2,
    completeWeight: 2.2,
    breakWeight: 1.4,
    elimWeight: 2.2,
    leaderWeight: 0.8,
    defenseShare: 0.45,
    overextendCare: 1,
    keepReserve: true,
    fortifyChance: 1,
    noise: 0.03,
    trade: 'timed',
    concentrate: true,
    lookahead: 4,
    hunt: true,
    deter: 0.3,
  },
};
