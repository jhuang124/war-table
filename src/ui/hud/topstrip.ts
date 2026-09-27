// Top strip (docs/SIMPLIFY.md §1): the roster as one chip per seat, in turn order, and the menu.
//   ▲ John 14   ● Cobalt 11   ◆ Amber 9 🂠 3   ✚ Rose 8                                   ≡
// The current seat's chip is filled in its color; the others are outlined; an eliminated seat is struck
// through and dimmed. A card count shows only at 3+ cards.

import type { SeatChipVM, UiIntent } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { emblem, h, pop, setEmblem, setStyle, setText, toggle } from '../dom';

const CARD_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2" width="9" height="12" rx="1.6"/></svg>';

class Chip {
  readonly el: HTMLDivElement;
  private emb: SVGSVGElement;
  private name: HTMLSpanElement;
  private terr: HTMLSpanElement;
  private cards: HTMLSpanElement;
  private cardsN: HTMLSpanElement;
  private vm: SeatChipVM | null = null;

  constructor() {
    this.el = h('div', 'seat-chip');
    this.emb = emblem('crimson', 'emb');
    this.name = h('span', 'sc-name');
    this.terr = h('span', 'sc-terr num');
    this.cards = h('span', 'sc-cards num');
    this.cards.innerHTML = CARD_GLYPH;
    this.cardsN = h('span', '');
    this.cards.append(this.cardsN);
    this.el.append(this.emb, this.name, this.terr, this.cards);
  }

  update(vm: SeatChipVM): void {
    if (this.vm === vm) return;
    const prev = this.vm;
    this.vm = vm;
    const pal = PLAYER_COLORS[vm.seat.color];
    setStyle(this.el, '--seat', pal.base);
    setStyle(this.el, '--seat-light', pal.light);
    setStyle(this.el, '--seat-ink', pal.ink);
    setEmblem(this.emb, vm.seat.color, vm.current ? 'ink' : 'light');
    setText(this.name, vm.seat.name);
    setText(this.terr, String(vm.territories));
    toggle(this.el, 'current', vm.current);
    toggle(this.el, 'out', vm.eliminated);
    toggle(this.cards, 'hidden', vm.cards === null);
    setText(this.cardsN, String(vm.cards ?? ''));
    this.el.dataset.testid = `seat-${vm.seat.id}`;
    this.el.setAttribute(
      'aria-label',
      vm.eliminated ? `${vm.seat.name}, out` : `${vm.seat.name}: ${vm.territories} territories${vm.cards ? `, ${vm.cards} cards` : ''}`,
    );
    if (prev && prev.territories !== vm.territories && !vm.eliminated) pop(this.terr, 1.2);
    if (prev && !prev.current && vm.current) pop(this.el, 1.05, 240);
  }
}

export class TopStrip {
  readonly el: HTMLElement;
  private seats: HTMLDivElement;
  private chips: Chip[] = [];
  private vm: SeatChipVM[] | null = null;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('header', 'topstrip');
    this.el.dataset.testid = 'topstrip';
    this.seats = h('div', 'ts-seats');
    this.seats.setAttribute('aria-label', 'Players');
    const menu = h('button', 'icon-btn ts-menu nofocus');
    menu.type = 'button';
    menu.dataset.testid = 'menu';
    menu.setAttribute('aria-label', 'Menu');
    menu.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
    menu.addEventListener('click', () => send({ type: 'overlay', overlay: 'pause' }));
    this.el.append(this.seats, menu);
  }

  update(vm: SeatChipVM[]): void {
    if (this.vm === vm) return;
    this.vm = vm;
    while (this.chips.length < vm.length) {
      const c = new Chip();
      this.chips.push(c);
      this.seats.append(c.el);
    }
    while (this.chips.length > vm.length) this.chips.pop()!.el.remove();
    vm.forEach((c, i) => this.chips[i].update(c));
  }
}
