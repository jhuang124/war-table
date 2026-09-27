// Victory (UX.md §4.6): winner banner (2.5 s), then ≤ 3 award cards dealt 250 ms apart, the
// territories-over-time chart, standings, Rematch / New setup / Title, and Full stats.

import type { PlayerStats } from '../../engine/types';
import type { SeatRef, UiIntent, VictoryVM } from '../../game/viewModel';
import { PLAYER_COLORS, EMBLEM_PATHS } from '../../shared/palette';
import { uiButton } from '../controls';
import { EASE_OUT_QUART, emblem, h, motion, setStyle, svg, titleText, toggle } from '../dom';

type Send = (i: UiIntent) => void;

const AWARD_GLYPH: Record<string, string> = {
  // crossed swords
  nemesis:
    '<path d="M5 4l9.5 9.5M4 5l1-1M14.5 13.5l-2 2 3 3 2-2zM19 4L9.5 13.5M20 5l-1-1M9.5 13.5l2 2-3 3-2-2z"/>',
  // a die showing five
  hotDice:
    '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="8.6" cy="8.6" r="1.2"/><circle cx="15.4" cy="8.6" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="8.6" cy="15.4" r="1.2"/><circle cx="15.4" cy="15.4" r="1.2"/>',
  // a die showing one
  cursedDice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="12" cy="12" r="1.3"/>',
  // stacked cards
  cashIn: '<rect x="8" y="4" width="10" height="14" rx="1.6"/><path d="M6 6.5v12a1.6 1.6 0 0 0 1.6 1.6H15"/>',
};

const STAT_COLS: { key: keyof PlayerStats; label: string }[] = [
  { key: 'territoriesConquered', label: 'Conquered' },
  { key: 'battlesWon', label: 'Rolls won' },
  { key: 'battlesLost', label: 'Rolls lost' },
  { key: 'armiesDestroyed', label: 'Armies destroyed' },
  { key: 'armiesLost', label: 'Armies lost' },
  { key: 'cardsTraded', label: 'Sets traded' },
  { key: 'reinforcementsReceived', label: 'Reinforcements' },
  { key: 'peakTerritories', label: 'Peak territories' },
];

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

/** Territories-over-time line chart (SVG). One 2 px line per seat in its base color, emblem-marked
 *  end labels, recessive grid, hover crosshair with a per-round readout. */
export class TerritoryChart {
  readonly el: HTMLDivElement;
  private readout: HTMLDivElement;
  private W = 640;
  private H = 260;
  private pad = { l: 34, r: 104, t: 12, b: 28 };
  private last: VictoryVM | null = null;

  /** Re-draw at the current size (resize, text-size change). */
  refresh(): void {
    if (this.last) this.render(this.last);
  }

  constructor() {
    this.el = h('div', 'chart');
    this.readout = h('div', 'chart-readout hidden');
  }

