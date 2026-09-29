// Phone screens by taps only (docs/MOBILE.md §5, §8), on the iPhone 15 Pro in portrait and landscape:
// title (New game in the thumb zone, no keycaps) → New game (one column, sticky Start inside the screen,
// Length as a segmented control, a seat flipped to Human and back) → Start → the game → rotate the phone
// (the layout follows, the rotate pill goes) → a winning blitz → Victory (awards swipe, sticky Rematch
// stays on screen while the page scrolls) → Rematch → a new game. The document never scrolls; 0 errors.
import { check, finish, idle, loadScenario, scenario, ui } from './lib';
import { DEVICES, openDevice, pageStill, tapId, tapT, type DeviceName } from './mobile-lib';
import { TERRITORY_IDS, type TerritoryId } from '../../src/engine';

const results: string[] = [];
const allErrors: string[] = [];

async function run(dev: DeviceName): Promise<void> {
  const ctx = await openDevice(dev);
  const { page, errors } = ctx;
  const tag = `[${dev}]`;
  const vp = DEVICES[dev].desc.viewport;
  let scrolled = 0;
  const still = async (w: string) => {
    const s = await pageStill(page);
    if (!s.ok) (scrolled++, console.log(`${tag} scrolled at ${w}: ${s.detail}`));
  };
  const inView = (testid: string) =>
    page.evaluate(
      ([id, H, W]) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top >= 0 && r.bottom <= H + 0.5 && r.left >= 0 && r.right <= W + 0.5;
      },
      [testid, vp.height, vp.width] as const,
    );

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__risk?.ui().screen === 'title');
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="title-new"]')!.getBoundingClientRect();
    const kc = [...document.querySelectorAll('.title-screen kbd')].filter((k) => (k as HTMLElement).offsetParent !== null).length;
    return { top: b.top, h: b.height, w: b.width, kc };
  });
  const portrait = vp.height > vp.width;
  check(t.h >= 44 && t.kc === 0 && (!portrait || (t.top > vp.height * 0.6 && t.w > vp.width * 0.8)), `${tag} title: New game ${Math.round(t.w)}×${Math.round(t.h)} at y ${Math.round(t.top)}${portrait ? ' (thumb zone, full width)' : ''}, ${t.kc} keycaps`, results);
  await still('title');

  await tapId(page, 'title-new');
  await page.waitForFunction(() => window.__risk.ui().screen === 'newGame');
  await page.waitForTimeout(400);
  check(await inView('ng-start'), `${tag} new game: Start is on screen (sticky)`, results);
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  check(focused !== 'INPUT', `${tag} new game: no field auto-focused (no keyboard pops up) (${focused})`, results);
  await tapId(page, 'seat-kind-1-human');
  await page.waitForTimeout(100);
  const kind = await page.locator('[data-testid="seat-kind-1-human"]').getAttribute('aria-checked');
  check(kind === 'true', `${tag} seat 2 → Human by tap`, results);
  await tapId(page, 'seat-kind-1-ai');
  await page.waitForTimeout(150);
  await tapId(page, 'length-quick');
  await page.waitForTimeout(100);
  check((await page.locator('[data-testid="length-quick"]').getAttribute('aria-checked')) === 'true', `${tag} Length → Quick by tap`, results);
  await page.evaluate(() => document.querySelector('.ng-grid')!.scrollTo(0, 9999));
  await page.waitForTimeout(150);
  check(await inView('ng-start'), `${tag} Start stays on screen with the list scrolled`, results);
  await still('new game scrolled');
  await tapId(page, 'ng-start');
  await page.waitForFunction(() => window.__risk.ui().screen === 'game', null, { timeout: 8000 });
  check(true, `${tag} Start → the game`, results);
  await page.waitForTimeout(1500);
  await still('game');

  // Rotate the phone mid-game.
  const html0 = await page.evaluate(() => document.documentElement.className);
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(600);
  const html1 = await page.evaluate(() => document.documentElement.className);
  const rot = await page.evaluate(() => {
    const s = document.querySelector('.strip')!.getBoundingClientRect();
    return { b: s.bottom, h: s.height, pill: !!document.querySelector('[data-testid="rotate-pill"]:not(.hidden)') };
  });
  check(html0.includes(portrait ? 'portrait' : 'landscape') && html1.includes(portrait ? 'landscape' : 'portrait') && html1.includes('form-phone') && rot.b <= vp.width + 0.5, `${tag} rotated: ${html1} · dock ${Math.round(rot.h)} px tall, bottom ${Math.round(rot.b)}`, results);
  if (portrait) check(!rot.pill, `${tag} rotating to landscape dismisses the rotate pill`, results);
  await page.setViewportSize(vp);
  await page.waitForTimeout(500);
  await still('rotated back');

  // A winning blitz → Victory → Rematch.
  const own: Partial<Record<TerritoryId, [number, number]>> = {};
  for (const id of TERRITORY_IDS) own[id] = [0, 1];
  own.alaska = [1, 1];
  own.kamchatka = [0, 30];
  await loadScenario(
    page,
    scenario(own, { kind: 'attack' }, {
      mutate: (st) => {
        st.config.dominationPercent = 100;
        st.players[2].eliminated = true;
        st.players[3].eliminated = true;
      },
    }),
  );
  await tapT(page, 'alaska');
  await page.waitForTimeout(200);
  check((await ui(page)).buttons.includes('Blitz'), `${tag} armed Kamchatka → Alaska`, results);
  await tapId(page, 'btn-blitz');
  await page.waitForFunction(() => window.__risk.ui().screen === 'victory', null, { timeout: 20000 });
  await page.waitForTimeout(1600);
  await page.touchscreen.tap(vp.width / 2, vp.height / 2);
  await page.locator('[data-testid="rematch"]').waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(900);
  check(await inView('rematch'), `${tag} victory: Rematch on screen`, results);
  const v = await page.evaluate(() => {
    const sc = document.querySelector('.victory-screen') as HTMLElement;
    // (No awards were earned in this short game: read the row's layout with it un-hidden.)
    const aw = document.querySelector('.v-awards') as HTMLElement;
    const wasHidden = aw.classList.contains('hidden');
    aw.classList.remove('hidden');
    // INK B5: three award lines on the scroll (stacked, all visible; the old swipe row hid two of three).
    const cs = { display: getComputedStyle(aw).display, dir: getComputedStyle(aw).flexDirection, fits: aw.scrollWidth <= aw.clientWidth + 1 };
    if (wasHidden) aw.classList.add('hidden');
    sc.scrollTo(0, 99999);
    return { scrollable: sc.scrollHeight > sc.clientHeight, awardsRow: cs.display === 'flex' && cs.dir === 'column' && cs.fits, mid: getComputedStyle(document.querySelector('.v-mid')!).gridTemplateColumns };
  });
  await page.waitForTimeout(200);
  check(v.awardsRow, `${tag} victory: awards are stacked lines that fit the width`, results);
  check(await inView('rematch'), `${tag} victory: Rematch stays on screen scrolled to the end (scrollable ${v.scrollable})`, results);
  await still('victory');
  await tapId(page, 'rematch');
  await page.waitForFunction(() => window.__risk.ui().screen === 'game', null, { timeout: 8000 });
  check(true, `${tag} Rematch → a new game`, results);
  await idle(page, 30000).catch(() => undefined);
  await still('rematch');

  check(scrolled === 0, `${tag} the document never scrolled or zoomed`, results);
  check(errors.length === 0, `${tag} 0 console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`, results);
  allErrors.push(...errors.map((e) => `${tag} ${e}`));
  await ctx.browser.close();
}

for (const dev of (process.env.MOBILE_DEVICES ?? 'iphone,iphone-land').split(',') as DeviceName[]) await run(dev);
finish(results, allErrors);
