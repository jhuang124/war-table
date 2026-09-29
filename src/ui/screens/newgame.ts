// New game (UX.md §4.1, INK.md B5): seats, length, setup, house rules drawer, summary + Start, on one paper
// sheet. Each seat is an ensō ring in its wash (tap → the six washes), a serif name, `Human · AI` and the
// difficulty as words (the active one underlined in a gold hairline). Start is the gold outline.

import type { AiDifficulty, PlayerColorId, PlayerKind } from '../../engine/types';
import type { HouseRulesDraft, LengthPreset, NewGameVM, SeatDraft, SetupPreset, UiIntent } from '../../game/viewModel';
import { PLAYER_COLOR_IDS, PLAYER_COLORS } from '../../shared/palette';
import { Segmented, Switch, uiButton } from '../controls';
import { animateIn, emblem, ensoEl, h, hashSeed, setAttr, setEmblem, setStyle, setText, toggle } from '../dom';
import { isPhone, layout } from '../layout';
import { dragToDismiss, grabHandle, sheetIn } from '../sheet';

type Send = (i: UiIntent) => void;

/** One colour emblem per seat; clicking it opens the six swatches (docs/ROUND2.md §E). */
class SeatRow {
  readonly el: HTMLDivElement;
  private swatches = new Map<PlayerColorId, HTMLButtonElement>();
  private colorBtn: HTMLButtonElement;
  private pop: HTMLDivElement;
  private swSheet: HTMLDivElement;
  private open = false;
  private name: HTMLInputElement;
  private kind: Segmented<PlayerKind>;
  private diff: Segmented<AiDifficulty>;
  private diffWrap: HTMLDivElement;
  private remove: HTMLButtonElement;
  private num: HTMLSpanElement;
  private seat: SeatDraft | null = null;

