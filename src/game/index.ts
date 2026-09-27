// Controller entry (SPEC §7): createController + the pure helpers the UI/tests may want.
export { createController, type GameController, type RiskHooks, type Metrics, type UiSnapshot } from './controller';
export { explainTerritory, REASON_CODES, type ReasonCode, type Explanation } from './explain';
export { bestSet, occupyDefault, autoSource, oddsWord, autoChain } from './helpers';
export { createStubBoard } from './stubBoard';
export { mountDebugHud } from './debugHud';
