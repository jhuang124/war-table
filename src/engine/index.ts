// Public engine API. Pure TypeScript: runs in the browser and in Node.

export * from './types';
export * from './mapData';

export { createGame, defaultConfig, validateConfig, sanitizeConfig } from './setup';
export { applyAction, validateAction, cloneState } from './reducer';
export { legalActionsSummary, type LegalSummary, type TradeOption } from './summary';
export {
  reinforcementsFor,
  attackTargets,
  attackSources,
  fortifyTargets,
  fortifySources,
  fortifyPath,
  connectedPath,
  maxAttackDice,
  defendDiceFor,
  territoriesNeeded,
  territoryCount,
  totalArmies,
  ownedTerritories,
  ownsContinent,
  continentsOwned,
  continentOwners,
  checkWinner,
  turnLimitWinner,
  isTerritoryId,
  territoryName,
  isBorder,
  enemyNeighborArmies,
  alivePlayers,
} from './rules';
export {
  buildDeck,
  validSets,
  setValue,
  setValueFor,
  fixedSetValue,
  progressiveValue,
  isValidSetSymbols,
  bonusTerritoryFor,
  upcomingSetValues,
  WILD_CARD_IDS,
} from './cards';
export {
  winProbability,
  winProbabilityStopAt,
  blitzOdds,
  rollOutcomes,
  expectedRollLosses,
  type BlitzOdds,
} from './probability';
export { chooseAiAction, fallbackAction, PERSONAS, type Persona } from './ai';
export { nextRandom } from './rng';
