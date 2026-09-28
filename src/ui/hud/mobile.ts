// Phone-only HUD pieces (docs/MOBILE.md §1, §3):
//   RotatePill — the one-time `Rotate for the full map` pill on a portrait phone (dismiss with ×, by
//                rotating, or it fades after 9 s; never shown again).
//   NameCard   — the long-press card above the finger: territory, continent + bonus, owner, armies.
//                Driven by the board's long-press callback through GameVM.nameCard; releasing hides it.

import type { NameCardVM } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { animateIn, animateOut, emblem, h, setStyle, setText, toggle } from '../dom';

const ROTATE_KEY = 'risk3d.rotateHint.v1';

function seen(): boolean {
  try {
    return localStorage.getItem(ROTATE_KEY) === '1';
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(ROTATE_KEY, '1');
  } catch {
    /* private mode: shows again next time, which is fine */
  }
}

export class RotatePill {
  readonly el: HTMLDivElement;
  private shown = false;
  private timer = 0;

  constructor() {
    this.el = h('div', 'rotate-pill hidden');
    this.el.setAttribute('role', 'status');
    this.el.dataset.testid = 'rotate-pill';
    const icon = h('span', 'rp-icon');
    icon.setAttribute('aria-hidden', 'true');
    // A phone turning a quarter
    icon.innerHTML =
      '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M20.5 9.5a8.5 8.5 0 0 0-5-6.2M20.5 9.5l-.3-3.1M20.5 9.5l-3 .5"/></svg>';
    const close = h('button', 'rp-close nofocus');
    close.type = 'button';
    close.dataset.testid = 'rotate-pill-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    close.addEventListener('click', () => this.dismiss());
    this.el.append(icon, h('span', 'rp-text', 'Rotate for the full map'), close);
  }

  /** Call whenever the game screen / orientation changes. */
  update(inGame: boolean, phonePortrait: boolean): void {
    if (this.shown && !phonePortrait) return this.dismiss();
    if (this.shown || !inGame || !phonePortrait || seen()) return;
    this.shown = true;
    markSeen();
    this.el.classList.remove('hidden');
    animateIn(this.el, { dy: -8, ms: 260 });
    this.timer = window.setTimeout(() => this.dismiss(), 9000);
  }

  dismiss(): void {
    if (!this.shown) return;
    this.shown = false;
    window.clearTimeout(this.timer);
    animateOut(this.el, { dy: -6, remove: false }, () => {
      if (!this.shown) this.el.classList.add('hidden');
    });
  }
}

export class NameCard {
  readonly el: HTMLDivElement;
  private title: HTMLDivElement;
  private cont: HTMLDivElement;
  private owner: HTMLDivElement;
  private ownerName: HTMLSpanElement;
  private emb: HTMLSpanElement;
  private armies: HTMLSpanElement;
  private key = -1;

  constructor() {
    this.el = h('div', 'name-card hidden');
    this.el.setAttribute('role', 'tooltip');
    this.title = h('div', 'nc-title');
    this.cont = h('div', 'nc-cont num');
    this.owner = h('div', 'nc-owner');
    this.emb = h('span', 'nc-emb');
    this.ownerName = h('span', 'nc-name');
    this.armies = h('span', 'nc-armies num');
    this.owner.append(this.emb, this.ownerName, this.armies);
    this.el.append(this.title, this.cont, this.owner, h('i', 'nc-nub'));
  }

  update(vm: NameCardVM | null | undefined): void {
    if (!vm) {
      if (this.key !== -1) {
        this.key = -1;
        delete this.el.dataset.testid;
        animateOut(this.el, { dy: 4, ms: 110, remove: false }, () => {
          if (this.key === -1) this.el.classList.add('hidden');
        });
      }
      return;
    }
    const fresh = vm.key !== this.key;
    this.key = vm.key;
    this.el.dataset.testid = 'name-card';
    setText(this.title, vm.territory);
    setText(this.cont, `${vm.continent} · +${vm.bonus}`);
    this.emb.textContent = '';
    if (vm.owner) this.emb.append(emblem(vm.owner.color));
    setText(this.ownerName, vm.owner ? vm.owner.name : 'Unclaimed');
    setText(this.armies, vm.armies === 1 ? '1 army' : `${vm.armies} armies`);
    setStyle(this.el, '--seat', vm.owner ? PLAYER_COLORS[vm.owner.color].base : 'var(--brass)');
    this.el.classList.remove('hidden');
    // Above the finger (a thumb covers ~40 px), clamped inside the safe screen; flips below near the top.
    const r = this.el.getBoundingClientRect();
    const W = window.innerWidth;
    const w = r.width || 200;
    const hgt = r.height || 90;
    // Above the finger; below it near the top pills; beside it when neither fits (a short landscape
    // screen), so it never covers the top pills or the dock.
    const H = window.innerHeight;
    const top = document.querySelector('.topstrip')?.getBoundingClientRect().bottom ?? 0;
    const dockEl = document.querySelector('.strip');
    const dockTop = dockEl && (dockEl as HTMLElement).offsetParent !== null ? dockEl.getBoundingClientRect().top : H;
    const minY = Math.max(12, top + 6);
    const maxY = dockTop - 6;
    let mode: 'above' | 'below' | 'side' = 'above';
    if (vm.y - 56 - hgt < minY) mode = vm.y + 48 + hgt <= maxY ? 'below' : 'side';
    let left: number;
    let y: number;
    if (mode === 'side') {
      const right = vm.x + 40 + w <= W - 10;
      left = right ? vm.x + 40 : vm.x - 40 - w;
      y = Math.max(minY, Math.min(maxY - hgt, vm.y - hgt / 2));
    } else {
      left = Math.max(10, Math.min(W - 10 - w, vm.x - w / 2));
      y = mode === 'below' ? vm.y + 48 : vm.y - 56 - hgt;
    }
    toggle(this.el, 'below', mode === 'below');
    toggle(this.el, 'side', mode === 'side');
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    setStyle(this.el, '--nub-x', `${Math.round(vm.x - left)}px`);
    const below = mode === 'below';
    if (fresh) animateIn(this.el, { dy: below ? -6 : 6, ms: 150, scale: 0.96 });
  }
}
