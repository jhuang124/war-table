// ui-gallery.html: mounts the real UI over a stand-in board with a fake ControllerApi.
//   ?state=<id>        pick a fixture (default: the index)
//   &text=tv|couch     override the text size
//   &debug=1           outline the reported viewport insets and battle band
//   &bg=render         use artifacts/render/home-WxH.png as the backdrop
// The index of every fixture is hidden by default; open it with ?index=1 or the "i" key.

import { createAudio } from '../../audio';
import type { ControllerApi, UiIntent, ViewModel } from '../../game/viewModel';
import type { ViewportInsets } from '../../render/BoardView';
import type { TerritoryId } from '../../engine/types';
import { BOARD } from '../../map';
import { PLAYER_COLORS } from '../../shared/palette';
import { mountUi, uiDebug } from '../index';
import { fixtures, type Fixture } from './fixtures';

const params = new URLSearchParams(location.search);
const W = window.innerWidth;
const H = window.innerHeight;
const all = fixtures(W, H);
const byId = new Map(all.map((f) => [f.id, f]));
const stateId = params.get('state');
const text = params.get('text') as ViewModel['settings']['textSize'] | null;
const debug = params.get('debug') === '1';

// ---- stand-in board ------------------------------------------------------
const boardHost = document.getElementById('board')!;
boardHost.innerHTML = '';
const table = document.createElement('div');
table.className = 'g-table';
const stage = document.createElement('div');
stage.className = 'g-stage';
const slab = document.createElement('div');
slab.className = 'g-slab';
const img = document.createElement('img');
img.alt = '';
img.src = '/artifacts/map/preview.png';
slab.append(img);
const markers = new Map<TerritoryId, HTMLElement>();
for (const [id, t] of Object.entries(BOARD.territories)) {
  const m = document.createElement('i');
  m.className = 'g-mark';
  m.style.left = `${(t.anchor[0] / BOARD.width) * 100}%`;
  m.style.top = `${(1 - t.anchor[1] / BOARD.height) * 100}%`;
  slab.append(m);
  markers.set(id as TerritoryId, m);
}
stage.append(slab);
table.append(stage);
boardHost.append(table);

// &bg=render: use the renderer's own home-view screenshot as a flat backdrop instead of the stand-in.
if (params.get('bg') === 'render') {
  table.classList.add('g-shot');
  table.style.backgroundImage = `url(/artifacts/render/home-${W}x${H}.png)`;
}

let insets: ViewportInsets = { top: 56, left: 232, right: 80, bottom: 300, trayBand: 180 };
const layoutBoard = () => {
  const availW = W - insets.left - insets.right;
  const availH = H - insets.top - insets.bottom;
  const margin = 0.04;
  // A 55° pitch foreshortens the board to ~0.82 of its height in the fake view.
  const aspect = BOARD.width / (BOARD.height * 0.82);
  let w = availW * (1 - margin * 2);
  let h = w / aspect;
  if (h > availH * (1 - margin * 2)) {
    h = availH * (1 - margin * 2);
    w = h * aspect;
  }
  stage.style.left = `${insets.left + (availW - w) / 2}px`;
  stage.style.top = `${insets.top + (availH - h) / 2}px`;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  drawDebug();
  drawDice();
};

