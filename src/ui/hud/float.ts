// Things that float over the board: the territory tooltip (UX.md §7.4) and the reinforce pills (§3.2).

import type { BattleVM, ControllerApi, PillsVM, TooltipVM, UiIntent } from '../../game/viewModel';
import type { TerritoryId } from '../../engine/types';
import { PLAYER_COLORS } from '../../shared/palette';
import { emblem, h, setEmblem, setStyle, setText, toggle } from '../dom';

/** Approximate badge footprint around its anchor (renderer draws a ~22–30 px pill centered there). */
const BADGE_HALF_W = 40;
const BADGE_HALF_H = 18;

export class Tooltip {
  readonly el: HTMLDivElement;
  private name: HTMLDivElement;
  private cont: HTMLDivElement;
  private ownerEmb: SVGSVGElement;
  private ownerName: HTMLSpanElement;
  private armies: HTMLSpanElement;
  private line: HTMLDivElement;
  private vm: TooltipVM | null = null;
  private shown = false;
  private hideTimer = 0;

  /** Other floating UI the tooltip must not cover (the reinforce pills). */
  avoid: HTMLElement | null = null;

  constructor(private api: ControllerApi) {
    this.el = h('div', 'tooltip hidden');
    this.el.setAttribute('role', 'tooltip');
    this.name = h('div', 'tt-name');
    this.cont = h('div', 'tt-cont');
    const owner = h('div', 'tt-owner');
    this.ownerEmb = emblem('crimson');
    this.ownerName = h('span', 'tt-owner-name');
    this.armies = h('span', 'tt-armies num');
    owner.append(this.ownerEmb, this.ownerName, this.armies);
    this.line = h('div', 'tt-line');
    this.el.append(this.name, this.cont, owner, this.line);
  }

  /**
   * `battle`: while an attack is armed, the source and the target already have their story in the
   * battle panel and the bar, so hovering them shows no tooltip (it would sit on the arrow).
   */
  update(vm: TooltipVM | null, battle: BattleVM | null = null): void {
    if (vm && battle && (vm.name === battle.attacker.territory || vm.name === battle.defender.territory)) vm = null;
    if (vm === this.vm) return;
    this.vm = vm;
    if (!vm) {
      // Hide 120 ms after the pointer leaves (the controller already debounces hover).
      window.clearTimeout(this.hideTimer);
      this.hideTimer = window.setTimeout(() => {
        if (!this.vm) {
          this.shown = false;
          this.el.classList.add('hidden');
        }
      }, 120);
      return;
    }
    window.clearTimeout(this.hideTimer);
    setText(this.name, vm.name);
    setText(this.cont, vm.continent);
    if (vm.owner) {
      setEmblem(this.ownerEmb, vm.owner.color);
      setText(this.ownerName, vm.owner.name);
      setStyle(this.el, '--seat', PLAYER_COLORS[vm.owner.color].base);
    } else {
      setText(this.ownerName, 'Unclaimed');
      setStyle(this.el, '--seat', '#cbbd9b');
    }
    toggle(this.ownerEmb, 'hidden', !vm.owner);
    setText(this.armies, vm.armies === 1 ? '1 army' : `${vm.armies} armies`);
    setText(this.line, vm.line);
    toggle(this.line, 'bad', !vm.ok);
    if (!this.shown) {
      this.shown = true;
      this.el.classList.remove('hidden');
    }
    this.place(vm);
  }

  /** 18 px up-right of the cursor; flips to stay in the viewport and off the hovered tile's badge. */
  private place(vm: TooltipVM): void {
    const r = this.el.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const off = 18;
    const cands: [number, number][] = [
      [vm.x + off, vm.y - off - r.height], // up-right
      [vm.x - off - r.width, vm.y - off - r.height], // up-left
      [vm.x + off, vm.y + off], // down-right
      [vm.x - off - r.width, vm.y + off], // down-left
    ];
    // Keep off the hovered tile's badge, and off the selected source / target (the arrow or route runs
    // between them) when the controller names them (additive TooltipVM.avoid).
    const ids: TerritoryId[] = [...(vm.territory ? [vm.territory] : []), ...(vm.avoid ?? [])];
    const anchors = ids.map((t) => this.api.screenPos(t)).filter((p): p is { x: number; y: number } => !!p);
    const fits = ([x, y]: [number, number]) => x >= 8 && y >= 8 && x + r.width <= W - 8 && y + r.height <= H - 8;
    const clearOf = (badge: { x: number; y: number }, [x, y]: [number, number]) =>
      x > badge.x + BADGE_HALF_W ||
      x + r.width < badge.x - BADGE_HALF_W ||
      y > badge.y + BADGE_HALF_H ||
      y + r.height < badge.y - BADGE_HALF_H;
    const clearOfBadge = (c: [number, number]) => anchors.every((a) => clearOf(a, c));
    const av = this.avoid && !this.avoid.classList.contains('hidden') ? this.avoid.getBoundingClientRect() : null;
    const clearOfPills = ([x, y]: [number, number]) =>
      !av || !av.width || x > av.right + 4 || x + r.width < av.left - 4 || y > av.bottom + 4 || y + r.height < av.top - 4;
    const pick =
      cands.find((c) => fits(c) && clearOfBadge(c) && clearOfPills(c)) ??
      cands.find((c) => fits(c) && (!anchors[0] || clearOf(anchors[0], c)) && clearOfPills(c)) ??
      cands.find((c) => fits(c) && clearOfPills(c)) ??
      cands.find(fits) ??
      cands[0];
    const x = Math.max(8, Math.min(W - r.width - 8, pick[0]));
    const y = Math.max(8, Math.min(H - r.height - 8, pick[1]));
    this.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  text(): string | null {
    return this.vm ? `${this.vm.name} · ${this.vm.line}` : null;
  }
}

export class Pills {
  readonly el: HTMLDivElement;
  private plus5: HTMLButtonElement;
  private all: HTMLButtonElement;
  private vm: PillsVM | null = null;
  private repeat = 0;
  private repeatDelay = 0;
  private lastX = NaN;
  private lastY = NaN;

