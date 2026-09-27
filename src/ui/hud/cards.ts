// The cards sheet behind `Cards N` (docs/SIMPLIFY.md §1): your hand, one status line, and a single
// `Trade for +8` when a set is ready. It is for looking: the best set is chosen for you.

import type { CardVM, CardsVM, UiIntent } from '../../game/viewModel';
import { uiButton } from '../controls';
import { animateIn, animateOut, h, setText, toggle } from '../dom';
import { pictogram, SYMBOL_NAME } from './pictograms';

class CardFace {
  readonly el: HTMLDivElement;
  private art: HTMLDivElement;
  private sym: HTMLSpanElement;
  private terr: HTMLSpanElement;
  private bonus: HTMLSpanElement;
  private symbol: CardVM['symbol'] | null = null;
  private vm: CardVM | null = null;

  constructor() {
    this.el = h('div', 'card');
    this.art = h('div', 'card-art');
    this.sym = h('span', 'card-sym');
    this.terr = h('span', 'card-terr');
    this.bonus = h('span', 'card-bonus', '+2');
    this.el.append(this.bonus, this.art, this.sym, this.terr);
  }

  update(vm: CardVM): void {
    if (this.vm === vm) return;
    this.vm = vm;
    this.el.dataset.testid = `card-${vm.id}`;
    if (this.symbol !== vm.symbol) {
      this.symbol = vm.symbol;
      this.art.textContent = '';
      this.art.append(pictogram(vm.symbol));
      setText(this.sym, SYMBOL_NAME[vm.symbol]);
    }
    setText(this.terr, vm.territory ?? 'Any symbol');
    toggle(this.bonus, 'hidden', !vm.ownedBonus);
    toggle(this.el, 'in-set', vm.inSet);
    toggle(this.el, 'wild', vm.symbol === 'wild');
    this.el.setAttribute('aria-label', `${SYMBOL_NAME[vm.symbol]}${vm.territory ? `, ${vm.territory}` : ''}${vm.ownedBonus ? ', yours, +2' : ''}`);
  }
}

export class CardsSheet {
  readonly el: HTMLElement;
  private grid: HTMLDivElement;
  private status: HTMLDivElement;
  private trade: HTMLButtonElement;
  private tradeLabel: HTMLSpanElement;
  private faces = new Map<number, CardFace>();
  private vm: CardsVM | null = null;
  private shown = false;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('section', 'cards-sheet panel hidden');
    this.el.setAttribute('aria-label', 'Your cards');
    const head = h('div', 'cs-head');
    const close = h('button', 'icon-btn nofocus');
    close.type = 'button';
    close.dataset.testid = 'cards-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    close.addEventListener('click', () => send({ type: 'cardsPanel', open: false }));
    head.append(h('h2', 'cs-title', 'Your cards'), close);
    this.grid = h('div', 'cards-grid');
    this.status = h('div', 'cards-status');
    this.trade = uiButton('', 'brass role-primary', () => send({ type: 'button', id: 'trade' }), undefined, 'cards-trade');
    this.tradeLabel = this.trade.querySelector('.btn-label')!;
    const foot = h('div', 'cs-foot');
    foot.append(this.status, this.trade);
    this.el.append(head, this.grid, foot);
  }

  update(vm: CardsVM | null): void {
    if (vm === this.vm) return;
    this.vm = vm;
    const open = !!vm?.open;
    if (open !== this.shown) {
      this.shown = open;
      if (open) {
        this.el.getAnimations().forEach((a) => a.cancel());
        this.el.classList.remove('hidden');
        this.el.dataset.testid = 'cards';
        animateIn(this.el, { dy: 10 });
      } else {
        delete this.el.dataset.testid;
        animateOut(this.el, { dy: 8, remove: false }, () => {
          if (!this.shown) this.el.classList.add('hidden');
        });
      }
    }
    if (!vm) return;
    const seen = new Set<number>();
    vm.hand.forEach((c, i) => {
      let f = this.faces.get(c.id);
      if (!f) {
        f = new CardFace();
        this.faces.set(c.id, f);
      }
      f.update(c);
      seen.add(c.id);
      if (this.grid.children[i] !== f.el) this.grid.insertBefore(f.el, this.grid.children[i] ?? null);
    });
    for (const [id, f] of this.faces) if (!seen.has(id)) (f.el.remove(), this.faces.delete(id));
    setText(this.status, vm.status);
    toggle(this.trade, 'hidden', !vm.trade);
    if (vm.trade) setText(this.tradeLabel, vm.trade.label);
  }
}
