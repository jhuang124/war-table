// Modal-ish layers: the hand-off cover, the confirm dialog, and the menu (≡ / Esc) with the sheets it
// opens: rules, settings (AI speed and the seat hand-off live here now) and the read-only log.

import type { GameVM, LogLineVM, SeatRef, Settings, UiIntent, ViewModel } from '../game/viewModel';

import { PLAYER_COLORS } from '../shared/palette';
import { Segmented, Slider, Switch, uiButton } from './controls';
import { animateIn, emblem, h, minus, motion, setAttr, setStyle, setText, titleText, toggle } from './dom';

type Send = (i: UiIntent) => void;

// ---------------------------------------------------------------------------
// Hand-off cover: mounted at full opacity in the same frame (no fade in), fades out 240 ms.
// ---------------------------------------------------------------------------

export class Handoff {
  readonly el: HTMLDivElement;
  private title: HTMLHeadingElement;
  private sub: HTMLParagraphElement;
  private btnLabel: HTMLSpanElement;
  private emb: HTMLDivElement;
  private seat: SeatRef | null = null;
  private vmRef: GameVM['handoff'] = null;

  constructor(send: Send) {
    this.el = h('div', 'handoff hidden');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.append(h('div', 'ho-band'));
    const box = h('div', 'ho-box');
    this.emb = h('div', 'ho-emb');
    this.title = h('h1', 'ho-title');
    this.sub = h('p', 'ho-sub num');
    const btn = uiButton('', 'brass role-primary big', () => send({ type: 'handoffAccept' }), undefined, 'handoff-accept');
    this.btnLabel = btn.querySelector('.btn-label')!;
    box.append(this.emb, this.title, this.sub, btn);
    this.el.append(box);
  }

  update(vm: GameVM['handoff']): void {
    if (vm === this.vmRef) return;
    this.vmRef = vm;
    setAttr(this.el, 'data-testid', vm ? 'handoff' : null);
    if (!vm) {
      if (this.seat) {
        this.seat = null;
        const a = this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in', fill: 'forwards' });
        a.onfinish = () => {
          if (!this.seat) this.el.classList.add('hidden');
          a.cancel();
        };
      }
      return;
    }
    this.seat = vm.seat;
    this.el.getAnimations().forEach((a) => a.cancel());
    this.el.classList.remove('hidden');
    const pal = PLAYER_COLORS[vm.seat.color];
    setStyle(this.el, '--seat', pal.base);
    setStyle(this.el, '--seat-light', pal.light);
    this.emb.textContent = '';
    this.emb.append(emblem(vm.seat.color));
    this.title.textContent = '';
    this.title.append(titleText(`Pass to ${vm.seat.name}`));
    setText(this.sub, vm.subline);
    setText(this.btnLabel, `I'm ${vm.seat.name} · start turn`);
  }
}

// ---------------------------------------------------------------------------
// Confirm dialog (End game now / Restart): the only confirms in the game.
// ---------------------------------------------------------------------------

export class Confirm {
  readonly el: HTMLDivElement;
  private text: HTMLParagraphElement;
  private yesLabel: HTMLSpanElement;
  private box: HTMLDivElement;
  private vm: GameVM['confirm'] = null;
  private yes: HTMLButtonElement;

  constructor(send: Send) {
    this.el = h('div', 'scrim confirm hidden');
    this.el.setAttribute('role', 'alertdialog');
    this.el.setAttribute('aria-modal', 'true');
    this.box = h('div', 'sheet confirm-box');
    this.text = h('p', 'confirm-text num');
    const row = h('div', 'confirm-row');
    this.yes = uiButton('', 'brass role-primary', () => send({ type: 'confirm', yes: true }), undefined, 'confirm-yes');
    this.yesLabel = this.yes.querySelector('.btn-label')!;
    row.append(uiButton('Keep playing', 'role-secondary', () => send({ type: 'confirm', yes: false }), undefined, 'confirm-no'), this.yes);
    this.box.append(this.text, row);
    this.el.append(this.box);
  }

