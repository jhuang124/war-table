// Bottom sheets on phones (docs/MOBILE.md §5): a grab handle, drag-down (or a tap on the scrim) to
// dismiss, spring motion (~300 ms), reduced motion = fades. Desktop never calls these (its overlays stay
// as they are); every entry point checks `isPhone()`.

import { h, motion } from './dom';
import { isPhone } from './layout';

/** The iOS sheet curve: fast out of the gate, long soft settle. */
export const SHEET_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** One small overshoot when a dragged sheet springs back. */
export const SHEET_SPRING = 'cubic-bezier(0.34, 1.26, 0.64, 1)';

/** The grab handle: a 36×5 pill, centred at the top of the sheet (hidden off phones by CSS). */
export function grabHandle(testid?: string): HTMLDivElement {
  const g = h('div', 'grab');
  g.setAttribute('aria-hidden', 'true');
  if (testid) g.dataset.testid = testid;
  g.append(h('i'));
  return g;
}

/** Slide a sheet up from the bottom edge (and fade its scrim in). */
export function sheetIn(sheet: HTMLElement, scrim?: HTMLElement | null): void {
  resetSheet(sheet);
  if (scrim) scrim.style.opacity = '';
  if (typeof sheet.animate !== 'function') return;
  sheet.getAnimations().forEach((a) => a.cancel());
  if (motion.reduced) {
    sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  } else {
    sheet.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 340, easing: SHEET_EASE });
  }
  scrim?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
}

/** Clear what a slide-out left behind (parked transform / opacity). */
export function resetSheet(sheet: HTMLElement): void {
  sheet.style.transform = '';
  sheet.style.opacity = '';
}

/** Slide a sheet back down (from wherever a drag left it), fade the scrim, then `done`. */
export function sheetOut(sheet: HTMLElement, scrim: HTMLElement | null | undefined, done: () => void, fromPx?: number): void {
  if (typeof sheet.animate !== 'function') return done();
  const from = fromPx ?? currentY(sheet);
  const H = sheet.getBoundingClientRect().height || 400;
  const ms = motion.reduced ? 160 : Math.round(Math.max(140, Math.min(240, 240 * (1 - from / H))));
  const a = motion.reduced
    ? sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' })
    : sheet.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(100%)' }], { duration: ms, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
  scrim?.animate([{ opacity: scrim.style.opacity || 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
  a.onfinish = () => {
    // Stays parked off-screen until the owner hides it (and sheetIn brings it back): no flash.
    sheet.style.transform = motion.reduced ? '' : 'translateY(100%)';
    if (motion.reduced) sheet.style.opacity = '0';
    a.cancel();
    if (scrim) {
      scrim.getAnimations().forEach((x) => x.cancel());
      scrim.style.opacity = '0';
    }
    done();
  };
}

function currentY(el: HTMLElement): number {
  const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
  return m ? Number(m[1]) : 0;
}

export interface DragOpts {
  /** The drag only runs when this is true (phones). Default: isPhone(). */
  enabled?: () => boolean;
  /** The scrim that fades as the sheet is pulled down. */
  scrim?: () => HTMLElement | null;
  /** Called once the sheet has slid off (it sits at translateY(100%) until the owner hides it). */
  onDismiss: () => void;
}

/**
 * Drag-down-to-dismiss on the sheet's grab handle and header. A tap on a button inside a grip still
 * clicks; the drag starts after 6 px. Released past ~28 % of the sheet (or flicked down) it slides away
 * and calls onDismiss; otherwise it springs back.
 */
export function dragToDismiss(sheet: HTMLElement, grips: HTMLElement[], opts: DragOpts): void {
  const enabled = opts.enabled ?? isPhone;
  let start: { y: number; id: number; t: number } | null = null;
  let dragging = false;
  let samples: { y: number; t: number }[] = [];
  let H = 1;
  const down = (e: PointerEvent) => {
    if (!enabled() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target instanceof Element && e.target.closest('button, input, [role="slider"]')) return;
    start = { y: e.clientY, id: e.pointerId, t: e.timeStamp };
    dragging = false;
    samples = [{ y: e.clientY, t: e.timeStamp }];
    H = sheet.getBoundingClientRect().height || 400;
  };
  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dy) < 6) return;
      dragging = true;
      sheet.getAnimations().forEach((a) => a.cancel());
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
    e.preventDefault();
    // Down follows the finger; up resists (a rubber band of a fifth).
    const y = dy >= 0 ? dy : dy * 0.2;
    sheet.style.transform = `translateY(${y}px)`;
    const s = opts.scrim?.();
    if (s) s.style.opacity = String(Math.max(0, 1 - Math.max(0, y) / H));
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 6) samples.shift();
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const st = start;
    start = null;
    if (!dragging) return;
    dragging = false;
    const dy = Math.max(0, e.clientY - st.y);
    const a = samples[0];
    const v = a && e.timeStamp > a.t ? (e.clientY - a.y) / (e.timeStamp - a.t) : 0; // px / ms
    if (dy > Math.min(H * 0.28, 180) || (v > 0.55 && dy > 24)) {
      sheetOut(sheet, opts.scrim?.(), () => opts.onDismiss(), dy);
    } else {
      const from = currentY(sheet);
      sheet.style.transform = '';
      const s = opts.scrim?.();
      if (s) s.style.opacity = '';
      if (!motion.reduced && typeof sheet.animate === 'function')
        sheet.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }], { duration: 300, easing: SHEET_SPRING });
    }
  };
  for (const g of grips) {
    g.addEventListener('pointerdown', down);
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
    g.style.touchAction = 'none';
  }
}
