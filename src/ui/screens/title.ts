// Title screen (SPEC §7 Screens 1): the name over the attract-mode board.

import type { TextSize, UiIntent, ViewModel } from '../../game/viewModel';
import { Segmented, uiButton } from '../controls';
import { h, setText, toggle } from '../dom';

export class TitleScreen {
  readonly el: HTMLElement;
  private cont: HTMLButtonElement;
  private contSub: HTMLSpanElement;
  private contKey: HTMLElement;
  private ng: HTMLButtonElement;
  private ngKey: HTMLElement;
  private menu: HTMLDivElement;
  private hasSave: boolean | null = null;
  private text: Segmented<TextSize>;
  private fitNote: HTMLSpanElement;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('section', 'screen title-screen');
    const col = h('div', 'title-col');
    const lock = h('div', 'lockup');
    lock.append(h('div', 'lk-risk', 'Risk'));
    const wt = h('div', 'lk-sub');
    wt.append(h('i', 'lk-rule'), h('span', '', 'War Table'), h('i', 'lk-rule'));
    lock.append(wt);
    const tag = h('p', 'title-tag', 'Classic Risk for 2 to 4 players around one screen. Any seat can be an AI.');

    const menu = (this.menu = h('div', 'title-menu'));
    // The brass button (and Enter) is New game, or Continue when a save exists: the group that closed
    // the lid mid-evening presses Enter and is back in the game.
    this.ng = uiButton('New game', 'big', () => send({ type: 'nav', screen: 'newGame' }), 'Enter', 'title-new');
    this.ngKey = this.ng.querySelector('kbd')!;
    this.cont = uiButton('Continue', 'big continue', () => send({ type: 'continue' }), 'Enter', 'title-continue');
    const contRow = h('span', 'btn-row');
    this.contKey = this.cont.querySelector('kbd')!;
    contRow.append(this.cont.querySelector('.btn-label')!, this.contKey);
    this.contSub = h('span', 'btn-sub num');
    this.cont.append(contRow, this.contSub);
    const ng = this.ng;
    const links = h('div', 'title-links');
    links.append(
      uiButton('How to play', 'link', () => send({ type: 'overlay', overlay: 'rules' }), undefined, 'title-rules'),
      uiButton('Settings', 'link', () => send({ type: 'overlay', overlay: 'settings' }), undefined, 'title-settings'),
    );
    const ts = h('div', 'title-textsize');
    const tl = h('span', 'field-label', 'Text size');
    this.fitNote = h('span', 'field-detail hidden', 'fitted to this screen');
    tl.append(this.fitNote);
    ts.append(tl);
    this.text = new Segmented<TextSize>('seg-row', (v) => send({ type: 'setting', patch: { textSize: v } }), 'Text size', 'textsize');
    this.text.setOptions([
      { value: 'laptop', label: 'Laptop' },
      { value: 'couch', label: 'Couch' },
      { value: 'tv', label: 'TV' },
    ]);
    ts.append(this.text.el);
    menu.append(ng, this.cont, links, ts);
    col.append(lock, tag, menu);
    this.el.append(h('div', 'title-scrim'), col);
  }

  /** The chosen text size is bigger than this screen has room for, so it was fitted down (src/ui/uiScale.ts). */
  setFitted(on: boolean): void {
    toggle(this.fitNote, 'hidden', !on);
  }

  update(vm: ViewModel): void {
    const save = !!vm.save;
    if (save !== this.hasSave) {
      this.hasSave = save;
      toggle(this.cont, 'hidden', !save);
      const primary = save ? this.cont : this.ng;
      const secondary = save ? this.ng : this.cont;
      primary.classList.add('brass', 'role-primary');
      primary.classList.remove('role-secondary');
      secondary.classList.remove('brass', 'role-primary');
      secondary.classList.add('role-secondary');
      toggle(this.contKey, 'hidden', !save);
      toggle(this.ngKey, 'hidden', save);
      // Primary first.
      this.menu.prepend(primary);
      primary.after(secondary);
    }
    if (vm.save) setText(this.contSub, vm.save.summary);
    this.text.set(vm.settings.textSize);
  }
}