  constructor(private index: number, send: Send) {
    this.el = h('div', 'seat-row');
    this.num = h('span', 'seat-num num', String(index + 1));
    const wrap = h('div', 'seat-color');
    this.colorBtn = h('button', 'swatch seat-emblem');
    this.colorBtn.type = 'button';
    this.colorBtn.dataset.testid = `seat-color-${index}`;
    this.colorBtn.setAttribute('aria-haspopup', 'true');
    this.colorBtn.setAttribute('aria-expanded', 'false');
    this.colorBtn.append(ensoEl(hashSeed(`seat${index}`), 'enso sw-ring', { small: true }), emblem('crimson', 'emb', 'light'));
    this.colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setOpen(!this.open);
    });
    // Desktop: a popover beside the emblem. Phones: a bottom sheet of six big swatches (mobile.css);
    // the pop itself is the scrim there, so a tap outside the sheet closes it.
    this.pop = h('div', 'swatch-pop hidden');
    const sheet = (this.swSheet = h('div', 'sw-sheet'));
    const sw = h('div', 'swatches');
    sw.setAttribute('role', 'radiogroup');
    sw.setAttribute('aria-label', `Seat ${index + 1} color`);
    sheet.append(grabHandle(), h('div', 'sw-title', `Seat ${index + 1} colour`), sw);
    this.pop.append(sheet);
    this.pop.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === this.pop) this.setOpen(false);
    });
    dragToDismiss(sheet, [sheet], { scrim: () => this.pop, onDismiss: () => this.setOpen(false) });
    wrap.append(this.colorBtn, this.pop);
    for (const c of PLAYER_COLOR_IDS) {
      const b = h('button', 'swatch');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', PLAYER_COLORS[c].name);
      b.dataset.tip = PLAYER_COLORS[c].name;
      b.dataset.testid = `seat-color-${index}-${c}`;
      setStyle(b, '--seat', PLAYER_COLORS[c].base);
      setStyle(b, '--seat-light', PLAYER_COLORS[c].light);
      b.append(ensoEl(hashSeed(`sw${c}`), 'enso sw-ring', { small: true }), emblem(c, 'emb', 'light'), h('span', 'sw-name', PLAYER_COLORS[c].name));
      b.addEventListener('click', () => {
        send({ type: 'seat', index: this.index, patch: { color: c } });
        this.setOpen(false);
      });
      this.swatches.set(c, b);
      sw.append(b);
    }
    this.name = h('input', 'name-input');
    this.name.type = 'text';
    this.name.maxLength = 12;
    this.name.spellcheck = false;
    this.name.autocomplete = 'off';
    this.name.setAttribute('aria-label', `Seat ${index + 1} name`);
    this.name.dataset.testid = `seat-name-${index}`;
    this.name.addEventListener('input', () => send({ type: 'seat', index: this.index, patch: { name: this.name.value } }));
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.name.blur();
    });
    this.kind = new Segmented<PlayerKind>('seg-row', (v) => send({ type: 'seat', index: this.index, patch: { kind: v } }), 'Human or AI', `seat-kind-${index}`);
    this.kind.setOptions([
      { value: 'human', label: 'Human' },
      { value: 'ai', label: 'AI' },
    ]);
    this.diffWrap = h('div', 'diff-wrap');
    this.diff = new Segmented<AiDifficulty>('seg-row', (v) => send({ type: 'seat', index: this.index, patch: { difficulty: v } }), 'AI difficulty', `seat-diff-${index}`);
    this.diff.setOptions([
      { value: 'easy', label: 'Easy' },
      { value: 'normal', label: 'Normal' },
      { value: 'hard', label: 'Hard' },
    ]);
    this.diffWrap.append(this.diff.el);
    this.remove = h('button', 'icon-btn remove-seat');
    this.remove.type = 'button';
    this.remove.setAttribute('aria-label', `Remove seat ${index + 1}`);
    this.remove.dataset.testid = `seat-remove-${index}`;
    this.remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    this.remove.addEventListener('click', () => {
      if (this.remove.getAttribute('aria-disabled') !== 'true') send({ type: 'removeSeat', index: this.index });
    });
    this.el.append(this.num, wrap, this.name, this.kind.el, this.diffWrap, this.remove);
  }

  setOpen(on: boolean): void {
    if (on === this.open) return;
    this.open = on;
    toggle(this.pop, 'hidden', !on);
    this.colorBtn.setAttribute('aria-expanded', String(on));
    if (on) {
      if (isPhone()) sheetIn(this.swSheet, this.pop);
      else animateIn(this.pop.firstElementChild as HTMLElement, { ms: 160 });
      this.onOpen?.(this);
    }
  }

  get isOpen(): boolean {
    return this.open;
  }

  onOpen: ((row: SeatRow) => void) | null = null;

  /** Focus the name so typing edits it (UX: people skip naming otherwise); caret at the end, nothing selected (INK F8). */
  focusName(): void {
    // The caret waits at the end of the name: no selection block on open (typing edits it).
    this.name.focus({ preventScroll: true });
    const n = this.name.value.length;
    this.name.setSelectionRange(n, n);
  }

  get kindValue(): PlayerKind | null {
    return this.seat?.kind ?? null;
  }

  update(seat: SeatDraft, taken: Set<PlayerColorId>, canRemove: boolean, clash: boolean): void {
    this.seat = seat;
    setStyle(this.el, '--seat', PLAYER_COLORS[seat.color].base);
    setStyle(this.colorBtn, '--seat', PLAYER_COLORS[seat.color].base);
    setStyle(this.colorBtn, '--seat-light', PLAYER_COLORS[seat.color].light);
    setEmblem(this.colorBtn.querySelector<SVGSVGElement>('.emb')!, seat.color, 'light');
    this.colorBtn.setAttribute('aria-label', `Seat ${this.index + 1} colour: ${PLAYER_COLORS[seat.color].name}`);
    toggle(this.colorBtn, 'clash', clash);
    for (const [c, b] of this.swatches) {
      const on = c === seat.color;
      toggle(b, 'on', on);
      b.setAttribute('aria-checked', String(on));
      toggle(b, 'taken', !on && taken.has(c));
      toggle(b, 'clash', on && clash);
    }
    if (document.activeElement !== this.name && this.name.value !== seat.name) this.name.value = seat.name;
    this.name.placeholder = `Seat ${this.index + 1}`;
    this.kind.set(seat.kind);
    this.diff.set(seat.difficulty);
    toggle(this.diffWrap, 'off', seat.kind !== 'ai');
    setAttr(this.diffWrap, 'aria-hidden', seat.kind !== 'ai' ? 'true' : null);
    setAttr(this.remove, 'aria-disabled', canRemove ? null : 'true');
    toggle(this.remove, 'is-disabled', !canRemove);
    this.remove.dataset.why = canRemove ? '' : 'At least 2 seats';
  }
}

export class NewGameScreen {
  readonly el: HTMLElement;
  private seatsWrap: HTMLDivElement;
  private rows: SeatRow[] = [];
  private addBtn: HTMLButtonElement;
  private length: Segmented<LengthPreset>;
  private setup: Segmented<SetupPreset>;
  private summary: HTMLParagraphElement;
  private problems: HTMLUListElement;
  private start: HTMLButtonElement;
  private houseBtn: HTMLButtonElement;
  private house: HTMLDivElement;
  private houseOpen = false;
  private h: {
    draft: Switch;
    cards: Segmented<HouseRulesDraft['cardBonus']>;
    fortify: Segmented<HouseRulesDraft['fortifyRule']>;
    batch: Segmented<string>;
    seed: HTMLInputElement;
  };
  private vm: NewGameVM | null = null;

