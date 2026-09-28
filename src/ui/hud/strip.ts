// Bottom strip (docs/ROUND2.md §A): one floating glass pill, centered, 12 px off the bottom.
//   [ ✓ Place | ATTACK | Fortify | End turn ] │ the one line ……… [ count ] [ secondary ] [ PRIMARY ]
// The Turn Track at the left is the only phase control; the right end is an action zone only. The line
// swaps (out, then in; never two at once) when its wording changes; when only a number changes it pops
// (±1) or counts (≥ 5). Everything is patched in place.

import type { ButtonVM, CountVM, StripVM, TrackSegId, TrackVM, UiIntent } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { ActionButton } from '../controls';
import { countUp, EASE_IN_QUAD, h, minus, motion, pop, setAttr, setStyle, setText, toggle } from '../dom';

/** The one line, with number-aware transitions. A change of wording never shows two lines at once:
 *  the outgoing line slides up while fading, then the new one comes in. */
class Line {
  readonly el: HTMLDivElement;
  private cur: HTMLSpanElement;
  private text = '';
  private kind = '';
  private key = -1;
  private cancels: (() => void)[] = [];

  constructor() {
    this.el = h('div', 'st-line');
    this.el.dataset.testid = 'line';
    this.cur = h('span', 'ln-text');
    this.el.append(this.cur);
  }

  private fill(span: HTMLSpanElement, text: string): void {
    span.textContent = '';
    for (const part of text.split(/(\d+%?)/)) {
      if (!part) continue;
      if (/^\d/.test(part)) span.append(h('span', 'ln-num', part));
      else span.append(document.createTextNode(part));
    }
  }

  update(text: string, kind: StripVM['lineKind'], key: number, narr: string | null): void {
    text = minus(text);
    const sameKey = key === this.key;
    if (text === this.text && kind === this.kind && sameKey) return;
    const prevText = this.text;
    const prevKind = this.kind;
    const skeleton = (s: string) => s.replace(/\d+/g, '#');
    const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
    const rejection = kind === 'rejection' && (!sameKey || prevKind !== 'rejection');
    const kindChanged = kind !== prevKind;
    this.text = text;
    this.kind = kind;
    this.key = key;
    this.el.dataset.kind = kind;
    toggle(this.el, 'is-rejection', kind === 'rejection');
    toggle(this.el, 'is-narration', kind === 'narration');
    setStyle(this.el, '--narr', narr ?? 'var(--ivory)');
    this.el.title = text;

    if (!rejection && !kindChanged && prevText && skeleton(prevText) === skeleton(text)) {
      // Same sentence, different number(s): patch the numbers in place.
      const a = nums(prevText);
      const b = nums(text);
      const spans = this.cur.querySelectorAll<HTMLSpanElement>('.ln-num');
      if (spans.length === b.length) {
        b.forEach((n, i) => {
          if (a[i] === n) return;
          const suffix = spans[i].textContent?.endsWith('%') ? '%' : '';
          if (Math.abs(n - a[i]) >= 5) this.cancels.push(countUp(spans[i], a[i], n, (x) => `${x}${suffix}`));
          else {
            setText(spans[i], `${n}${suffix}`);
            pop(spans[i], 1.14, 160);
          }
        });
        return;
      }
    }
    this.cancels.forEach((c) => c());
    this.cancels = [];
    // Only one line leaves at a time: any line still on its way out goes now.
    this.el.querySelectorAll('.ln-ghost').forEach((g) => g.remove());
    const old = this.cur;
    old.getAnimations().forEach((a) => a.cancel());
    const next = h('span', 'ln-text');
    this.fill(next, text);
    this.cur = next;
    this.el.append(next);
    if (!prevText || motion.reduced) {
      old.remove();
      return;
    }
    const quick = kind === 'rejection' || prevKind === 'rejection';
    const outMs = quick ? 70 : 100;
    const inMs = quick ? 110 : 150;
    old.classList.add('ln-ghost');
    const out = old.animate(
      [
        { opacity: 1, transform: 'translateY(-50%)' },
        { opacity: 0, transform: 'translateY(calc(-50% - 6px))' },
      ],
      { duration: outMs, easing: EASE_IN_QUAD, fill: 'forwards' },
    );
    out.onfinish = () => old.remove();
    next.animate(
      [
        { opacity: 0, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: inMs, delay: outMs, easing: 'ease-out', fill: 'backwards' },
    );
  }
}

/**
 * The Turn Track (docs/ROUND2.md §A): Place · Attack · Fortify · End turn (or Setup · Done) in one pill
 * group. The marker (a fill in the seat's colour) slides to the new segment in 180 ms; the recommended
 * next segment glows; forward segments are the buttons that change phase. It never hides or renames.
 */
class Track {
  readonly el: HTMLDivElement;
  private fill: HTMLSpanElement;
  private segs = new Map<TrackSegId, HTMLButtonElement>();
  private order: TrackSegId[] = [];
  private vm: TrackVM | null = null;
  private turnKey = '';
  private placed: TrackSegId | null = null;

