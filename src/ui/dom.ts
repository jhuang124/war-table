// Tiny DOM helpers for the HUD. No framework: components keep their elements and patch them.

import { EMBLEM_PATHS, PLAYER_COLORS } from '../shared/palette';
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

/** Signed number with a real minus (U+2212). */
export function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}

/** Replace ASCII hyphen-minus before a digit with U+2212 (defensive: copy should already use it). */
export function minus(s: string): string {
  return s.replace(/(^|[\s(])-(?=\d)/g, '$1−');
}

export const EASE_OUT_QUART = 'cubic-bezier(0.25, 1, 0.5, 1)';
export const EASE_IN_QUAD = 'cubic-bezier(0.11, 0, 0.5, 0)';
export const EASE_OUT_CUBIC = 'cubic-bezier(0.33, 1, 0.68, 1)';
/** One small overshoot (turn banner spring). */
export const EASE_SPRING = 'cubic-bezier(0.34, 1.36, 0.64, 1)';

/** Shared motion flag, set by the root on every ViewModel. */
export const motion = { reduced: false };

/** Enter: fade + travel (no travel under reduced motion). */
export function animateIn(el: HTMLElement, opts: { ms?: number; dy?: number; dx?: number; easing?: string; scale?: number } = {}): Animation | null {
  const ms = opts.ms ?? 220;
  const dy = motion.reduced ? 0 : (opts.dy ?? 12);
  const dx = motion.reduced ? 0 : (opts.dx ?? 0);
  const sc = motion.reduced ? 1 : (opts.scale ?? 1);
  if (typeof el.animate !== 'function') return null;
  return el.animate(
    [
      { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${sc})` },
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
    ],
    { duration: ms, easing: opts.easing ?? EASE_OUT_QUART },
  );
}

/** Exit, then remove (or hide) the element. */
export function animateOut(
  el: HTMLElement,
  opts: { ms?: number; dy?: number; dx?: number; remove?: boolean } = {},
  done?: () => void,
): void {
  const ms = opts.ms ?? 140;
  const dy = motion.reduced ? 0 : (opts.dy ?? 8);
  const dx = motion.reduced ? 0 : (opts.dx ?? 0);
  const finish = () => {
    if (opts.remove !== false) el.remove();
    done?.();
  };
  if (typeof el.animate !== 'function') return finish();
  const a = el.animate(
    [
      { opacity: 1, transform: 'translate(0, 0)' },
      { opacity: 0, transform: `translate(${dx}px, ${dy}px)` },
    ],
    { duration: ms, easing: EASE_IN_QUAD, fill: 'forwards' },
  );
  a.onfinish = finish;
}

/** Small attention pop (single increments). */
export function pop(el: Element, scale = 1.12, ms = 160): void {
  if (motion.reduced || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
    { duration: ms, easing: 'ease-out' },
  );
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

/** Text for a Cinzel title: numerals (and their sign) are set in Inter, since numbers are never Cinzel. */
export function titleText(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const part of minus(text).split(/([+\u2212]?\d[\d,.]*%?)/)) {
    if (!part) continue;
    if (/\d/.test(part)) f.append(h('span', 'title-num', part));
    else f.append(document.createTextNode(part));
  }
  return f;
}
