// Right rail (≤ 56 px) with the Cards and Log drawers (UX.md §7.5, §9).

import type { CardVM, CardsVM, LogLineVM, UiIntent } from '../../game/viewModel';
import { animateIn, animateOut, emblem, h, setText, toggle } from '../dom';
import { pictogram, SYMBOL_NAME } from './pictograms';

const CARD_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="3.5" width="11" height="15" rx="1.8"/><path d="M5.5 6.5 v12.2 a1.8 1.8 0 0 0 1.8 1.8 h8.2"/></svg>';
const LOG_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h10.5a2 2 0 0 1 2 2V19.5H8a2 2 0 0 1-2-2Z"/><path d="M9.5 9h6M9.5 12.5h6M9.5 16h4"/></svg>';

export class Rail {
  readonly el: HTMLElement;
  private cardsBtn: HTMLButtonElement;
  private cardsN: HTMLSpanElement;
  private badge: HTMLDivElement;
  private logBtn: HTMLButtonElement;
  private cardsOpen = false;
  private logOpen = false;

  constructor(private send: (i: UiIntent) => void) {
    this.el = h('nav', 'rail panel');
    this.el.setAttribute('aria-label', 'Cards and log');
    this.cardsBtn = h('button', 'rail-btn nofocus');
    this.cardsBtn.type = 'button';
    this.cardsBtn.innerHTML = CARD_ICON;
    this.cardsBtn.setAttribute('aria-label', 'Cards');
    this.cardsBtn.dataset.testid = 'rail-cards';
    this.cardsN = h('span', 'rail-n');
    this.badge = h('div', 'rail-badge hidden');
    this.cardsBtn.append(this.cardsN, h('span', 'rail-cap', 'Cards'));
    this.cardsBtn.addEventListener('click', () => this.send({ type: 'cardsPanel', open: !this.cardsOpen }));
    this.logBtn = h('button', 'rail-btn nofocus');
    this.logBtn.type = 'button';
    this.logBtn.innerHTML = LOG_ICON;
    this.logBtn.setAttribute('aria-label', 'Battle log');
    this.logBtn.dataset.testid = 'rail-log';
    this.logBtn.append(h('span', 'rail-cap', 'Log'));
    this.logBtn.addEventListener('click', () => this.send({ type: 'logPanel', open: !this.logOpen }));
    const cardsWrap = h('div', 'rail-slot');
    cardsWrap.append(this.cardsBtn, this.badge);
    this.el.append(cardsWrap, this.logBtn);
  }

  update(cards: CardsVM, logOpen: boolean): void {
    this.cardsOpen = cards.open;
    this.logOpen = logOpen;
    toggle(this.cardsBtn, 'on', cards.open);
    toggle(this.logBtn, 'on', logOpen);
    this.cardsBtn.setAttribute('aria-expanded', String(cards.open));
    this.logBtn.setAttribute('aria-expanded', String(logOpen));
    setText(this.cardsN, String(cards.count));
    toggle(this.cardsN, 'hidden', cards.count === 0);
    toggle(this.cardsN, 'must', cards.mustTrade);
    const b = cards.railBadge;
    toggle(this.badge, 'hidden', !b || cards.open || logOpen);
    if (b) setText(this.badge, b);
  }
}

// ---------------------------------------------------------------------------
// Drawer shell
// ---------------------------------------------------------------------------

class Drawer {
  readonly el: HTMLElement;
  readonly body: HTMLDivElement;
  readonly head: HTMLDivElement;
  readonly title: HTMLHeadingElement;
  private shown = false;

