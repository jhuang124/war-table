// Chaining after a conquest on the real board + HUD (review round 1, carried through the simplify pass).
//   R1-02 an enemy next to your own stack during occupy is a legal chain click (min moves in)
//   R1-05 the tray header never shows one owner on both sides, and a decided fight shows its verdict
//   R1-11 the line never describes a half-moved board after a conquest
//   R1-21 Enter pressed right after a chain click never fires a Blitz the player hasn't seen
//   R1-13 the random deal never shows claim-phase copy
//   R1-14 an Undo after a refused click restores the live line (setup)
import { applyAction } from '../../src/engine';
import { ART, TWO_HUMANS, check, clickBtn, clickT, finish, idle, loadScenario, open, place, scenario, ui } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();
const shot = (name: string) => page.screenshot({ path: `${ART}/chain-${name}.png` });

// --- R1-02: Greenland 10 took Ontario; click Iceland (next to Greenland, not to Ontario) -------------
const occ = () =>
  scenario({ greenland: [0, 10], ontario: [0, 0] }, { kind: 'occupy', from: 'greenland', to: 'ontario', min: 3, max: 9, previousOwner: 1 });
{
  const s0 = occ();
  await loadScenario(page, s0);
  const u0 = await ui(page);
  check(u0.line === 'Move armies into Ontario' && u0.primary === 'Move 9', `occupy shows Move 9 (${u0.line} · ${u0.primary})`, results);
  const ex = await page.evaluate(() => window.__risk.explain('iceland'));
  check(ex.ok && /^Move 3 in · attack from Greenland · \d+% · /.test(ex.text), `explain(Iceland): ${ex.text}`, results);
  const pos = (await page.evaluate(() => window.__risk.screenPos('iceland')))!;
  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(600);
  check((await page.locator('.tooltip').count()) === 0, 'hovering shows no tooltip (the board names the tile)', results);
  await shot('r1-02-occupy-hover-iceland');
  await clickT(page, 'iceland');
  await idle(page);
  const s1 = (await page.evaluate(() => window.__risk.getState()))!;
  const u1 = await ui(page);
  check(s1.territories.ontario.armies === 3 && s1.territories.greenland.armies === 7, `min moved in: Ontario ${s1.territories.ontario.armies}, Greenland ${s1.territories.greenland.armies}`, results);
  check(/^Attack Iceland from Greenland · \d+%$/.test(u1.line), `armed from the stack: ${u1.line}`, results);
  check(u1.battle?.header === 'GREENLAND 7 vs ICELAND 1', `tray header: ${u1.battle?.header}`, results);
  const rej = await page.evaluate(() => window.__risk.metrics().turns.reduce((n, t) => n + t.rejected, 0));
  check(rej === 0, `no rejection (${rej})`, results);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await shot('r1-02-after-chain-click');
}

// --- R1-21: in occupy, click the next target and press Enter at ~120 ms ------------------------------
{
  await loadScenario(page, occ());
  await clickT(page, 'alberta');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await idle(page);
  await page.waitForTimeout(400);
  const s = (await page.evaluate(() => window.__risk.getState()))!;
  const u = await ui(page);
  check(s.territories.alberta.owner !== 0 && s.territories.alberta.armies === 1, `Enter after a chain click did not blitz (Alberta ${s.territories.alberta.armies})`, results);
  check(u.primary === 'Blitz' && /^Attack Alberta from Ontario · \d+%$/.test(u.line), `armed and waiting: ${u.line} · ${u.primary}`, results);
}

