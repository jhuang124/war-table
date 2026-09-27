// Title screen (SPEC §7 Screens 1): the name over the attract-mode board.

import type { TextSize, UiIntent, ViewModel } from '../../game/viewModel';
import { Segmented, uiButton } from '../controls';
import { h, setText, toggle } from '../dom';

export class TitleScreen {
  readonly el: HTMLElement;
  private cont: HTMLButtonElement;
  private contSub: HTMLSpanElement;
  private text: Segmented<TextSize>;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('section', 'screen title-screen');
    const col = h('div', 'title-col');
    const lock = h('div', 'lockup');
    lock.append(h('div', 'lk-risk', 'Risk'));
    const wt = h('div', 'lk-sub');
    wt.append(h('i', 'lk-rule'), h('span', '', 'War Table'), h('i', 'lk-rule'));
    lock.append(wt);
    const tag = h('p', 'title-tag', 'Classic Risk for 2 to 4 players around one screen. Any seat can be an AI.');

    const menu = h('div', 'title-menu');
    const ng = uiButton('New game', 'brass role-primary big', () => send({ type: 'nav', screen: 'newGame' }), 'Enter', 'title-new');
    this.cont = uiButton('Continue', 'role-secondary big continue', () => send({ type: 'continue' }), undefined, 'title-continue');
    this.contSub = h('span', 'btn-sub num');
    this.cont.append(this.contSub);
    const links = h('div', 'title-links');
    links.append(
      uiButton('How to play', 'link', () => send({ type: 'overlay', overlay: 'rules' }), undefined, 'title-rules'),
      uiButton('Settings', 'link', () => send({ type: 'overlay', overlay: 'settings' }), undefined, 'title-settings'),
    );
    const ts = h('div', 'title-textsize');
    ts.append(h('span', 'field-label', 'Text size'));
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

  update(vm: ViewModel): void {
    toggle(this.cont, 'hidden', !vm.save);
    if (vm.save) setText(this.contSub, vm.save.summary);
    this.text.set(vm.settings.textSize);
  }
}
