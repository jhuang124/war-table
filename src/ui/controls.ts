// Reusable controls: action buttons (ButtonVM), plain UI buttons, segmented controls, switches, the
// volume slider. None of them look like browser defaults; all numerals are tabular Inter (styles.css).

import type { ButtonVM } from '../game/viewModel';
import { h, setAttr, setText, toggle } from './dom';

/** A button bound to a ButtonVM. No keycaps: the keyboard is a hidden accelerator. */
export class ActionButton {
  readonly el: HTMLButtonElement;
  private labelEl: HTMLSpanElement;
  vm: ButtonVM | null = null;

  constructor(onPress: (vm: ButtonVM) => void) {
    this.el = h('button', 'btn nofocus');
    this.el.type = 'button';
    this.labelEl = h('span', 'btn-label');
    this.el.append(this.labelEl);
    this.el.addEventListener('click', () => {
      const vm = this.vm;
      if (!vm || vm.busy) return;
      onPress(vm);
    });
  }

  update(vm: ButtonVM): void {
    if (this.vm === vm) return;
    this.vm = vm;
    setText(this.labelEl, vm.label);
    this.el.className = `btn nofocus ${vm.primary ? 'role-primary brass' : 'role-secondary'}${vm.busy ? ' is-busy' : ''}`;
    setAttr(this.el, 'data-id', vm.id);
    setAttr(this.el, 'data-testid', `btn-${vm.id}`);
  }
}

/** A plain UI button (menus, dialogs). */
export function uiButton(label: string, cls: string, onClick: () => void, keycap?: string, testid?: string): HTMLButtonElement {
  const b = h('button', `btn ${cls}`);
  b.type = 'button';
  if (testid) b.dataset.testid = testid;
  b.append(h('span', 'btn-label', label));
  if (keycap) b.append(h('kbd', 'kc', keycap));
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    onClick();
  });
  return b;
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  detail?: string;
  meta?: string;
  disabled?: boolean;
}

/** Segmented control: a row of options, one selected. Keyboard: arrows move within. */
export class Segmented<T extends string | number> {
  readonly el: HTMLDivElement;
  private buttons = new Map<T, HTMLButtonElement>();
  private value: T | null = null;
  private opts: SegOption<T>[] = [];

  constructor(cls: string, private onPick: (v: T) => void, ariaLabel: string, private testid?: string) {
    this.el = h('div', `seg ${cls}`);
    if (testid) this.el.dataset.testid = testid;
    this.el.setAttribute('role', 'radiogroup');
    this.el.setAttribute('aria-label', ariaLabel);
  }

  setOptions(opts: SegOption<T>[]): void {
    const same =
      opts.length === this.opts.length &&
      opts.every((o, i) => {
        const p = this.opts[i];
        return p.value === o.value && p.label === o.label && p.detail === o.detail && p.meta === o.meta && p.disabled === o.disabled;
      });
    if (same) return;
    this.opts = opts;
    this.el.textContent = '';
    this.buttons.clear();
    for (const o of opts) {
      const b = h('button', 'seg-opt');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      if (this.testid) b.dataset.testid = `${this.testid}-${o.value}`;
      const l = h('span', 'seg-label', o.label);
      b.append(l);
      if (o.detail) b.append(h('span', 'seg-detail', o.detail));
      if (o.meta) b.append(h('span', 'seg-meta', o.meta));
      if (o.disabled) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('click', () => {
        if (o.disabled || this.value === o.value) return;
        this.onPick(o.value);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const i = this.opts.findIndex((x) => x.value === o.value);
        const n = this.opts[(i + (e.key === 'ArrowRight' ? 1 : this.opts.length - 1)) % this.opts.length];
        if (!n.disabled) {
          this.onPick(n.value);
          this.buttons.get(n.value)?.focus();
        }
      });
      this.buttons.set(o.value, b);
      this.el.append(b);
    }
    const v = this.value;
    this.value = null;
    if (v !== null) this.set(v);
  }

  set(v: T): void {
    if (this.value === v) return;
    this.value = v;
    for (const [k, b] of this.buttons) {
      const on = k === v;
      toggle(b, 'on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
  }
}

/** On/off switch with a label. */
export class Switch {
  readonly el: HTMLButtonElement;
  private on: boolean | null = null;
  constructor(label: string, private onFlip: (v: boolean) => void, detail?: string, testid?: string) {
    this.el = h('button', 'switch');
    if (testid) this.el.dataset.testid = testid;
    this.el.type = 'button';
    this.el.setAttribute('role', 'switch');
    const text = h('span', 'switch-text');
    text.append(h('span', 'switch-label', label));
    if (detail) text.append(h('span', 'switch-detail', detail));
    const track = h('span', 'switch-track');
    track.append(h('span', 'switch-knob'));
    this.el.append(text, track);
    this.el.addEventListener('click', () => this.onFlip(!this.on));
  }
  set(v: boolean): void {
    if (this.on === v) return;
    this.on = v;
    toggle(this.el, 'on', v);
    this.el.setAttribute('aria-checked', v ? 'true' : 'false');
  }
}

/** Custom slider (0..1) built from divs: pointer drag + arrow keys. */
export class Slider {
  readonly el: HTMLDivElement;
  private fill: HTMLDivElement;
  private knob: HTMLDivElement;
  private v = -1;
  constructor(label: string, private onSet: (v: number) => void) {
    this.el = h('div', 'slider');
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', label);
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    const track = h('div', 'slider-track');
    this.fill = h('div', 'slider-fill');
    this.knob = h('div', 'slider-knob');
    track.append(this.fill, this.knob);
    this.el.append(track);
    const fromEvent = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this.onSet(Math.round(v * 20) / 20);
    };
    this.el.addEventListener('pointerdown', (e) => {
      this.el.setPointerCapture(e.pointerId);
      fromEvent(e);
      const move = (ev: PointerEvent) => fromEvent(ev);
      const up = () => {
        this.el.removeEventListener('pointermove', move);
        this.el.removeEventListener('pointerup', up);
        this.el.removeEventListener('pointercancel', up);
      };
      this.el.addEventListener('pointermove', move);
      this.el.addEventListener('pointerup', up);
      this.el.addEventListener('pointercancel', up);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this.onSet(Math.max(0, Math.round((this.v - 0.05) * 20) / 20));
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this.onSet(Math.min(1, Math.round((this.v + 0.05) * 20) / 20));
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }
  set(v: number): void {
    if (this.v === v) return;
    this.v = v;
    const pct = `${Math.round(v * 100)}%`;
    this.fill.style.width = pct;
    this.knob.style.left = pct;
    this.el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }
}