  constructor(private send: Send) {
    this.el = h('section', 'screen newgame-screen');
    const sheet = h('div', 'sheet ng-sheet');
    const head = h('div', 'sheet-head');
    head.append(h('h1', 'sheet-title', 'New game'), uiButton('Back', 'role-exit', () => send({ type: 'nav', screen: 'title' }), undefined, 'ng-back'));

    const grid = h('div', 'ng-grid');
    // Seats
    this.seatsWrap = h('div', 'seats');
    this.addBtn = uiButton('Add a seat', 'role-exit add-seat', () => send({ type: 'addSeat' }), undefined, 'add-seat');
    const seatsCell = h('div', 'ng-cell');
    seatsCell.append(this.seatsWrap, this.addBtn);
    grid.append(h('div', 'ng-label', 'Seats'), seatsCell);
    // Length
    this.length = new Segmented<LengthPreset>('seg-cards', (v) => send({ type: 'length', value: v }), 'Game length', 'length');
    grid.append(h('div', 'ng-label', 'Length'), this.length.el);
    // Setup
    this.setup = new Segmented<SetupPreset>('seg-cards', (v) => send({ type: 'setup', value: v }), 'Setup', 'setup');
    grid.append(h('div', 'ng-label', 'Setup'), this.setup.el);

    // House rules drawer
    this.houseBtn = h('button', 'house-toggle');
    this.houseBtn.type = 'button';
    this.houseBtn.dataset.houseToggle = '';
    this.houseBtn.dataset.testid = 'house-toggle';
    this.houseBtn.innerHTML =
      '<span>House rules</span><span class="house-sum"></span>';
    this.houseBtn.addEventListener('click', () => this.setHouseOpen(!this.houseOpen));
    this.house = h('div', 'house hidden');
    const patch = (p: Partial<HouseRulesDraft>) => send({ type: 'house', patch: p });
    const draft = new Switch('Draft territories', (v) => patch({ draft: v }), 'Take turns claiming them · adds ~10 min', 'house-draft');
    const cards = new Segmented<HouseRulesDraft['cardBonus']>('seg-row', (v) => patch({ cardBonus: v }), 'Card values', 'house-cards');
    cards.setOptions([
      { value: 'progressive', label: 'Growing', detail: '4, 6, 8, 10 …' },
      { value: 'fixed', label: 'Fixed', detail: '4 · 6 · 8 · 10' },
    ]);
    const fortify = new Segmented<HouseRulesDraft['fortifyRule']>('seg-row', (v) => patch({ fortifyRule: v }), 'Fortify rule', 'house-fortify');
    fortify.setOptions([
      { value: 'connected', label: 'Connected', detail: 'any chain of yours' },
      { value: 'adjacent', label: 'Adjacent', detail: 'neighbors only' },
    ]);
    const batch = new Segmented<string>('seg-row', (v) => patch({ setupBatch: v === 'auto' ? 'auto' : Number(v) }), 'Setup batch', 'house-batch');
    batch.setOptions([
      { value: 'auto', label: 'Two passes' },
      { value: '3', label: '3' },
      { value: '5', label: '5' },
      { value: '8', label: '8' },
    ]);
    const seed = h('input', 'name-input seed-input num');
    seed.type = 'text';
    seed.inputMode = 'numeric';
    seed.placeholder = 'Random';
    seed.maxLength = 10;
    seed.setAttribute('aria-label', 'Seed');
    seed.dataset.testid = 'house-seed';
    seed.addEventListener('input', () => {
      const digits = seed.value.replace(/\D/g, '');
      if (digits !== seed.value) seed.value = digits;
      patch({ seed: digits ? Number(digits) : null });
    });
    seed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') seed.blur();
    });
    this.h = { draft, cards, fortify, batch, seed };
    const hf = (label: string, ctl: HTMLElement, detail?: string) => {
      const f = h('div', 'field');
      const l = h('div', 'field-label');
      l.append(h('span', '', label));
      if (detail) l.append(h('span', 'field-detail', detail));
      f.append(l, ctl);
      return f;
    };
    const hg = h('div', 'house-grid');
    hg.append(
      draft.el,
      hf('Card sets', cards.el),
      hf('Fortify', fortify.el),
      hf('Armies per setup turn', batch.el, 'Place your own only'),
      hf('Seed', seed, 'Same seed, same dice'),
    );
    this.house.append(hg);
    grid.append(h('div', 'ng-label'), this.houseBtn, h('div', ''), this.house);

    const foot = h('div', 'ng-foot');
    const sumWrap = h('div', 'ng-sum');
    this.summary = h('p', 'ng-summary num');
    this.summary.dataset.testid = 'ng-summary';
    this.problems = h('ul', 'ng-problems');
    sumWrap.append(this.summary, this.problems);
    this.start = uiButton('Start', 'brass role-primary big', () => {
      if (this.vm?.canStart) send({ type: 'start' });
    }, 'Enter', 'ng-start');
    foot.append(sumWrap, this.start);
    sheet.append(head, grid, foot);
    this.el.append(sheet);
    // One swatch popover at a time; a click anywhere else (or Esc, in src/ui/index.ts) closes it.
    this.el.addEventListener('click', () => this.closeSwatches());
  }

  /** Close any open colour popover. True if one was open. */
  closeSwatches(): boolean {
    const open = this.rows.filter((r) => r.isOpen);
    open.forEach((r) => r.setOpen(false));
    return open.length > 0;
  }

  setHouseOpen(on: boolean): void {
    this.houseOpen = on;
    toggle(this.houseBtn, 'open', on);
    this.houseBtn.setAttribute('aria-expanded', String(on));
    toggle(this.house, 'hidden', !on);
    if (on) animateIn(this.house);
  }

  /** On entering the screen: the first human seat's name, focused. */
  focusFirstName(): void {
    // Touch: focusing a field raises the on-screen keyboard over the screen; the player taps a name to edit.
    if (layout.touch || isPhone()) return;
    const row = this.rows.find((r) => r.kindValue === 'human');
    row?.focusName();
  }

  update(vm: NewGameVM): void {
    if (this.vm === vm) return;
    this.vm = vm;
    while (this.rows.length < vm.seats.length) {
      const r = new SeatRow(this.rows.length, this.send);
      r.onOpen = (me) => this.rows.forEach((x) => x !== me && x.setOpen(false));
      this.rows.push(r);
      this.seatsWrap.append(r.el);
      if (this.rows.length > 2) animateIn(r.el);
    }
    while (this.rows.length > vm.seats.length) this.rows.pop()!.el.remove();
    const counts = new Map<PlayerColorId, number>();
    for (const s of vm.seats) counts.set(s.color, (counts.get(s.color) ?? 0) + 1);
    vm.seats.forEach((s, i) => {
      const taken = new Set(vm.seats.filter((_, j) => j !== i).map((x) => x.color));
      this.rows[i].update(s, taken, vm.canRemoveSeat, (counts.get(s.color) ?? 0) > 1);
    });
    toggle(this.addBtn, 'hidden', !vm.canAddSeat);

    this.length.setOptions(vm.lengthOptions.map((o) => ({ value: o.id, label: o.label, detail: o.detail, meta: o.estimate })));
    this.length.set(vm.length);
    this.setup.setOptions(vm.setupOptions.map((o) => ({ value: o.id, label: o.label, detail: o.detail })));
    this.setup.set(vm.setup);

    const hr = vm.house;
    this.h.draft.set(hr.draft);
    this.h.cards.set(hr.cardBonus);
    this.h.fortify.set(hr.fortifyRule);
    this.h.batch.set(String(hr.setupBatch));
    if (document.activeElement !== this.h.seed) this.h.seed.value = hr.seed == null ? '' : String(hr.seed);
    const changed: string[] = [];
    if (hr.draft) changed.push('draft');
    if (hr.cardBonus === 'fixed') changed.push('fixed cards');
    if (hr.fortifyRule === 'adjacent') changed.push('adjacent fortify');
    if (hr.setupBatch !== 'auto') changed.push(`${hr.setupBatch} per setup turn`);
    if (hr.seed != null) changed.push(`seed ${hr.seed}`);
    setText(this.houseBtn.querySelector('.house-sum')!, changed.length ? changed.join(' · ') : 'classic');

    setText(this.summary, vm.summary);
    this.problems.textContent = '';
    for (const p of vm.problems) this.problems.append(h('li', '', p));
    toggle(this.problems, 'hidden', vm.problems.length === 0);
    toggle(this.start, 'is-disabled', !vm.canStart);
    setAttr(this.start, 'aria-disabled', vm.canStart ? null : 'true');
    this.start.dataset.why = vm.canStart ? '' : (vm.problems[0] ?? 'Fix the seats first');
  }
}
