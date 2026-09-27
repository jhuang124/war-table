// Announcements (UX.md §3.1, §5.2, §6.2): the turn banner, tier 1–3 banners, and toasts.
// All live in one top-center column that stays in the top 20% of the viewport and never takes input.
// The controller owns timing (it removes items after holdMs); the UI animates in and out.

import type { BannerVM, SeatRef, ToastVM, TurnBannerVM } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { EASE_IN_QUAD, EASE_OUT_QUART, EASE_SPRING, emblem, h, minus, motion, setStyle, titleText } from '../dom';

function seatVars(el: HTMLElement, seat: SeatRef | null): void {
  const p = seat ? PLAYER_COLORS[seat.color] : null;
  setStyle(el, '--seat', p ? p.base : 'var(--brass)');
  setStyle(el, '--seat-light', p ? p.light : 'var(--ivory)');
}

function leave(el: HTMLElement, ms: number): void {
  el.classList.add('leaving');
  const a = el.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: `translateY(${motion.reduced ? 0 : -10}px)` },
    ],
    { duration: ms, easing: EASE_IN_QUAD, fill: 'forwards' },
  );
  a.onfinish = () => el.remove();
}

export class Announcements {
  readonly el: HTMLElement;
  private turnSlot: HTMLDivElement;
  private bannerSlot: HTMLDivElement;
  private toastSlot: HTMLDivElement;
  private turnId = -1;
  private turnEl: HTMLElement | null = null;
  private turnFast = false;
  private bannerId = -1;
  private bannerEl: HTMLElement | null = null;
  private toasts = new Map<number, HTMLElement>();
  private lastToasts: ToastVM[] | null = null;
  /** Latest turn banner (for tests / gallery). */
  recap: string[] = [];

  constructor() {
    this.el = h('div', 'announce');
    this.turnSlot = h('div', 'an-slot');
    this.bannerSlot = h('div', 'an-slot');
    this.toastSlot = h('div', 'an-toasts');
    this.el.append(this.turnSlot, this.bannerSlot, this.toastSlot);
  }

  update(turn: TurnBannerVM | null, banner: BannerVM | null, toasts: ToastVM[]): void {
    // Turn banner
    const tid = turn ? turn.id : -1;
    if (tid !== this.turnId) {
      if (this.turnEl) leave(this.turnEl, this.turnFast ? 150 : 200);
      this.turnEl = null;
      this.turnId = tid;
      if (turn) {
        const el = h('div', 'ribbon turn-banner');
        seatVars(el, turn.seat);
        el.append(h('div', 'rb-edge'));
        const t = h('div', 'rb-title');
        const tt = h('span', '');
        tt.append(titleText(turn.title));
        t.append(emblem(turn.seat.color, 'emb rb-emb'), tt);
        // Instant AI speed: the banner still shows, on a 150 / 500 / 150 ms beat (UX.md §8.2).
        this.turnFast = turn.holdMs <= 700;
        el.append(t);
        if (turn.receipt) el.append(h('div', 'rb-sub num', minus(turn.receipt)));
        for (const r of turn.recap.slice(0, 2)) el.append(h('div', 'rb-recap', minus(r)));
        this.turnSlot.append(el);
        this.turnEl = el;
        this.recap = turn.recap.slice(0, 2);
        el.animate(
          [
            { opacity: 0, transform: `translateY(${motion.reduced ? 0 : -24}px)` },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: this.turnFast ? 150 : 280, easing: motion.reduced || this.turnFast ? 'ease-out' : EASE_SPRING },
        );
      } else this.recap = [];
    }

    // Tier banner (≤ 1 on screen; the controller queues)
    const bid = banner ? banner.id : -1;
    if (bid !== this.bannerId) {
      if (this.bannerEl) leave(this.bannerEl, 200);
      this.bannerEl = null;
      this.bannerId = bid;
      if (banner) {
        const el = h('div', `ribbon tier-banner tier-${banner.tier}`);
        seatVars(el, banner.seat);
        el.append(h('div', 'rb-edge'));
        const t = h('div', 'rb-title');
        if (banner.seat) t.append(emblem(banner.seat.color, 'emb rb-emb'));
        const bt = h('span', '');
        bt.append(titleText(banner.title));
        t.append(bt);
        el.append(t);
        if (banner.subline) el.append(h('div', 'rb-sub num', minus(banner.subline)));
        this.bannerSlot.append(el);
        this.bannerEl = el;
        el.animate(
          [
            { opacity: 0, transform: `translateY(${motion.reduced ? 0 : -14}px) scale(${motion.reduced ? 1 : 0.985})` },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          { duration: 240, easing: EASE_OUT_QUART },
        );
      }
    }

    // Toasts (≤ 2)
    if (toasts !== this.lastToasts) {
      this.lastToasts = toasts;
      const seen = new Set<number>();
      for (const t of toasts.slice(0, 2)) {
        seen.add(t.id);
        if (this.toasts.has(t.id)) continue;
        const el = h('div', 'toast');
        seatVars(el, t.seat);
        if (t.seat) el.append(emblem(t.seat.color));
        el.append(h('span', '', minus(t.text)));
        this.toastSlot.append(el);
        this.toasts.set(t.id, el);
        el.animate(
          [
            { opacity: 0, transform: `translateY(${motion.reduced ? 0 : -8}px)` },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 200, easing: EASE_OUT_QUART },
        );
      }
      for (const [id, el] of this.toasts) {
        if (!seen.has(id)) {
          this.toasts.delete(id);
          leave(el, 160);
        }
      }
    }
  }

  texts(): { banners: string[]; toasts: string[] } {
    return {
      banners: this.bannerEl ? [this.bannerEl.textContent ?? ''] : [],
      toasts: [...this.toasts.values()].map((e) => e.textContent ?? ''),
    };
  }
}
