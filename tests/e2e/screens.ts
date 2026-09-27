// Screenshot sweep for the visual review (not part of test:e2e), on the real board + HUD, at 1280×800,
// 1440×900 and 1920×1080: Place (picked), Attack armed, Attack rolling, Occupy, Fortify (picked), an AI
// turn, and the menu. Also counts the words on screen (top strip + bottom strip + tray header) in each.
// Usage: npx tsx tests/e2e/screens.ts [outDir] [WxH,...]   (server on RISK_URL)
import { clickBtn, clickT, idle, loadScenario, open, scenario, state } from './lib';
import type { GameState, Phase } from '../../src/engine';
import type { Page } from 'playwright';

const OUT = process.argv[2] ?? 'artifacts/ui-simplify';
const SIZES = (process.argv[3] ?? '1280x800,1440x900,1920x1080').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });

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
      ural: [0, 12],
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
        s.players[1].cards = [0, 1, 2].map((i) => ({ id: 5 + i, territory: null, symbol: 'infantry' as const }));
        s.territories.siberia = { owner: 1, armies: 5 };
        mutate?.(s);
      },
    },
  );
}

async function words(page: Page): Promise<number> {
  return page.evaluate(() =>
    ['.topstrip', '.strip', '.battle:not(.hidden)']
      .map((q) => document.querySelector(q) as HTMLElement | null)
      .filter((e): e is HTMLElement => !!e && e.offsetParent !== null)
      .map((e) => e.innerText)
      .join(' ')
      .split(/\s+/)
      .filter((w) => /[A-Za-z0-9]/.test(w)).length,
  );
}

const report: string[] = [];
for (const [w, h] of SIZES) {
  const tag = `${w}x${h}`;
  const { browser, page, errors } = await open(undefined, { width: w, height: h });
  const shot = async (name: string) => {
    await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    const u = await page.evaluate(() => window.__risk.ui());
    const n = await words(page);
    report.push(`${tag} ${name}: ${n} words · [${u.step}] "${u.line}" · ${u.buttons.join(' / ')}${u.battle ? ` · tray "${u.battle.header}"` : ''}`);
  };
  // Place: Ural picked, the stepper showing all remaining.
  await loadScenario(page, base({ kind: 'reinforce', remaining: 9, mustTrade: false, placed: {}, midTurn: false }));
  await page.waitForTimeout(1300); // the turn banner leaves
  await clickT(page, 'ural');
  await page.waitForTimeout(350);
  await shot('place');
  await clickBtn(page, 'btn-place');
  await idle(page);
  // Attack armed.
  await clickBtn(page, 'btn-attack');
  await idle(page);
  await clickT(page, 'siberia');
  await page.waitForTimeout(450);
  await shot('attack-armed');
  // Attack rolling: one roll, caught with the dice in the tray.
  await clickBtn(page, 'btn-roll');
  await page.waitForTimeout(700);
  await shot('attack-rolling');
  await idle(page);
  // Occupy: blitz until Siberia falls.
  for (let i = 0; i < 4; i++) {
    const s = (await state(page))!;
    if (s.phase.kind !== 'attack' || s.territories.siberia.owner === 0 || s.territories.ural.armies < 2) break;
    await clickBtn(page, 'btn-blitz');
    await idle(page);
  }
  if ((await state(page))!.phase.kind === 'occupy') {
    await page.waitForTimeout(250);
    await shot('occupy');
    await clickBtn(page, 'btn-move');
    await idle(page);
  }
  // Fortify: a source and a destination picked.
  await page.keyboard.press('Escape');
  await clickBtn(page, 'btn-fortify');
  await idle(page);
  const sf = (await state(page))!;
  const src = (['ural', 'siberia', 'ukraine', 'afghanistan'] as const).find((t) => sf.territories[t].owner === 0 && sf.territories[t].armies >= 2);
  if (src) {
    await clickT(page, src);
    const dst = (['ukraine', 'afghanistan', 'middle_east', 'ural'] as const).find((t) => t !== src && sf.territories[t].owner === 0);
    if (dst) await clickT(page, dst);
  }
  await page.waitForTimeout(400);
  await shot('fortify');
  // Menu.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await shot('menu');
  await page.keyboard.press('Escape');
  // AI turn: end the turn and catch an attack line.
  await clickBtn(page, 'btn-endTurn');
  await page.waitForFunction(() => / attacks /.test(window.__risk.ui().line), null, { timeout: 25_000, polling: 30 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await shot('ai-turn');
  console.log(tag, errors.length ? `console errors: ${errors.join(' | ')}` : 'ok');
  await browser.close();
}
writeFileSync(`${OUT}/report.txt`, report.join('\n') + '\n');
console.log(report.join('\n'));
