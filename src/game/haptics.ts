// Haptics (docs/MOBILE.md §3): a light tick on select, a short buzz when the dice land, a stronger one
// on a conquest or a knockout. navigator.vibrate exists on Android Chrome; everywhere else (iOS Safari,
// desktops, Node tests) this is a silent no-op. Only touch devices buzz, and never faster than the
// throttle, so a blitz reads as a patter, not a drone.

export type HapticKind = 'select' | 'dice' | 'conquest' | 'eliminated';

const PATTERN: Record<HapticKind, number | number[]> = {
  select: 8,
  dice: 18,
  conquest: [28, 40, 36],
  eliminated: [40, 50, 60, 50, 80],
};
const GAP_MS: Record<HapticKind, number> = { select: 60, dice: 140, conquest: 250, eliminated: 400 };

export interface Haptics {
  play(kind: HapticKind): void;
  /** Turn haptics on / off (off while autoplay drives the game). */
  enabled: boolean;
}

export function createHaptics(touch: boolean): Haptics {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }) : null;
  const can = touch && !!nav && typeof nav.vibrate === 'function';
  const last: Partial<Record<HapticKind, number>> = {};
  const h: Haptics = {
    enabled: true,
    play(kind) {
      if (!can || !h.enabled) return;
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (now - (last[kind] ?? -1e9) < GAP_MS[kind]) return;
      last[kind] = now;
      try {
        nav!.vibrate!(PATTERN[kind]);
      } catch {
        /* a blocked vibrate (no user activation yet) is fine */
      }
    },
  };
  return h;
}
