// Top of the board (docs/ROUND2.md §C): the roster as one glass pill per seat, in turn order, floating
// on the ocean; `≡` as its own pill at the right, with `Reset view` beside it only when the player has
// moved the camera off home.
//   ( ▲ John 14 )( ● Cobalt 11 )( ◆ Amber 9 )( ■ Emerald 8 )                 ( Reset view )( ≡ )
// The current seat's pill is filled in its colour; on a turn change the fill slides to the next seat
// (200 ms). An eliminated seat is struck through and dimmed. No card counts here: the current human's
// hand is the `Cards N` button.

import type { SeatChipVM, UiIntent } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { animateIn, emblem, h, motion, pop, setEmblem, setStyle, setText, toggle } from '../dom';

class Chip {
  readonly el: HTMLDivElement;
  private emb: SVGSVGElement;
  private name: HTMLSpanElement;
  private terr: HTMLSpanElement;
  private vm: SeatChipVM | null = null;

  constructor() {
    this.el = h('div', 'seat-chip');
    this.emb = emblem('crimson', 'emb');
    this.name = h('span', 'sc-name');
    this.terr = h('span', 'sc-terr num');
    this.el.append(this.emb, this.name, this.terr);
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
    this.el.dataset.testid = `seat-${vm.seat.id}`;
    this.el.setAttribute('aria-label', vm.eliminated ? `${vm.seat.name}, out` : `${vm.seat.name}: ${vm.territories} territories`);
    if (prev && prev.territories !== vm.territories && !vm.eliminated) pop(this.terr, 1.2);
  }
}

export class TopStrip {
  readonly el: HTMLElement;
  private seats: HTMLDivElement;
  private fill: HTMLSpanElement;
  private chips: Chip[] = [];
  private reset: HTMLButtonElement;
  private vm: SeatChipVM[] | null = null;
  private at = -1;
  private moved = false;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('header', 'topstrip');
    this.el.dataset.testid = 'topstrip';
    this.seats = h('div', 'ts-seats');
    this.seats.setAttribute('aria-label', 'Players');
    this.fill = h('span', 'ts-fill hidden');
    this.fill.setAttribute('aria-hidden', 'true');
    this.seats.append(this.fill);
    const right = h('div', 'ts-right');
    this.reset = h('button', 'pill ts-reset nofocus hidden', 'Reset view');
    this.reset.type = 'button';
    this.reset.dataset.testid = 'reset-view';
    this.reset.addEventListener('click', () => send({ type: 'resetView' }));
    const menu = h('button', 'icon-btn pill ts-menu nofocus');
    menu.type = 'button';
    menu.dataset.testid = 'menu';
    menu.setAttribute('aria-label', 'Menu');
    menu.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
    menu.addEventListener('click', () => send({ type: 'overlay', overlay: 'pause' }));
    right.append(this.reset, menu);
    this.el.append(this.seats, right);
    new ResizeObserver(() => this.placeFill(false)).observe(this.seats);
  }

  /** The current seat's fill sits under its pill; a turn change slides it to the next one. */
  private placeFill(slide: boolean): void {
    const vm = this.vm;
    const i = vm ? vm.findIndex((c) => c.current) : -1;
    const chip = i >= 0 ? this.chips[i]?.el : null;
    if (!vm || !chip || !chip.offsetWidth) {
      toggle(this.fill, 'hidden', true);
      this.at = -1;
      return;
    }
    const wasHidden = this.fill.classList.contains('hidden');
    toggle(this.fill, 'hidden', false);
    setStyle(this.fill, 'background-color', PLAYER_COLORS[vm[i].seat.color].base);
    const apply = () => {
      this.fill.style.transform = `translateX(${chip.offsetLeft}px)`;
      this.fill.style.width = `${chip.offsetWidth}px`;
    };
    if (!slide || wasHidden || motion.reduced) {
      this.fill.style.transition = 'none';
      apply();
      void this.fill.offsetWidth;
      this.fill.style.transition = '';
    } else apply();
    this.at = i;
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
    const i = vm.findIndex((c) => c.current);
    this.placeFill(i !== this.at && this.at >= 0);
  }

  /** `Reset view` beside ≡, only while the camera is off home. */
  setViewMoved(on: boolean): void {
    if (on === this.moved) return;
    this.moved = on;
    toggle(this.reset, 'hidden', !on);
    if (on) animateIn(this.reset, { dx: 8, dy: 0, ms: 180 });
  }
}
