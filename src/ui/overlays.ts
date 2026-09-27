// Modal-ish layers: hand-off cover (§6.3), all-humans-out card (§4.5), confirm dialog, pause menu,
// rules card (§7.6) and settings.

import type { GameVM, SeatRef, Settings, UiIntent, ViewModel } from '../game/viewModel';
import { PLAYER_COLORS } from '../shared/palette';
import { Segmented, Slider, Switch, uiButton } from './controls';
import { animateIn, emblem, h, motion, setAttr, setStyle, setText, titleText, toggle } from './dom';

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
    const btn = uiButton('', 'brass role-primary big', () => send({ type: 'handoffAccept' }), 'Enter', 'handoff-accept');
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
// All humans out: non-modal card.
// ---------------------------------------------------------------------------

export class HumansOut {
  readonly el: HTMLDivElement;
  private on = false;
  constructor(send: Send) {
    this.el = h('div', 'humans-out panel hidden');
    this.el.setAttribute('role', 'status');
    const t = h('div', 'ho2-text');
    t.append(h('strong', '', 'All humans are out.'), h('span', '', 'The AIs can play it out, or you can call it now.'));
    const row = h('div', 'ho2-row');
    row.append(
      uiButton('Watch the AIs finish · fast', 'brass role-primary', () => send({ type: 'watchAisFinish' }), undefined, 'watch-ais'),
      uiButton('End game', 'role-secondary', () => send({ type: 'endGameNow' }), undefined, 'humans-out-end'),
    );
    this.el.append(t, row);
  }
  update(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    setAttr(this.el, 'data-testid', on ? 'humans-out' : null);
    toggle(this.el, 'hidden', !on);
    if (on) animateIn(this.el);
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
    this.yes = uiButton('', 'brass role-primary', () => send({ type: 'confirm', yes: true }), 'Enter', 'confirm-yes');
    this.yesLabel = this.yes.querySelector('.btn-label')!;
    row.append(uiButton('Keep playing', 'role-secondary', () => send({ type: 'confirm', yes: false }), 'Esc', 'confirm-no'), this.yes);
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
// Pause, rules, settings: one scrim, three sheets.
// ---------------------------------------------------------------------------

const RULE_BLOCKS: [string, string, string][] = [
  ['Turn', 'Reinforce, attack as often as you like, then make one fortify move.', 'Take at least one territory in a turn to earn a card.'],
  ['Armies', '1 army per 3 territories you hold (at least 3), plus a bonus for each whole continent.', 'Card sets add more on top.'],
  ['Attacking', 'Attack a neighbor from a territory with 2+ armies. You roll up to 3 dice, the defender up to 2.', 'Highest dice pair off. Ties go to the defender.'],
  ['Cards', 'Three of a kind, one of each, or any two plus a wild trades for armies.', 'Sets grow every time anyone trades. At 5 cards you must trade.'],
  ['Fortify', 'Move armies once, through your own connected territories. It ends your turn.', 'One army always stays behind to hold a territory.'],
];

const SHORTCUTS: [string, string][] = [
  ['Enter', 'The brass button'],
  ['Space', 'Blitz · confirm a move'],
  ['E', 'Fortify → / End turn'],
  ['B', 'Blitz'],
  ['1 2 3', 'Dice to roll'],
  ['Right-click', 'Take one army back'],
  ['Shift · Alt', '+5 · all on a click'],
  ['Tab', 'Cycle clickable territories'],
  ['F', 'Focus the selection'],
  ['L', 'Territory names'],
  ['M', 'Mute'],
  ['Esc', 'Back · pause'],
];

export class Overlays {
  readonly el: HTMLDivElement;
  private pause: HTMLDivElement;
  private rules: HTMLDivElement;
  private settings: HTMLDivElement;
  private rulesHouse: HTMLDivElement;
  private current: string | null = null;
  private s: {
    anim: Segmented<0 | 1 | 2>;
    ai: Segmented<Settings['aiSpeed']>;
    text: Segmented<Settings['textSize']>;
    vol: Slider;
    sw: Record<string, Switch>;
  };
  private settingsBack: HTMLButtonElement;
  private screen = '';

  constructor(private send: Send) {
    this.el = h('div', 'scrim overlays hidden');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');

    // Pause
    this.pause = h('div', 'sheet pause-sheet');
    this.pause.append(h('h1', 'sheet-title', 'Paused'));
    const list = h('div', 'menu-list');
    list.append(
      uiButton('Resume', 'brass role-primary menu-item', () => send({ type: 'overlay', overlay: null }), 'Esc', 'pause-resume'),
      uiButton('Rules', 'menu-item', () => send({ type: 'overlay', overlay: 'rules' }), '?', 'pause-rules'),
      uiButton('Settings', 'menu-item', () => send({ type: 'overlay', overlay: 'settings' }), undefined, 'pause-settings'),
      uiButton('Save & quit to title', 'menu-item', () => send({ type: 'saveAndQuit' }), undefined, 'pause-quit'),
      h('div', 'menu-sep'),
      uiButton('Restart', 'menu-item quiet', () => send({ type: 'restart' }), undefined, 'pause-restart'),
      uiButton('End game now', 'menu-item quiet', () => send({ type: 'endGameNow' }), undefined, 'pause-endgame'),
    );
    this.pause.append(list);

    // Rules
    this.rules = h('div', 'sheet rules-sheet');
    const rh = h('div', 'sheet-head');
    rh.append(h('h1', 'sheet-title', 'How to play'));
    rh.append(uiButton('Close', 'role-exit', () => send({ type: 'overlay', overlay: this.backTarget() }), 'Esc'));
    const rg = h('div', 'rules-grid');
    const blocks = h('div', 'rules-blocks');
    for (const [t, a, b] of RULE_BLOCKS) {
      const blk = h('div', 'rule');
      blk.append(h('h2', 'rule-title', t), h('p', '', a), h('p', 'dim', b));
      blocks.append(blk);
    }
    this.rulesHouse = h('div', 'rule house');
    blocks.append(this.rulesHouse);
    const keys = h('div', 'rules-keys');
    keys.append(h('h2', 'rule-title', 'Shortcuts'));
    const dl = h('dl', 'keys');
    for (const [k, d] of SHORTCUTS) {
      const dt = h('dt');
      for (const part of k.split(' · ')) dt.append(h('kbd', 'kc', part));
      dl.append(dt, h('dd', '', d));
    }
    keys.append(dl);
    rg.append(blocks, keys);
    this.rules.append(rh, rg);

    // Settings
    this.settings = h('div', 'sheet settings-sheet');
    const sh = h('div', 'sheet-head');
    sh.append(h('h1', 'sheet-title', 'Settings'));
    this.settingsBack = uiButton('Done', 'role-exit', () => send({ type: 'overlay', overlay: this.backTarget() }), 'Esc');
    sh.append(this.settingsBack);
    const set = (patch: Partial<Settings>) => send({ type: 'setting', patch });
    const anim = new Segmented<0 | 1 | 2>('seg-row', (v) => set({ animationSpeed: v }), 'Animation speed');
    anim.setOptions([
      { value: 1, label: '1×' },
      { value: 2, label: '2×' },
      { value: 0, label: 'Instant' },
    ]);
    const ai = new Segmented<Settings['aiSpeed']>('seg-row', (v) => set({ aiSpeed: v }), 'AI speed');
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
      muted: new Switch('Mute all sound', (v) => set({ muted: v })),
      music: new Switch('Music', (v) => set({ music: v }), 'A quiet ambient bed'),
      showLabels: new Switch('Territory names on the board', (v) => set({ showLabels: v })),
      showWinChance: new Switch('Show win chance', (v) => set({ showWinChance: v }), 'The odds word always shows'),
      hideCardsBetweenTurns: new Switch('Hide cards between turns', (v) => set({ hideCardsBetweenTurns: v }), 'A pass-the-laptop cover when 2+ humans play'),
      autoCamera: new Switch('Return camera home each turn', (v) => set({ autoCamera: v }), 'Only if you moved it'),
      reduceMotion: new Switch('Reduce motion', (v) => set({ reduceMotion: v })),
    };
    this.s = { anim, ai, text, vol, sw };
    const field = (label: string, ctl: HTMLElement, detail?: string) => {
      const f = h('div', 'field');
      const l = h('div', 'field-label');
      l.append(h('span', '', label));
      if (detail) l.append(h('span', 'field-detail', detail));
      f.append(l, ctl);
      return f;
    };
    const cols = h('div', 'settings-cols');
    const c1 = h('div', 'settings-col');
    c1.append(
      field('Text size', text.el),
      field('Animation speed', anim.el, 'Your own turns'),
      field('AI speed', ai.el, 'How AI turns play'),
      field('Sound volume', vol.el),
    );
    const c2 = h('div', 'settings-col');
    c2.append(sw.muted.el, sw.music.el, sw.showLabels.el, sw.showWinChance.el, sw.hideCardsBetweenTurns.el, sw.autoCamera.el, sw.reduceMotion.el);
    cols.append(c1, c2);
    this.settings.append(sh, cols);

    this.el.append(this.pause, this.rules, this.settings);
  }

  /** Where Close / Esc goes from rules or settings: back to the pause menu only if it was opened from there. */
  backTarget(): 'pause' | null {
    return this.screen === 'game' && this.fromPause ? 'pause' : null;
  }
  private fromPause = false;

  update(vm: ViewModel): void {
    this.screen = vm.screen;
    const o = vm.overlay;
    if (o !== this.current && (o === 'rules' || o === 'settings')) this.fromPause = this.current === 'pause' || (this.fromPause && this.current !== null);
    toggle(this.el, 'hidden', !o);
    toggle(this.el, 'over-menu', vm.screen !== 'game');
    toggle(this.pause, 'hidden', o !== 'pause');
    toggle(this.rules, 'hidden', o !== 'rules');
    toggle(this.settings, 'hidden', o !== 'settings');
    setAttr(this.pause, 'data-testid', o === 'pause' ? 'pause' : null);
    setAttr(this.rules, 'data-testid', o === 'rules' ? 'rules' : null);
    setAttr(this.settings, 'data-testid', o === 'settings' ? 'settings' : null);
    if (o !== this.current) {
      const prev = this.current;
      this.current = o;
      const sheet = o === 'pause' ? this.pause : o === 'rules' ? this.rules : o === 'settings' ? this.settings : null;
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
    }
    if (o === 'rules') this.renderHouse(vm);
  }

  private renderHouse(vm: ViewModel): void {
    const g = vm.game;
    const needed = g?.roster.find((r) => !r.eliminated)?.territoriesNeeded;
    const hr = g?.house ?? vm.newGame.house;
    const lines: string[] = [];
    if (needed) lines.push(needed >= 42 ? 'Goal: take every territory.' : `Goal: first to ${needed} territories wins.`);
    else lines.push(vm.newGame.summary);
    if (g && /of \d+/.test(g.topBar.round)) lines.push(`${g.topBar.round.replace(/^Round \d+ of /, 'Game ends after round ')} · most territories wins.`);
    lines.push(hr.cardBonus === 'progressive' ? 'Card sets: 4, 6, 8, 10, 12, 15, then +5 each.' : 'Card sets: 3 infantry 4 · 3 cavalry 6 · 3 artillery 8 · one of each 10.');
    lines.push(hr.fortifyRule === 'connected' ? 'Fortify: along any chain of your territories.' : 'Fortify: to a neighbor only.');
    this.rulesHouse.textContent = '';
    this.rulesHouse.append(h('h2', 'rule-title', 'This game'));
    for (const l of lines) this.rulesHouse.append(h('p', 'num', l));
  }
}
