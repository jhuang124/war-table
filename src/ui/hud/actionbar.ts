// Action bar (UX.md §8.9): fixed 5.25 rem × min(57.5 rem, 94vw), never resizes.
//
//   row 1: [line 1 ……………………………] [dice toggle | occupy stepper] [secondary slot] [primary slot]
//   row 2: [receipt chips] [line 2 …………] [trade / hints chips] [exit buttons]
//
// Line 1 crossfades (160 ms) when its wording changes; when only a number changes it pops (±1) or
// counts (≥ 5). A rejection swaps in with a 120 ms fade. Everything is patched in place.

import type { ActionBarVM, ButtonVM, ChipVM, UiIntent } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { ActionButton } from '../controls';
import { countUp, EASE_IN_QUAD, h, minus, motion, pop, setAttr, setStyle, setText, toggle } from '../dom';

const STEPPER_IDS = new Set(['min', 'dec', 'inc', 'max']);

/** Line 1 with number-aware transitions. */
class Line1 {
  readonly el: HTMLDivElement;
  cur: HTMLSpanElement;
  private text = '';
  private kind = '';
  private key = -1;
  private cancels: (() => void)[] = [];

  constructor() {
    this.el = h('div', 'ab-line1');
    this.cur = h('span', 'l1-text');
    this.el.append(this.cur);
  }

  /** Swap the text of the current line in place (no crossfade), e.g. when fitting splits it. */
  replaceInstant(text: string): void {
    text = minus(text);
    if (text === this.text) return;
    this.text = text;
    this.cur.textContent = '';
    for (const part of text.split(/(\d+)/)) {
      if (!part) continue;
      if (/^\d+$/.test(part)) this.cur.append(h('span', 'l1-num', part));
      else this.cur.append(document.createTextNode(part));
    }
    this.el.title = text;
  }

  get shown(): string {
    return this.text;
  }

  update(text: string, kind: ActionBarVM['line1Kind'], key: number, narrationColor: string | null): void {
    text = minus(text);
    const sameKey = key === this.key;
    if (text === this.text && kind === this.kind && sameKey) {
      return;
    }
    const prevText = this.text;
    const prevKind = this.kind;
    const skeleton = (s: string) => s.replace(/\d+/g, '#');
    const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
    const rejection = kind === 'rejection' && (!sameKey || prevKind !== 'rejection');
    const kindChanged = kind !== this.kind;
    this.text = text;
    this.kind = kind;
    this.key = key;
    toggle(this.el, 'is-rejection', kind === 'rejection');
    this.el.dataset.kind = kind;
    toggle(this.el, 'is-narration', kind === 'narration');
    setStyle(this.el, '--narr', narrationColor ?? 'var(--ivory)');
    this.el.title = text;

    if (!rejection && !kindChanged && prevText && skeleton(prevText) === skeleton(text)) {
      // Same sentence, different number(s): patch the numbers in place.
      const a = nums(prevText);
      const b = nums(text);
      const spans = this.cur.querySelectorAll<HTMLSpanElement>('.l1-num');
      if (spans.length === b.length) {
        b.forEach((n, i) => {
          if (a[i] === n) return;
          const d = Math.abs(n - a[i]);
          if (d >= 5) this.cancels.push(countUp(spans[i], a[i], n));
          else {
            setText(spans[i], String(n));
            pop(spans[i], 1.14, 160);
          }
        });
        return;
      }
    }
    this.cancels.forEach((c) => c());
    this.cancels = [];
    // Crossfade: the old line fades out in place while the new one fades in.
    const old = this.cur;
    const next = h('span', 'l1-text');
    for (const part of text.split(/(\d+)/)) {
      if (!part) continue;
      if (/^\d+$/.test(part)) next.append(h('span', 'l1-num', part));
      else next.append(document.createTextNode(part));
    }
    this.cur = next;
    this.el.append(next);
    if (!prevText || motion.reduced) {
      old.remove();
      return;
    }
    const ms = kind === 'rejection' || prevKind === 'rejection' ? 120 : 160;
    old.classList.add('l1-ghost');
    const out = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: EASE_IN_QUAD, fill: 'forwards' });
    out.onfinish = () => old.remove();
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' });
  }
}

