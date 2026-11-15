# rev-design — design system, theme, string tables (2026-11-15)

Scope: `app/src/theme/**`, `app/src/i18n/**`, the eleven shared components. Everything else was scanned, not edited.

Final state, after the coordinator approved the whole first «Fixed» list (round 3). Everything below under «Fixed» is in the working tree now; nothing is committed. Hand-over files next to this report:

| File | What it is |
| --- | --- |
| `rev-design-gold-text.cjs` | lists the 111 pale-gold text sites in other sessions' files; `--write` switches them to `colors.goldLightText`. **Not run** — waiting for the coordinator's go |
| `rev-design-unused-string-keys.json` | 107 keys with no use in `app/src`, plus 8 keys merged today whose screens do not read them yet. `contact.membersOnly` and `contact.activate` are in use and are not listed |

## Fixed

String tables (values only, every edit made with the Edit tool; no key added, removed or moved by me; both tables parse, 1554 keys each, CRLF kept):

- `ar.json:1495` + `en.json:1495` `affiliate.homeNudge` — «ابدأ في تحقيق عوائد مجزية» read as a promised return. Now «…واحصل على عمولة عن كل عضو دافع وفق شروط البرنامج.» / «…earn a commission for every paying member under the program terms.» (the sentence rev-services proposed).
- `en.json` — one word per thing: `e-mail` / `E-mail` → `email` / `Email` (24 occurrences); `administration` → `management` (14); `:1167` `inbox.kind.post` «Management message»; `:845` `requests.kind.profile` «A Life & Legacy» (same Arabic as `nav.people`); `:497` `stats.creditsLeft` «Balance left».
- `en.json` — `nav.*` header titles in Title Case like the other 30: `nav.goldenOffer`, `nav.form`, `nav.card`, `nav.invite`, `nav.register`, `nav.verify`, `nav.peopleApply`.
- `en.json` — punctuation: 6 curly apostrophes → straight; `home.destination.confirmText` and `wow.countdown` `"…"` → `“…”`.
- `en.json:66` `news.latest` «The latest business news from trusted sources» (matches the Arabic; rev-news-videos); `:609` `golden.vibesPage` «Vibes Ventures' offer page» (rev-projects).

Theme (`theme/tokens.ts`), contrast computed with the WCAG formula:

- `:19-23`, `:90-91` `goldText` / `goldLightText` — gold as text or icon. Dark = `gold` / `goldLight` (no visible change). Light `#7F6218`: 5.7:1 on white, 5.3:1 on the page, 4.6–5.0:1 on the gold wash (light `gold` reads 3.3:1, light `goldLight` 2.2:1).
- `:33` dark `textMuted` `#7E7E86` → `#86868E` (4.2:1 on elevated cards → 4.7:1); `:101` light `textMuted` `#6B7A90` → `#5F6F86` (4.0–4.4:1 → 4.6–5.1:1).
- `:40`, `:107` `onPhotoMuted` `#7E7E86` → `#9B9BA3` (4.3:1 → 6.3:1 on a dark photo, 1.9:1 → 2.7:1 over a mid-tone photo).
- `:70`, `:129` `paperMuted` `#8C8472` → `#736B59` (3.5:1 on the ivory sheet → 4.9:1).
- `:118`, `:120` light `success` `#1E8E63` → `#177A53` (3.8:1 → 4.9:1), light `warning` `#B8842A` → `#8F6A12` (3.05:1 → 4.6:1).
- `:322`, `:337` light form palette `muted` → `#5F6F86`, `accent` `#b8842a` → `#8A6D1D` (3.3:1 → 4.9:1 on the white form card).
- `:181-184`, `:196-198` gradients `hairline` and `rim`, with a light variant (the pale filament and rim light vanished on white).
- `:60-63`, `:122-123` new `onDanger: '#FFFFFF'` and `stage: '#000000'` in both palettes (coordinator item 4). The two callers (`news/NewsCard.tsx:36`, `YouTubeEmbed.tsx:14`) are not my files and still hold their literals.

Shared components:

