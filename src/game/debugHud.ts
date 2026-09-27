// Fallback UI: renders the whole ViewModel as plain HTML and sends intents back. Every line, chip,
// button, counter, banner, battle-panel text, card and log line is present and clickable, so the
// controller can be driven end to end before (or without) the real src/ui. Not the shipping look.

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
.dh kbd{font-size:.7rem;opacity:.7;margin-left:.3rem}
.dh .chip{display:inline-block;border:1px solid #666;border-radius:99px;padding:.05rem .5rem;margin:.1rem;font-size:.85rem}
.dh .chip.brass{border-color:#c2a062;color:#e9cf98;cursor:pointer}
.dh .chip.toggle{cursor:pointer}
.dh .chip.success{border-color:#6c9;color:#bfe}
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
  const pills = document.createElement('div');
  pills.className = 'dh';
  pills.style.zIndex = '5';
  root.appendChild(pills);

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
    if (!t || !last?.game?.actionBar.counter) return;
    e.preventDefault();
    const c = last.game.actionBar.counter;
    api.intent({ type: 'setCount', value: c.value + (e.deltaY < 0 ? 1 : -1) });
  };
  const onCtx = (e: MouseEvent) => e.preventDefault();
  el.addEventListener('pointerdown', onDown);
  pills.addEventListener('pointerdown', onDown);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', onCtx);
  pills.addEventListener('click', onClick);

  const reportInsets = () => api.setViewportInsets({ top: 64, right: 64, bottom: 190, left: 250, trayBand: 80 });
  reportInsets();
  window.addEventListener('resize', reportInsets);

  const btn = (label: string, i: UiIntent, o: { brass?: boolean; disabled?: boolean; why?: string | null; key?: string | null; id?: string; on?: boolean } = {}) =>
    `<button ${attr(i)} ${o.id ? `data-testid="${o.id}"` : ''} class="${o.brass ? 'brass' : ''} ${o.on ? 'on' : ''}" ${o.disabled ? 'disabled' : ''} title="${esc(o.why ?? '')}">${esc(label)}${o.key ? `<kbd>${esc(o.key)}</kbd>` : ''}</button>`;

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
      <div class="row">${btn('Start', { type: 'start' }, { brass: true, disabled: !n.canStart, id: 'ng-start', key: 'Enter' })}${btn('Back', { type: 'nav', screen: 'title' })}</div>
    </div>`;
  };

  const renderGame = (vm: ViewModel) => {
    const g = vm.game!;
    const tb = g.topBar;
    const bar = g.actionBar;
    const accent = PLAYER_COLORS[bar.accent].base;
    const top = `<div class="p row" style="position:absolute;left:.5rem;right:.5rem;top:.5rem" data-testid="topbar">
      <b>${seatName(tb.player)}</b><span class="chip" style="${tb.finalRound ? 'border-color:#c2a062;color:#e9cf98' : ''}">${esc(tb.round)}</span>
      <span class="muted">${(['reinforce', 'attack', 'fortify'] as const).map((s) => (s === tb.step ? `<b>${s}</b>` : s)).join(' → ')}${tb.step === 'setup' ? ' · <b>setup</b>' : ''}</span>
      ${tb.nextSet ? `<span class="chip brass" data-pulse="${tb.nextSet.pulseKey}">${esc(tb.nextSet.label)}</span>` : ''}
      ${tb.aiSpeed ? `<span>AI: ${(['watch', 'fast', 'instant'] as const).map((s) => btn(s === 'instant' ? 'skip' : s, { type: 'aiSpeed', value: s }, { on: tb.aiSpeed === s, id: `ai-${s}` })).join('')}</span>` : ''}
      <span style="flex:1"></span>
      ${btn(`Cards ${g.cards.count}${g.cards.railBadge ? ` · ${g.cards.railBadge}` : ''}`, { type: 'cardsPanel', open: !g.cards.open }, { id: 'rail-cards' })}
      ${btn('Log', { type: 'logPanel', open: !g.log.open }, { id: 'rail-log' })}
      ${btn('Menu', { type: 'overlay', overlay: 'pause' }, { key: 'Esc', id: 'menu' })}
    </div>`;
    const roster = `<div class="p" style="position:absolute;left:.5rem;top:4rem;width:14rem" data-testid="roster">${g.roster
      .map(
        (r) => `<div ${attr({ type: 'highlightSeat', player: r.seat.id })} style="cursor:pointer;padding:.2rem 0;${r.current ? 'font-weight:700;' : ''}${r.eliminated ? 'opacity:.5;text-decoration:line-through;' : ''}${r.underAttack ? `box-shadow:0 0 0 2px ${PLAYER_COLORS[r.seat.color].base};` : ''}${r.highlighted ? 'background:#333;' : ''}">
        ${r.epitaph ? esc(r.epitaph) : `${seatName(r.seat)}<br><small>${r.territories} / ${r.territoriesNeeded} · ${r.armies} armies · +${r.income} ${r.continents.join(' · ')} · <span class="chip ${r.cardState === 'normal' ? '' : 'brass'}">${r.cardState === 'mustTrade' ? 'must trade' : `${r.cards} cards`}</span></small>`}
      </div>`,
      )
      .join('')}</div>`;
    const dice = bar.dice
      ? `<span>Dice ${([3, 2, 1] as const).filter((d) => d <= bar.dice!.max).map((d) => btn(String(d), { type: 'setDice', value: d }, { on: bar.dice!.value === d, id: `dice-${d}` })).join('')}</span>`
      : '';
    const counter = bar.counter
      ? `<span data-counter="1" data-testid="counter" style="font-size:1.6rem;font-weight:700;margin:0 .5rem">${bar.counter.value}</span>${bar.counter.note ? `<span class="muted" data-testid="counter-note">${esc(bar.counter.note)}</span>` : ''}`
      : '';
    const chips = bar.chips
      .map((c) => `<span class="chip ${c.tone}" ${c.intent ? attr(c.intent) : ''} data-testid="chip-${c.id}">${esc(c.label)}</span>`)
      .join('');
    const buttons = bar.buttons
      .map((b) => btn(b.label, { type: 'button', id: b.id }, { brass: b.brass, disabled: !b.enabled || !!b.busy, why: b.why, key: b.keycap, id: `btn-${b.id}` }))
      .join('');
    const action = `<div class="p" data-testid="actionbar" style="position:absolute;left:50%;bottom:.5rem;transform:translateX(-50%);width:min(920px,94vw);height:5.25rem;box-sizing:border-box;border-top:3px solid ${accent};overflow:hidden">
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
        <div style="min-width:0;flex:1">
          <div data-testid="line1" data-kind="${bar.line1Kind}" class="${bar.line1Kind === 'rejection' ? 'rej' : ''}" style="font-size:1.25rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(bar.line1)}</div>
          <div data-testid="line2" class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(bar.line2)}</div>
        </div>
        <div class="row" style="flex-wrap:nowrap">${counter}${dice}${buttons}</div>
      </div>
      <div class="row" style="flex-wrap:nowrap;overflow:hidden">${chips}</div>
    </div>`;
    const b = g.battle;
    const battle = b
      ? `<div class="p" data-testid="battle" style="position:absolute;left:50%;bottom:6.4rem;transform:translateX(-50%);min-width:26rem;text-align:center">
        <div>${seatName(b.attacker.seat)} <b>${esc(b.attacker.territory.toUpperCase())} ${b.attacker.armies}</b> vs ${seatName(b.defender.seat)} <b>${esc(b.defender.territory.toUpperCase())} ${b.defender.armies}</b></div>
        ${b.odds ? `<div style="font-size:1.3rem" data-testid="odds">${esc(b.odds.label)}</div>` : ''}
        ${b.stakes.map((s) => `<div style="${s.priority ? 'color:#e9cf98;font-size:1.15rem' : ''}">${esc(s.text)}</div>`).join('')}
        ${b.rolling ? '<div class="muted">rolling…</div>' : ''}
        ${b.result ? `<div data-testid="result" style="font-size:1.2rem">${esc(b.result)}${b.tieHint ? ' <small class="muted">tie → defender</small>' : ''}</div>` : ''}
        ${b.tally ? `<div class="muted" data-testid="tally">${esc(b.tally)}</div>` : ''}
      </div>`
      : '';
    const tbn = g.turnBanner
      ? `<div class="p" ${attr({ type: 'dismissTurnBanner' })} data-testid="turnbanner" style="position:absolute;left:50%;top:4.2rem;transform:translateX(-50%);text-align:center;cursor:pointer;border-top:4px solid ${PLAYER_COLORS[g.turnBanner.seat.color].base}">
        <div class="title" style="font-size:1.8rem">${emblem(g.turnBanner.seat, 20)} ${esc(g.turnBanner.title)}</div>
        <div>${esc(g.turnBanner.receipt)}</div>${g.turnBanner.recap.map((r) => `<div class="muted">${esc(r)}</div>`).join('')}</div>`
      : '';
    const banner = g.banner
      ? `<div class="p" data-testid="banner" style="position:absolute;left:50%;top:10rem;transform:translateX(-50%);text-align:center;${g.banner.seat ? `border-top:4px solid ${PLAYER_COLORS[g.banner.seat.color].base}` : ''}">
        <div class="title" style="font-size:1.7rem">${esc(g.banner.title)}</div><div>${esc(g.banner.subline)}</div></div>`
      : '';
    const toasts = g.toasts.length
      ? `<div style="position:absolute;right:4.5rem;top:4.5rem">${g.toasts.map((t) => `<div class="p" data-testid="toast" style="margin-bottom:.3rem">${esc(t.text)}</div>`).join('')}</div>`
      : '';
    const tt = g.tooltip
      ? `<div class="p" data-testid="tooltip" style="position:fixed;left:${g.tooltip.x + 18}px;top:${Math.max(0, g.tooltip.y - 90)}px;pointer-events:none;max-width:22rem">
        <b>${esc(g.tooltip.name)}</b> <span class="muted">${esc(g.tooltip.continent)}</span><br>${seatName(g.tooltip.owner)} · ${g.tooltip.armies}<br><span class="${g.tooltip.ok ? '' : 'rej'}">${esc(g.tooltip.line)}</span></div>`
      : '';
    const c = g.cards;
    const cards = c.open
      ? `<div class="p" data-testid="cards" style="position:absolute;right:.5rem;top:4rem;width:20rem">
        <b>${esc(c.header)}</b><div>${esc(c.status)}</div>${c.coach ? `<div class="muted">${esc(c.coach)}</div>` : ''}
        <div class="row">${(c.hand ?? []).map((k) => `<button ${attr({ type: 'toggleCard', id: k.id })} data-testid="card-${k.id}" class="${k.selected ? 'on' : ''}" style="${k.suggested ? 'border-color:#c2a062' : ''}">${k.symbol}${k.territory ? `<br><small>${esc(k.territory)}${k.ownedBonus ? ' · yours +2' : ''}</small>` : ''}</button>`).join('')}</div>
        ${c.hand === null ? '<div class="muted">Hand hidden</div>' : ''}
        ${c.selectionValue !== null ? `<div>Selected set +${c.selectionValue}</div>` : ''}
        ${btn(c.mustTrade ? 'Trade (required)' : 'Trade', { type: 'button', id: 'trade' }, { disabled: !c.canTrade, brass: c.mustTrade, id: 'cards-trade' })}
        ${btn('Close', { type: 'cardsPanel', open: false })}</div>`
      : '';
    const log = g.log.open
      ? `<div class="p" data-testid="log" style="position:absolute;right:.5rem;top:4rem;width:26rem;max-height:60vh;overflow:auto;font-size:.85rem">
        ${g.log.lines.slice(-60).reverse().map((l) => `<div title="${esc(l.detail.join('\n'))}">${l.seat ? emblem(l.seat) : ''} <span class="muted">R${l.round}</span> ${esc(l.text)}</div>`).join('')}
        ${btn('Close', { type: 'logPanel', open: false })}</div>`
      : '';
    const handoff = g.handoff
      ? `<div class="p" data-testid="handoff" style="position:fixed;inset:0;backdrop-filter:blur(12px);background:rgba(12,15,19,.8);display:flex;flex-direction:column;align-items:center;justify-content:center;border-top:6px solid ${PLAYER_COLORS[g.handoff.seat.color].base}">
        <div class="title" style="font-size:2.75rem">Pass to ${esc(g.handoff.seat.name)}</div><div>${esc(g.handoff.subline)}</div>
        ${btn(`I'm ${g.handoff.seat.name} · start turn`, { type: 'handoffAccept' }, { brass: true, key: 'Enter', id: 'handoff-accept' })}</div>`
      : '';
    const out = g.allHumansOut
      ? `<div class="p" data-testid="humans-out" style="position:absolute;right:.5rem;bottom:7rem">All humans are out.<br>${btn('Watch the AIs finish · fast', { type: 'watchAisFinish' }, { id: 'watch-ais' })}${btn('End game', { type: 'endGameNow' }, { id: 'end-game' })}</div>`
      : '';
    const confirm = g.confirm
      ? `<div class="p" data-testid="confirm" style="position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:10">${esc(g.confirm.text)}<br>
        ${btn(g.confirm.kind === 'endGame' ? 'End game' : 'Restart', { type: 'confirm', yes: true }, { id: 'confirm-yes' })}${btn('Keep playing', { type: 'confirm', yes: false }, { id: 'confirm-no' })}</div>`
      : '';
    return top + roster + tbn + banner + toasts + battle + action + cards + log + tt + out + handoff + confirm;
  };

  const renderVictory = (vm: ViewModel) => {
    const v = vm.victory!;
    return `<div class="p" data-testid="victory" style="position:absolute;left:50%;top:8%;transform:translateX(-50%);min-width:30rem;text-align:center;border-top:6px solid ${PLAYER_COLORS[v.winner.color].base}">
      <div class="title" style="font-size:2.2rem">${esc(v.title)}</div><div>${esc(v.subline)}</div>
      <div class="row" style="justify-content:center;margin:.6rem 0">${v.awards.map((a) => `<div class="p"><b>${esc(a.title)}</b><br>${esc(a.text)}</div>`).join('')}</div>
      <table style="margin:auto">${v.standings.map((s) => `<tr><td>${s.place}</td><td>${seatName(s.seat)}</td><td>${s.territories} territories</td><td>${s.stats.territoriesConquered} taken</td></tr>`).join('')}</table>
      <div class="muted">Timeline: ${v.timeline.length} rounds recorded</div>
      <div class="row" style="justify-content:center">${btn('Rematch', { type: 'rematch' }, { brass: true, key: 'Enter', id: 'rematch' })}${btn('New setup', { type: 'nav', screen: 'newGame' })}${btn('Title', { type: 'nav', screen: 'title' })}</div></div>`;
  };

  const renderOverlay = (vm: ViewModel) => {
    if (vm.overlay === 'pause') {
      return `<div class="p" data-testid="pause" style="position:fixed;left:50%;top:25%;transform:translateX(-50%);z-index:9;text-align:center">
        <div class="title" style="font-size:1.6rem">Paused</div>
        ${btn('Resume', { type: 'overlay', overlay: null }, { brass: true })}${btn('Settings', { type: 'overlay', overlay: 'settings' })}${btn('Rules', { type: 'overlay', overlay: 'rules' })}<br>
        ${btn('Save & quit to title', { type: 'saveAndQuit' }, { id: 'save-quit' })}${btn('Restart', { type: 'restart' })}${btn('End game now', { type: 'endGameNow' }, { id: 'end-now' })}</div>`;
    }
    if (vm.overlay === 'rules') {
      return `<div class="p" data-testid="rules" style="position:fixed;left:50%;top:15%;transform:translateX(-50%);z-index:9;max-width:40rem">
        <div class="title" style="font-size:1.4rem">How to play</div>
        <p><b>Turn</b> · Reinforce, attack, then one fortify move.<br><b>Armies</b> · 1 per 3 territories (min 3) plus whole continents.<br>
        <b>Attacking</b> · Need 2+ armies; ties go to the defender.<br><b>Cards</b> · Take a territory to earn one; 3 alike or 1 of each trades for armies.<br>
        <b>Fortify</b> · One move through your own territories, then your turn ends.</p>
        <p class="muted">Enter primary · Space commit · E exit · B blitz · 1/2/3 dice · Esc back · Tab cycle · F focus · L labels · M mute · ? rules</p>
        ${btn('Close', { type: 'overlay', overlay: null })}</div>`;
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
        ${chk('showLabels', 'Territory labels')}${chk('hideCardsBetweenTurns', 'Hide cards between turns')}${chk('muted', 'Mute')}${chk('music', 'Music')}
        ${chk('reduceMotion', 'Reduce motion')}${chk('showWinChance', 'Show win chance')}${chk('autoCamera', 'Auto-camera')}
        Volume <input type="range" data-k="set.sfxVolume" min="0" max="100" value="${Math.round(s.sfxVolume * 100)}"><br>
        ${btn('Done', { type: 'overlay', overlay: vm.screen === 'game' ? 'pause' : null })}</div>`;
    }
    return '';
  };

  const render = (vm: ViewModel) => {
    last = vm;
    document.documentElement.style.fontSize = `${16 * ({ laptop: 1, couch: 1.25, tv: 1.5 } as const)[vm.settings.textSize]}px`;
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

  // Pills follow their tile every frame.
  let raf = 0;
  let lastPills = '';
  const pillLoop = () => {
    const p = last?.game?.pills;
    if (p && last?.screen === 'game') {
      const pos = api.screenPos(p.territory);
      const html = pos
        ? `<div class="p" data-testid="pills" style="position:fixed;left:${pos.x - 50}px;top:${pos.y + 16}px;padding:.1rem .2rem">${p.buttons
            .map((b) => btn(b.label, { type: 'pill', id: b.id }, { disabled: !b.enabled, id: `pill-${b.id}` }))
            .join('')}</div>`
        : '';
      if (lastPills !== html) pills.innerHTML = lastPills = html;
    } else if (lastPills) pills.innerHTML = lastPills = '';
    raf = requestAnimationFrame(pillLoop);
  };
  raf = requestAnimationFrame(pillLoop);

  const unsub = api.subscribe(render);
  render(api.getViewModel());
  return {
    dispose() {
      unsub();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reportInsets);
      el.remove();
      pills.remove();
      style.remove();
    },
  };
}
