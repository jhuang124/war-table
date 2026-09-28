# Mobile pass: War Table as a first-class mobile game

John: "optimize for mobile, make decisions similar in style to a fully featured AAA mobile app;
efficient, clean UI/UX." Live at https://jhuang124.github.io/war-table/ (GitHub Pages; push to main
deploys). References: Risk: Global Domination (mobile), Polytopia, Marvel Snap for clarity, Apple HIG
for touch. Desktop must keep working exactly as today; mobile is additive and chosen by capability
(`pointer: coarse` and/or viewport width), not user agent.

Rules, engine, AI, pieces, dice, the Turn Track and "board clicks select, buttons commit" all stay.
This file overrides ROUND2/SIMPLIFY/UX where they conflict on touch devices.

## 1. Devices and orientation
- Targets: iPhone 13–16 (390–430 pt wide), Pixel 7/8, iPad / Android tablets. Safari iOS 17+ and
  Chrome Android.
- **Landscape is the primary phone layout** (the world map is 2:1). Portrait is fully supported, not
  a "rotate your phone" wall: the board fits width and can be panned; controls live in a bottom dock.
  First launch in portrait on a phone shows one dismissible pill: `Rotate for the full map`.
- Respect safe areas everywhere (`env(safe-area-inset-*)`, `viewport-fit=cover`), including the
  home indicator and notch/Dynamic Island in landscape.

## 2. App shell (feels installed, not a web page)
- Viewport: `width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no` (the game
  provides its own zoom and a Text size setting). `overscroll-behavior: none`, no pull-to-refresh,
  no rubber-banding, no text selection, no tap highlight, no callouts on long-press, `touch-action:
  none` on the board, `manipulation` on controls. `100dvh`, never `100vh`.
- **PWA**: `manifest.webmanifest` (name "War Table", short name "War Table", `display: fullscreen`
  with `standalone` fallback, `orientation: any`, dark theme/background colors), generated app icons
  (192, 512, maskable, apple-touch-icon 180) drawn from the game's own look (brass on ink-teal,
  a stylized cannon or crossed swords + "WT"), `apple-mobile-web-app-capable`, status-bar style
  black-translucent. A service worker caches the built assets so the game loads offline after the
  first visit (cache-first for hashed assets, network-first for index.html, versioned; must not break
  GitHub Pages updates).
- Everything relative to Vite `base: './'` (Pages subpath).

## 3. Touch input (board)
- **Tap** = select (the same as a click on desktop). Tap tolerance: if no tile is exactly under the
  finger, pick the nearest selectable territory within ~22 px, so small tiles (Iceland, Japan, Central
  America) are easy to hit. Tap feedback in the same frame (lift + ring).
- **One-finger drag = pan** (not orbit). **Pinch = zoom** toward the pinch center, with momentum and
  soft clamps. No orbit on touch; no double-tap zoom. A drag never selects.
- **Long-press (400 ms)** on a territory = the name card (territory, continent + bonus, owner, armies)
  as a small popover above the finger; it replaces hover, which doesn't exist on touch. Releasing
  dismisses it. Long-press never selects.
- Selected source, armed target and hovered/pressed tiles always show their names (no hover on touch).
- Reset view pill appears when panned/zoomed away (as on desktop).
- Haptics where supported (`navigator.vibrate`, Android): light tick on select, a short buzz on dice
  landing, a stronger one on conquest/elimination. Silent no-op elsewhere.

## 4. HUD layout on phones
**Landscape phone** (e.g. 844×390):
- Top-left: seat chips compress to **colored emblem pills with the territory count** (`▲ 12`); the
  current seat's pill expands to show the name. Top-right: `≡` (44×44). Nothing else on top.
- Bottom: a **dock** hugging the bottom safe area, full width minus insets, ~64 px: Turn Track as a
  compact segmented control on the left (icons + short labels: Place / Attack / Fortify / End), the one
  line in the middle (truncates gracefully), the action buttons on the right (≥ 44 px tall, primary
  brass). Count control appears as a compact stepper/slider inline.
- Dice tray: scaled to fit above the dock, never covering more than ~40% of the screen height; the
  header line on its top edge.

**Portrait phone** (e.g. 390×844):
- Top: seat pills in one row (scroll horizontally if > 4 ever), `≡` at right.
- Board in the middle, fit to width, pannable.
- Bottom **dock stacks in two rows**: row 1 = the Turn Track (full width, 4 equal segments, 44 px);
  row 2 = the line (one line) + count control + buttons (full-width primary on the right, thumb zone).
- Dice tray above the dock, full width.

**Tablet**: desktop layout with touch input rules and 44 px targets.

## 5. Sheets and screens
- Menu, Settings, Rules, Log, Cards, and the hand-off cover become **bottom sheets** on phones:
  grab handle, drag-down or tap-scrim to dismiss, spring motion (≈ 280 ms), safe-area padding,
  scrollable content, big 48 px rows. Desktop keeps its current overlays.
- **Title**: portrait = stacked lockup at top, big full-width `New game` / `Continue` buttons at the
  bottom thumb zone; landscape = as desktop but scaled.
- **New game**: single column, one seat per row as a card (emblem button → 6-swatch sheet, name field,
  Human/AI segmented, difficulty only for AI), Length and Setup as full-width segmented controls,
  sticky `Start` button at the bottom. No hover-only affordances. Name inputs don't trigger iOS zoom
  (font-size ≥ 16 px).
- **Victory**: single column: banner, awards as a horizontal swipe row, chart full width, sticky
  `Rematch`.
- Hand-off cover **defaults on** for touch devices with 2+ humans (a phone is physically passed
  around, so hiding cards means something there).

## 6. Type, targets, motion
- Minimum touch target 44×44 pt; 8 pt spacing between targets. Minimum body text 15 px, line 16 px,
  plaques ≥ 20 px on phones.
- Text size setting defaults: phone = Laptop (1.0) scale tuned for phones; the setting still works.
- Motion: sheets and dock changes use springs; respect reduced motion.

## 7. Performance (mobile GPUs)
- DPR cap 2 on phones (1.5 if the frame budget is missed for 2 s, adaptive), shadows cheaper (smaller
  shadow map, or baked contact shadows for pieces), no bloom on phones, pause rendering when the tab is
  hidden, and render on demand when idle (nothing animating → don't redraw every frame) to save
  battery. Target 60 fps on iPhone 13, never below 30.
- Handle `webglcontextlost` / restored: show a quiet `Reloading the board…` and rebuild; never a
  white screen.
- First load on 4G: keep the bundle lean; show the boot splash immediately.

## 8. Done means
- Playwright device emulation (iPhone 15 Pro portrait + landscape, Pixel 8, iPad Pro) with
  `hasTouch/isMobile`: a full human turn by taps only (place via stepper, Turn Track, attack, blitz,
  occupy, fortify, end), pinch/pan (CDP multi-touch), long-press name card, every sheet opens and
  dismisses, title → new game → start → victory → rematch, no page scroll or zoom ever, safe areas
  respected, 0 console errors. Screenshots of each state in both orientations, looked at.
- Desktop e2e suite still 17/17.
- Lighthouse-style check: manifest valid, icons present, service worker registers, works offline on
  reload.