- `Screen.tsx:1,39,43` — iOS: `keyboardVerticalOffset` = the stack header height, read with `useContext(HeaderHeightContext) ?? 0`; Android unchanged. **Import path differs from the coordinator's note:** `@react-navigation/elements` is not installed (expo-router 57 ships react-navigation inside itself), so the context comes from `expo-router/react-navigation` — the same object the native stack provides (`build/react-navigation/native-stack/views/NativeStackView.native.js:229`). Not seen on an iPhone.
- `AppButton.tsx:30` outline / ghost label and icon `goldText`; `:67` `minHeight: 44`.
- `Chip.tsx:48` `hitSlop` (pill ~28 pt → 44 pt touch area, layout unchanged).
- `ClampText.tsx:56` `hitSlop={10}` on «عرض المزيد» (28 → 48 pt); `:63`, `:88` text and chevron `goldLightText`.
- `SectionHeader.tsx:32,45` icons `goldText`; `:39`, `:46` `numberOfLines={1}` on the «+N» badge and «عرض الكل»; `:45` `hitSlop` 8 → 10 (27 → 47 pt); `:100` `goldLightText`; `:111` `#141005` → `colors.goldInk`.
- `Notice.tsx:18`, `StateView.tsx:39,62` icons `goldLightText`.
- `lux.tsx:119` `GoldHairline` reads `gradients.hairline`; `:77-92` `NeonPulse` holds still under «reduce motion».
- `motion.tsx:133-150` `Wiggle`: under «reduce motion» the repeating nudge rests and the one-shot shake still runs (M152's own rule: endless loops hold, one-shots run — the first version dropped the one-shot too); `:263-278` `usePulse` holds at the mid value; `:324-336` `Sheen` rests.
- `wow.tsx:25-42` `GoldTicker`, `:82-91` `GoldSweep`, `:318-320` `GoldDust` rest under «reduce motion» (the ticker then shows one still copy of the row: items beyond the screen width are not reachable in that mode); `:112` `gradients.rim`; `:371`, `:395` ticker text and flip digits `goldLightText`; `:378` the compact countdown label sits on the event photo → `onPhotoGold`.

Checked and found right, nothing changed: no missing key, empty value, placeholder mismatch or duplicate in the tables; the Arabic copy rules over every value («مجان», «كريديت», «صفقات», the old brand names, «صفة», a hyphen between numbers, persona order, a colloquial-word token scan); `ClampText`'s overflow test (unclamped invisible twin, right on both platforms); `Screen` safe areas and the status-bar style from `_layout.tsx`; `StateView` loading / empty / error + retry; `paper.tsx` (no `zIndex`); `direction.ts`, `chooseLanguage.ts`, `theme.ts`; every Animated value is `useState(() => new Animated.Value())` and stopped on unmount; every shadow is a `boxShadow` string.

## Problems not fixed

1. **High (light mode), waiting for the coordinator's go** — `colors.goldLight` is the text or icon colour in **111 places in ~50 files** of other sessions (worst: `ProjectCard.tsx` ×6, `(tabs)/projects.tsx` ×6, `news/NewsCard.tsx` ×5, `WorkshopRecordings.tsx` ×5, `project/[id].tsx` ×5, `agenda/[id].tsx` ×4, `news/index.tsx` ×4, `requests/index.tsx` ×4, `advisor/RichText.tsx` ×4, `StorePurchaseCard.tsx` ×3). Pale gold on white at 2.2:1: source names, «اقرأ من المصدر», prices, links. Fix: `node docs/reviews/2026-11-15/rev-design-gold-text.cjs --write`, then 8 lines by hand in `card.tsx`, `watch.tsx`, `welcome.tsx`, `NewsCarousel.tsx` (surfaces dark in both themes → `onPhotoGold`). Until it runs, the light theme keeps this problem everywhere outside the shared components.
2. **Medium (light mode)** — `colors.gold` as a text colour: 98 style lines + 98 icons in other files; 3.3:1 on white, fine for 24 pt titles, weak for 12–15 pt text. Proposed: small gold text → `colors.goldText`, titles keep `gold`; needs a per-line look.
3. **Medium** — `components/NewsCarousel.tsx:25` (`DIR`) and `components/ProfileCompleteness.tsx:24` (`MIRRORED`) read `I18nManager.isRTL` at module scope; on a binary that reports RTL at every start, English gets the Arabic swipe direction and a mirrored ring. Exact edits in the next section.
4. **Medium (iPhone)** — the `Screen` keyboard offset above is applied but not seen on a device. One check on the iPhone before the store build: a long form under a header (`form/[key]`, `profile-edit`), last field focused — it must sit just above the keyboard, with no gap.
5. **Low (Android 15+, not verified)** — `edgeToEdgeEnabled=true` with `adjustResize`, and `Screen` passes no `behavior` on Android: one check by the Android-run session that a field at the bottom of a form rises above the keyboard.
6. **Low, not now (coordinator)** — Arabic number agreement in 20 values (`wallet.available`, `videos.count`, `card.daysValue`, `form.summaryMany`…); `Appearance.setColorScheme` for the dark native UI in the light theme; deleting unused keys; the wording of `nav.partners`, `card.promoLabel`, `card.numberLabel`, «أرباحي».
7. **Low** — `projects.count` not reworded: the coordinator says no screen uses it any more (it is now in the unused list).
8. **Low** — placeholders `textFaint` (2.5:1 dark, 2.1:1 light) and `paperFaint` (1.9:1): the owner's own M128 choice.
9. **Info** — hard-coded colours outside the tokens: 63 literals in 31 files; 21 are black scrims, backdrops and text shadows over photos (same in both themes). The ones that ignore the theme: `news/NewsCard.tsx:36` `#FFFFFF` (→ `colors.onDanger`), `YouTubeEmbed.tsx:14` `#000000` (→ `colors.stage`), `NewsCarousel.tsx:271` `#0E0E14`, `StructuredText.tsx:221` `#0B0B0D`, `DeletionBanner.tsx:65`, `VerifiedBadge.tsx:25,50`, `SectorStrip.tsx:158`, `ProjectsBankCarousel.tsx:126,139`, `RotatingBanner.tsx:110`, `agenda/index.tsx:178`, `RetiredBuildGate.tsx:13,53`, `UpdateGate.tsx:139`; deliberate: `checkout/[id].tsx` (white payment sheet), `card.tsx:41-44,397,400` (the black card).

Scans that came back clean: module-scope `colors.` / `shadows.` / `gradients.` reads (0), module-scope `t()` / `isRTL()` calls (0), `zIndex` (0), `fontFamily` outside `fonts.*` (0), `fontWeight` (0), `shadowColor` (0), persona order in code (0 out of order), Arabic sentences inside `.tsx` (0; only the «ريال» marker that `SarText` swaps for the symbol, and sector keywords in `SectorStrip.tsx`), English sentences inside `.tsx` (0; only «VIP» and «PDF»).

## Shared-file changes needed

Other sessions' files (exact edits):

1. `colors.goldLight` text / icon sites → `colors.goldLightText`: the script above, on the coordinator's go.
2. `components/NewsCarousel.tsx:25` — old `const DIR = I18nManager.isRTL ? -1 : 1;` → remove the constant; inside the component `const dir = isRTL() ? -1 : 1;` (import `isRTL` from `@/i18n/direction`) and use `dir` where `DIR` was.
3. `components/ProfileCompleteness.tsx:24` — old `const MIRRORED = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;` → inside the component `const mirrored = isRTL() && I18nManager.doLeftAndRightSwapInRTL;`.
4. `components/news/NewsCard.tsx:36` — `color: '#FFFFFF'` → `color: colors.onDanger`; `components/YouTubeEmbed.tsx:14` — `export const STAGE_BLACK = '#000000';` → use `colors.stage` at the call sites (read at render, not in a module constant).
5. `components/UpdateGate.tsx:138-139` — `textAlign: 'left'` → `textAlign: textStart` (same result, the agreed helper). `components/FormField.tsx:108` is a `TextInput` (physical left for Latin input): correct, leave it.
6. Remote images not passed through `sized()` at the `<Image>` (16; another 6 are QR codes and YouTube thumbnails, which need none). Some may be sized earlier in the data layer, so check before changing: `(tabs)/account.tsx:225`, `(tabs)/index.tsx:590`, `about.tsx:43,108`, `golden.tsx:62`, `golden/[code].tsx:62,105`, `partners.tsx:114`, `GoldenCompanyCard.tsx:29`, `GoldenOpportunity.tsx:71`, `ProjectCard.tsx:49`, `ProjectsBankCarousel.tsx:84`, `project/ProjectReviews.tsx:60`, `StructuredText.tsx:166`, `IntroVideo.tsx:51,113`.
7. Elevation covers (not `zIndex`, so not the M240 crash; listed for awareness): `AppLockGate.tsx:79`, `ProfileCompletionGate.tsx:366`, `RetiredBuildGate.tsx:43`, `SplashFlash.tsx:34`, `UpdateGate.tsx:126`.
8. `server/` — `npm run strings` after the string tables are final (it copies them into `server/src/appStrings/catalog.ts`; the server's `npm test` fails while that copy is stale — it is stale now).

## Checks run

- `npx tsc --noEmit` inside `app/` — exit 0 (last run after every edit of this round). An earlier run in this round failed once on `src/components/FormEmbed.tsx(211,17)` (`required` not in `FormFileField`'s props): another session's edit in progress, gone by the next run.
- `npx eslint src/theme src/i18n` + the eleven shared components — exit 0, no warnings.
- Table audit script (scratchpad, not in the repo): 1554 / 1554 keys, 0 missing, 0 empty, 0 placeholder differences, 0 duplicates; no `e-mail`, `administration` or curly apostrophe left in `en.json`; both files keep CRLF.
- Contrast: WCAG formula over the text / surface pairs of both palettes; the figures above are from that script.
- `rev-design-gold-text.cjs`: dry run only — 111 sites, 8 of them in the four CHECK files.
- Not run: no device, emulator, Metro, OTA or build. Nothing here was seen on a phone; the light-theme colours are computed, not looked at, and the iOS keyboard offset is untested.
