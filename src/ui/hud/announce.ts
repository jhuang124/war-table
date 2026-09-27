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

function leave(el: HTMLElement, ms: number): Animation {
  el.classList.add('leaving');
  const a = el.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: `translateY(${motion.reduced ? 0 : -10}px)` },
    ],
    { duration: ms, easing: EASE_IN_QUAD, fill: 'forwards' },
  );
  a.onfinish = () => el.remove();
  return a;
}

/** A replacement never waits longer than this for the outgoing banner: the old one is cut short. */
const CUT_MS = 120;

type Want = { key: string; turn: TurnBannerVM; banner?: undefined } | { key: string; banner: BannerVM; turn?: undefined };

export class Announcements {
  readonly el: HTMLElement;
  /** The one banner slot (UX.md §5.2: at most 1 banner on screen). Turn and tier banners share it. */
  private slot: HTMLDivElement;
  private toastSlot: HTMLDivElement;
  private shownKey = '';
  private shownEl: HTMLElement | null = null;
  private shownFast = false;
  private outgoing: Animation[] = [];
  private toasts = new Map<number, HTMLElement>();
  private lastToasts: ToastVM[] | null = null;
  /** Latest turn banner (for tests / gallery). */
  recap: string[] = [];

  constructor() {
    this.el = h('div', 'announce');
    this.slot = h('div', 'an-slot');
    this.toastSlot = h('div', 'an-toasts');
    this.el.append(this.slot, this.toastSlot);
  }

  /**
   * Which banner owns the slot. The controller normally never sends both, but if it does: an
   * elimination or victory (tier 2+) outranks the turn banner, and the turn banner outranks a tier-1
   * swing (it's news about the past turn; the recap carries what matters).
   */
  private pick(turn: TurnBannerVM | null, banner: BannerVM | null): Want | null {
    if (banner && (banner.tier >= 2 || !turn)) return { key: `b${banner.id}`, banner };
    if (turn) return { key: `t${turn.id}`, turn };
    return null;
  }

  /** Cut whatever is still leaving so the next banner enters alone; returns the wait in ms. */
  private clearStage(): number {
    let wait = 0;
    this.outgoing = this.outgoing.filter((a) => a.playState === 'running');
    for (const a of this.outgoing) {
      const dur = Number(a.effect?.getTiming().duration) || 0;
      const left = (dur - Number(a.currentTime ?? 0)) / (a.playbackRate || 1);
      if (left > CUT_MS) a.playbackRate *= left / CUT_MS;
      wait = Math.max(wait, Math.min(left, CUT_MS));
    }
    return Math.max(0, Math.round(wait));
  }

  update(turn: TurnBannerVM | null, banner: BannerVM | null, toasts: ToastVM[]): void {
    const want = this.pick(turn, banner);
    const key = want?.key ?? '';
    if (key !== this.shownKey) {
      if (this.shownEl) this.outgoing.push(leave(this.shownEl, this.shownFast ? 150 : 200));
      this.shownEl = null;
      this.shownKey = key;
      this.shownFast = false;
      this.recap = [];
      if (want) {
        const delay = this.clearStage();
        const el = want.turn ? this.turnEl(want.turn) : this.tierEl(want.banner);
        this.slot.append(el);
        this.shownEl = el;
        const t = want.turn;
        const dy = motion.reduced ? 0 : t ? -24 : -14;
        const sc = motion.reduced || t ? 1 : 0.985;
        el.animate(
          [
            { opacity: 0, transform: `translateY(${dy}px) scale(${sc})` },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          {
            duration: t ? (this.shownFast ? 150 : 280) : 240,
            delay,
            fill: 'backwards',
            easing: t ? (motion.reduced || this.shownFast ? 'ease-out' : EASE_SPRING) : EASE_OUT_QUART,
          },
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

  private turnEl(turn: TurnBannerVM): HTMLElement {
    const el = h('div', 'ribbon turn-banner');
    seatVars(el, turn.seat);
    el.append(h('div', 'rb-edge'));
    const t = h('div', 'rb-title');
    const tt = h('span', '');
    tt.append(titleText(turn.title));
    t.append(emblem(turn.seat.color, 'emb rb-emb'), tt);
    // Instant AI speed: the banner still shows, on a 150 / 500 / 150 ms beat (UX.md §8.2).
    this.shownFast = turn.holdMs <= 700;
    el.append(t);
    if (turn.receipt) el.append(h('div', 'rb-sub num', minus(turn.receipt)));
    for (const r of turn.recap.slice(0, 2)) el.append(h('div', 'rb-recap', minus(r)));
    this.recap = turn.recap.slice(0, 2);
    return el;
  }

  private tierEl(banner: BannerVM): HTMLElement {
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
    return el;
  }

  texts(): { banners: string[]; toasts: string[] } {
    const tier = this.shownEl?.classList.contains('tier-banner') ? this.shownEl : null;
    return {
      banners: tier ? [tier.textContent ?? ''] : [],
      toasts: [...this.toasts.values()].map((e) => e.textContent ?? ''),
    };
  }
}
