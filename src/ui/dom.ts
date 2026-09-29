// Tiny DOM helpers for the HUD. No framework: components keep their elements and patch them.

import { EMBLEM_PATHS, PLAYER_COLORS } from '../shared/palette';
import { ensoPath, type EnsoShape } from '../shared/enso';
import type { PlayerColorId } from '../engine/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

/** Write text only when it changed (keeps text nodes, avoids style recalcs). */
export function setText(el: Element, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function setStyle(el: HTMLElement | SVGElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

/** Seat emblem as inline SVG (EMBLEM_PATHS, 24x24), filled with the seat's light tint by default. */
export function emblem(color: PlayerColorId, cls = 'emb', tint: 'light' | 'base' | 'ink' = 'light'): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' });
  const p = svg('path', { d: EMBLEM_PATHS[PLAYER_COLORS[color].emblem] });
  s.appendChild(p);
  s.style.color = PLAYER_COLORS[color][tint];
  return s;
}

/** Re-point an existing emblem svg at another seat color. */
export function setEmblem(s: SVGSVGElement, color: PlayerColorId, tint: 'light' | 'base' | 'ink' = 'light'): void {
  const p = s.firstChild as SVGPathElement;
  const d = EMBLEM_PATHS[PLAYER_COLORS[color].emblem];
  if (p.getAttribute('d') !== d) p.setAttribute('d', d);
  setStyle(s, 'color', PLAYER_COLORS[color][tint]);
}

/** Replace ASCII hyphen-minus before a digit with U+2212 (defensive: copy should already use it). */
export function minus(s: string): string {
  return s.replace(/(^|[\s(])-(?=\d)/g, '$1−');
}

/** The brush: fast, sure, long soft landing (docs/INK.md B4). Things are drawn in with it. */
export const EASE_BRUSH = 'cubic-bezier(0.2, 0.9, 0.2, 1)';
/** Kept for older call sites: the same brush curve (nothing slides or overshoots any more). */
export const EASE_OUT_QUART = EASE_BRUSH;
/** Drying out: easeInQuad, always shorter than the way in. */
export const EASE_IN_QUAD = 'cubic-bezier(0.11, 0, 0.5, 0)';
/** Kept for older call sites; no overshoot in the ink language (only phone sheets spring, ≤ 2 %). */
export const EASE_SPRING = EASE_BRUSH;
export const MS_IN = 240;
export const MS_OUT = 160;

/** Shared motion flag, set by the root on every ViewModel. */
export const motion = { reduced: false };

/**
 * Draw an element in: a soft-edged mask sweeps across it (left → right, like a brush), with the ink
 * coming up from pale. Never a slide or a scale. Reduced motion: a 150 ms fade. The class is removed
 * when it finishes, so nothing stays masked.
 */
export function drawIn(el: HTMLElement | SVGElement, ms = MS_IN, delay = 0): void {
  if (typeof (el as HTMLElement).animate !== 'function') return;
  el.classList.remove('ink-in');
  if (motion.reduced) {
    (el as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay, easing: 'ease-out', fill: 'backwards' });
    return;
  }
  (el as HTMLElement).style.setProperty('--ink-ms', `${ms}ms`);
  (el as HTMLElement).style.setProperty('--ink-delay', `${delay}ms`);
  void (el as HTMLElement).getBoundingClientRect();
  el.classList.add('ink-in');
  const done = (e: Event) => {
    if ((e as AnimationEvent).animationName !== 'ink-in') return;
    el.classList.remove('ink-in');
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

/** Enter: drawn in (the old travel/scale options are ignored: nothing slides or scales). */
export function animateIn(el: HTMLElement, opts: { ms?: number; dy?: number; dx?: number; easing?: string; scale?: number } = {}): Animation | null {
  if (typeof el.animate !== 'function') return null;
  const ms = motion.reduced ? 150 : (opts.ms ?? MS_IN);
  return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASE_BRUSH });
}

/** Exit: the ink dries out (alpha, easeInQuad), then remove (or hide) the element. */
export function animateOut(
  el: HTMLElement,
  opts: { ms?: number; dy?: number; dx?: number; remove?: boolean } = {},
  done?: () => void,
): void {
  const ms = opts.ms ?? MS_OUT;
  const finish = () => {
    if (opts.remove !== false) el.remove();
    done?.();
  };
  if (typeof el.animate !== 'function') return finish();
  const a = el.animate([{ opacity: getComputedStyle(el).opacity || 1 }, { opacity: 0 }], { duration: ms, easing: EASE_IN_QUAD, fill: 'forwards' });
  a.onfinish = () => {
    finish();
    a.cancel();
  };
}

/** A number re-inks: it dips pale and comes back (no scale). */
export function pop(el: Element, _scale = 1.12, ms = 220): void {
  if (motion.reduced || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: ms, easing: EASE_BRUSH });
}

