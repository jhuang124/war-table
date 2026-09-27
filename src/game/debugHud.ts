// Fallback UI: renders the whole ViewModel as plain HTML and sends intents back. Every chip, line,
// button, count, banner, battle header, card and log line is present and clickable, so the controller
// can be driven end to end before (or without) the real src/ui. Not the shipping look.

import { effectiveUiScale } from '../ui/uiScale';
import { EMBLEM_PATHS, PLAYER_COLORS, PLAYER_COLOR_IDS } from '../shared/palette';
import type { ControllerApi, SeatRef, UiIntent, ViewModel } from './viewModel';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const attr = (i: UiIntent) => `data-i='${esc(JSON.stringify(i))}'`;

function emblem(seat: SeatRef | null, size = 14): string {
  if (!seat) return '';
  const p = PLAYER_COLORS[seat.color];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="${EMBLEM_PATHS[p.emblem]}" fill="${p.light}"/></svg>`;
}

function seatName(seat: SeatRef | null): string {
  if (!seat) return '';
  return `<span style="color:${PLAYER_COLORS[seat.color].light}">${emblem(seat)} ${esc(seat.name)}${seat.kind === 'ai' ? ' <small>AI</small>' : ''}</span>`;
}

const CSS = `
.dh{position:fixed;inset:0;pointer-events:none;font:15px/1.35 Inter,system-ui,sans-serif;color:#f3ead8;font-variant-numeric:tabular-nums lining-nums;user-select:none}
.dh .p{pointer-events:auto;background:rgba(12,15,19,.82);border:1px solid rgba(194,160,98,.35);border-radius:8px;padding:.5rem .7rem}
.dh button{font:inherit;color:#f3ead8;background:#232830;border:1px solid #555;border-radius:6px;padding:.25rem .6rem;margin:.1rem;cursor:pointer}
.dh button[disabled]{opacity:.4;cursor:default}
.dh button.brass{background:#c2a062;color:#1a1408;border-color:#c2a062;font-weight:700}
.dh button.on{outline:2px solid #f3ead8}
.dh .chip{display:inline-block;border:1px solid #666;border-radius:99px;padding:.05rem .5rem;margin:.1rem;font-size:.85rem}
.dh .chip.brass{border-color:#c2a062;color:#e9cf98;cursor:pointer}
.dh input,.dh select{font:inherit;background:#1b1f25;color:#f3ead8;border:1px solid #555;border-radius:4px;padding:.1rem .3rem}
.dh .title{font-family:Cinzel,serif;letter-spacing:.08em}
.dh .row{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}
.dh .muted{opacity:.7}
.dh .rej{color:#ffd9a0}
`;

export function mountDebugHud(root: HTMLElement, api: ControllerApi): { dispose(): void } {
  document.getElementById('boot-splash')?.remove();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'dh';
  el.dataset.hud = 'debug';
  root.appendChild(el);

  let last: ViewModel | null = null;
  let lastHtml = '';

  const sendFrom = (target: HTMLElement | null) => {
    const node = target?.closest('[data-i]') as HTMLElement | null;
    if (!node || (node as HTMLButtonElement).disabled) return;
    const i = JSON.parse(node.dataset.i!) as UiIntent;
    api.audio.play('uiClick', { volume: 0.6 });
    api.intent(i);
  };
  // A re-render between pointerdown and pointerup retargets the click to an ancestor; remember what
  // was pressed so the click still lands.
  let pressed: { node: string; at: number } | null = null;
  const onDown = (e: PointerEvent) => {
    const node = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
    pressed = node && !(node as HTMLButtonElement).disabled ? { node: node.dataset.i!, at: performance.now() } : null;
  };
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    if (t.closest('[data-i]')) sendFrom(t);
    else if (pressed && performance.now() - pressed.at < 600) {
      api.audio.play('uiClick', { volume: 0.6 });
      api.intent(JSON.parse(pressed.node) as UiIntent);
    }
    pressed = null;
  };
  const onChange = (e: Event) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const k = t.dataset.k;
    if (!k) return;
    const idx = Number(t.dataset.idx ?? -1);
    const v = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value;
    let i: UiIntent | null = null;
    if (k === 'name') i = { type: 'seat', index: idx, patch: { name: String(v) } };
    if (k === 'color') i = { type: 'seat', index: idx, patch: { color: v as SeatRef['color'] } };
    if (k === 'kind') i = { type: 'seat', index: idx, patch: { kind: v as 'human' | 'ai' } };
    if (k === 'difficulty') i = { type: 'seat', index: idx, patch: { difficulty: v as 'easy' | 'normal' | 'hard' } };
    if (k === 'draft') i = { type: 'house', patch: { draft: !!v } };
    if (k === 'cardBonus') i = { type: 'house', patch: { cardBonus: v as 'progressive' | 'fixed' } };
    if (k === 'fortifyRule') i = { type: 'house', patch: { fortifyRule: v as 'connected' | 'adjacent' } };
    if (k === 'setupBatch') i = { type: 'house', patch: { setupBatch: v === 'auto' || v === '' ? 'auto' : Math.max(1, Number(v) || 1) } };
    if (k === 'seed') i = { type: 'house', patch: { seed: v === '' ? null : Number(v) >>> 0 } };
    if (k.startsWith('set.')) {
      const key = k.slice(4);
      const val = key === 'animationSpeed' ? Number(v) : key === 'sfxVolume' ? Number(v) / 100 : v;
      i = { type: 'setting', patch: { [key]: val } as never };
    }
    if (i) api.intent(i);
  };
  const onWheel = (e: WheelEvent) => {
    const t = (e.target as HTMLElement).closest('[data-counter]') as HTMLElement | null;
    if (!t || !last?.game?.strip.count) return;
    e.preventDefault();
    const c = last.game.strip.count;
    api.intent({ type: 'setCount', value: c.value + (e.deltaY < 0 ? 1 : -1) });
  };
  const onCtx = (e: MouseEvent) => e.preventDefault();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', onCtx);

  const reportInsets = () => api.setViewportInsets({ top: 48, right: 0, bottom: 170, left: 0, trayBand: 90 });
  reportInsets();
  window.addEventListener('resize', reportInsets);

  const btn = (label: string, i: UiIntent, o: { brass?: boolean; disabled?: boolean; id?: string; on?: boolean } = {}) =>
    `<button ${attr(i)} ${o.id ? `data-testid="${o.id}"` : ''} class="${o.brass ? 'brass' : ''} ${o.on ? 'on' : ''}" ${o.disabled ? 'disabled' : ''}>${esc(label)}</button>`;

  const renderTitle = (vm: ViewModel) => `
    <div class="p" style="position:absolute;left:50%;top:30%;transform:translateX(-50%);text-align:center;min-width:22rem">
      <div class="title" style="font-size:2.4rem">RISK · WAR TABLE</div>
      <div class="row" style="justify-content:center;margin-top:1rem">
        ${btn('New game', { type: 'nav', screen: 'newGame' }, { brass: !vm.save, id: 'title-new' })}
        ${vm.save ? btn(`Continue · ${vm.save.summary}`, { type: 'continue' }, { brass: true, id: 'title-continue' }) : ''}
        ${btn('How to play', { type: 'overlay', overlay: 'rules' })}
        ${btn('Settings', { type: 'overlay', overlay: 'settings' })}
      </div>
      <div class="row" style="justify-content:center">Text size:
        ${(['laptop', 'couch', 'tv'] as const).map((t) => btn(t === 'tv' ? 'TV' : t[0].toUpperCase() + t.slice(1), { type: 'setting', patch: { textSize: t } }, { on: vm.settings.textSize === t })).join('')}
      </div>
    </div>`;

  const renderNewGame = (vm: ViewModel) => {
    const n = vm.newGame;
    const seats = n.seats
      .map(
        (s, i) => `<div class="row">
        <input data-k="name" data-idx="${i}" value="${esc(s.name)}" size="12" data-testid="seat-name-${i}">
        <select data-k="color" data-idx="${i}">${PLAYER_COLOR_IDS.map((c) => `<option value="${c}" ${c === s.color ? 'selected' : ''}>${PLAYER_COLORS[c].name}</option>`).join('')}</select>
        <select data-k="kind" data-idx="${i}" data-testid="seat-kind-${i}"><option value="human" ${s.kind === 'human' ? 'selected' : ''}>Human</option><option value="ai" ${s.kind === 'ai' ? 'selected' : ''}>AI</option></select>
        ${s.kind === 'ai' ? `<select data-k="difficulty" data-idx="${i}">${['easy', 'normal', 'hard'].map((d) => `<option ${d === s.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select>` : ''}
        ${n.canRemoveSeat ? btn('Remove', { type: 'removeSeat', index: i }) : ''}
      </div>`,
      )
      .join('');
    return `<div class="p" style="position:absolute;left:50%;top:8%;transform:translateX(-50%);min-width:34rem">
      <div class="title" style="font-size:1.6rem">New game</div>
      <div style="margin:.5rem 0">${seats}${n.canAddSeat ? btn('Add seat', { type: 'addSeat' }) : ''}</div>
      <div class="row">Length: ${n.lengthOptions.map((o) => btn(`${o.label} · ${o.detail} · ${o.estimate}`, { type: 'length', value: o.id }, { on: n.length === o.id, id: `len-${o.id}` })).join('')}</div>
      <div class="row">Setup: ${n.setupOptions.map((o) => btn(`${o.label} · ${o.detail}`, { type: 'setup', value: o.id }, { on: n.setup === o.id, id: `setup-${o.id}` })).join('')}</div>
      <details><summary>House rules</summary>
        <div class="row"><label><input type="checkbox" data-k="draft" ${n.house.draft ? 'checked' : ''}> Draft territories · adds ~10 min</label></div>
        <div class="row">Cards <select data-k="cardBonus"><option value="progressive" ${n.house.cardBonus === 'progressive' ? 'selected' : ''}>Progressive</option><option value="fixed" ${n.house.cardBonus === 'fixed' ? 'selected' : ''}>Fixed</option></select>
        Fortify <select data-k="fortifyRule"><option value="connected" ${n.house.fortifyRule === 'connected' ? 'selected' : ''}>Connected</option><option value="adjacent" ${n.house.fortifyRule === 'adjacent' ? 'selected' : ''}>Adjacent</option></select>
        Batch <input data-k="setupBatch" size="4" value="${n.house.setupBatch}">
        Seed <input data-k="seed" size="10" value="${n.house.seed ?? ''}"></div>
      </details>
      <div class="muted" style="margin:.5rem 0" data-testid="ng-summary">${esc(n.summary)}</div>
      ${n.problems.map((p) => `<div class="rej">${esc(p)}</div>`).join('')}
      <div class="row">${btn('Start', { type: 'start' }, { brass: true, disabled: !n.canStart, id: 'ng-start' })}${btn('Back', { type: 'nav', screen: 'title' })}</div>
    </div>`;
  };

  const renderGame = (vm: ViewModel) => {
    const g = vm.game!;
    const st = g.strip;
    const accent = PLAYER_COLORS[st.accent].base;
    const top = `<div class="p row" style="position:absolute;left:.5rem;right:.5rem;top:.5rem" data-testid="topstrip">
      ${g.seats
        .map(
          (c) =>
            `<span class="chip" data-testid="seat-${c.seat.id}" style="${c.current ? `background:${PLAYER_COLORS[c.seat.color].base};color:${PLAYER_COLORS[c.seat.color].ink};` : ''}${c.eliminated ? 'opacity:.5;text-decoration:line-through;' : ''}">${emblem(c.seat)} ${esc(c.seat.name)} ${c.territories}${c.cards ? ` · ${c.cards} cards` : ''}</span>`,
        )
        .join('')}
      <span style="flex:1"></span>
      ${btn('≡', { type: 'overlay', overlay: 'pause' }, { id: 'menu' })}
    </div>`;
    const step =
      st.step.kind === 'turn'
        ? (['place', 'attack', 'fortify'] as const).map((x) => (x === st.step.current ? `<b>${x}</b>` : x)).join(' · ')
        : `<b>${esc(st.step.label)}</b>`;
    const count = st.count
      ? `<span data-counter="1" data-testid="counter" style="white-space:nowrap">${btn('−', { type: 'setCount', value: st.count.value - 1 }, { disabled: st.count.value <= st.count.min, id: 'count-dec' })}<b style="font-size:1.3rem;margin:0 .4rem">${st.count.value}</b>${btn('+', { type: 'setCount', value: st.count.value + 1 }, { disabled: st.count.value >= st.count.max, id: 'count-inc' })}</span>`
      : '';
    const buttons = st.buttons.map((b) => btn(b.label, { type: 'button', id: b.id }, { brass: b.primary, disabled: !!b.busy, id: `btn-${b.id}` })).join('');
    const strip = `<div class="p row" data-testid="strip" style="position:absolute;left:50%;bottom:.5rem;transform:translateX(-50%);width:min(1100px,96vw);height:4rem;box-sizing:border-box;border-top:3px solid ${accent};flex-wrap:nowrap">
      <span class="muted" data-testid="step" style="white-space:nowrap">${step}</span>
      <div data-testid="line" data-kind="${st.lineKind}" class="${st.lineKind === 'rejection' ? 'rej' : ''}" style="flex:1;min-width:0;font-size:1.2rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(st.line)}</div>
      ${count}${buttons}
    </div>`;
    const b = g.battle;
    const battle = b
      ? `<div class="p" data-testid="battle" style="position:absolute;left:50%;bottom:5rem;transform:translateX(-50%);text-align:center">
        <b style="color:${PLAYER_COLORS[b.attacker.seat.color].light}">${esc(b.attacker.territory.toUpperCase())} ${b.attacker.armies}</b> vs <b style="color:${PLAYER_COLORS[b.defender.seat.color].light}">${esc(b.defender.territory.toUpperCase())} ${b.defender.armies}</b>${b.rolling ? ' <span class="muted">rolling…</span>' : ''}</div>`
      : '';
    const bn = g.banner;
    const banner = bn
      ? `<div class="p" ${attr({ type: 'dismissTurnBanner' })} data-testid="banner" style="position:absolute;left:50%;top:4rem;transform:translateX(-50%);text-align:center;cursor:pointer;${bn.seat ? `border-top:4px solid ${PLAYER_COLORS[bn.seat.color].base}` : ''}">
        <div class="title" style="font-size:1.7rem">${esc(bn.title)}</div>${bn.sub ? `<div>${esc(bn.sub)}</div>` : ''}${bn.recap ? `<div class="muted">${esc(bn.recap)}</div>` : ''}</div>`
      : '';
    const c = g.cards;
    const cards = c?.open
      ? `<div class="p" data-testid="cards" style="position:absolute;right:.5rem;bottom:5rem;width:20rem">
        <div class="row">${c.hand.map((k) => `<span class="chip ${k.inSet ? 'brass' : ''}" data-testid="card-${k.id}">${k.symbol}${k.territory ? ` · ${esc(k.territory)}${k.ownedBonus ? ' +2' : ''}` : ''}</span>`).join('')}</div>
        <div>${esc(c.status)}</div>
        ${c.trade ? btn(c.trade.label, { type: 'button', id: 'trade' }, { brass: true, id: 'cards-trade' }) : ''}
        ${btn('Close', { type: 'cardsPanel', open: false })}</div>`
      : '';
    const handoff = g.handoff
      ? `<div class="p" data-testid="handoff" style="position:fixed;inset:0;backdrop-filter:blur(12px);background:rgba(12,15,19,.8);display:flex;flex-direction:column;align-items:center;justify-content:center;border-top:6px solid ${PLAYER_COLORS[g.handoff.seat.color].base}">
        <div class="title" style="font-size:2.75rem">Pass to ${esc(g.handoff.seat.name)}</div><div>${esc(g.handoff.subline)}</div>
        ${btn(`I'm ${g.handoff.seat.name} · start turn`, { type: 'handoffAccept' }, { brass: true, id: 'handoff-accept' })}</div>`
      : '';
    const confirm = g.confirm
      ? `<div class="p" data-testid="confirm" style="position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:10">${esc(g.confirm.text)}<br>
        ${btn(g.confirm.kind === 'endGame' ? 'End game' : 'Restart', { type: 'confirm', yes: true }, { id: 'confirm-yes' })}${btn('Keep playing', { type: 'confirm', yes: false }, { id: 'confirm-no' })}</div>`
      : '';
    return top + banner + battle + strip + cards + handoff + confirm;
  };

  const renderVictory = (vm: ViewModel) => {
    const v = vm.victory!;
    return `<div class="p" data-testid="victory" style="position:absolute;left:50%;top:8%;transform:translateX(-50%);min-width:30rem;text-align:center;border-top:6px solid ${PLAYER_COLORS[v.winner.color].base}">
      <div class="title" style="font-size:2.2rem">${esc(v.title)}</div><div>${esc(v.subline)}</div>
      <div class="row" style="justify-content:center;margin:.6rem 0">${v.awards.map((a) => `<div class="p"><b>${esc(a.title)}</b><br>${esc(a.text)}</div>`).join('')}</div>
      <table style="margin:auto">${v.standings.map((s) => `<tr><td>${s.place}</td><td>${seatName(s.seat)}</td><td>${s.territories} territories</td><td>${s.stats.territoriesConquered} taken</td></tr>`).join('')}</table>
      <div class="muted">Timeline: ${v.timeline.length} rounds recorded</div>
      <div class="row" style="justify-content:center">${btn('Rematch', { type: 'rematch' }, { brass: true, id: 'rematch' })}${btn('New setup', { type: 'nav', screen: 'newGame' })}${btn('Title', { type: 'nav', screen: 'title' })}</div></div>`;
  };

  const renderOverlay = (vm: ViewModel) => {
    if (vm.overlay === 'pause') {
      return `<div class="p" data-testid="pause" style="position:fixed;left:50%;top:25%;transform:translateX(-50%);z-index:9;text-align:center">
        <div class="title" style="font-size:1.6rem">Menu</div>
        ${btn('Resume', { type: 'overlay', overlay: null }, { brass: true, id: 'pause-resume' })}${btn('Rules', { type: 'overlay', overlay: 'rules' }, { id: 'pause-rules' })}${btn('Settings', { type: 'overlay', overlay: 'settings' }, { id: 'pause-settings' })}${btn('Log', { type: 'overlay', overlay: 'log' }, { id: 'pause-log' })}<br>
        ${btn('Save & quit', { type: 'saveAndQuit' }, { id: 'pause-quit' })}${btn('End game now', { type: 'endGameNow' }, { id: 'pause-endgame' })}${btn('Restart', { type: 'restart' }, { id: 'pause-restart' })}</div>`;
    }
    if (vm.overlay === 'rules') {
      return `<div class="p" data-testid="rules" style="position:fixed;left:50%;top:15%;transform:translateX(-50%);z-index:9;max-width:40rem">
        <div class="title" style="font-size:1.4rem">How to play</div>
        <p><b>Turn</b> · Place, attack, then one fortify move.<br><b>Armies</b> · 1 per 3 territories (min 3) plus whole continents.<br>
        <b>Attacking</b> · Need 2+ armies; ties go to the defender.<br><b>Cards</b> · Take a territory to earn one; 3 alike or 1 of each trades for armies.<br>
        <b>Fortify</b> · One move through your own territories, then your turn ends.</p>
        ${vm.rulesNotes.map((l) => `<div class="muted">${esc(l)}</div>`).join('')}
        ${btn('Close', { type: 'overlay', overlay: vm.screen === 'game' ? 'pause' : null })}</div>`;
    }
    if (vm.overlay === 'log') {
      const lines = vm.game?.log ?? [];
      return `<div class="p" data-testid="log" style="position:fixed;left:50%;top:10%;transform:translateX(-50%);z-index:9;width:30rem;max-height:70vh;overflow:auto;font-size:.85rem">
        ${lines.slice(-80).reverse().map((l) => `<div>${l.seat ? emblem(l.seat) : ''} <span class="muted">R${l.round}</span> ${esc(l.text)}</div>`).join('')}
        ${btn('Close', { type: 'overlay', overlay: 'pause' })}</div>`;
    }
    if (vm.overlay === 'settings') {
      const s = vm.settings;
      const sel = (k: string, opts: [string, string][], cur: string) =>
        `<select data-k="set.${k}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      const chk = (k: keyof typeof s, label: string) => `<label><input type="checkbox" data-k="set.${k}" ${s[k] ? 'checked' : ''}> ${label}</label><br>`;
      return `<div class="p" data-testid="settings" style="position:fixed;left:50%;top:15%;transform:translateX(-50%);z-index:9">
        <div class="title" style="font-size:1.4rem">Settings</div>
        Animation ${sel('animationSpeed', [['1', '1×'], ['2', '2×'], ['0', 'Instant']], String(s.animationSpeed))}
        AI ${sel('aiSpeed', [['watch', 'Watch'], ['fast', 'Fast'], ['instant', 'Skip']], s.aiSpeed)}
        Text ${sel('textSize', [['laptop', 'Laptop'], ['couch', 'Couch'], ['tv', 'TV']], s.textSize)}<br>
        ${chk('showLabels', 'Territory names')}${chk('hideCardsBetweenTurns', 'Hide cards between turns')}${chk('muted', 'Mute')}${chk('music', 'Music')}
        ${chk('reduceMotion', 'Reduce motion')}${chk('showWinChance', 'Show win chance')}${chk('autoCamera', 'Auto-camera')}
        Volume <input type="range" data-k="set.sfxVolume" min="0" max="100" value="${Math.round(s.sfxVolume * 100)}"><br>
        ${(vm.game?.seatActions ?? []).map((a) => btn(a.label, a.intent, { id: `seat-action-${a.seat.id}` })).join('')}
        ${btn('Done', { type: 'overlay', overlay: vm.screen === 'game' ? 'pause' : null })}</div>`;
    }
    return '';
  };

  const render = (vm: ViewModel) => {
    last = vm;
    document.documentElement.style.fontSize = `${16 * effectiveUiScale(vm.settings.textSize, window.innerWidth, window.innerHeight)}px`;
    let html = '';
    if (vm.screen === 'title' || vm.screen === 'boot') html = renderTitle(vm);
    else if (vm.screen === 'newGame') html = renderNewGame(vm);
    else if (vm.screen === 'game' && vm.game) html = renderGame(vm);
    else if (vm.screen === 'victory' && vm.victory) html = renderVictory(vm) + (vm.game ? '' : '');
    html += renderOverlay(vm);
    if (html !== lastHtml) {
      const focused = document.activeElement as HTMLInputElement | null;
      const keep = focused && el.contains(focused) && focused.tagName === 'INPUT' ? { k: focused.dataset.k, idx: focused.dataset.idx, pos: focused.selectionStart } : null;
      el.innerHTML = html;
      lastHtml = html;
      if (keep) {
        const again = el.querySelector(`input[data-k="${keep.k}"]${keep.idx ? `[data-idx="${keep.idx}"]` : ''}`) as HTMLInputElement | null;
        again?.focus();
      }
    }
  };

  const unsub = api.subscribe(render);
  render(api.getViewModel());
  return {
    dispose() {
      unsub();
      window.removeEventListener('resize', reportInsets);
      el.remove();
      style.remove();
    },
  };
}