class Chip {
  readonly el: HTMLElement;
  vm: ChipVM | null = null;
  constructor(vm: ChipVM, send: (i: UiIntent) => void) {
    this.el = vm.intent ? h('button', 'chip nofocus') : h('span', 'chip');
    if (this.el instanceof HTMLButtonElement) {
      this.el.type = 'button';
      this.el.addEventListener('click', () => {
        if (this.vm?.intent) send(this.vm.intent);
      });
    }
    this.update(vm);
  }
  update(vm: ChipVM): void {
    if (this.vm === vm) return;
    this.vm = vm;
    this.el.dataset.testid = `chip-${vm.id}`;
    this.el.className = `chip tone-${vm.tone}${vm.intent ? ' is-action nofocus' : ''}`;
    setText(this.el, minus(vm.label));
  }
}

class ChipRow {
  readonly el: HTMLDivElement;
  readonly chips = new Map<string, Chip>();
  constructor(cls: string, private send: (i: UiIntent) => void) {
    this.el = h('div', cls);
  }
  update(list: ChipVM[]): void {
    const seen = new Set<string>();
    list.forEach((c, i) => {
      let chip = this.chips.get(c.id);
      if (chip && !!chip.vm?.intent !== !!c.intent) {
        chip.el.remove();
        chip = undefined;
      }
      if (!chip) {
        chip = new Chip(c, this.send);
        this.chips.set(c.id, chip);
        if (!motion.reduced) chip.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      } else chip.update(c);
      seen.add(c.id);
      if (this.el.children[i] !== chip.el) this.el.insertBefore(chip.el, this.el.children[i] ?? null);
    });
    for (const [id, c] of this.chips) if (!seen.has(id)) (c.el.remove(), this.chips.delete(id));
  }
}

/** Keyed pool of ActionButtons inside one container. */
class ButtonGroup {
  readonly el: HTMLDivElement;
  private pool = new Map<string, ActionButton>();
  constructor(cls: string, private press: (b: ButtonVM) => void) {
    this.el = h('div', cls);
  }
  update(list: ButtonVM[]): void {
    const seen = new Set<string>();
    list.forEach((b, i) => {
      let ab = this.pool.get(b.id);
      if (!ab) {
        ab = new ActionButton(this.press);
        this.pool.set(b.id, ab);
      }
      ab.update(b);
      seen.add(b.id);
      if (this.el.children[i] !== ab.el) this.el.insertBefore(ab.el, this.el.children[i] ?? null);
    });
    for (const [id, ab] of this.pool) if (!seen.has(id)) (ab.el.remove(), this.pool.delete(id));
    toggle(this.el, 'empty', list.length === 0);
  }
}

class Stepper {
  readonly el: HTMLDivElement;
  private minB: ButtonGroup;
  private maxB: ButtonGroup;
  private count: HTMLDivElement;
  private countN: HTMLSpanElement;
  private value = -1;
  private cancel: () => void = () => {};

  constructor(press: (b: ButtonVM) => void) {
    this.el = h('div', 'stepper-ctl');
    this.minB = new ButtonGroup('st-side', press);
    this.maxB = new ButtonGroup('st-side', press);
    this.count = h('div', 'st-count');
    this.countN = h('span', 'num');
    this.countN.dataset.testid = 'counter';
    this.count.append(this.countN);
    this.el.append(this.minB.el, this.count, this.maxB.el);
  }

  update(counter: NonNullable<ActionBarVM['counter']>, buttons: ButtonVM[]): void {
    const by = (id: string) => buttons.find((b) => b.id === id);
    this.minB.update([by('min'), by('dec')].filter((b): b is ButtonVM => !!b));
    this.maxB.update([by('inc'), by('max')].filter((b): b is ButtonVM => !!b));
    if (counter.value !== this.value) {
      const prev = this.value;
      this.value = counter.value;
      this.cancel();
      if (prev >= 0 && Math.abs(counter.value - prev) >= 5) this.cancel = countUp(this.countN, prev, counter.value);
      else {
        setText(this.countN, String(counter.value));
        if (prev >= 0) pop(this.countN, 1.12, 140);
      }
    }
    this.count.setAttribute('aria-label', `${counter.value} armies, from ${counter.min} to ${counter.max}`);
  }
}

