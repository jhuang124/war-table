// Card pictograms (UX.md §7.5): distinct silhouettes, never told apart by color. 48x48 viewBox, ink fill.

import type { CardSymbol } from '../../engine/types';

const PATHS: Record<CardSymbol, string> = {
  // A standing soldier with a shouldered rifle.
  infantry:
    '<circle cx="22" cy="10.5" r="5.2"/>' +
    '<path d="M13.5 44 L15 27.5 Q15.6 19.5 22 18.6 Q28.4 19.5 29 27.5 L30.5 44 H25 L22 32 L19 44 Z"/>' +
    '<path d="M31.2 5.5 L33.6 6.1 L29.6 38 L27.4 37.6 Z"/>',
  // A horse's head and neck (knight silhouette).
  cavalry:
    '<path d="M13 44 Q12.5 36 17 30.5 Q13.2 28.8 10.6 25.2 Q9.6 23.4 11.2 22 L19.8 14.2 Q21.6 9 25 7.4 L25.8 3.6 L29 7.2 Q37.6 10.2 39 21.6 Q39.9 31 36.2 44 Z"/>' +
    '<circle cx="24.6" cy="14.6" r="1.7" fill="var(--card-bg, #ece2c8)"/>',
  // A field cannon: barrel, carriage and a spoked wheel.
  artillery:
    '<path d="M9.2 22.4 L38.6 12.2 Q41.4 11.4 42.2 14 Q42.8 16.6 40.2 17.6 L12.4 30.2 Z"/>' +
    '<path d="M16 29 L6 40 L8.8 42 L20.4 31 Z"/>' +
    '<circle cx="23" cy="33" r="9.4" fill="none" stroke="currentColor" stroke-width="3.2"/>' +
    '<circle cx="23" cy="33" r="2.6"/>' +
    '<path d="M23 23.6 V42.4 M13.6 33 H32.4 M16.4 26.4 L29.6 39.6 M29.6 26.4 L16.4 39.6" stroke="currentColor" stroke-width="1.8"/>',
  // An eight-point compass star: any symbol.
  wild:
    '<path d="M24 3 L27.4 18.4 L40.2 7.8 L29.6 20.6 L45 24 L29.6 27.4 L40.2 40.2 L27.4 29.6 L24 45 L20.6 29.6 L7.8 40.2 L18.4 27.4 L3 24 L18.4 20.6 L7.8 7.8 L20.6 18.4 Z"/>',
};

export const SYMBOL_NAME: Record<CardSymbol, string> = {
  infantry: 'Infantry',
  cavalry: 'Cavalry',
  artillery: 'Artillery',
  wild: 'Wild',
};

export function pictogram(symbol: CardSymbol, cls = 'picto'): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('class', `${cls} picto-${symbol}`);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[symbol];
  return s;
}
