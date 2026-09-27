// Screenshot sweep for the visual review (not part of test:e2e): at 1280×800, 1440×900, 1920×1080 and
// TV text on 1920×1080 — home, reinforce (pills), cards open, armed attack with dice, blitz result, AI
// turn narration, victory. Usage: npx tsx tests/e2e/screens.ts [outDir]   (server on RISK_URL)
import { clickBtn, clickT, idle, loadScenario, open, scenario, state } from './lib';
import type { GameState, Phase } from '../../src/engine';

const OUT = process.argv[2] ?? 'artifacts/integration/screens';
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });

const sizes = [
  { w: 1280, h: 800, text: 'laptop' },
  { w: 1440, h: 900, text: 'laptop' },
  { w: 1920, h: 1080, text: 'laptop' },
  { w: 1920, h: 1080, text: 'tv' },
];
const PLAYERS = [
  { name: 'John', color: 'crimson', kind: 'human' },
  { name: 'Cobalt', color: 'cobalt', kind: 'ai', difficulty: 'normal' },
  { name: 'Amber', color: 'amber', kind: 'ai', difficulty: 'normal' },
  { name: 'Rose', color: 'rose', kind: 'ai', difficulty: 'normal' },
] as never;
const own = (t: string[]) => Object.fromEntries(t.map((x) => [x, [0, 2]]));

function base(phase: Phase, mutate?: (s: GameState) => void): GameState {
  return scenario(
    {
      ...own(['ural', 'ukraine', 'afghanistan', 'middle_east', 'india', 'scandinavia', 'egypt', 'north_africa', 'brazil', 'peru']),
      ural: [0, 3],
    } as never,
    phase,
    {
      players: PLAYERS,
      fill: (_t, i) => [1 + (i % 3), 1 + ((i * 7) % 4)],
      mutate: (s) => {
        s.round = 6;
        s.players[0].cards = [
          { id: 0, territory: 'ural', symbol: 'infantry' },
          { id: 1, territory: 'peru', symbol: 'cavalry' },
          { id: 2, territory: 'brazil', symbol: 'artillery' },
        ];
        s.players[1].cards = [{ id: 5, territory: null, symbol: 'infantry' }];
        s.territories.siberia = { owner: 1, armies: 5 };
        mutate?.(s);
      },
    },
  );
}

for (const sz of sizes) {
  const tag = `${sz.w}x${sz.h}${sz.text === 'tv' ? '-tv' : ''}`;
  const { browser, page, errors } = await open(undefined, { width: sz.w, height: sz.h });
  const shot = (name: string) => page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
  await loadScenario(page, base({ kind: 'reinforce', remaining: 9, mustTrade: false, placed: {}, midTurn: false }), { settings: { textSize: sz.text } });
  await page.waitForTimeout(1600);
  await shot('home');
  await clickT(page, 'ural');
  await page.waitForTimeout(350);
  await shot('reinforce');
  await clickBtn(page, 'rail-cards');
  await page.waitForTimeout(450);
  await shot('cards');
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="pill-all"]').click();
  await clickT(page, 'siberia');
  await page.waitForTimeout(500);
  await shot('armed');
  await clickBtn(page, 'btn-roll');
  await page.waitForTimeout(1050);
  await shot('dice');
  await idle(page);
  await clickBtn(page, 'btn-blitz');
  await idle(page);
  await page.waitForTimeout(150);
  await shot('blitz-result');
  await clickBtn(page, 'rail-log');
  await page.waitForTimeout(400);
  await shot('log');
  await clickBtn(page, 'rail-log');
  await page.waitForTimeout(200);
  const s = (await state(page))!;
  if (s.phase.kind === 'occupy') {
    await clickBtn(page, 'btn-move');
    await idle(page);
  }
  await clickBtn(page, 'btn-endTurn');
  // AI narration: wait for an attack line.
  await page
    .waitForFunction(() => / attacks .+ from /.test(window.__risk.ui().actionBarText), null, { timeout: 20_000, polling: 30 })
    .catch(() => undefined);
  await page.waitForTimeout(250);
  await shot('ai-turn');
  // Victory: one conquest from the goal.
  await loadScenario(
    page,
    base({ kind: 'attack' }, (st) => {
      st.config = { ...st.config, dominationPercent: 30 }; // 13 territories: John holds 12, Siberia makes 13
      st.territories.alaska = { owner: 0, armies: 2 };
      st.territories.greenland = { owner: 0, armies: 2 };
      st.territories.ural = { owner: 0, armies: 14 };
      st.territories.siberia = { owner: 1, armies: 2 };
    }),
    { settings: { textSize: sz.text } },
  );
  await clickT(page, 'siberia');
  await clickBtn(page, 'btn-blitz');
  await page.waitForFunction(() => window.__risk.ui().screen === 'victory', null, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await shot('victory-banner');
  await page.waitForTimeout(2600);
  await shot('victory');
  console.log(tag, errors.length ? `console errors: ${errors.join(' | ')}` : 'ok');
  await browser.close();
}
