// A model of the renderer's event durations at 1× (UX.md §8.2), for the stub board's simulated mode
// and the reel-scheduling unit tests. The real renderer owns the real numbers; this only lets the
// controller's pacing be measured without WebGL.

import type { GameEvent } from '../engine';
import type { PlayEventOptions } from '../render/BoardView';

const BLITZ_CAP = 3000;

function diceMs(opts: PlayEventOptions | undefined): number {
  const seq = opts?.seq;
  if (opts?.style === 'brief') {
    // arrow 150 + hit ticks ≤ 400 in total across the engagement.
    const count = seq?.count ?? 1;
    const ticks = 400 / count;
    return (seq?.index ?? 0) === 0 ? 150 + ticks : ticks;
  }
  if (!seq || seq.count <= 1) return 1200;
  const { index, count } = seq;
  if (index === 0) return 700;
  if (index === count - 1) return 700;
  // Middle rolls: max(180, 600 × 0.75^(k−1)), scaled uniformly to fit the cap (floor 120).
  let total = 1400;
  for (let k = 1; k < count - 1; k++) total += Math.max(180, 600 * Math.pow(0.75, k - 1));
  const mid = Math.max(180, 600 * Math.pow(0.75, index - 1));
  if (total <= BLITZ_CAP) return mid;
  const scale = (BLITZ_CAP - 1400) / (total - 1400);
  return Math.max(120, mid * scale);
}

/** Duration in ms of one playEvent at speed 1. */
export function eventDurationMs(e: GameEvent, opts?: PlayEventOptions): number {
  const brief = opts?.style === 'brief';
  switch (e.type) {
    case 'diceRolled':
      return diceMs(opts);
    case 'territoryConquered':
      return brief ? 250 : 650;
    case 'armiesMoved':
      if (e.reason === 'fortify') return Math.min(900, 220 * Math.max(1, (e.path?.length ?? 2) - 1));
      // An inline march is part of the conquest's 650 ms; a manual-count occupy move is 400 ms.
      return brief || opts?.inlineMarch ? 0 : 400;
    case 'continentGained':
      return 1150;
    case 'continentLost':
      return 300;
    case 'playerEliminated':
      return 1600;
    case 'cardsCaptured':
      return 300;
    case 'cardsTraded':
      return 400;
    case 'territoriesDealt':
      return 2500;
    case 'gameOver':
      return 2400;
    case 'armiesPlaced':
      return 290;
    case 'territoryClaimed':
      return 250;
    case 'turnStarted':
      return 0;
    default:
      return 0;
  }
}

/** Scale by animation speed: 2× halves (floor 80 ms), 0 = instant. */
export function scaledDuration(ms: number, speed: number): number {
  if (speed <= 0 || ms <= 0) return 0;
  if (speed === 1) return ms;
  return Math.max(80, ms / speed);
}
