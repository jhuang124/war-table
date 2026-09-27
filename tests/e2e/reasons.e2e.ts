// Every reason code: explain() says it, and a real click on the tile shows exactly that copy in the
// bottom strip's one line for 2 s (never a raw engine string, never a shake), then the line comes back.
import { check, clickT, finish, loadScenario, open, scenario, ui } from './lib';
import type { Phase, TerritoryId } from '../../src/engine';

const results: string[] = [];
const { browser, page, errors } = await open();
const reinforce = (remaining: number, mustTrade = false): Phase => ({ kind: 'reinforce', remaining, mustTrade, placed: {}, midTurn: false });

interface Case {
  code: string;
  state: ReturnType<typeof scenario>;
  select?: TerritoryId;
  click: TerritoryId;
}
const cases: Case[] = [
  { code: 'not_yours', state: scenario({ ural: [0, 3] }, reinforce(3)), click: 'siberia' },
  { code: 'one_army', state: scenario({ ural: [0, 1], ukraine: [0, 4] }, { kind: 'attack' }), click: 'ural' },
  { code: 'no_source_for_target', state: scenario({ venezuela: [0, 1], peru: [0, 1], ural: [0, 5] }, { kind: 'attack' }), click: 'brazil' },
  {
    code: 'no_enemy_neighbors',
    state: scenario({ brazil: [0, 4], venezuela: [0, 1], peru: [0, 1], argentina: [0, 1], north_africa: [0, 1], ural: [0, 5] }, { kind: 'attack' }),
    click: 'brazil',
  },
  { code: 'not_adjacent', state: scenario({ ural: [0, 6] }, { kind: 'attack' }), select: 'ural', click: 'peru' },
  { code: 'own_as_target', state: scenario({ ural: [0, 6], ukraine: [0, 1] }, { kind: 'attack' }), select: 'ural', click: 'ukraine' },
  {
    code: 'must_trade_first',
    state: scenario({ ural: [0, 3] }, reinforce(3, true), {
      mutate: (s) => {
        s.players[0].cards = [0, 1, 2, 3, 4].map((i) => ({ id: i + 10, territory: null, symbol: 'infantry' as const }));
        s.players[0].cards = [
          { id: 0, territory: 'alaska', symbol: 'infantry' },
          { id: 1, territory: 'alberta', symbol: 'cavalry' },
          { id: 2, territory: 'peru', symbol: 'artillery' },
          { id: 3, territory: 'brazil', symbol: 'infantry' },
          { id: 42, territory: null, symbol: 'wild' },
        ];
      },
    }),
    click: 'ural',
  },
  { code: 'none_left', state: scenario({ ural: [0, 1], ukraine: [0, 1] }, reinforce(0)), click: 'ural' },
  { code: 'fortify_unreachable', state: scenario({ ural: [0, 5], ukraine: [0, 1], brazil: [0, 1] }, { kind: 'fortify' }), select: 'ural', click: 'brazil' },
  {
    code: 'fortify_not_adjacent',
    state: scenario({ ural: [0, 5], ukraine: [0, 1], scandinavia: [0, 1] }, { kind: 'fortify' }, { mutate: (s) => void (s.config = { ...s.config, fortifyRule: 'adjacent' }) }),
    select: 'ural',
    click: 'scandinavia',
  },
  { code: 'fortify_one_army', state: scenario({ ural: [0, 1], ukraine: [0, 3] }, { kind: 'fortify' }), click: 'ural' },
  {
    code: 'already_claimed',
    state: scenario({}, { kind: 'setup-claim' }, {
      fill: (_t, i) => (i < 20 ? [-1, 0] : [1 + (i % 3), 1]),
      mutate: (s) => {
        s.round = 0;
        s.turn = 0;
        for (const p of s.players) p.setupArmies = 20;
      },
    }),
    click: 'ural',
  },
];

for (const c of cases) {
  await loadScenario(page, c.state);
  if (c.select) {
    const pre = await page.evaluate((t) => window.__risk.explain(t as never), c.select);
    await clickT(page, c.select);
    await page.waitForTimeout(60);
    console.log('   select', c.select, JSON.stringify(pre), '→', (await ui(page)).line);
    await page.waitForTimeout(420); // not a double-click
  }
  const ex = await page.evaluate((t) => window.__risk.explain(t as never), c.click);
  if (!ex.code) {
    const d = await page.evaluate(() => ({ screen: window.__risk.ui().screen, state: !!window.__risk.getState(), save: !!localStorage.getItem('risk3d.save.v1'), line: window.__risk.ui().line }));
    console.log('   diagnostics:', JSON.stringify(d));
  }
  check(ex.ok === false && ex.code === c.code, `${c.code}: explain → ${ex.code} "${ex.text}"`, results);
  await clickT(page, c.click);
  await page.waitForFunction((t) => window.__risk.ui().line === t && document.querySelector('[data-testid="line"]')?.getAttribute('data-kind') === 'rejection', ex.text, { timeout: 3000 }).catch(() => undefined);
  const u = await ui(page);
  const kind = await page.locator('[data-testid="line"]').getAttribute('data-kind');
  check(u.line === ex.text && kind === 'rejection', `${c.code}: the line after a real click = "${u.line}"`, results);
  check(ex.text.length <= 52, `${c.code}: fits the one line (${ex.text.length} chars)`, results);
}
// The reason holds 2 s, then the live line comes back.
await page.waitForTimeout(2100);
const back = await page.locator('[data-testid="line"]').getAttribute('data-kind');
check(back === 'normal', `after 2 s the line is live again (${back})`, results);
await page.screenshot({ path: 'artifacts/e2e/reason-last.png' });
await browser.close();
finish(results, errors);
