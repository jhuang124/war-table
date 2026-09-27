// Review round 1 (game fixer): chaining after a conquest on the real board + HUD.
//   R1-02 an enemy next to your own stack during occupy is a legal chain click (min moves in)
//   R1-05 the battle header never shows one owner on both sides, and a decided fight shows its verdict
//   R1-11 line 1 never describes a half-moved board after a conquest
//   R1-21 Enter pressed right after a chain click never fires a Blitz the player hasn't seen
//   R1-13 the random deal never shows claim-phase copy
//   R1-14 a right-click after a refused click restores the live line 1
import { applyAction, type GameState } from '../../src/engine';
import { ART, TWO_HUMANS, check, clickT, finish, idle, loadScenario, open, scenario, ui } from './lib';

const results: string[] = [];
const { browser, page, errors } = await open();
const shot = (name: string) => page.screenshot({ path: `${ART}/chain-${name}.png` });
const name = (s: GameState, t: string) => s.players[s.territories[t as 'ural'].owner].name.toUpperCase();

// --- R1-02: Greenland 10 took Ontario; click Iceland (next to Greenland, not to Ontario) -------------
const occ = () =>
  scenario({ greenland: [0, 10], ontario: [0, 0] }, { kind: 'occupy', from: 'greenland', to: 'ontario', min: 3, max: 9, previousOwner: 1 });
{
  const s0 = occ();
  await loadScenario(page, s0);
  const u0 = await ui(page);
  check(/^You took Ontario/.test(u0.actionBarText) && u0.primary === 'Move 9', `occupy shows Move 9 (${u0.actionBarText} · ${u0.primary})`, results);
  const ex = await page.evaluate(() => window.__risk.explain('iceland'));
  check(ex.ok && /^Click: move 3 in · attack from Greenland · \d+% · /.test(ex.text), `explain(Iceland): ${ex.text}`, results);
  const pos = (await page.evaluate(() => window.__risk.screenPos('iceland')))!;
  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(600);
  const tip = (await ui(page)).tooltip ?? '';
  check(/move 3 in · attack from Greenland/.test(tip), `tooltip over Iceland: ${tip.replace(/\n/g, ' / ')}`, results);
  await shot('r1-02-occupy-hover-iceland');
  await clickT(page, 'iceland');
  await idle(page);
  const s1 = (await page.evaluate(() => window.__risk.getState()))!;
  const u1 = await ui(page);
  check(s1.territories.ontario.armies === 3 && s1.territories.greenland.armies === 7, `min moved in: Ontario ${s1.territories.ontario.armies}, Greenland ${s1.territories.greenland.armies}`, results);
  check(u1.actionBarText === 'Attack Iceland from Greenland', `line 1 armed from the stack: ${u1.actionBarText}`, results);
  check(u1.battle?.header === `JOHN GREENLAND 7 vs ${name(s1, 'iceland')} ICELAND 1`, `battle header: ${u1.battle?.header}`, results);
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
  check(u.primary === 'Blitz' && u.actionBarText === 'Attack Alberta from Ontario', `armed and waiting: ${u.actionBarText} · ${u.primary}`, results);
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
  const samples: { t: number; line: string; header: string | null; result: string | null }[] = [];
  let shots = 0;
  while (Date.now() - t0 < 4200) {
    const u = await ui(page);
    samples.push({ t: Date.now() - t0, line: u.actionBarText, header: u.battle?.header ?? null, result: u.battle?.result ?? null });
    const t = Date.now() - t0;
    if ((shots === 0 && t > 1300) || (shots === 1 && t > 1900) || (shots === 2 && t > 2600)) await shot(`r1-05-conquest-${shots++}`);
    await page.waitForTimeout(40);
  }
  const headers = [...new Set(samples.map((x) => x.header).filter(Boolean))] as string[];
  const lines = [...new Set(samples.map((x) => x.line))];
  console.log('   headers: ' + headers.join(' | '));
  console.log('   lines:   ' + lines.join(' | '));
  const sameOwner = headers.filter((h) => {
    const [a, d] = h.split(' vs ');
    return a.split(' ')[0] === d.split(' ')[0];
  });
  check(sameOwner.length === 0, `no header with one owner on both sides (${sameOwner.join(' | ') || 'none'})`, results);
  check(headers.some((h) => /^JOHN NEW GUINEA 3 vs \S+ INDONESIA 0$/.test(h)), 'the verdict header holds the armies at the verdict (NEW GUINEA 3 vs INDONESIA 0)', results);
  check(!lines.some((l) => /New Guinea \(1\)/.test(l)), 'line 1 never reads "Attacking from New Guinea (1)"', results);
  check(lines.includes('You took Indonesia'), 'line 1 says "You took Indonesia" while the conquest plays', results);
  const last = samples[samples.length - 1];
  check(last.line === 'Attacking from Indonesia (2) · click a glowing enemy', `settles on the chained source: ${last.line}`, results);
}

// --- R1-14: setup-place, refused 4th click, then right-click ------------------------------------------
{
  const s = scenario({ ural: [0, 1], ukraine: [0, 1] }, { kind: 'setup-place', toPlace: 3 }, {
    mutate: (x) => {
      x.round = 0;
      x.turn = 0;
      x.players[0].setupArmies = 3;
    },
  });
  await loadScenario(page, s);
  for (let i = 0; i < 3; i++) await clickT(page, 'ural');
  await page.waitForTimeout(100);
  await clickT(page, 'ural');
  await page.waitForTimeout(100);
  const a = await ui(page);
  check(a.actionBarText === 'All 3 placed · Confirm placement', `refused 4th click: ${a.actionBarText}`, results);
  await clickT(page, 'ural', { button: 'right' });
  await page.waitForTimeout(150);
  const b = await ui(page);
  const conf = b.buttons.find((x) => x.label === 'Confirm placement');
  check(b.actionBarText === 'Place 3 armies · 1 left' && conf && !conf.enabled, `after right-click: ${b.actionBarText} · Confirm ${conf?.enabled ? 'on' : `off (${conf?.why})`}`, results);
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
    lines.add((await ui(page)).actionBarText);
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