  constructor(cls: string, title: string, onClose: () => void) {
    this.el = h('section', `drawer panel ${cls} hidden`);
    this.head = h('div', 'drawer-head');
    this.title = h('h2', 'drawer-title', title);
    const close = h('button', 'icon-btn nofocus close');
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${title}`);
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    close.addEventListener('click', onClose);
    this.head.append(this.title, close);
    this.body = h('div', 'drawer-body');
    this.el.append(this.head, this.body);
  }

  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    if (on) {
      this.el.getAnimations().forEach((a) => a.cancel());
      this.el.classList.remove('hidden');
      animateIn(this.el, { dx: 12, dy: 0 });
    } else {
      animateOut(this.el, { dx: 12, dy: 0, remove: false }, () => {
        if (!this.shown) this.el.classList.add('hidden');
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Cards drawer
// ---------------------------------------------------------------------------

class CardFace {
  readonly el: HTMLButtonElement;
  private terr: HTMLSpanElement;
  private bonus: HTMLSpanElement;
  private sym: CardVM['symbol'] | null = null;
  private art: HTMLDivElement;
  private symName: HTMLSpanElement;
  vm: CardVM | null = null;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('button', 'card nofocus');
    this.el.type = 'button';
    this.art = h('div', 'card-art');
    this.symName = h('span', 'card-sym');
    this.terr = h('span', 'card-terr');
    this.bonus = h('span', 'card-bonus', 'yours +2');
    this.el.append(this.bonus, this.art, this.symName, this.terr);
    this.el.addEventListener('click', () => {
      if (this.vm) send({ type: 'toggleCard', id: this.vm.id });
    });
  }

  update(vm: CardVM): void {
    if (this.vm === vm) return;
    this.vm = vm;
    this.el.dataset.testid = `card-${vm.id}`;
    if (this.sym !== vm.symbol) {
      this.sym = vm.symbol;
      this.art.textContent = '';
      this.art.append(pictogram(vm.symbol));
      setText(this.symName, SYMBOL_NAME[vm.symbol]);
    }
    setText(this.terr, vm.territory ?? 'Any symbol');
    toggle(this.bonus, 'hidden', !vm.ownedBonus);
    toggle(this.el, 'selected', vm.selected);
    toggle(this.el, 'suggested', vm.suggested);
    toggle(this.el, 'wild', vm.symbol === 'wild');
    this.el.setAttribute('aria-pressed', String(vm.selected));
    this.el.setAttribute(
      'aria-label',
      `${SYMBOL_NAME[vm.symbol]}${vm.territory ? `, ${vm.territory}` : ''}${vm.ownedBonus ? ', yours, +2' : ''}`,
    );
  }
}

export class CardsDrawer {
  readonly drawer: Drawer;
  private header: HTMLDivElement;
  private grid: HTMLDivElement;
  private empty: HTMLDivElement;
  private status: HTMLDivElement;
  private coach: HTMLDivElement;
  private tradeBtn: HTMLButtonElement;
  private tradeLabel: HTMLSpanElement;
  private faces = new Map<number, CardFace>();
  private vm: CardsVM | null = null;
  private brassFree = true;

  constructor(private send: (i: UiIntent) => void) {
    this.drawer = new Drawer('cards-drawer', 'Cards', () => send({ type: 'cardsPanel', open: false }));
    this.header = h('div', 'cards-header');
    this.grid = h('div', 'cards-grid');
    this.empty = h('div', 'cards-empty', 'No cards yet · take a territory on your turn to earn one');
    this.status = h('div', 'cards-status');
    this.coach = h('div', 'cards-coach');
    this.tradeBtn = h('button', 'btn role-primary nofocus');
    this.tradeBtn.type = 'button';
    this.tradeBtn.dataset.testid = 'cards-trade';
    this.tradeLabel = h('span', 'btn-label');
    this.tradeBtn.append(this.tradeLabel);
    this.tradeBtn.addEventListener('click', () => {
      if (this.vm?.canTrade) send({ type: 'button', id: 'trade' });
    });
    const foot = h('div', 'cards-foot');
    foot.append(this.status, this.tradeBtn);
    this.drawer.body.append(this.header, this.grid, this.empty, this.coach, foot);
  }

  get el(): HTMLElement {
    return this.drawer.el;
  }

  /** `brassFree`: no other brass button in this state, so the drawer's trade may take brass. */
  update(vm: CardsVM, brassFree: boolean): void {
    if (this.vm === vm && this.brassFree === brassFree) return;
    this.vm = vm;
    this.brassFree = brassFree;
    this.drawer.show(vm.open);
    setText(this.header, vm.header);
    toggle(this.header, 'hidden', !vm.header);
    const hand = vm.hand;
    const seen = new Set<number>();
    if (hand) {
      hand.forEach((c, i) => {
        let f = this.faces.get(c.id);
        if (!f) {
          f = new CardFace(this.send);
          this.faces.set(c.id, f);
        }
        f.update(c);
        seen.add(c.id);
        if (this.grid.children[i] !== f.el) this.grid.insertBefore(f.el, this.grid.children[i] ?? null);
      });
    }
    for (const [id, f] of this.faces) {
      if (!seen.has(id)) {
        f.el.remove();
        this.faces.delete(id);
      }
    }
    toggle(this.grid, 'hidden', !hand || hand.length === 0);
    toggle(this.empty, 'hidden', !!hand && hand.length > 0);
    setText(this.empty, hand === null ? 'Hidden until the next player starts their turn' : 'No cards yet · take a territory on your turn to earn one');
    setText(this.status, vm.status);
    toggle(this.status, 'must', vm.mustTrade);
    setText(this.coach, vm.coach ?? '');
    toggle(this.coach, 'hidden', !vm.coach);
    const n = hand?.length ?? 0;
    const sel = hand?.filter((c) => c.selected).length ?? 0;
    const label = vm.canTrade
      ? vm.selectionValue != null
        ? `Trade · +${vm.selectionValue}`
        : 'Trade'
      : n < 3
        ? 'Trade'
        : sel === 0
          ? 'Select 3 cards'
          : sel < 3
            ? `Select ${3 - sel} more`
            : 'Not a set';
    setText(this.tradeLabel, label);
    this.tradeBtn.className = `btn role-primary nofocus${vm.canTrade && brassFree ? ' brass' : ''}${vm.canTrade ? '' : ' is-disabled'}`;
    this.tradeBtn.setAttribute('aria-disabled', vm.canTrade ? 'false' : 'true');
    if (!vm.canTrade) this.tradeBtn.dataset.why = n >= 3 ? 'Three alike, one of each, or any two plus a wild' : 'You need 3 cards for a set';
    else delete this.tradeBtn.dataset.why;
    toggle(this.tradeBtn, 'hidden', !hand);
  }
}

// ---------------------------------------------------------------------------
// Log drawer
// ---------------------------------------------------------------------------

class LogLine {
  readonly el: HTMLDivElement;
  private row: HTMLButtonElement | HTMLDivElement;
  private text: HTMLSpanElement;
  private detail: HTMLOListElement;
  private embSlot: HTMLSpanElement;
  vm: LogLineVM | null = null;
  expanded = false;

  constructor(vm: LogLineVM) {
    this.el = h('div', 'log-line');
    const expandable = vm.detail.length > 0;
    this.row = expandable ? h('button', 'log-row nofocus') : h('div', 'log-row');
    if (this.row instanceof HTMLButtonElement) {
      this.row.type = 'button';
      this.row.addEventListener('click', () => this.setExpanded(!this.expanded));
    }
    this.embSlot = h('span', 'log-emb');
    this.text = h('span', 'log-text');
    this.row.append(this.embSlot, this.text);
    if (expandable) {
      const chev = h('span', 'log-chev');
      chev.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
      this.row.append(chev);
    }
    this.detail = h('ol', 'log-detail hidden');
    this.el.append(this.row, this.detail);
    this.update(vm);
  }

  setExpanded(on: boolean): void {
    this.expanded = on;
    toggle(this.el, 'open', on);
    toggle(this.detail, 'hidden', !on);
    if (this.row instanceof HTMLButtonElement) this.row.setAttribute('aria-expanded', String(on));
  }

  update(vm: LogLineVM): void {
    if (this.vm === vm) return;
    this.vm = vm;
    this.el.className = `log-line kind-${vm.kind}${this.expanded ? ' open' : ''}`;
    this.embSlot.textContent = '';
    if (vm.seat) this.embSlot.append(emblem(vm.seat.color));
    setText(this.text, vm.text);
    this.detail.textContent = '';
    for (const d of vm.detail) this.detail.append(h('li', '', d));
  }
}

export class LogDrawer {
  readonly drawer: Drawer;
  private list: HTMLDivElement;
  private lines = new Map<number, LogLine>();
  private rounds = new Map<number, HTMLDivElement>();
  private vm: LogLineVM[] | null = null;
  private empty: HTMLDivElement;

  constructor(send: (i: UiIntent) => void) {
    this.drawer = new Drawer('log-drawer', 'Battle log', () => send({ type: 'logPanel', open: false }));
    this.list = h('div', 'log-list');
    this.empty = h('div', 'cards-empty', 'Nothing yet · battles show up here, one line each');
    this.drawer.body.append(this.list, this.empty);
  }

  get el(): HTMLElement {
    return this.drawer.el;
  }

  update(open: boolean, lines: LogLineVM[]): void {
    this.drawer.show(open);
    if (this.vm === lines) return;
    this.vm = lines;
    const sc = this.drawer.body;
    const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 24;
    const seen = new Set<number>();
    const seenRounds = new Set<number>();
    let cursor: ChildNode | null = this.list.firstChild;
    const place = (el: HTMLElement) => {
      if (cursor === el) cursor = el.nextSibling;
      else this.list.insertBefore(el, cursor);
    };
    for (const l of lines) {
      if (!seenRounds.has(l.round)) {
        seenRounds.add(l.round);
        let r = this.rounds.get(l.round);
        if (!r) {
          r = h('div', 'log-round', l.round > 0 ? `Round ${l.round}` : 'Setup');
          this.rounds.set(l.round, r);
        }
        place(r);
      }
      let ln = this.lines.get(l.id);
      if (!ln) {
        ln = new LogLine(l);
        this.lines.set(l.id, ln);
      } else ln.update(l);
      seen.add(l.id);
      place(ln.el);
    }
    for (const [id, ln] of this.lines) if (!seen.has(id)) (ln.el.remove(), this.lines.delete(id));
    for (const [r, el] of this.rounds) if (!seenRounds.has(r)) (el.remove(), this.rounds.delete(r));
    toggle(this.empty, 'hidden', lines.length > 0);
    if (atBottom || !open) requestAnimationFrame(() => (sc.scrollTop = sc.scrollHeight));
  }

  /** Test/gallery hook: expand the first engagement line. */
  expandFirst(): void {
    for (const ln of this.lines.values()) {
      if (ln.vm && ln.vm.detail.length) {
        ln.setExpanded(true);
        return;
      }
    }
  }
}