  constructor(private send: (i: UiIntent) => void) {
    this.el = h('div', 'track');
    this.el.dataset.testid = 'track';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Turn');
    this.fill = h('span', 'tr-fill');
    this.fill.setAttribute('aria-hidden', 'true');
    this.el.append(this.fill);
    new ResizeObserver(() => this.placeFill(false)).observe(this.el);
  }

  private build(ids: TrackSegId[]): void {
    for (const b of this.segs.values()) b.remove();
    this.segs.clear();
    this.order = ids;
    for (const id of ids) {
      const b = h('button', `tr-seg nofocus seg-${id}`);
      b.type = 'button';
      b.dataset.testid = `seg-${id}`;
      b.dataset.seg = id;
      b.append(h('span', 'tr-check', '✓'), h('span', 'tr-label'));
      b.addEventListener('click', () => {
        const vm = this.vm;
        const seg = vm?.segments.find((x) => x.id === id);
        if (!vm || !seg || !vm.live) return;
        if (seg.state === 'eligible' || seg.state === 'locked') this.send({ type: 'track', seg: id });
      });
      this.segs.set(id, b);
      this.el.append(b);
    }
    this.placed = null;
  }

  /** Put the marker under the current segment: a slide (180 ms), or a cut when the turn changed hands. */
  private placeFill(slide: boolean): void {
    const vm = this.vm;
    const cur = vm?.segments.find((x) => x.state === 'current');
    const b = cur ? this.segs.get(cur.id) : null;
    if (!vm || !b || !b.offsetWidth) {
      toggle(this.fill, 'hidden', !b);
      return;
    }
    toggle(this.fill, 'hidden', false);
    const x = `${b.offsetLeft}px`;
    const w = `${b.offsetWidth}px`;
    if (!slide || motion.reduced) {
      this.fill.style.transition = 'none';
      this.fill.style.transform = `translateX(${x})`;
      this.fill.style.width = w;
      void this.fill.offsetWidth;
      this.fill.style.transition = '';
    } else {
      this.fill.style.transform = `translateX(${x})`;
      this.fill.style.width = w;
    }
    this.placed = cur!.id;
  }

  update(vm: TrackVM): void {
    if (this.vm === vm) return;
    const prev = this.vm;
    this.vm = vm;
    const ids = vm.segments.map((x) => x.id);
    if (ids.join() !== this.order.join()) this.build(ids);
    const pal = PLAYER_COLORS[vm.seat.color];
    setStyle(this.el, '--seat', pal.base);
    setStyle(this.el, '--seat-ink', pal.ink);
    setStyle(this.el, '--seat-light', pal.light);
    toggle(this.el, 'is-live', vm.live);
    toggle(this.el, 'is-disabled', vm.disabled);
    toggle(this.el, 'is-watch', !vm.live);
    this.el.dataset.kind = vm.kind;
    for (const seg of vm.segments) {
      const b = this.segs.get(seg.id)!;
      setText(b.querySelector('.tr-label')!, seg.label);
      b.dataset.state = seg.state;
      for (const st of ['done', 'current', 'eligible', 'locked'] as const) toggle(b, `is-${st}`, seg.state === st);
      const rec = vm.recommended === seg.id;
      toggle(b, 'is-rec', rec);
      toggle(b, 'is-primary', rec && vm.primary);
      // A locked segment still answers a click (its reason goes in the line); done / current don't.
      const answers = vm.live && !vm.disabled && (seg.state === 'eligible' || seg.state === 'locked');
      setAttr(b, 'aria-disabled', answers ? null : 'true');
      b.tabIndex = vm.live && !vm.disabled && seg.state === 'eligible' ? 0 : -1;
      setAttr(b, 'aria-current', seg.state === 'current' ? 'step' : null);
    }
    const cur = vm.segments.find((x) => x.state === 'current')?.id ?? null;
    const handsChanged = vm.turnKey !== this.turnKey;
    this.turnKey = vm.turnKey;
    if (cur !== this.placed || handsChanged || prev?.seat.color !== vm.seat.color) {
      const slide = !!prev && !handsChanged && prev.kind === vm.kind;
      this.placeFill(slide);
      if (handsChanged && prev && !motion.reduced) this.fill.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    }
  }
}

/** − N + for the Place count. Hold a side to repeat. */
class Stepper {
  readonly el: HTMLDivElement;
  private dec: HTMLButtonElement;
  private inc: HTMLButtonElement;
  private n: HTMLSpanElement;
  private vm: CountVM | null = null;
  private repeatT = 0;
  private repeatI = 0;
  private value = -1;

