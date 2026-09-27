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