  update(vm: GameVM['confirm']): void {
    if (vm === this.vm) return;
    const was = this.vm;
    this.vm = vm;
    toggle(this.el, 'hidden', !vm);
    if (!vm) return;
    setText(this.text, vm.text);
    setText(this.yesLabel, vm.kind === 'endGame' ? 'End game' : 'Restart');
    if (!was) {
      animateIn(this.box, { dy: 8 });
    }
  }
}

// ---------------------------------------------------------------------------
// The menu and its sheets: one scrim, four sheets.
// ---------------------------------------------------------------------------

const RULE_BLOCKS: [string, string, string][] = [
  ['Turn', 'Place your new armies, attack as often as you like, then make one fortify move.', 'Take at least one territory in a turn to earn a card.'],
  ['Armies', '1 army per 3 territories you hold (at least 3), plus a bonus for each whole continent.', 'Card sets add more on top.'],
  ['Pieces', 'Pieces show army size: soldier 1–4, horse 5–9, cannon 10+.', 'The number on each piece is the exact count.'],
  ['Attacking', 'Attack a neighbor from a territory with 2+ armies. You roll up to 3 dice, the defender up to 2.', 'Highest dice pair off. Ties go to the defender.'],
  ['Cards', 'Three of a kind, one of each, or any two plus a wild trades for armies.', 'Sets grow every time anyone trades. At 5 cards you must trade.'],
  ['Fortify', 'Move armies once, through your own connected territories. It ends your turn.', 'One army always stays behind to hold a territory.'],
];

class LogSheet {
  readonly el: HTMLDivElement;
  private list: HTMLDivElement;
  private empty: HTMLDivElement;
  private lines: LogLineVM[] | null = null;

  constructor(back: () => void) {
    this.el = h('div', 'sheet log-sheet');
    const head = h('div', 'sheet-head');
    head.append(h('h1', 'sheet-title', 'Log'), uiButton('Close', 'role-exit', back, undefined, 'log-close'));
    this.list = h('div', 'log-list');
    this.empty = h('div', 'log-empty', 'Nothing yet. Battles show up here, one line each.');
    this.el.append(head, this.list, this.empty);
  }

  update(lines: LogLineVM[]): void {
    if (lines === this.lines) return;
    this.lines = lines;
    this.list.textContent = '';
    // Newest first.
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const row = h('div', `log-line kind-${l.kind}`);
      const emb = h('span', 'log-emb');
      if (l.seat) emb.append(emblem(l.seat.color));
      row.append(emb, h('span', 'log-text', minus(l.text)), h('span', 'log-round num', l.round > 0 ? `R${l.round}` : ''));
      this.list.append(row);
    }
    toggle(this.empty, 'hidden', lines.length > 0);
    this.list.scrollTop = 0;
  }
}

export class Overlays {
  readonly el: HTMLDivElement;
  private pause: HTMLDivElement;
  private rules: HTMLDivElement;
  private settings: HTMLDivElement;
  private log: LogSheet;
  private rulesHouse: HTMLDivElement;
  private current: string | null = null;
  private s: {
    anim: Segmented<0 | 1 | 2>;
    ai: Segmented<Settings['aiSpeed']>;
    text: Segmented<Settings['textSize']>;
    vol: Slider;
    sw: Record<string, Switch>;
  };
  private fitNote: HTMLSpanElement;
  private seats: HTMLDivElement;
  private seatsKey = '';
  private screen = '';