class DiceToggle {
  readonly el: HTMLDivElement;
  private opts: HTMLButtonElement[] = [];
  constructor(send: (i: UiIntent) => void) {
    this.el = h('div', 'dice-toggle');
    this.el.setAttribute('role', 'radiogroup');
    this.el.setAttribute('aria-label', 'Dice to roll');
    // A small die glyph instead of a word keeps the bar's width for line 1.
    const die = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    die.setAttribute('viewBox', '0 0 16 16');
    die.setAttribute('class', 'dt-die');
    die.setAttribute('aria-hidden', 'true');
    die.innerHTML = '<rect x="2" y="2" width="12" height="12" rx="2.5"/><circle cx="5.5" cy="5.5" r="1.1"/><circle cx="10.5" cy="10.5" r="1.1"/><circle cx="8" cy="8" r="1.1"/>';
    this.el.append(die);
    this.el.dataset.tip = 'Dice to roll  1 · 2 · 3';
    for (const v of [3, 2, 1] as const) {
      const b = h('button', 'dt-opt nofocus', String(v));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.v = String(v);
      b.dataset.testid = `dice-${v}`;
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true') return;
        send({ type: 'setDice', value: v });
      });
      this.opts.push(b);
      this.el.append(b);
    }
  }
  update(d: NonNullable<ActionBarVM['dice']>): void {
    for (const b of this.opts) {
      const v = Number(b.dataset.v);
      toggle(b, 'on', v === d.value);
      b.setAttribute('aria-checked', String(v === d.value));
      const dis = v > d.max;
      setAttr(b, 'aria-disabled', dis ? 'true' : null);
      setAttr(b, 'data-why', dis ? `Only ${d.max} ${d.max === 1 ? 'die' : 'dice'} · 1 army stays behind` : null);
      b.setAttribute('aria-keyshortcuts', String(v));
    }
  }
}

export class ActionBar {
  readonly el: HTMLElement;
  private line1 = new Line1();
  private line2: HTMLDivElement;
  private line2Text = '';
  private receipts: ChipRow;
  private status: ChipRow;
  private actChips: ChipRow;
  private hintsBtn: HTMLButtonElement;
  private middle: HTMLDivElement;
  private dice: DiceToggle;
  private stepper: Stepper;
  private note: HTMLDivElement;
  private secondary: ButtonGroup;
  private primary: ButtonGroup;
  private exits: ButtonGroup;
  private vm: ActionBarVM | null = null;
  private infoKey = '';
  private splitFrom: string | null = null;

  constructor(private send: (i: UiIntent) => void) {
    const press = (b: ButtonVM) => send({ type: 'button', id: b.id });
    this.el = h('section', 'actionbar panel');
    this.el.dataset.testid = 'actionbar';
    this.line1.el.dataset.testid = 'line1';
    this.el.setAttribute('aria-label', 'Actions');
    this.el.setAttribute('aria-live', 'polite');
    const row1 = h('div', 'ab-row ab-row1');
    const row2 = h('div', 'ab-row ab-row2');
    this.middle = h('div', 'ab-middle');
    this.dice = new DiceToggle(send);
    this.stepper = new Stepper(press);
    this.middle.append(this.dice.el, this.stepper.el);
    this.secondary = new ButtonGroup('ab-slot ab-secondary', press);
    this.primary = new ButtonGroup('ab-slot ab-primary', press);
    this.receipts = new ChipRow('ab-receipts', send);
    row1.append(this.line1.el, this.receipts.el, h('div', 'ab-spacer'), this.middle, this.secondary.el, this.primary.el);

    this.line2 = h('div', 'ab-line2');
    this.note = h('div', 'ab-note');
    this.actChips = new ChipRow('ab-actchips', send);
    this.hintsBtn = h('button', 'chip tone-toggle is-action nofocus');
    this.hintsBtn.type = 'button';
    this.hintsBtn.dataset.testid = 'chip-hints';
    this.hintsBtn.addEventListener('click', () => send({ type: 'toggleHints' }));
    this.exits = new ButtonGroup('ab-exits', press);
    this.status = new ChipRow('ab-status', send);
    row2.append(this.status.el, this.line2, this.note, this.actChips.el, this.hintsBtn, this.exits.el);
    this.el.append(row1, row2);

    // Mouse wheel adjusts the occupy / fortify count.
    this.el.addEventListener(
      'wheel',
      (e) => {
        const c = this.vm?.counter;
        if (!c) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const v = Math.max(c.min, Math.min(c.max, c.value + dir));
        if (v !== c.value) send({ type: 'setCount', value: v });
      },
      { passive: false },
    );
  }

