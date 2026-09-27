// Top bar (UX.md §9): player chip · round chip · phase stepper · Next set chip · AI speed · rules · menu.

import type { AiSpeed, PhaseStep, TopBarVM, UiIntent } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { emblem, h, pop, setEmblem, setStyle, setText, toggle } from '../dom';
import { Segmented } from '../controls';

const STEPS: { id: Exclude<PhaseStep, 'setup'>; label: string }[] = [
  { id: 'reinforce', label: 'Reinforce' },
  { id: 'attack', label: 'Attack' },
  { id: 'fortify', label: 'Fortify' },
];

export class TopBar {
  readonly el: HTMLElement;
  private chip: HTMLDivElement;
  private chipEmb: SVGSVGElement;
  private chipName: HTMLSpanElement;
  private chipKind: HTMLSpanElement;
  private round: HTMLDivElement;
  private stepper: HTMLDivElement;
  private stepEls = new Map<string, HTMLSpanElement>();
  private setupStep: HTMLSpanElement;
  private nextSet: HTMLDivElement;
  private aiWrap: HTMLDivElement;
  private ai: Segmented<AiSpeed>;
  private vm: TopBarVM | null = null;
  private lastPulse = -1;
  private lastPlayer = -1;

  constructor(send: (i: UiIntent) => void) {
    this.el = h('header', 'topbar panel-strip');
    const left = h('div', 'tb-left');
    this.chip = h('div', 'player-chip');
    this.chipEmb = emblem('crimson', 'emb', 'ink');
    this.chipName = h('span', 'pc-name');
    this.chipKind = h('span', 'pc-kind');
    this.chip.append(this.chipEmb, this.chipName, this.chipKind);
    this.round = h('div', 'round-chip');
    left.append(this.chip, this.round);

    this.stepper = h('div', 'stepper');
    this.stepper.setAttribute('aria-label', 'Turn phases');
    this.setupStep = h('span', 'step on', 'Setup');
    this.stepper.append(this.setupStep);
    STEPS.forEach((s, i) => {
      if (i > 0) this.stepper.append(h('span', 'step-sep', '→'));
      const el = h('span', 'step', s.label);
      this.stepEls.set(s.id, el);
      this.stepper.append(el);
    });

    const right = h('div', 'tb-right');
    this.nextSet = h('div', 'nextset-chip');
    this.aiWrap = h('div', 'ai-speed');
    this.aiWrap.append(h('span', 'ai-speed-label', 'AI'));
    this.ai = new Segmented<AiSpeed>('seg-mini', (v) => send({ type: 'aiSpeed', value: v }), 'AI speed', 'ai');
    this.ai.setOptions([
      { value: 'watch', label: 'watch' },
      { value: 'fast', label: 'fast' },
      { value: 'instant', label: 'skip' },
    ]);
    this.aiWrap.append(this.ai.el);
    const help = h('button', 'icon-btn nofocus', '?');
    help.type = 'button';
    help.dataset.testid = 'topbar-rules';
    help.setAttribute('aria-label', 'Rules');
    help.dataset.tip = 'Rules  ?';
    help.addEventListener('click', () => send({ type: 'overlay', overlay: 'rules' }));
    const menu = h('button', 'icon-btn nofocus');
    menu.type = 'button';
    menu.dataset.testid = 'topbar-menu';
    menu.setAttribute('aria-label', 'Menu');
    menu.dataset.tip = 'Menu  Esc';
    menu.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
    menu.addEventListener('click', () => send({ type: 'overlay', overlay: 'pause' }));
    right.append(this.nextSet, this.aiWrap, help, menu);

    this.el.append(left, this.stepper, right);
  }

  update(vm: TopBarVM): void {
    if (this.vm === vm) return;
    const prev = this.vm;
    this.vm = vm;
    const pal = PLAYER_COLORS[vm.player.color];
    setStyle(this.chip, '--seat', pal.base);
    setStyle(this.chip, '--seat-ink', pal.ink);
    setEmblem(this.chipEmb, vm.player.color, 'ink');
    setText(this.chipName, vm.player.name);
    setText(this.chipKind, vm.player.kind === 'ai' ? 'AI' : '');
    toggle(this.chipKind, 'hidden', vm.player.kind !== 'ai');
    if (vm.player.id !== this.lastPlayer) {
      if (this.lastPlayer !== -1) pop(this.chip, 1.06, 260);
      this.lastPlayer = vm.player.id;
    }

    setText(this.round, vm.round);
    toggle(this.round, 'final', vm.finalRound);

    const step = vm.step;
    toggle(this.stepper, 'hidden', step === null);
    toggle(this.stepper, 'is-setup', step === 'setup');
    const idx = STEPS.findIndex((s) => s.id === step);
    STEPS.forEach((s, i) => {
      const el = this.stepEls.get(s.id)!;
      toggle(el, 'on', i === idx);
      toggle(el, 'done', idx >= 0 && i < idx);
    });

    toggle(this.nextSet, 'hidden', !vm.nextSet);
    if (vm.nextSet) {
      setText(this.nextSet, vm.nextSet.label);
      if (prev?.nextSet && vm.nextSet.pulseKey !== this.lastPulse && this.lastPulse !== -1) {
        this.nextSet.classList.remove('pulse');
        void this.nextSet.offsetWidth;
        this.nextSet.classList.add('pulse');
      }
      this.lastPulse = vm.nextSet.pulseKey;
    }

    toggle(this.aiWrap, 'hidden', vm.aiSpeed === null);
    if (vm.aiSpeed) this.ai.set(vm.aiSpeed);
  }
}