/** Count a number element from `from` to `to` over 400 ms (easeOutCubic). Returns a cancel fn. */
export function countUp(el: Element, from: number, to: number, fmt: (n: number) => string = String, ms = 400): () => void {
  if (motion.reduced) {
    setText(el, fmt(to));
    return () => {};
  }
  const t0 = performance.now();
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    setText(el, fmt(Math.round(from + (to - from) * e)));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Title text with the minus sign fixed (one family now: numerals are the serif's lining figures). */
export function titleText(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(document.createTextNode(minus(text)));
  return f;
}

// ---------------------------------------------------------------------------
// The ensō (src/shared/enso.ts) as live SVG
// ---------------------------------------------------------------------------

const ensoCache = new Map<string, EnsoShape>();
function shape(seed: number, small: boolean): EnsoShape {
  const k = `${seed}:${small ? 's' : 'l'}`;
  let e = ensoCache.get(k);
  if (!e) {
    e = ensoPath(seed, small ? { bristles: 3, samples: 64, weight: 1.25 } : {});
    if (ensoCache.size > 40) ensoCache.clear();
    ensoCache.set(k, e);
  }
  return e;
}

let maskSeq = 0;
/**
 * An ensō element (fill = currentColor). `small` = a lighter path for marks under ~48 px. `drawable`
 * adds a mask along the brush's spine so `drawEnso` can paint it in, stroke-first.
 */
export function ensoEl(seed: number, cls = 'enso', opts: { small?: boolean; drawable?: boolean } = {}): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 100 100', class: cls, 'aria-hidden': 'true' });
  setEnso(s, seed, opts);
  return s;
}

/** Re-seed an existing ensō element. */
export function setEnso(s: SVGSVGElement, seed: number, opts: { small?: boolean; drawable?: boolean } = {}): void {
  const key = `${seed}:${opts.small ? 1 : 0}:${opts.drawable ? 1 : 0}`;
  if (s.dataset.enso === key) return;
  s.dataset.enso = key;
  const e = shape(seed, !!opts.small);
  s.textContent = '';
  const p = svg('path', { d: e.d, fill: 'currentColor' });
  if (opts.drawable) {
    const id = `enso-m${++maskSeq}`;
    const defs = svg('defs');
    const m = svg('mask', { id, maskUnits: 'userSpaceOnUse', x: '-10', y: '-10', width: '120', height: '120' });
    const sp = svg('path', { d: e.spine, fill: 'none', stroke: '#fff', 'stroke-width': '16', 'stroke-linecap': 'round', class: 'enso-spine' });
    sp.style.strokeDasharray = `${e.length + 4}`;
    sp.style.strokeDashoffset = '0';
    m.append(sp);
    defs.append(m);
    p.setAttribute('mask', `url(#${id})`);
    s.append(defs);
  }
  s.append(p);
}

/** Paint a drawable ensō in along its spine (the brush goes round once), `ms` long. */
export function drawEnso(s: SVGSVGElement, ms = 900, delay = 0): void {
  const sp = s.querySelector<SVGPathElement>('.enso-spine');
  if (!sp || motion.reduced || typeof sp.animate !== 'function') {
    if (typeof s.animate === 'function') s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay, fill: 'backwards' });
    return;
  }
  const len = parseFloat(sp.style.strokeDasharray) || 240;
  sp.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms, delay, easing: 'cubic-bezier(0.45, 0.05, 0.3, 1)', fill: 'backwards' });
}

/** A stable small hash for seeding marks from names and ids. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000003;
}
