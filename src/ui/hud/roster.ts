// Roster (left, ≤ 220 px at 100%): one row per seat (UX.md §9).

import type { RosterRowVM, UiIntent } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { countUp, emblem, h, pop, setEmblem, setStyle, setText, toggle } from '../dom';

class Row {
  readonly el: HTMLButtonElement;
  private emb: SVGSVGElement;
  private name: HTMLSpanElement;
  private tag: HTMLSpanElement;
  private cards: HTMLSpanElement;
  private cardsN: HTMLSpanElement;
  private terr: HTMLSpanElement;
  private need: HTMLSpanElement;
  private cont: HTMLSpanElement;
  private barFill: HTMLDivElement;
  private armies: HTMLSpanElement;
  private income: HTMLSpanElement;
  private epitaph: HTMLSpanElement;
  private live: HTMLDivElement;
  private must: HTMLDivElement;
  vm: RosterRowVM | null = null;
  private cancelArmies: () => void = () => {};

  constructor(send: (i: UiIntent) => void) {
    this.el = h('button', 'r-row nofocus');
    this.el.type = 'button';
    this.el.addEventListener('click', () => {
      const vm = this.vm;
      if (!vm || vm.eliminated) return;
      send({ type: 'highlightSeat', player: vm.highlighted ? null : vm.seat.id });
    });
    const head = h('div', 'r-head');
    this.emb = emblem('crimson');
    this.name = h('span', 'r-name');
    this.tag = h('span', 'r-tag', 'AI');
    this.cards = h('span', 'r-cards');
    this.cards.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2" width="9" height="12" rx="1.5"/></svg>';
    this.cardsN = h('span', 'r-cards-n');
    this.cards.append(this.cardsN);
    head.append(this.emb, this.name, this.tag, this.cards);

    this.live = h('div', 'r-live');
    const l1 = h('div', 'r-line');
    const terrWrap = h('span', 'r-terr');
    this.terr = h('span', 'num strong');
    this.need = h('span', 'num dim');
    terrWrap.append(this.terr, h('span', 'dim', ' / '), this.need);
    this.cont = h('span', 'r-cont');
    l1.append(terrWrap, this.cont);
    const bar = h('div', 'r-bar');
    this.barFill = h('div', 'r-bar-fill');
    bar.append(this.barFill);
    const l2 = h('div', 'r-line r-armline');
    const armWrap = h('span', 'r-arm');
    this.armies = h('span', 'num');
    armWrap.append(this.armies, h('span', 'dim', ' armies'));
    this.income = h('span', 'r-inc num');
    l2.append(armWrap, this.income);
    this.live.append(l1, bar, l2);
    this.must = h('div', 'r-must', 'Must trade a set');
    this.live.append(this.must);
    this.epitaph = h('span', 'r-epitaph');
    this.el.append(head, this.live, this.epitaph);
  }

  update(vm: RosterRowVM): void {
    if (this.vm === vm) return;
    const prev = this.vm;
    this.vm = vm;
    const pal = PLAYER_COLORS[vm.seat.color];
    setStyle(this.el, '--seat', pal.base);
    setStyle(this.el, '--seat-light', pal.light);
    setEmblem(this.emb, vm.seat.color);
    const ep = vm.eliminated ? vm.epitaph ?? `${vm.seat.name.toUpperCase()} · out` : '';
    const cut = ep.indexOf(' · ');
    setText(this.name, vm.eliminated ? (cut > 0 ? ep.slice(0, cut) : vm.seat.name.toUpperCase()) : vm.seat.name);
    const rest = cut > 0 ? ep.slice(cut + 3) : '';
    setText(this.epitaph, rest ? rest[0].toUpperCase() + rest.slice(1) : '');
    this.el.title = ep;
    toggle(this.tag, 'hidden', vm.seat.kind !== 'ai' || vm.eliminated);
    toggle(this.el, 'current', vm.current);
    toggle(this.el, 'out', vm.eliminated);
    toggle(this.el, 'under-attack', vm.underAttack);
    toggle(this.el, 'highlighted', vm.highlighted);
    this.el.setAttribute('aria-pressed', vm.highlighted ? 'true' : 'false');
    this.el.setAttribute(
      'aria-label',
      vm.eliminated && vm.epitaph
        ? vm.epitaph
        : `${vm.seat.name}: ${vm.territories} of ${vm.territoriesNeeded} territories, ${vm.armies} armies, +${vm.income} a turn, ${vm.cards} cards`,
    );

    toggle(this.live, 'hidden', vm.eliminated);
    toggle(this.epitaph, 'hidden', !vm.eliminated);
    if (vm.eliminated) {
      toggle(this.cards, 'hidden', true);
      return;
    }
    toggle(this.cards, 'hidden', vm.cards === 0 && vm.cardState === 'normal');
    setText(this.cardsN, String(vm.cards));
    toggle(this.must, 'hidden', vm.cardState !== 'mustTrade');
    this.cards.className = `r-cards card-${vm.cardState}${vm.cards === 0 ? ' hidden' : ''}`;
    this.cards.setAttribute('title', `${vm.cards} card${vm.cards === 1 ? '' : 's'}`);

    setText(this.terr, String(vm.territories));
    setText(this.need, String(vm.territoriesNeeded));
    if (prev && prev.territories !== vm.territories) pop(this.terr, 1.2);
    setText(this.cont, vm.continents.join(' · '));
    const pct = vm.territoriesNeeded > 0 ? Math.min(1, vm.territories / vm.territoriesNeeded) : 0;
    setStyle(this.barFill, 'transform', `scaleX(${pct.toFixed(4)})`);

    if (prev && !prev.eliminated && prev.armies !== vm.armies) {
      this.cancelArmies();
      if (Math.abs(vm.armies - prev.armies) >= 5) this.cancelArmies = countUp(this.armies, prev.armies, vm.armies);
      else {
        setText(this.armies, String(vm.armies));
        pop(this.armies, 1.2);
      }
    } else setText(this.armies, String(vm.armies));
    setText(this.income, `+${vm.income} a turn`);
  }
}

export class Roster {
  readonly el: HTMLElement;
  /**
   * Compact rows (no armies line) when the full roster would reach down to the action bar, e.g. four
   * seats at a large text size on a short screen. Measured by the UI root on every layout change.
   */
  fitAbove(limitY: number): void {
    this.el.classList.remove('compact');
    if (this.el.getBoundingClientRect().bottom > limitY) this.el.classList.add('compact');
  }
  private rows: Row[] = [];
  private vm: RosterRowVM[] | null = null;

  constructor(private send: (i: UiIntent) => void) {
    this.el = h('aside', 'roster panel');
    this.el.setAttribute('aria-label', 'Players');
  }

  update(vm: RosterRowVM[]): void {
    if (this.vm === vm) return;
    this.vm = vm;
    while (this.rows.length < vm.length) {
      const r = new Row(this.send);
      this.rows.push(r);
      this.el.append(r.el);
    }
    while (this.rows.length > vm.length) this.rows.pop()!.el.remove();
    vm.forEach((r, i) => this.rows[i].update(r));
  }
}