// ---- fake dice tray, placed like the renderer's ---------------------------
const tray = document.createElement('div');
tray.className = 'g-tray';
document.body.append(tray);
const pip: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};
let current: Fixture | null = null;
function drawDice() {
  tray.innerHTML = '';
  const b = current?.vm.game?.battle;
  if (!b || current?.vm.screen !== 'game') return;
  // Mirror src/render/dice.ts layout(): tray centered in the band.
  const band = insets.trayBand;
  const scale = { laptop: 1, couch: 1.25, tv: 1.5 }[current.vm.settings.textSize] ?? 1;
  const size = Math.max(56, Math.min(H * 0.08 * scale, band * 0.56));
  const trayH = Math.max(size * 1.75, band * 0.66);
  tray.style.cssText = `top:${H - insets.bottom + (band - trayH) / 2}px;height:${trayH}px`;
  const mk = (face: number, color: string, ink: string, dim = false) => {
    const d = document.createElement('div');
    d.className = 'g-die';
    d.style.cssText = `width:${size}px;height:${size}px;background:${color};opacity:${dim ? 0.55 : 1}`;
    for (const [x, y] of pip[face]) {
      const p = document.createElement('i');
      p.style.cssText = `left:${x}%;top:${y}%;background:${ink}`;
      d.append(p);
    }
    return d;
  };
  const att = document.createElement('div');
  att.className = 'g-dice att';
  const def = document.createElement('div');
  def.className = 'g-dice def';
  const [a, d] = current?.dice ?? [[], []];
  const ap = PLAYER_COLORS[b.attacker.seat.color];
  const dp = PLAYER_COLORS[b.defender.seat.color];

  a.forEach((f, i) => att.append(mk(f, ap.base, ap.ink, i < d.length && f <= d[i])));
  d.forEach((f, i) => def.append(mk(f, dp.base, dp.ink, i < a.length && a[i] > f)));
  tray.append(att, def);
}

// ---- debug overlay -------------------------------------------------------
const dbg = document.createElement('div');
dbg.className = 'g-debug';
if (debug) document.body.append(dbg);
function drawDebug() {
  if (!debug) return;
  dbg.innerHTML = `<div style="position:fixed;left:${insets.left}px;top:${insets.top}px;right:${insets.right}px;bottom:${insets.bottom}px;outline:1px dashed #0ff"></div>
  <div style="position:fixed;left:0;right:0;top:${H - insets.bottom}px;height:${insets.trayBand}px;outline:1px dashed #f0f"></div>
`;
}

// ---- fake controller -----------------------------------------------------
const listeners = new Set<(vm: ViewModel) => void>();
const intents: UiIntent[] = [];
const audio = createAudio({ volume: 0.6 });
let vm: ViewModel;