  constructor(private send: (i: UiIntent) => void) {
    this.el = h('div', 'stepper-ctl');
    this.dec = h('button', 'sp-btn nofocus', '−');
    this.inc = h('button', 'sp-btn nofocus', '+');
    this.dec.type = this.inc.type = 'button';
    this.dec.setAttribute('aria-label', 'One fewer');
    this.inc.setAttribute('aria-label', 'One more');
    this.dec.dataset.testid = 'count-dec';
    this.inc.dataset.testid = 'count-inc';
    this.n = h('span', 'sp-n num');
    this.n.dataset.testid = 'count';
    this.el.append(this.dec, this.n, this.inc);
    for (const [b, d] of [
      [this.dec, -1],
      [this.inc, 1],
    ] as const) {
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this.step(d);
        this.stop();
        this.repeatT = window.setTimeout(() => (this.repeatI = window.setInterval(() => this.step(d), 90)), 380);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => this.stop());
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.step(d);
        }
      });
    }
  }

  private step(d: number): void {
    const vm = this.vm;
    if (!vm) return;
    const v = Math.max(vm.min, Math.min(vm.max, vm.value + d));
    if (v !== vm.value) {
      this.vm = { ...vm, value: v };
      this.send({ type: 'setCount', value: v });
    } else this.stop();
  }

  private stop(): void {
    window.clearTimeout(this.repeatT);
    window.clearInterval(this.repeatI);
  }

  update(vm: CountVM): void {
    this.vm = vm;
    setAttr(this.dec, 'aria-disabled', vm.value <= vm.min ? 'true' : null);
    setAttr(this.inc, 'aria-disabled', vm.value >= vm.max ? 'true' : null);
    if (vm.value !== this.value) {
      if (this.value >= 0) pop(this.n, 1.12, 140);
      this.value = vm.value;
      setText(this.n, String(vm.value));
    }
    this.el.setAttribute('aria-label', `${vm.value} of ${vm.max}`);
  }

  reset(): void {
    this.stop();
    this.value = -1;
  }
}

/** A min…max slider for Occupy and Fortify: drag, click the track, or arrow keys. */
class CountSlider {
  readonly el: HTMLDivElement;
  private track: HTMLDivElement;
  private fill: HTMLDivElement;
  private knob: HTMLDivElement;
  private lo: HTMLSpanElement;
  private hi: HTMLSpanElement;
  private vm: CountVM | null = null;

