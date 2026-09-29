// Title (docs/INK.md B5): the painting, flat, and on it "War Table" in serif small caps with the ensō
// drawing itself beneath on the gold rule (~900 ms). Three lines: New game · Continue · How to play, and
// one quiet Settings word (text size lives in Settings). One gold: Continue when a save exists, else
// New game — a gold outline with gold words; the rest are words.

import type { UiIntent, ViewModel } from '../../game/viewModel';
import { uiButton } from '../controls';
import { drawEnso, drawIn, ensoEl, h, motion, setEnso, setText, toggle } from '../dom';

/** The title's mark is always the same brush (the game's own ensō is drawn from its seed in play). */
const TITLE_SEED = 2026;

export class TitleScreen {
  readonly el: HTMLElement;
  private cont: HTMLButtonElement;
  private contSub: HTMLSpanElement;
  private ng: HTMLButtonElement;
  private menu: HTMLDivElement;
  private mark: SVGSVGElement;
  private name: HTMLElement;
  private hasSave: boolean | null = null;
  private drawn = false;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('section', 'screen title-screen');
    const col = h('div', 'title-col');
    const lock = h('div', 'lockup');
    this.name = h('h1', 'lk-name', 'War Table');
    const rule = h('div', 'lk-rule');
    this.mark = ensoEl(TITLE_SEED, 'enso lk-enso', { drawable: true });
    rule.append(h('i', 'lk-half'), this.mark, h('i', 'lk-half'));
    lock.append(this.name, rule);

    const menu = (this.menu = h('div', 'title-menu'));
    this.ng = uiButton('New game', 'title-item', () => send({ type: 'nav', screen: 'newGame' }), undefined, 'title-new');
    this.cont = uiButton('Continue', 'title-item continue', () => send({ type: 'continue' }), undefined, 'title-continue');
    this.contSub = h('span', 'btn-sub num');
    this.cont.append(this.contSub);
    const rules = uiButton('How to play', 'title-item', () => send({ type: 'overlay', overlay: 'rules' }), undefined, 'title-rules');
    const settings = uiButton('Settings', 'title-item quiet', () => send({ type: 'overlay', overlay: 'settings' }), undefined, 'title-settings');
    menu.append(this.ng, this.cont, rules, settings);
    col.append(lock, menu);
    this.el.append(h('div', 'title-scrim'), col);
  }

  /** Kept for the root's call (the fitted-text note now lives only in Settings). */
  setFitted(_on: boolean): void {}

  update(vm: ViewModel): void {
    const save = !!vm.save;
    if (save !== this.hasSave) {
      this.hasSave = save;
      toggle(this.cont, 'hidden', !save);
      const primary = save ? this.cont : this.ng;
      const secondary = save ? this.ng : this.cont;
      primary.classList.add('brass', 'gold', 'role-primary');
      secondary.classList.remove('brass', 'gold', 'role-primary');
      // Primary first.
      this.menu.prepend(primary);
      primary.after(secondary);
    }
    if (vm.save) setText(this.contSub, vm.save.summary);
    setEnso(this.mark, TITLE_SEED, { drawable: true });
    if (vm.screen === 'title' && !this.drawn) {
      this.drawn = true;
      // Arrival: the name is brushed on, then the ensō draws itself round once; the words follow.
      drawIn(this.name, 420);
      drawEnso(this.mark, 900, motion.reduced ? 0 : 180);
      if (!motion.reduced) [...this.menu.children].forEach((c, i) => drawIn(c as HTMLElement, 260, 420 + i * 70));
    }
    if (vm.screen !== 'title') this.drawn = false;
  }
}