const api: ControllerApi = {
  getViewModel: () => vm,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  intent(i) {
    intents.push(i);
    console.debug('[intent]', JSON.stringify(i));
    react(i);
  },
  screenPos(t) {
    const m = markers.get(t);
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
  setViewportInsets(i) {
    insets = i;
    layoutBoard();
  },
  audio,
};

const push = (next: ViewModel) => {
  vm = next;
  for (const l of listeners) l(vm);
  drawDice();
};

/** A little interactivity so the gallery can be clicked through by hand. */
function react(i: UiIntent) {
  const g = vm.game;
  switch (i.type) {
    case 'overlay':
      return push({ ...vm, overlay: i.overlay });
    case 'setting':
      return push({ ...vm, settings: { ...vm.settings, ...i.patch }, reducedMotion: i.patch.reduceMotion ?? vm.reducedMotion });
    case 'cardsPanel':
      if (g) push({ ...vm, game: { ...g, cards: { ...g.cards, open: i.open }, log: i.open ? { ...g.log, open: false } : g.log } });
      return;
    case 'logPanel':
      if (g) push({ ...vm, game: { ...g, log: { ...g.log, open: i.open }, cards: i.open ? { ...g.cards, open: false } : g.cards } });
      return;
    case 'toggleHints':
      if (g) push({ ...vm, game: { ...g, actionBar: { ...g.actionBar, hints: { ...g.actionBar.hints, on: !g.actionBar.hints.on } } } });
      return;
    case 'setDice':
      if (g?.actionBar.dice) push({ ...vm, game: { ...g, actionBar: { ...g.actionBar, dice: { ...g.actionBar.dice, value: i.value } } } });
      return;
    case 'aiSpeed':
      if (g) push({ ...vm, settings: { ...vm.settings, aiSpeed: i.value }, game: { ...g, topBar: { ...g.topBar, aiSpeed: i.value } } });
      return;
    case 'toggleCard':
      if (g?.cards.hand) {
        const hand = g.cards.hand.map((c) => (c.id === i.id ? { ...c, selected: !c.selected } : c));
        const sel = hand.filter((c) => c.selected).length;
        push({ ...vm, game: { ...g, cards: { ...g.cards, hand, canTrade: sel === 3, selectionValue: sel === 3 ? 10 : null } } });
      }
      return;
    case 'highlightSeat':
      if (g) push({ ...vm, game: { ...g, roster: g.roster.map((r) => ({ ...r, highlighted: r.seat.id === i.player })) } });
      return;
    case 'setCount':
      if (g?.actionBar.counter) push({ ...vm, game: { ...g, actionBar: { ...g.actionBar, counter: { ...g.actionBar.counter, value: i.value } } } });
      return;
    case 'button':
      if (g?.actionBar.counter && ['min', 'max', 'inc', 'dec'].includes(i.id)) {
        const c = g.actionBar.counter;
        const v = i.id === 'min' ? c.min : i.id === 'max' ? c.max : Math.max(c.min, Math.min(c.max, c.value + (i.id === 'inc' ? 1 : -1)));
        const buttons = g.actionBar.buttons.map((b) =>
          b.id === 'move' ? { ...b, label: b.label.replace(/\d+/, String(v)) } : b.id === 'inc' || b.id === 'max' ? { ...b, enabled: v < c.max } : b.id === 'dec' || b.id === 'min' ? { ...b, enabled: v > c.min } : b,
        );
        push({ ...vm, game: { ...g, actionBar: { ...g.actionBar, counter: { ...c, value: v }, buttons } } });
      }
      return;
    case 'confirm':
      if (g) push({ ...vm, game: { ...g, confirm: null } });
      return;
    case 'handoffAccept':
      if (g) push({ ...vm, game: { ...g, handoff: null } });
      return;
    case 'dismissTurnBanner':
      if (g?.turnBanner) push({ ...vm, game: { ...g, turnBanner: null } });
      return;
    case 'nav':
      return push({ ...vm, screen: i.screen, overlay: null });
  }
}

// ---- index ---------------------------------------------------------------
function buildIndex() {
  const idx = document.createElement('nav');
  idx.className = 'g-index';
  const groups = new Map<string, Fixture[]>();
  for (const f of all) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  let html = '<h1>UI gallery</h1><p>Every screen and state, rendered by the real UI over a stand-in board. Add <code>&amp;text=tv</code> for TV size, <code>&amp;debug=1</code> for insets.</p>';
  for (const [g, list] of groups) {
    html += `<h2>${g}</h2><ul>`;
    for (const f of list) html += `<li><a href="?state=${f.id}">${f.label}</a> <a class="tv" href="?state=${f.id}&text=tv">TV</a></li>`;
    html += '</ul>';
  }
  idx.innerHTML = html;
  document.body.append(idx);
  return idx;
}

// ---- go ------------------------------------------------------------------
const fx = (stateId && byId.get(stateId)) || byId.get('reinforce')!;
current = fx;
vm = text ? { ...fx.vm, settings: { ...fx.vm.settings, textSize: text } } : fx.vm;
mountUi(document.getElementById('ui')!, api);
layoutBoard();
if (fx.after === 'openHouse') uiDebug().openHouseRules();
if (fx.after === 'expandLog') uiDebug().expandLog();
if (fx.after === 'skipVictoryIntro') setTimeout(() => uiDebug().skipVictoryIntro(), 50);
const idx = buildIndex();
if (!stateId || params.get('index') === '1') idx.classList.add('open');
window.addEventListener('keydown', (e) => {
  if (e.key === 'i' && !(e.target instanceof HTMLInputElement)) idx.classList.toggle('open');
});
Object.assign(window, { __gallery: { ids: all.map((f) => f.id), intents, ui: uiDebug, ready: true } });
