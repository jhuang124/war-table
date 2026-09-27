// Battle panel text (UX.md §5.1). The renderer draws the tray and dice in the middle ~56% of the band;
// this draws TEXT ONLY around it, on smoked-glass strips that never cover the tray's middle:
//
//   top strip:     JOHN ▲ URAL 8          vs          SAM ● SIBERIA 3
//   (middle 56%:   [ attacker dice ]              [ defender dice ]      ← renderer)
//   bottom strip:  Blitz · 82% · likely  │  COMPLETES SOUTH AMERICA · +2 a turn
//                  Sam loses 2           │  URAL 8 → 5 · SIBERIA 3 → 0 · 58%

import type { BattleSideVM, BattleVM } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { emblem, h, minus, pop, setEmblem, setStyle, setText, toggle } from '../dom';

class Side {
  readonly el: HTMLDivElement;
  private name: HTMLSpanElement;
  private emb: SVGSVGElement;
  private terr: HTMLSpanElement;
  private armies: HTMLSpanElement;
  private last = -1;
  constructor(cls: string) {
    this.el = h('div', `bt-side ${cls}`);
    this.name = h('span', 'bt-name');
    this.emb = emblem('crimson');
    this.terr = h('span', 'bt-terr');
    this.armies = h('span', 'bt-armies num');
    this.el.append(this.name, this.emb, this.terr, this.armies);
  }
  update(s: BattleSideVM): void {
    setText(this.name, s.seat.name.toUpperCase());
    setStyle(this.name, 'color', PLAYER_COLORS[s.seat.color].light);
    setEmblem(this.emb, s.seat.color);
    setText(this.terr, s.territory.toUpperCase());
    if (s.armies !== this.last) {
      if (this.last >= 0) pop(this.armies, 1.2, 160);
      this.last = s.armies;
      setText(this.armies, String(s.armies));
    }
  }
  reset(): void {
    this.last = -1;
  }
}

export class BattlePanel {
  readonly el: HTMLElement;
  private att = new Side('bt-att');
  private def = new Side('bt-def');
  private top: HTMLDivElement;
  private bottom: HTMLDivElement;
  private main: HTMLDivElement;
  private aside: HTMLDivElement;
  private tie: HTMLSpanElement;
  private vm: BattleVM | null = null;
  private shown = false;
  private lastResult: string | null = null;

  constructor() {
    this.el = h('section', 'battle hidden');
    this.el.setAttribute('aria-label', 'Battle');
    this.el.setAttribute('aria-live', 'polite');
    this.top = h('div', 'bt-strip bt-top');
    this.top.append(this.att.el, h('span', 'bt-vs', 'vs'), this.def.el);
    const mid = h('div', 'bt-mid');
    this.tie = h('span', 'bt-tie', 'Ties go to the defender');
    this.bottom = h('div', 'bt-strip bt-bottom');
    this.main = h('div', 'bt-main');
    this.aside = h('div', 'bt-aside');
    this.bottom.append(this.main, this.aside);
    this.el.append(this.top, mid, this.bottom);
  }

  update(vm: BattleVM | null): void {
    if (vm === this.vm) return;
    this.vm = vm;
    if (!vm) {
      if (this.shown) {
        this.shown = false;
        this.el.classList.add('leaving');
        const a = this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
        a.onfinish = () => {
          if (!this.shown) {
            this.el.classList.add('hidden');
            this.el.classList.remove('leaving');
            this.att.reset();
            this.def.reset();
            this.lastResult = null;
          }
          a.cancel();
        };
      }
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.el.getAnimations().forEach((a) => a.cancel());
      this.el.classList.remove('hidden', 'leaving');
      this.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
    this.att.update(vm.attacker);
    this.def.update(vm.defender);

    // Bottom strip: before a roll = odds; after = result. Rolling = the dice speak, odds dim.
    const showResult = !!vm.result && !vm.rolling;
    this.main.textContent = '';
    this.aside.textContent = '';
    if (showResult) {
      const r = h('span', 'bt-result', minus(vm.result!));
      this.main.append(r);
      if (vm.result !== this.lastResult) pop(r, 1.08, 200);
    } else if (vm.odds) {
      this.main.append(h('span', `bt-odds${vm.rolling ? ' dim' : ''}`, minus(vm.odds.label)));
    }
    this.lastResult = showResult ? vm.result : this.lastResult;

    const asideLines: HTMLElement[] = [];
    if (vm.tally) asideLines.push(h('span', 'bt-tally num', minus(vm.tally)));
    // Stakes stay visible while armed; after a roll they give way to the tally.
    if (!vm.tally || !showResult) {
      for (const s of vm.stakes.slice(0, vm.tally ? 1 : 2)) asideLines.push(h('span', `bt-stake${s.priority ? ' priority' : ''}`, minus(s.text)));
    }
    if (vm.tieHint && showResult && asideLines.length < 2) asideLines.push(this.tie);
    this.aside.append(...asideLines);
    toggle(this.aside, 'hidden', asideLines.length === 0);
    toggle(this.bottom, 'solo', asideLines.length === 0);
    toggle(this.bottom, 'hidden', !showResult && !vm.odds && asideLines.length === 0);
  }
}
