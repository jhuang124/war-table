// Device class, by capability (docs/MOBILE.md): never the user agent.
//   phone   — a phone-sized viewport (short side ≤ 540, long side ≤ 1000), either orientation: the dock,
//             compact seat pills, bottom sheets, the single-column screens.
//   tablet  — a coarse primary pointer on anything bigger: the desktop layout with 44 px targets.
//   desktop — everything else: exactly the round-2 layout.
// The classes go on <html> (index.html sets them before first paint; this keeps them current):
//   form-phone | form-tablet | form-desktop, portrait | landscape, touch (pointer: coarse).

import { isPhoneViewport } from './uiScale';

export type Form = 'phone' | 'tablet' | 'desktop';

export interface Layout {
  form: Form;
  portrait: boolean;
  touch: boolean;
  /**
   * The bottom dock stacks (track / line / actions): portrait phones, and portrait tablets too narrow for
   * the desktop strip (an iPad at 834 px). Class `dock-stacked`.
   */
  stacked: boolean;
}

function coarse(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function detectLayout(w = window.innerWidth, h = window.innerHeight, touch = coarse()): Layout {
  const form: Form = isPhoneViewport(w, h) ? 'phone' : touch ? 'tablet' : 'desktop';
  const portrait = h > w;
  const stacked = portrait && (form === 'phone' || (form === 'tablet' && w < 1100));
  return { form, portrait, touch, stacked };
}

export const layout: Layout = typeof window !== 'undefined' ? detectLayout() : { form: 'desktop', portrait: false, touch: false, stacked: false };

const subs = new Set<(l: Layout) => void>();

/** Called on every change of form or orientation. */
export function onLayout(fn: (l: Layout) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function applyLayoutClasses(l: Layout = layout): void {
  const c = document.documentElement.classList;
  for (const f of ['phone', 'tablet', 'desktop'] as const) c.toggle(`form-${f}`, l.form === f);
  c.toggle('portrait', l.portrait);
  c.toggle('landscape', !l.portrait);
  c.toggle('touch', l.touch);
  c.toggle('dock-stacked', l.stacked);
}

let installed = false;
/** Keep `layout` and the <html> classes current (resize, rotation, a pointer change). */
export function installLayout(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const update = () => {
    const next = detectLayout();
    if (next.form === layout.form && next.portrait === layout.portrait && next.touch === layout.touch && next.stacked === layout.stacked) return;
    Object.assign(layout, next);
    applyLayoutClasses();
    for (const fn of subs) fn(layout);
  };
  applyLayoutClasses();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  try {
    matchMedia('(pointer: coarse)').addEventListener('change', update);
  } catch {
    /* old Safari */
  }
}

export const isPhone = (): boolean => layout.form === 'phone';