  constructor(private send: (i: UiIntent) => void) {
    this.el = h('div', 'count-slider');
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', 'Armies to move');
    this.el.dataset.testid = 'count-slider';
    this.lo = h('span', 'cs-end num');
    this.hi = h('span', 'cs-end num');
    this.track = h('div', 'cs-track');
    this.fill = h('div', 'cs-fill');
    this.knob = h('div', 'cs-knob');
    this.track.append(this.fill, this.knob);
    this.el.append(this.lo, this.track, this.hi);
    const at = (e: PointerEvent) => {
      const vm = this.vm;
      if (!vm) return;
      const r = this.track.getBoundingClientRect();
      const k = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      this.set(Math.round(vm.min + k * (vm.max - vm.min)));
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      at(e);
      const move = (ev: PointerEvent) => at(ev);
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
      const vm = this.vm;
      if (!vm) return;
      const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
      if (e.key === 'Home') this.set(vm.min);
      else if (e.key === 'End') this.set(vm.max);
      else if (d) this.set(vm.value + d);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  private set(v: number): void {
    const vm = this.vm;
    if (!vm) return;
    const value = Math.max(vm.min, Math.min(vm.max, v));
    if (value === vm.value) return;
    this.vm = { ...vm, value };
    this.paint();
    this.send({ type: 'setCount', value });
  }

  private paint(): void {
    const vm = this.vm!;
    const k = vm.max > vm.min ? (vm.value - vm.min) / (vm.max - vm.min) : 1;
    const pct = `${(k * 100).toFixed(2)}%`;
    this.fill.style.width = pct;
    this.knob.style.left = pct;
    this.el.setAttribute('aria-valuemin', String(vm.min));
    this.el.setAttribute('aria-valuemax', String(vm.max));
    this.el.setAttribute('aria-valuenow', String(vm.value));
  }

  update(vm: CountVM): void {
    this.vm = vm;
    setText(this.lo, String(vm.min));
    setText(this.hi, String(vm.max));
    this.paint();
  }
}

/** Keyed pool of ActionButtons. */
class Buttons {
  readonly el: HTMLDivElement;
  private pool = new Map<string, ActionButton>();
  constructor(private press: (b: ButtonVM) => void) {
    this.el = h('div', 'st-buttons');
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
  }
}

export class BottomStrip {
  readonly el: HTMLElement;
  private track: Track;
  private line = new Line();
  private count: HTMLDivElement;
  private stepper: Stepper;
  private slider: CountSlider;
  private buttons: Buttons;
  private sweep: HTMLSpanElement;
  private vm: StripVM | null = null;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('section', 'strip');
    this.el.dataset.testid = 'strip';
    this.el.setAttribute('aria-label', 'Your move');
    this.el.setAttribute('aria-live', 'polite');
    this.track = new Track(send);
    this.count = h('div', 'st-count');
    this.stepper = new Stepper(send);
    this.slider = new CountSlider(send);
    this.count.append(this.stepper.el, this.slider.el);
    this.buttons = new Buttons((b) => send({ type: 'button', id: b.id }));
    const zone = h('div', 'st-zone');
    zone.dataset.testid = 'action-zone';
    zone.append(this.count, this.buttons.el);
    this.sweep = h('span', 'st-sweep');
    this.sweep.setAttribute('aria-hidden', 'true');
    this.el.append(this.sweep, this.track.el, h('i', 'st-rule'), this.line.el, zone);
    // The mouse wheel over the strip adjusts the count.
    this.el.addEventListener(
      'wheel',
      (e) => {
        const c = this.vm?.count;
        if (!c) return;
        e.preventDefault();
        const v = Math.max(c.min, Math.min(c.max, c.value + (e.deltaY < 0 ? 1 : -1)));
        if (v !== c.value) send({ type: 'setCount', value: v });
      },
      { passive: false },
    );
  }

  update(vm: StripVM): void {
    if (this.vm === vm) return;
    const prev = this.vm;
    this.vm = vm;
    const pal = PLAYER_COLORS[vm.accent];
    // The turn passes: the accent sweeps left → right in the new colour (280 ms).
    if (prev && prev.accent !== vm.accent && !motion.reduced) {
      setStyle(this.sweep, '--to', pal.base);
      this.sweep.getAnimations().forEach((a) => a.cancel());
      const a = this.sweep.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 280, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });
      a.onfinish = () => setStyle(this.el, '--accent', pal.base);
    } else setStyle(this.el, '--accent', pal.base);
    this.el.dataset.mode = vm.mode;
    this.track.update(vm.track);
    this.line.update(vm.line, vm.lineKind, vm.lineKey, vm.lineKind === 'narration' ? PLAYER_COLORS[vm.track.seat.color].light : null);
    const c = vm.count;
    toggle(this.count, 'hidden', !c);
    toggle(this.stepper.el, 'hidden', c?.control !== 'stepper');
    toggle(this.slider.el, 'hidden', c?.control !== 'slider');
    if (c?.control === 'stepper') this.stepper.update(c);
    else this.stepper.reset();
    if (c?.control === 'slider') this.slider.update(c);
    this.buttons.update(vm.buttons);
  }
}
