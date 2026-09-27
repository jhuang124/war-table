// The one banner slot (docs/SIMPLIFY.md §5), center-top under the top strip, never takes input:
//   the turn banner (JOHN'S TURN · +9 armies, and one recap line from round 2 if you lost territory),
//   continent captured (JOHN HOLDS ASIA · +7), elimination (SAM IS OUT). The victory screen is its own.
// The controller owns timing (it removes the banner after holdMs); the UI animates in and out.

import type { BannerVM } from '../../game/viewModel';
import { PLAYER_COLORS } from '../../shared/palette';
import { EASE_IN_QUAD, EASE_OUT_QUART, EASE_SPRING, emblem, h, minus, motion, setStyle, titleText } from '../dom';

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

export class Announcements {
  readonly el: HTMLElement;
  private shownId = -1;
  private shownEl: HTMLElement | null = null;
  private outgoing: Animation[] = [];

  constructor() {
    this.el = h('div', 'announce');
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

  update(b: BannerVM | null): void {
    const id = b?.id ?? -1;
    if (id === this.shownId) return;
    const fast = !!b && b.holdMs <= 700;
    if (this.shownEl) this.outgoing.push(leave(this.shownEl, fast ? 150 : 200));
    this.shownEl = null;
    this.shownId = id;
    if (!b) return;
    const delay = this.clearStage();
    const el = this.build(b);
    this.el.append(el);
    this.shownEl = el;
    const turn = b.kind === 'turn';
    el.animate(
      [
        { opacity: 0, transform: `translateY(${motion.reduced ? 0 : turn ? -20 : -12}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: fast ? 150 : turn ? 280 : 240, delay, fill: 'backwards', easing: turn && !motion.reduced && !fast ? EASE_SPRING : EASE_OUT_QUART },
    );
  }

  private build(b: BannerVM): HTMLElement {
    const el = h('div', `ribbon banner-${b.kind}`);
    el.dataset.testid = 'banner';
    const pal = b.seat ? PLAYER_COLORS[b.seat.color] : null;
    setStyle(el, '--seat', pal ? pal.base : 'var(--brass)');
    el.append(h('div', 'rb-edge'));
    const t = h('div', 'rb-title');
    if (b.seat) t.append(emblem(b.seat.color, 'emb rb-emb'));
    const tt = h('span', '');
    tt.append(titleText(b.title));
    t.append(tt);
    el.append(t);
    if (b.sub) el.append(h('div', 'rb-sub num', minus(b.sub)));
    if (b.recap) el.append(h('div', 'rb-recap', minus(b.recap)));
    return el;
  }
}
