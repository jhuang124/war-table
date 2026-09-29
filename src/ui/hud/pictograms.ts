// Card pictures (UX.md §7.5): the board's own ivory brush figures — soldier, rider, cannon — so a card
// reads as the piece it stands for; the wild card is the ensō. Never told apart by colour. The figures
// are the unit sprites trimmed and downscaled to ~190 px WebP (public/icons/unit-*.webp, ~10 KB each).

import type { CardSymbol } from '../../engine/types';
import { ensoEl, h } from '../dom';

const SPRITE: Partial<Record<CardSymbol, string>> = {
  infantry: 'soldier',
  cavalry: 'rider',
  artillery: 'cannon',
};

export const SYMBOL_NAME: Record<CardSymbol, string> = {
  infantry: 'Infantry',
  cavalry: 'Cavalry',
  artillery: 'Artillery',
  wild: 'Wild',
};

/** URL of a figure sprite ('soldier' | 'rider' | 'cannon'), relative to the app (Pages subpath safe). */
export function unitSrc(name: 'soldier' | 'rider' | 'cannon'): string {
  return `${import.meta.env.BASE_URL}icons/unit-${name}.webp`;
}

/** The picture for a card symbol: a figure, or the ensō for a wild. */
export function pictogram(symbol: CardSymbol, cls = 'picto'): HTMLElement {
  const wrap = h('span', `${cls} picto-${symbol}`);
  wrap.setAttribute('aria-hidden', 'true');
  const sprite = SPRITE[symbol];
  if (sprite) {
    const img = h('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.src = unitSrc(sprite as 'soldier');
    wrap.append(img);
  } else wrap.append(ensoEl(7, 'enso', { small: true }));
  return wrap;
}
