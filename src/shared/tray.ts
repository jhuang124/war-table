// Dice-tray geometry, shared by the renderer (src/render/dice.ts draws the tray) and the HUD
// (src/ui/index.ts sizes the battle band so its text strips sit exactly above and below the tray).
// One formula in one place, so the two can never drift apart. All values are CSS px.

export interface TrayGeometry {
  /** Tray width: min(720 px, 70vw). */
  trayW: number;
  /** Die edge: 8vh × UI scale (min 56 px), capped by the band and by the tray width (5 dice + gaps). */
  die: number;
  /** Tray height: the die plus room for the tumble and the verdict lift. Centred in the band. */
  trayH: number;
}

export function trayGeometry(W: number, H: number, band: number, uiScale: number): TrayGeometry {
  const trayW = Math.min(720, W * 0.7);
  let die = Math.max(56, Math.min(H * 0.08 * uiScale, band * 0.56));
  die = Math.max(40, Math.min(die, (trayW - 24) / 9.4));
  const trayH = Math.min(band, Math.round(die * 1.9 + 8));
  return { trayW, die, trayH };
}

/**
 * The tray the board actually draws (mirrors `boardTrayGeometry` in src/render/dice.ts, mobile pass):
 * below 520 px wide the tray runs full width (minus 12 px a side) and the dice shrink to fit it; it is
 * never taller than the shared formula. The HUD sizes the band and the fight header from this.
 */
export function boardTrayGeometry(W: number, H: number, band: number, uiScale: number): TrayGeometry {
  const g = trayGeometry(W, H, band, uiScale);
  if (W >= 520) return g;
  const trayW = Math.max(g.trayW, W - 24);
  const die = Math.min(g.die, (trayW - 24) / 9.4);
  const trayH = Math.min(g.trayH, Math.round(die * 1.9 + 8));
  return { trayW, die, trayH };
}

/** Ink-tray die spacing (in die edges): the mid gap between the sides, die to die, and the rim padding. */
export const INK_TRAY_MID_GAP = 0.55;
export const INK_TRAY_STEP = 1.2;
export const INK_TRAY_PAD = 0.42;

/**
 * The tray the board draws (INK review F2): sized to the dice with a little padding, and small — about
 * 420 × 90 px at 1440 × 900, under half the width on a landscape phone, about two thirds of it in
 * portrait. Never taller than the HUD's band tray. All CSS px.
 */
export function inkTrayGeometry(W: number, H: number, band: number, uiScale: number): TrayGeometry {
  const hud = boardTrayGeometry(W, H, band, uiScale);
  const compact = Math.min(W, H) < 520;
  const maxW = compact ? (W > H ? 0.44 * W : 0.72 * W) : Math.min(560 * uiScale, 0.46 * W);
  const span = 2 * (INK_TRAY_MID_GAP + 0.5 + 2 * INK_TRAY_STEP + 0.5 + INK_TRAY_PAD); // tray width in die edges
  // Landscape phones: the dice (and the ring) at ~80 %, so fewer army counts hide under them mid-roll.
  let die = compact ? Math.min(W, H) * (W > H ? 0.069 : 0.086) : H * 0.052 * uiScale;
  die = Math.min(die, (maxW - 8) / span, hud.die, (hud.trayH - 8) / 1.75);
  die = Math.max(compact ? 26 : 34, die);
  const trayW = Math.round(die * span + 8);
  const trayH = Math.min(hud.trayH, Math.round(die * 1.75 + 8));
  return { trayW, die, trayH };
}

/** Portrait phones: the drawn tray's bottom sits this far above the band's bottom (the dock's line). */
const PORTRAIT_TRAY_GAP = 10;

/**
 * Where the drawn tray sits in the band: the distance from the band's bottom up to the drawn tray's top
 * edge, CSS px. The renderer places the tray with it and the HUD rests the fight header on it, so the
 * header always sits on the rim. Usually the drawn tray is top-aligned with the HUD's band tray (centred
 * in the band). A portrait phone's band is tall (it grows to clear the two-row dock), so there the tray
 * drops to the band's bottom, into the open southern ocean, instead of floating over Africa.
 */
export function inkTrayTop(W: number, H: number, band: number, uiScale: number): number {
  const ink = inkTrayGeometry(W, H, band, uiScale);
  if (Math.min(W, H) < 520) return Math.min(band, ink.trayH + PORTRAIT_TRAY_GAP);
  const hud = boardTrayGeometry(W, H, band, uiScale);
  return Math.floor((band - hud.trayH) / 2) + hud.trayH;
}

/** The ink ring's long-axis overshoot past the tray box (docs/INK2.md §2.3: 6 %). */
export const INK_RING_OVERSHOOT = 0.06;

/**
 * The ink ring the dice land inside (docs/INK2.md §2.3): an ellipse inscribed in the ink tray's box with
 * a 6 % overshoot on the long axis. `rx`/`ry` are the radii of the brush's centre line, CSS px; its top
 * is the tray's top, so the fight header still rests on it.
 */
export function inkRingGeometry(W: number, H: number, band: number, uiScale: number): { rx: number; ry: number } {
  const g = inkTrayGeometry(W, H, band, uiScale);
  return { rx: (g.trayW * (1 + INK_RING_OVERSHOOT)) / 2, ry: g.trayH / 2 };
}
