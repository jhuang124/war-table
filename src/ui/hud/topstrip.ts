// Top of the board (docs/INK.md B5 "In-game HUD"): the seats as ink rings on the paper, in turn order,
// the territory count inside each ring and the name beside it; the game's ensō at the top right is the
// menu, with the words `Reset view` beside it only while the camera is off home.
//   (11) John   (9) Sam   (8) Ochre   ( ) Sage                                   Reset view   (ensō)
// The current seat's ring is inked at full strength and its name underlined in a hairline; the others
// stay quieter. Losing a territory dims your ring for 300 ms (A5). An eliminated seat's ring is empty
// and faintly cracked, and says who did it. No card counts here: the current human's hand is `Cards N`.

import type { SeatChipVM, UiIntent } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { drawIn, emblem, ensoEl, h, hashSeed, motion, pop, setEmblem, setEnso, setStyle, setText, toggle } from '../dom';

class Chip {
  readonly el: HTMLDivElement;
  private ring: HTMLSpanElement;
  private mark: SVGSVGElement;
  private emb: SVGSVGElement;
  private name: HTMLSpanElement;
  private terr: HTMLSpanElement;
  private by: HTMLSpanElement;
  private vm: SeatChipVM | null = null;

  constructor() {
    this.el = h('div', 'seat-chip');
    this.ring = h('span', 'sc-ring');
    this.mark = ensoEl(1, 'sc-enso', { small: true });
    this.terr = h('span', 'sc-terr num');
    this.ring.append(this.mark, this.terr, h('i', 'sc-crack'));
    const text = h('span', 'sc-text');
    this.emb = emblem('crimson', 'emb sc-emb');
    this.name = h('span', 'sc-name');
    this.by = h('span', 'sc-by hidden');
    const nm = h('span', 'sc-nameline');
    nm.append(this.emb, this.name);
    text.append(nm, this.by);
    this.el.append(this.ring, text);
  }

  update(vm: SeatChipVM): void {
    if (this.vm === vm) return;
    const prev = this.vm;
    this.vm = vm;
    const pal = PLAYER_COLORS[vm.seat.color];
    setStyle(this.el, '--seat', pal.base);
    setStyle(this.el, '--seat-light', pal.light);
    setEnso(this.mark, hashSeed(`${vm.seat.id}:${vm.seat.color}`), { small: true });
    setEmblem(this.emb, vm.seat.color, 'light');
    setText(this.name, vm.seat.name);
    setText(this.terr, vm.eliminated ? '' : String(vm.territories));
    toggle(this.el, 'current', vm.current);
    toggle(this.el, 'out', vm.eliminated);
    const out = vm.eliminated ? vm.out : null;
    toggle(this.by, 'hidden', !out);
    if (out) setText(this.by, `taken by ${out.by.name}`);
    this.el.dataset.testid = `seat-${vm.seat.id}`;
    this.el.setAttribute(
      'aria-label',
      vm.eliminated ? `${vm.seat.name}, out${out ? `, taken by ${out.by.name}` : ''}` : `${vm.seat.name}: ${vm.territories} territories`,
    );
    if (!prev) return;
    // Turn start (INK B4 "seat ring inks"): the ring is brushed in fresh ivory ink and dries into its wash
    // (~900 ms, with the breath line). Ivory, not gold: one gold on screen at a time (INK A9), and the
    // track / commit already holds it.
    if (vm.current && !prev.current) {
      drawIn(this.ring, 300);
      if (!motion.reduced && typeof this.mark.animate === 'function')
        this.mark.animate([{ color: '#f2ede2' }, { color: '#f2ede2', offset: 0.3 }, { color: pal.base }], { duration: 900, easing: 'cubic-bezier(0.11, 0, 0.5, 0)' });
    }
    if (prev.territories !== vm.territories && !vm.eliminated) pop(this.terr);
    // A5: your colour is eaten — the ring dims for 300 ms each time a territory goes.
    if ((vm.lostKey ?? 0) !== (prev.lostKey ?? 0) && !motion.reduced && typeof this.ring.animate === 'function')
      this.ring.animate([{ opacity: 1 }, { opacity: 0.3, offset: 0.35 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    if (vm.eliminated && !prev.eliminated && typeof this.el.animate === 'function')
      this.el.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: motion.reduced ? 150 : 900, easing: 'ease-in-out' });
  }
}

export class TopStrip {
  readonly el: HTMLElement;
  private seats: HTMLDivElement;
  private chips: Chip[] = [];
  private reset: HTMLButtonElement;
  private menuMark: SVGSVGElement;
  private vm: SeatChipVM[] | null = null;
  private moved = false;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('header', 'topstrip');
    this.el.dataset.testid = 'topstrip';
    this.seats = h('div', 'ts-seats');
    this.seats.setAttribute('aria-label', 'Players');
    const right = h('div', 'ts-right');
    // `Reset view`: the words with a hairline under them (INK2 §3.2), a 44 px hit box; never a pill.
    this.reset = h('button', 'ts-reset nofocus hidden', 'Reset view');
    this.reset.type = 'button';
    this.reset.dataset.testid = 'reset-view';
    this.reset.addEventListener('click', () => send({ type: 'resetView' }));
    const menu = h('button', 'ts-menu nofocus');
    menu.type = 'button';
    menu.dataset.testid = 'menu';
    menu.setAttribute('aria-label', 'Menu');
    this.menuMark = ensoEl(1, 'ts-enso', { small: true });
    menu.append(this.menuMark);
    menu.addEventListener('click', () => send({ type: 'overlay', overlay: 'pause' }));
    right.append(this.reset, menu);
    this.el.append(this.seats, right);
  }

  /** The game's ensō (seed = the game's seed) is the menu mark. */
  setSeed(seed: number): void {
    setEnso(this.menuMark, seed, { small: true });
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

  /** `Reset view` beside the ensō, only while the camera is off home. */
  setViewMoved(on: boolean): void {
    if (on === this.moved) return;
    this.moved = on;
    toggle(this.reset, 'hidden', !on);
    if (on) drawIn(this.reset, 200);
  }
}