// --- R1-05 / R1-11: one roll conquers Indonesia from New Guinea 3 (auto-occupy, then chain) ----------
{
  const base = scenario({ new_guinea: [0, 3], western_australia: [0, 1], eastern_australia: [0, 1] }, { kind: 'attack' }, {
    mutate: (s) => {
      s.territories.indonesia = { owner: 1, armies: 1 };
    },
  });
  for (let seed = 1; seed < 500; seed++) {
    base.rng = seed;
    const r = applyAction(base, { type: 'attack', player: 0, from: 'new_guinea', to: 'indonesia', dice: 2 });
    if (r.ok && r.state.territories.indonesia.owner === 0) break;
  }
  await loadScenario(page, base);
  await clickT(page, 'indonesia');
  await page.waitForTimeout(80);
  await clickT(page, 'indonesia'); // roll once
  const t0 = Date.now();
  const samples: { t: number; line: string; header: string | null }[] = [];
  let shots = 0;
  while (Date.now() - t0 < 4200) {
    const u = await ui(page);
    samples.push({ t: Date.now() - t0, line: u.line, header: u.battle?.header ?? null });
    const t = Date.now() - t0;
    if ((shots === 0 && t > 1300) || (shots === 1 && t > 1900) || (shots === 2 && t > 2600)) await shot(`r1-05-conquest-${shots++}`);
    await page.waitForTimeout(40);
  }
  const headers = [...new Set(samples.map((x) => x.header).filter(Boolean))] as string[];
  const lines = [...new Set(samples.map((x) => x.line))];
  console.log('   headers: ' + headers.join(' | '));
  console.log('   lines:   ' + lines.join(' | '));
  check(headers.every((h) => !/^INDONESIA .* vs INDONESIA/.test(h)), `no header pits a tile against itself (${headers.join(' | ')})`, results);
  check(headers.includes('NEW GUINEA 3 vs INDONESIA 0'), 'the verdict header holds the armies at the verdict (NEW GUINEA 3 vs INDONESIA 0)', results);
  check(!lines.some((l) => /from New Guinea · 1/.test(l)), 'the line never describes a half-moved board', results);
  check(lines.includes('You took Indonesia'), 'the line says "You took Indonesia" while the conquest plays', results);
  const last = samples[samples.length - 1];
  check(last.line === 'Attack from Indonesia · click an enemy', `settles on the chained source: ${last.line}`, results);
}

// --- R1-14: setup-place, a refused click after all are placed, then Undo ------------------------------
{
  const s = scenario({ ural: [0, 1], ukraine: [0, 1] }, { kind: 'setup-place', toPlace: 3 }, {
    mutate: (x) => {
      x.round = 0;
      x.turn = 0;
      x.players[0].setupArmies = 3;
    },
  });
  await loadScenario(page, s);
  await place(page, 'ural');
  await clickT(page, 'ural');
  await page.waitForTimeout(100);
  const a = await ui(page);
  check(a.line === 'All 3 placed · press Done' && a.lineKind === 'rejection', `refused click: ${a.line}`, results);
  await clickBtn(page, 'btn-undo');
  await page.waitForTimeout(150);
  const b = await ui(page);
  check(b.line === 'Place 3 armies · click a territory' && b.lineKind === 'normal' && !b.buttons.includes('Done'), `after Undo: ${b.line} · ${b.buttons.join(' / ') || 'no buttons'}`, results);
}

// --- R1-13: a Place-your-own game with a human first: the deal never says "Claim a territory" --------
{
  await page.evaluate((players) => {
    localStorage.clear();
    window.__risk.newGame({ players: players as never, seed: 4, setupMode: 'random', initialPlacement: 'manual', setupBatch: 10 });
  }, TWO_HUMANS);
  const t0 = Date.now();
  const lines = new Set<string>();
  let shotDone = false;
  while (Date.now() - t0 < 2500) {
    lines.add((await ui(page)).line);
    if (!shotDone && Date.now() - t0 > 500) {
      await shot('r1-13-deal');
      shotDone = true;
    }
    await page.waitForTimeout(40);
  }
  console.log('   deal lines: ' + [...lines].join(' | '));
  check(![...lines].some((l) => /^Claim a territory/.test(l)), 'no claim copy during the random deal', results);
  check([...lines].includes('Dealing territories'), 'line 1 says "Dealing territories"', results);
}

await browser.close();
finish(results, errors);