  update(vm: ActionBarVM): void {
    if (this.vm === vm) return;
    this.vm = vm;
    const pal = PLAYER_COLORS[vm.accent];
    setStyle(this.el, '--accent', pal.base);
    this.el.dataset.mode = vm.mode;
    // If a previous fit split line 1, compare against the full sentence so numbers still patch in place.
    if (this.splitFrom && minus(vm.line1) !== this.splitFrom) this.line1.replaceInstant(this.splitFrom);
    this.splitFrom = null;
    this.line1.update(vm.line1, vm.line1Kind, vm.line1Key, vm.line1Kind === 'narration' ? pal.light : null);
    this.setLine2(minus(vm.line2));

    const chips = vm.chips.filter((c) => c.intent?.type !== 'toggleHints');
    const info = chips.filter((c) => !c.intent);
    const infoKey = info.map((c) => `${c.id}:${c.label}`).join('|') + '#' + vm.line1 + '#' + vm.buttons.map((b) => b.id).join();
    this.receipts.update(info);
    this.status.update([]);
    this.actChips.update(chips.filter((c) => !!c.intent));

    toggle(this.hintsBtn, 'hidden', !vm.hints.toggleable);
    setText(this.hintsBtn, vm.hints.on ? 'Hints on' : 'Hints off');
    toggle(this.hintsBtn, 'off', !vm.hints.on);
    this.hintsBtn.setAttribute('aria-pressed', String(vm.hints.on));

    toggle(this.dice.el, 'hidden', !vm.dice);
    if (vm.dice) this.dice.update(vm.dice);
    toggle(this.stepper.el, 'hidden', !vm.counter);
    if (vm.counter) this.stepper.update(vm.counter, vm.buttons);
    toggle(this.middle, 'hidden', !vm.dice && !vm.counter);
    const note = vm.counter?.note ?? '';
    setText(this.note, minus(note));
    toggle(this.note, 'hidden', !note || note === vm.line2);

    const rest = vm.buttons.filter((b) => !STEPPER_IDS.has(b.id));
    this.primary.update(rest.filter((b) => b.role === 'primary'));
    this.secondary.update(rest.filter((b) => b.role === 'secondary'));
    this.exits.update(rest.filter((b) => b.role === 'exit'));
    if (infoKey !== this.infoKey) {
      this.infoKey = infoKey;
      this.fit();
    } else this.markClipped();
  }

  /**
   * Priority fit inside the fixed bar: line 1 never yields to a chip. Info chips (receipts, card
   * status) sit beside line 1 when there is room and spill to the start of row 2 when there isn't;
   * an overflowing hint keeps its full text in a hover tip. Runs on content change and resize only.
   */
  private setLine2(l2: string): void {
    if (l2 === this.line2Text) return;
    this.line2Text = l2;
    setText(this.line2, l2);
    if (!motion.reduced) this.line2.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  }

  fit(): void {
    const vm = this.vm;
    if (!vm) return;
    const full = minus(vm.line1);
    if (this.splitFrom) {
      this.line1.replaceInstant(full);
      this.splitFrom = null;
      this.line2Text = minus(vm.line2);
      setText(this.line2, this.line2Text);
    }
    const row1 = this.receipts.el;
    const row2 = this.status.el;
    // Everything back to row 1, in order.
    for (const c of [...row2.children]) row1.append(c);
    const line = this.line1.el.querySelector<HTMLElement>('.l1-text:not(.l1-ghost)');
    const truncated = () => !!line && line.scrollWidth > line.clientWidth + 1;
    const r1 = row1.parentElement!;
    const over = () => truncated() || r1.scrollWidth > r1.clientWidth + 1;
    let guard = 12;
    while (row1.lastElementChild && over() && guard--) row2.prepend(row1.lastElementChild);
    // Still too long, and line 2 is free: carry the sentence's tail down to line 2.
    const cut = full.indexOf(' · ');
    if (truncated() && !vm.line2 && cut > 0) {
      this.line1.replaceInstant(full.slice(0, cut));
      this.splitFrom = full;
      this.line2Text = full.slice(cut + 3);
      setText(this.line2, this.line2Text);
    }
    this.markClipped();
  }

  private markClipped(): void {
    const clipped = this.line2.scrollWidth > this.line2.clientWidth + 1;
    if (clipped) this.line2.dataset.tip = this.line2Text;
    else delete this.line2.dataset.tip;
  }
}