  constructor(private api: ControllerApi, private send: (i: UiIntent) => void) {
    this.el = h('div', 'pills hidden');
    this.plus5 = h('button', 'pill nofocus');
    this.plus5.type = 'button';
    this.all = h('button', 'pill nofocus');
    this.all.type = 'button';
    this.plus5.dataset.testid = 'pill-plus5';
    this.all.dataset.testid = 'pill-all';
    this.el.append(this.plus5, this.all);
    // Hold +5 to repeat every 150 ms (after a 350 ms hold).
    this.plus5.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.enabled('plus5')) return;
      this.send({ type: 'pill', id: 'plus5' });
      this.stopRepeat();
      this.repeatDelay = window.setTimeout(() => {
        this.repeat = window.setInterval(() => {
          if (this.enabled('plus5')) this.send({ type: 'pill', id: 'plus5' });
          else this.stopRepeat();
        }, 150);
      }, 350);
    });
    const stop = () => this.stopRepeat();
    this.plus5.addEventListener('pointerup', stop);
    this.plus5.addEventListener('pointerleave', stop);
    this.plus5.addEventListener('pointercancel', stop);
    this.all.addEventListener('click', () => {
      if (!this.enabled('all')) return;
      this.send({ type: 'pill', id: 'all' });
      // Nothing is left to place: get out of the way of the neighbouring tiles now, not a frame later.
      this.stopRepeat();
      this.el.classList.add('hidden');
      this.vm = null;
    });
  }

  private enabled(id: 'plus5' | 'all'): boolean {
    return !!this.vm && this.enabledIn(this.vm, id) && !(id === 'plus5' && this.plus5.classList.contains('hidden'));
  }

  private enabledIn(vm: PillsVM, id: 'plus5' | 'all'): boolean {
    return !!vm.buttons.find((b) => b.id === id)?.enabled;
  }

  private stopRepeat(): void {
    window.clearTimeout(this.repeatDelay);
    window.clearInterval(this.repeat);
  }

  update(vm: PillsVM | null): void {
    if (vm === this.vm) return;
    const moved = !this.vm || !vm || vm.territory !== this.vm.territory;
    this.vm = vm;
    toggle(this.el, 'hidden', !vm);
    if (!vm) {
      this.stopRepeat();
      return;
    }
    // With 5 or fewer left, '+5' clamps to the remainder and would duplicate 'All N': show only All.
    const count = (id: 'plus5' | 'all') => Number(/\d+/.exec(vm.buttons.find((x) => x.id === id)?.label ?? '')?.[0] ?? NaN);
    const allN = count('all');
    const dupPlus5 = vm.buttons.some((x) => x.id === 'all') && (!this.enabledIn(vm, 'plus5') || !(allN > 5) || count('plus5') >= allN);
    if (dupPlus5) this.stopRepeat();
    for (const [id, btn] of [
      ['plus5', this.plus5],
      ['all', this.all],
    ] as const) {
      const b = vm.buttons.find((x) => x.id === id);
      toggle(btn, 'hidden', !b || (id === 'plus5' && dupPlus5));
      if (!b) continue;
      setText(btn, b.label);
      toggle(btn, 'is-disabled', !b.enabled);
      btn.setAttribute('aria-disabled', String(!b.enabled));
      if (b.enabled) delete btn.dataset.why;
      else btn.dataset.why = id === 'plus5' ? 'Fewer than 5 left · use All' : 'Nothing left to place';
    }
    if (moved) {
      this.lastX = NaN;
      this.frame();
    }
  }

  /** Called every rAF while pills are showing: follow the tile's badge. */
  frame(): void {
    const vm = this.vm;
    if (!vm) return;
    const p = this.api.screenPos(vm.territory);
    toggle(this.el, 'offscreen', !p);
    if (!p) return;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x === this.lastX && y === this.lastY) return;
    this.lastX = x;
    this.lastY = y;
    this.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, 0)`;
  }

  get active(): boolean {
    return !!this.vm;
  }
}