  render(vm: VictoryVM): void {
    this.last = vm;
    this.el.textContent = '';
    // Legend (identity never by color alone)
    const legend = h('div', 'chart-legend');
    for (const seat of vm.seats) {
      const it = h('span', 'lg-item');
      const sw = h('i', 'lg-line');
      setStyle(sw, 'background', PLAYER_COLORS[seat.color].base);
      it.append(sw, emblem(seat.color), h('span', '', seat.name));
      legend.append(it);
    }
    const head = h('div', 'chart-head');
    head.append(h('h2', 'chart-title', 'Territories, round by round'), legend);
    const plot = h('div', 'chart-plot');
    this.el.append(head, plot);
    // Draw in real CSS pixels at the plot's size, so labels follow the text-size setting (rem).
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const W = Math.max(320, Math.round(plot.clientWidth));
    const H = Math.max(160, Math.round(plot.clientHeight || 260));
    this.W = W;
    this.H = H;
    this.pad = { l: Math.round(2.4 * rem), r: Math.round(6.5 * rem), t: Math.round(0.9 * rem), b: Math.round(1.9 * rem) };
    const pad = this.pad;
    const pts = vm.timeline;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg', role: 'img' });
    s.setAttribute('aria-label', 'Territories held by each player, round by round');
    if (pts.length === 0) {
      plot.append(h('p', 'dim', 'No rounds recorded'));
      return;
    }
    // Samples are taken at the start of each round (the board after the previous round); the engine adds
    // one more at game over, inside the last round. That final board is plotted at the end of the last
    // round (x = R + 1, tick 'End'), so the line climbs across the round instead of spiking in place.
    const n = pts.length;
    const finalDup = n > 1 && pts[n - 1].round === pts[n - 2].round;
    const xr = pts.map((p, i) => (finalDup && i === n - 1 ? p.round + 1 : p.round));
    const minR = xr[0];
    const maxR = xr[n - 1];
    const span = Math.max(1, maxR - minR);
    const x = (r: number) => pad.l + ((r - minR) / span) * (W - pad.l - pad.r);
    // Scale to the game that was played (a called game at 13 territories shouldn't hug the floor).
    let peak = 0;
    for (const p of pts) for (const v of Object.values(p.territories)) peak = Math.max(peak, v as number);
    const yMax = Math.min(42, Math.max(20, Math.ceil((peak + 2) / 10) * 10));
    const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
    const xs = n === 1 ? [pad.l] : xr.map((r) => x(r));
    const tick = 0.84 * rem;

    // Grid + y axis
    const grid = svg('g', { class: 'c-grid' });
    for (const v of [0, 10, 20, 30, 40].filter((v) => v <= yMax)) {
      grid.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
      const t = svg('text', { x: pad.l - 8, y: y(v) + tick * 0.35, 'text-anchor': 'end', class: 'c-tick' });
      t.textContent = String(v);
      grid.append(t);
    }
    // x ticks: about 6 labels, plus 'End' under the final board.
    const every = Math.max(1, Math.ceil(span / 6));
    const endX = finalDup ? xs[n - 1] : Infinity;
    for (let r = minR; r <= maxR; r += every) {
      const i = xr.findIndex((v, k) => v === r && !(finalDup && k === n - 1));
      if (i < 0 || Math.abs(xs[i] - endX) < 2.2 * rem) continue;
      const t = svg('text', { x: xs[i], y: H - tick * 0.4, 'text-anchor': 'middle', class: 'c-tick' });
      t.textContent = String(r);
      grid.append(t);
    }
    if (finalDup) {
      const t = svg('text', { x: endX, y: H - tick * 0.4, 'text-anchor': 'middle', class: 'c-tick' });
      t.textContent = 'End';
      grid.append(t);
    }
    s.append(grid);

    // Lines (winner drawn last, on top)
    const order = [...vm.seats].sort((a, b) => (a.id === vm.winner.id ? 1 : 0) - (b.id === vm.winner.id ? 1 : 0));
    const lines = svg('g', { class: 'c-lines' });
    const ends: { seat: SeatRef; y: number; v: number }[] = [];
    for (const seat of order) {
      const col = PLAYER_COLORS[seat.color];
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p.territories[seat.id] ?? 0).toFixed(1)}`).join('');
      const path = svg('path', { d, class: `c-line${seat.id === vm.winner.id ? ' winner' : ''}` });
      path.style.stroke = col.base;
      lines.append(path);
      if (!motion.reduced) {
        const len = W * 3;
        path.style.strokeDasharray = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900, delay: 150, easing: EASE_OUT_QUART, fill: 'forwards' });
      }
      const last = pts[pts.length - 1].territories[seat.id] ?? 0;
      ends.push({ seat, y: y(last), v: last });
    }
    s.append(lines);

    // Direct end labels: emblem + name + value, de-collided vertically.
    ends.sort((a, b) => a.y - b.y);
    const lh = 1.15 * rem;
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < lh) ends[i].y = ends[i - 1].y + lh;
    const lab = svg('g', { class: 'c-labels' });
    const xEnd = xs[xs.length - 1];
    for (const e of ends) {
      const col = PLAYER_COLORS[e.seat.color];
      const g = svg('g', { transform: `translate(${xEnd + 10}, ${e.y})` });
      const k = (0.8 * rem) / 24;
      const em = svg('path', { d: EMBLEM_PATHS[col.emblem], transform: `translate(0,${-0.4 * rem}) scale(${k})` });
      em.style.fill = col.light;
      const t = svg('text', { x: rem * 1.05, y: 0.3 * rem, class: 'c-end' });
      t.textContent = `${e.seat.name} ${e.v}`;
      g.append(em, t);
      lab.append(g);
    }
    s.append(lab);

    // Hover layer: crosshair + readout
    const cross = svg('line', { class: 'c-cross', y1: pad.t, y2: H - pad.b, x1: 0, x2: 0, opacity: 0 });
    const hit = svg('rect', { x: pad.l, y: 0, width: W - pad.l - pad.r + 8, height: H, fill: 'transparent' });
    s.append(cross, hit);
    const move = (ev: PointerEvent) => {
      const r = s.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let best = 0;
      for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
      cross.setAttribute('x1', String(xs[best]));
      cross.setAttribute('x2', String(xs[best]));
      cross.setAttribute('opacity', '1');
      const p = pts[best];
      this.readout.textContent = '';
      this.readout.append(h('div', 'cr-head', best === pts.length - 1 ? 'Final board' : `Round ${p.round}`));
      const rows = [...vm.seats].sort((a, b) => (p.territories[b.id] ?? 0) - (p.territories[a.id] ?? 0));
      for (const seat of rows) {
        const row = h('div', 'cr-row');
        row.append(emblem(seat.color), h('span', '', seat.name), h('span', 'num', String(p.territories[seat.id] ?? 0)));
        this.readout.append(row);
      }
      this.readout.classList.remove('hidden');
      const left = (xs[best] / W) * r.width;
      this.readout.style.left = `${Math.round(left > r.width * 0.6 ? left - 12 : left + 12)}px`;
      toggle(this.readout, 'flip', left > r.width * 0.6);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('opacity', '0');
      this.readout.classList.add('hidden');
    });

    plot.append(s, this.readout);
  }
}

export class VictoryScreen {
  readonly el: HTMLElement;
  private vm: VictoryVM | null = null;
  private intro: HTMLDivElement;
  private body: HTMLDivElement;
  private awards: HTMLDivElement;
  private chart = new TerritoryChart();
  private standings: HTMLOListElement;
  private stats: HTMLDivElement;
  private statsBtn: HTMLButtonElement;
  private statsOpen = false;
  private timers: number[] = [];
  private shownAt = 0;
  phase: 'intro' | 'full' = 'intro';

  constructor(send: Send) {
    this.el = h('section', 'screen victory-screen');
    this.intro = h('div', 'v-intro');
    this.body = h('div', 'v-body hidden');
    this.awards = h('div', 'v-awards');
    const mid = h('div', 'v-mid');
    const chartWrap = h('div', 'panel v-chart');
    chartWrap.append(this.chart.el);
    const standWrap = h('div', 'panel v-stand');
    standWrap.append(h('h2', 'chart-title', 'Final standings'));
    this.standings = h('ol', 'standings');
    standWrap.append(this.standings);
    mid.append(chartWrap, standWrap);
    this.stats = h('div', 'panel v-stats hidden');
    const actions = h('div', 'v-actions');
    this.statsBtn = uiButton('Full stats', 'role-exit', () => this.setStats(!this.statsOpen), undefined, 'victory-stats');
    actions.append(
      uiButton('Rematch', 'brass role-primary big', () => send({ type: 'rematch' }), 'Enter', 'rematch'),
      uiButton('New setup', 'role-secondary big', () => send({ type: 'nav', screen: 'newGame' }), undefined, 'victory-newsetup'),
      uiButton('Title', 'role-secondary big', () => send({ type: 'nav', screen: 'title' }), undefined, 'victory-title'),
      h('span', 'v-spacer'),
      this.statsBtn,
    );
    this.body.append(this.awards, mid, this.stats, actions);
    this.el.append(h('div', 'v-scrim'), this.intro, this.body);
    let rt = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(() => {
        if (this.phase === 'full' && this.el.isConnected) this.chart.refresh();
      }, 120);
    });
    // A click after the first 1.5 s skips the intro hold.
    this.el.addEventListener('pointerdown', () => {
      if (this.phase === 'intro' && performance.now() - this.shownAt > 1500) this.showFull();
    });
  }

  private setStats(on: boolean): void {
    this.statsOpen = on;
    toggle(this.stats, 'hidden', !on);
    toggle(this.body, 'stats-open', on);
    this.statsBtn.querySelector('.btn-label')!.textContent = on ? 'Hide stats' : 'Full stats';
    if (on) {
      animateInSafe(this.stats);
      this.stats.scrollIntoView({ block: 'nearest', behavior: motion.reduced ? 'auto' : 'smooth' });
    }
  }

  update(vm: VictoryVM | null, active: boolean): void {
    if (!active || !vm) {
      if (!active && this.vm) {
        this.timers.forEach((t) => clearTimeout(t));
        this.timers = [];
        this.vm = null;
      }
      return;
    }
    if (vm === this.vm) return;
    this.vm = vm;
    this.shownAt = performance.now();
    this.phase = 'intro';
    const pal = PLAYER_COLORS[vm.winner.color];
    setStyle(this.el, '--seat', pal.base);
    setStyle(this.el, '--seat-light', pal.light);

    // Intro banner
    this.intro.textContent = '';
    const rb = h('div', 'ribbon v-banner');
    rb.append(h('div', 'rb-edge'));
    const em = h('div', 'v-emb');
    em.append(emblem(vm.winner.color));
    const vt = h('div', 'v-title');
    vt.append(titleText(vm.title));
    rb.append(em, vt, h('div', 'rb-sub num', vm.subline));
    this.intro.append(rb);
    this.intro.classList.remove('docked');
    this.body.classList.add('hidden');
    rb.animate(
      [
        { opacity: 0, transform: `scale(${motion.reduced ? 1 : 0.96})` },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 600, easing: EASE_OUT_QUART },
    );

    // Awards
    this.awards.textContent = '';
    for (const a of vm.awards.slice(0, 3)) {
      const c = h('div', `award panel award-${a.id}`);
      const col = PLAYER_COLORS[a.seat.color];
      setStyle(c, '--seat', col.base);
      const g = h('div', 'aw-glyph');
      g.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${AWARD_GLYPH[a.id] ?? ''}</svg>`;
      const txt = h('div', 'aw-text');
      const who = h('div', 'aw-who');
      who.append(emblem(a.seat.color), h('span', '', a.seat.name));
      txt.append(h('div', 'aw-title', a.title), h('div', 'aw-line num', a.text), who);
      c.append(g, txt);
      this.awards.append(c);
    }
    toggle(this.awards, 'hidden', vm.awards.length === 0);

    // Standings
    this.standings.textContent = '';
    for (const st of [...vm.standings].sort((a, b) => a.place - b.place)) {
      const li = h('li', `st-row${st.place === 1 ? ' first' : ''}`);
      setStyle(li, '--seat', PLAYER_COLORS[st.seat.color].base);
      li.append(h('span', 'st-place num', ordinal(st.place)), emblem(st.seat.color), h('span', 'st-name', st.seat.name));
      li.append(h('span', 'st-terr num', `${st.territories}`), h('span', 'st-unit', 'territories'));
      this.standings.append(li);
    }

    // Full stats table
    this.stats.textContent = '';
    const table = h('table', 'stats-table');
    const thead = h('thead');
    const hr = h('tr');
    hr.append(h('th', '', 'Player'), h('th', 'num', 'Territories'));
    for (const c of STAT_COLS) hr.append(h('th', 'num', c.label));
    thead.append(hr);
    const tb = h('tbody');
    for (const st of [...vm.standings].sort((a, b) => a.place - b.place)) {
      const tr = h('tr');
      const nm = h('td', 'st-cell');
      nm.append(emblem(st.seat.color), h('span', '', st.seat.name));
      tr.append(nm, h('td', 'num', String(st.territories)));
      for (const c of STAT_COLS) tr.append(h('td', 'num', String(st.stats[c.key])));
      tb.append(tr);
    }
    table.append(thead, tb);
    this.stats.append(table);
    this.setStats(false);

    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [window.setTimeout(() => this.showFull(), 2500)];
  }

  refreshChart(): void {
    if (this.phase === 'full') this.chart.refresh();
  }

  showFull(): void {
    if (!this.vm || this.phase === 'full') return;
    this.phase = 'full';
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.intro.classList.add('docked');
    this.body.classList.remove('hidden');
    const cards = [...this.awards.children] as HTMLElement[];
    cards.forEach((c, i) => {
      c.animate(
        [
          { opacity: 0, transform: `translateY(${motion.reduced ? 0 : 18}px) rotate(${motion.reduced ? 0 : i % 2 ? 1.5 : -1.5}deg)` },
          { opacity: 1, transform: 'translateY(0) rotate(0)' },
        ],
        { duration: 320, delay: 200 + i * 250, easing: EASE_OUT_QUART, fill: 'backwards' },
      );
    });
    const after = 200 + cards.length * 250;
    this.body.querySelectorAll<HTMLElement>('.v-mid, .v-actions').forEach((el) =>
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: after, easing: 'ease-out', fill: 'backwards' }),
    );
    this.chart.render(this.vm);
  }
}

function animateInSafe(el: HTMLElement): void {
  if (motion.reduced) return;
  el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT_QUART });
}