  constructor(private send: Send) {
    this.el = h('div', 'scrim overlays hidden');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    // A click on the scrim itself (not a sheet) closes the menu.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el && this.current === 'pause') send({ type: 'overlay', overlay: null });
    });

    // Menu
    this.pause = h('div', 'sheet pause-sheet');
    this.pause.append(h('h1', 'sheet-title', 'Menu'));
    const list = h('div', 'menu-list');
    list.append(
      uiButton('Resume', 'brass role-primary menu-item', () => send({ type: 'overlay', overlay: null }), undefined, 'pause-resume'),
      uiButton('Rules', 'menu-item', () => send({ type: 'overlay', overlay: 'rules' }), undefined, 'pause-rules'),
      uiButton('Settings', 'menu-item', () => send({ type: 'overlay', overlay: 'settings' }), undefined, 'pause-settings'),
      uiButton('Log', 'menu-item', () => send({ type: 'overlay', overlay: 'log' }), undefined, 'pause-log'),
      uiButton('Save & quit', 'menu-item', () => send({ type: 'saveAndQuit' }), undefined, 'pause-quit'),
      h('div', 'menu-sep'),
      uiButton('End game now', 'menu-item quiet', () => send({ type: 'endGameNow' }), undefined, 'pause-endgame'),
      uiButton('Restart', 'menu-item quiet', () => send({ type: 'restart' }), undefined, 'pause-restart'),
    );
    this.pause.append(list);

    // Rules
    this.rules = h('div', 'sheet rules-sheet');
    const rh = h('div', 'sheet-head');
    rh.append(h('h1', 'sheet-title', 'How to play'));
    rh.append(uiButton('Close', 'role-exit', () => send({ type: 'overlay', overlay: this.backTarget() }), undefined, 'rules-close'));
    const blocks = h('div', 'rules-blocks');
    for (const [t, a, b] of RULE_BLOCKS) {
      const blk = h('div', 'rule');
      blk.append(h('h2', 'rule-title', t), h('p', '', a), h('p', 'dim', b));
      blocks.append(blk);
    }
    this.rulesHouse = h('div', 'rule house');
    blocks.append(this.rulesHouse);
    this.rules.append(rh, blocks);

    // Settings
    this.settings = h('div', 'sheet settings-sheet');
    const sh = h('div', 'sheet-head');
    sh.append(h('h1', 'sheet-title', 'Settings'));
    sh.append(uiButton('Done', 'role-exit', () => send({ type: 'overlay', overlay: this.backTarget() }), undefined, 'settings-done'));
    const set = (patch: Partial<Settings>) => send({ type: 'setting', patch });
    const anim = new Segmented<0 | 1 | 2>('seg-row', (v) => set({ animationSpeed: v }), 'Animation speed');
    anim.setOptions([
      { value: 1, label: '1×' },
      { value: 2, label: '2×' },
      { value: 0, label: 'Instant' },
    ]);
    const ai = new Segmented<Settings['aiSpeed']>('seg-row', (v) => set({ aiSpeed: v }), 'AI speed', 'ai');
    ai.setOptions([
      { value: 'watch', label: 'Watch' },
      { value: 'fast', label: 'Fast' },
      { value: 'instant', label: 'Skip' },
    ]);
    const text = new Segmented<Settings['textSize']>('seg-row', (v) => set({ textSize: v }), 'Text size');
    text.setOptions([
      { value: 'laptop', label: 'Laptop' },
      { value: 'couch', label: 'Couch' },
      { value: 'tv', label: 'TV' },
    ]);
    const vol = new Slider('Sound volume', (v) => set({ sfxVolume: v }));
    const sw: Record<string, Switch> = {
      showLabels: new Switch('Territory names', (v) => set({ showLabels: v }), 'On every tile, not just the one you point at', 'set-labels'),
      showWinChance: new Switch('Show win chance', (v) => set({ showWinChance: v }), 'Otherwise a word: likely, coin flip…'),
      hideCardsBetweenTurns: new Switch('Hide cards between turns', (v) => set({ hideCardsBetweenTurns: v }), 'A pass-the-laptop cover when 2+ humans play'),
      muted: new Switch('Mute all sound', (v) => set({ muted: v })),
      music: new Switch('Music', (v) => set({ music: v }), 'A quiet ambient bed'),
      autoCamera: new Switch('Return camera home each turn', (v) => set({ autoCamera: v }), 'Only if you moved it'),
      reduceMotion: new Switch('Reduce motion', (v) => set({ reduceMotion: v })),
    };
    this.s = { anim, ai, text, vol, sw };
    const field = (label: string, ctl: HTMLElement, detail?: string | HTMLElement) => {
      const f = h('div', 'field');
      const l = h('div', 'field-label');
      l.append(h('span', '', label));
      if (typeof detail === 'string') l.append(h('span', 'field-detail', detail));
      else if (detail) l.append(detail);
      f.append(l, ctl);
      return f;
    };
    this.fitNote = h('span', 'field-detail hidden', 'fitted to this screen');
    const cols = h('div', 'settings-cols');
    const c1 = h('div', 'settings-col');
    c1.append(
      field('AI speed', ai.el, 'How AI turns play'),
      field('Animation speed', anim.el, 'Your own turns'),
      field('Text size', text.el, this.fitNote),
      field('Sound volume', vol.el),
    );
    // Seats: hand a seat to the AI when a friend leaves (and back). Filled in update().
    this.seats = h('div', 'menu-seats hidden');
    c1.append(this.seats);
    const c2 = h('div', 'settings-col');
    c2.append(sw.showLabels.el, sw.showWinChance.el, sw.hideCardsBetweenTurns.el, sw.muted.el, sw.music.el, sw.autoCamera.el, sw.reduceMotion.el);
    cols.append(c1, c2);
    this.settings.append(sh, cols);

    // Log
    this.log = new LogSheet(() => send({ type: 'overlay', overlay: this.backTarget() }));

    this.el.append(this.pause, this.rules, this.settings, this.log.el);
  }

  /** The chosen text size was fitted down to this screen (src/ui/uiScale.ts). */
  setFitted(on: boolean): void {
    toggle(this.fitNote, 'hidden', !on);
  }

  /** Where Close / Esc goes from a sheet: back to the menu only if it was opened from there. */
  backTarget(): 'pause' | null {
    return this.screen === 'game' && this.fromPause ? 'pause' : null;
  }
  private fromPause = false;

  update(vm: ViewModel): void {
    this.screen = vm.screen;
    const o = vm.overlay;
    if (o !== this.current && o !== null && o !== 'pause') this.fromPause = this.current === 'pause' || (this.fromPause && this.current !== null);
    toggle(this.el, 'hidden', !o);
    toggle(this.el, 'over-menu', vm.screen !== 'game');
    const sheets = { pause: this.pause, rules: this.rules, settings: this.settings, log: this.log.el };
    for (const [k, el] of Object.entries(sheets)) {
      toggle(el, 'hidden', o !== k);
      setAttr(el, 'data-testid', o === k ? k : null);
    }
    if (o !== this.current) {
      const prev = this.current;
      this.current = o;
      const sheet = o ? sheets[o] : null;
      if (sheet) {
        if (!prev && !motion.reduced) this.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        animateIn(sheet, { dy: 12 });
      }
    }
    if (o === 'settings') {
      const st = vm.settings;
      this.s.anim.set(st.animationSpeed);
      this.s.ai.set(st.aiSpeed);
      this.s.text.set(st.textSize);
      this.s.vol.set(st.sfxVolume);
      for (const k of Object.keys(this.s.sw)) this.s.sw[k].set(!!st[k as keyof Settings]);
      this.renderSeats(vm.game?.seatActions ?? []);
    }
    if (o === 'rules') this.renderHouse(vm.rulesNotes);
    if (o === 'log') this.log.update(vm.game?.log ?? []);
  }

  private renderSeats(actions: GameVM['seatActions']): void {
    const key = actions.map((a) => `${a.seat.id}:${a.seat.color}:${a.label}`).join('|');
    if (key === this.seatsKey) return;
    this.seatsKey = key;
    this.seats.textContent = '';
    toggle(this.seats, 'hidden', actions.length === 0);
    if (!actions.length) return;
    this.seats.append(h('div', 'field-label', 'Seats'));
    for (const a of actions) {
      const b = uiButton(a.label, 'menu-item quiet seat-item', () => this.send(a.intent), undefined, `seat-action-${a.seat.id}`);
      setStyle(b, '--seat-light', PLAYER_COLORS[a.seat.color].light);
      b.prepend(emblem(a.seat.color));
      this.seats.append(b);
    }
  }

  private renderHouse(lines: string[]): void {
    this.rulesHouse.textContent = '';
    this.rulesHouse.append(h('h2', 'rule-title', 'This game'));
    for (const l of lines) this.rulesHouse.append(h('p', 'num', minus(l)));
  }
}
