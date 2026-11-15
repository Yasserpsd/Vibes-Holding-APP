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

---

# Round 4 (2026-11-16) — the shared text layer, for two member complaints

Source: `docs/reviews/2026-11-16/complaint-text-pushed-left.json` and `complaint-text-unreadable-or-overlapping.json` (`challenge.finalFixPlan`), with the coordinator's decisions. JavaScript only, Edit tool only, no string key added or removed.

## Fixed

- `i18n/direction.ts:78` **`markParagraphs()`** (text plan priority 2) — puts an invisible direction mark in front of every line of server- or member-written text. Pure function; empty lines and lines that already open with a mark are left alone; `''` for no input. `restart()` / `syncDirection()` untouched (rev-platform's edits to them are in the same file and intact).
  - One thing goes beyond the plan's wording, and it is needed for decision 2: a line that reads the OTHER way from the screen (no Arabic letter on the Arabic screen, or Arabic on the English one) gets the screen's mark **plus an isolate** of its own direction (U+2066 / U+2067 … U+2069). With a bare left-to-right mark, Android would still put that line on the left among Arabic lines, because one Text has one alignment; inside an isolate it sits on the start edge and still reads in its own order, full stop included.
  - The marks are written as code points (`String.fromCharCode`), never as invisible characters in the source.
- `i18n/direction.ts:47` **`textDir()`** (priority 3, decided) — always the start edge, with the content's own writing direction. Latin-only titles go back to the right in Arabic on project cards, the Projects Bank carousel, the golden opportunity, videos, the watch page and advisor file names. No caller needed a change to compile; `Highlight.ownDirection` already did the same.
- `components/advisor/RichText.tsx` — the advisor's replies and the member's own bubbles: `:196` every paragraph and table cell, `:169` code blocks, both pinned to the start edge (`:19`). `:21-33`, `:227` a plain link that closes a line no longer swallows the closing mark (the address is cut before punctuation and marks).
- `app/contact.tsx:175` — the management thread bubbles (another session edited the file after me; the call is still there).
- `app/posts/[id].tsx:70,175,232` — the letter's title, the poll options, the event's place. The BODY is drawn by `StructuredText` (left for its owner, one-line change below).
- `app/news/[id].tsx:61,68` — the headline and the source's snippet (the text itself is unchanged: the marks are invisible).
- `components/ClampText.tsx` (unreadable plan priority 9) — the line count is kept for text + rounded width + system text size; a change of any of them mounts a new invisible twin and counts again.
- Centred popups (priority 6), card capped at 88% of the window height, text in a `ScrollView` that gives way first, buttons outside it: `GuestNudge.tsx:64`, `RateUsPrompt.tsx:144` (the grip, the hairline and the three buttons stay; emblem, stars and words scroll), `IntroVideo.tsx:113` (the popup only; poster and words scroll), `ProfileCompleteness.tsx:128`. `PhoneConfirmAlert.tsx` and `PasswordPrompt.tsx` not touched.
- `components/wow.tsx:166,399` (priority 8, my file) — the labels of the compact countdown (the one on the event photo) use `onPhotoMuted`. The full-size countdown on the page keeps `textMuted`: on-photo ink would be 2.7:1 on a white page.

Not done on purpose: no `textAlign` in the typography tokens (decision 4); Latin form fields unchanged (decision 3).

## One-line changes for the files left to their owners

Each one: add `markParagraphs` to the import from `@/i18n/direction`, then:

1. `components/Highlight.tsx:58` — `const parts = rangeDashes(text).split(IMPORTANT);` → `const parts = markParagraphs(rangeDashes(text)).split(IMPORTANT);` (covers every `Highlight` caller, `project/[id].tsx:354,364,368` included).
2. `components/StructuredText.tsx:102` (`Lit`) — `const parts = text.split(NUMBER);` → `const parts = markParagraphs(text).split(NUMBER);`; and the two headings drawn without `Lit`: `:119` `{block.text}` → `{markParagraphs(block.text)}`, `:190` the same. This is what fixes the body of `posts/[id].tsx`, `agenda/[id].tsx` and `service/[key].tsx`.
3. `components/GoldenCompanyCard.tsx:35-37` — `{company.code}`, `{company.name}`, `{company.tagline}` → each inside `markParagraphs(…)`; and `textAlign: textStart` on the `code`, `name` and `tagline` styles (plan priority 4, iPhone).
4. `app/project/[id].tsx` — nothing once item 1 is in (its content goes through `Highlight`); only plan priority 4: `textAlign: textStart` on the `body` style.
5. `components/PostsBlock.tsx:99` — `{post.title}` → `{markParagraphs(post.title)}`; `:134` `{withoutMediaLines(post.body)}` → `{markParagraphs(withoutMediaLines(post.body))}`; and `textAlign: textStart` on the `title` and `body` styles (priority 4).

The same one-liner at the remaining sites of the plan, none of them mine: `WorkshopAd.tsx:107-108` (`ad.headline`, `ad.body`), `AdminPopup.tsx` (the popup's text), `meetup/[key].tsx:49` (`meetup.description`), `people/[id].tsx:68` (`data.bio`), `(tabs)/news.tsx:194` (the inbox row title), and the children of the `textDir` sites: `(tabs)/index.tsx:434`, `watch.tsx:93`, `advisor/Composer.tsx:54`, `advisor/MessageBubble.tsx:146`, `news/NewsCard.tsx:63,67`, `NewsCarousel.tsx:214,242,243`, `VideoCard.tsx:61,65`. Until they have it, an Arabic line that OPENS with a Latin word still reads in the wrong order on Android at those sites (unchanged from before; the edge is already right).

## What must be looked at on a phone

Nothing in this round was seen on a device. The two platforms differ here, so both are needed.

Android (it reads direction from the string, and gives one Text one alignment):
1. Advisor, Arabic: ask for «قائمة مؤشرات KPI لشركة SaaS». Every bullet starts on the right, also a bullet with no Arabic at all, which must read left to right with its full stop at its right end. A line that ends with a link: the link opens.
2. No box or stray glyph anywhere a mark was added (advisor bubble, contact bubble, news page, post title) — the isolates U+2066 / U+2069 are new in this app; an old phone (Android 7 or 8) is the one to try. Copy a reply and paste it into a note: it must paste clean.
3. Contact thread: a message whose first line is «Investors Club» with Arabic lines under it — all on the right.
4. News page: an Arabic headline that opens with a Latin name reads right to left with the name on the right; an English headline sits on the right.
5. Project cards, the Projects Bank carousel, videos, the watch page: a Latin-only name is on the right again.
6. English mode: an Arabic line inside an English reply stays on the left and reads right to left.
7. Popups on a short screen with large text (`adb shell wm size 1080x1680`, `font_scale 1.3`): the guest nudge, the rating sheet, the intro film, the profile nudge — every button visible, the words scroll.
8. Project page with a three-line «نبذة»: change `font_scale` while the app is open — the «اقرأ المزيد» pill appears when the text now runs past three lines.
9. Light theme, home event card with a photo: the «يوم / ساعة / دقيقة» labels are readable.

iPhone (it takes the edge from the style and each line's base direction from the mark; before this round it guessed from the first letter):
1. The same advisor check: bullets on the right, the bullet sign on the right, a Latin-only line readable left to right.
2. English mode on the iPhone: Arabic lines inside an English reply.
3. The four popups: the card is not clipped, the buttons are not squeezed, and the rating sheet still sits on the bottom edge.
4. Text size changed in Settings while the app is open: the «اقرأ المزيد» pill follows (this case exists on iPhone only in practice).
5. Still open from round 3: a long form under a header with the last field focused (keyboard offset in `Screen`).

## Checks run (round 4)

- Unit check of `markParagraphs()` / `textDir()` and the advisor link handling against the real source files (scratchpad script, 19 cases: Arabic, Latin, digits only, mixed lines, empty lines, CRLF, already marked, twice in a row, both screen languages, a link at the end of a marked line, bold at the start of one): all pass.
- `npx eslint` on the 11 files changed in this round — exit 0.
- `npx tsc --noEmit` — exit 2, six errors, none in my files: `keyboardType` `"ascii-capable-number-pad"` in `auth/reset.tsx`, `auth/verify.tsx`, `delete-account.tsx`, `persona.tsx`, `PhoneCodeStep.tsx`, `PhoneConfirmAlert.tsx` (another session's keyboard work in progress).
- Source scan: no raw invisible character in `direction.ts` or `RichText.tsx`.

---

# Round 5 (2026-11-16) — the text layer everywhere, small gold text, the compact countdown

Edit tool only; no string key added or removed; none of `Screen.tsx`, `FormField.tsx`, `FormEmbed.tsx`, `ProfileCompletionGate.tsx`, `AdvisorChat.tsx`, `contact.tsx` touched.

## Fixed

**1. Direction marks at every content site — 36 call sites in 16 files** (with round 4: 44 sites in 20 files), each found by its text:

| File | Sites |
| --- | --- |
| `components/Highlight.tsx` | 1 — before the split, so every caller is covered (`project/[id].tsx` description lines included) |
| `components/StructuredText.tsx` | 5 — `Lit` (paragraphs, bullets, fact values, both variants), the two headings, the two fact labels. Added AFTER the line is parsed, so a mark never hides a bullet or a label from the parser. This is the body of `posts/[id].tsx`, `agenda/[id].tsx`, `service/[key].tsx` |
| `components/GoldenCompanyCard.tsx` | 3 — code, name, tagline |
| `components/PostsBlock.tsx` | 3 — title, place line, body preview |
| `components/WorkshopAd.tsx` | 3 — headline, body, title |
| `components/AdminPopup.tsx` | 2 — title, body |
| `app/meetup/[key].tsx` | 3 — description, feature title, feature text |
| `app/people/[id].tsx` | 2 — bio, the title · company line |
| `app/(tabs)/news.tsx` | 2 — the inbox row title and its one-line subtitle (after `fitWords`) |
| `app/(tabs)/index.tsx` | 1 — the unread-message title |
| `app/watch.tsx` | 2 — title, description |
| `components/advisor/MessageBubble.tsx` | 1 — file name |
| `components/news/NewsCard.tsx` | 2 — title, snippet |
| `components/NewsCarousel.tsx` | 3 — number-of-the-day title, slide title, slide snippet (after `fitWords`) |
| `components/VideoCard.tsx` | 2 — title, blurb |
| `components/advisor/Composer.tsx` | 1 — the attachment name (done last, after re-reading the file; nothing else changed in it) |

Start-edge alignment for iPhone (text plan priority 4), 6 styles: `GoldenCompanyCard` `code` / `name` / `tagline`, `PostsBlock` `title` / `body`, `project/[id].tsx` `body`.

**2. Small gold text and icons in the light theme — 73 sites in 42 files, read line by line** (the list of `colors.gold` as a text or icon colour went from 230 to 157):

- 44 text styles → `colors.goldText`: every one at 15 px and below (links, pills, prices in lists, captions, the «◆» bullets), plus the seven at 16 px, which are links, prices, a pill and the 2FA secret (`affiliate/index` `link`, `people/[id]` `title`, `security-2fa` `secret`, `guide` `stepNumber`, `HqProposalCard` `title`, `MessageBubble` `cardPrice`, `VoiceFill` `pillText`).
- 28 icons of 10–18 px that sit beside such text → `colors.goldText` (chevrons after a call to action, pill icons, the sparkles beside «اسأل المستشار»).
- On a surface that is not the page:
  - `GoldenOpportunity.tsx` — the call and its chevron wear `onPhotoGold` while the photo and its scrim are showing, `goldText` on the golden fallback.
  - `wow.tsx` — the compact countdown's colons → `onPhotoGold` (they sit on the event card's dark plate).
  - `checkout/[id].tsx` — the lock beside «دفع آمن» → `paperGold`: the payment sheet is white in both themes, so theme gold was 2.2:1 there in the DARK theme.
- Dark theme: unchanged by construction (`goldText` equals `gold` in the dark palette).

**3. The compact countdown fits its card** (`components/wow.tsx`): its digits and colons are a fixed-size dial (`allowFontScaling={false}`), its three labels and «تبدأ خلال» grow by 15% at most (`maxFontSizeMultiplier`) on one line. The three cells are 34 pt wide by their style, so the row is about 126 pt on every phone, inside the 164 pt left by a 200 pt home card and the plate's padding. The full-size countdown on a page still scales like any text (up to the app-wide 1.3).

## Left as it is, for the coordinator

- **Files I was told not to touch**, same small-gold change still open: `contact.tsx` `bubbleBy` (13 px); `advisor/AdvisorChat.tsx` `creditText` and `openingTitle` (13 px) and two icons (`:360` 16 px, `:401` 14 px). In `Composer.tsx` only the mark was added; the 18 px `document-text` icon beside the attachment name is still `colors.gold`. Each is one word: `colors.gold` → `colors.goldText`.
- **25 texts at 18 px keep `colors.gold`**: 23 `typography.subtitle` titles (section titles, sheet and popup titles, `SectionHeader`), the payout amount, and the colons of the full-size countdown. The instruction names 15 px and below and 20 px and above; 18 px is neither. They read 3.05–3.3:1 in the light theme — enough for a heading by the large-text rule only if it counts as large, which at 18 px semi-bold it just misses. Moving them to `goldText` is one word each; say the word and I do it.
- **Kept on purpose:** rating stars (a deep-brown star reads as an empty one), the two title icons in `security.tsx` / `security-2fa.tsx` (beside an 18 px title), the avatar initial in `PeopleBlock`, `ProjectUnlock` `figureValueHighlight` (22 px), the active tab ICON (25 px; its 11 px label moved).
- **Not `colors.gold` but the same problem:** `ServiceTile.tsx` `savings` is `colors.goldNeon` at 11 px — `#C9922E` in the light theme, about 2.7:1 on white. `goldNeon` is brighter than `goldText` in the dark theme, so swapping it would dim the dark tiles; it needs a decision (a `goldNeonText` alias, or accept the dimmer dark).
- **`lib/validation.ts:14` (not mine):** the `INVISIBLE` regex now holds raw invisible characters (U+200B, U+200F, U+202A, U+202E, U+2069…) instead of `\u` escapes. It works, but nobody can read or review it, and a formatter or a copy can drop them silently. Cause, seen in my own edit of `direction.ts`: the Edit tool decodes `\uXXXX` in the text it is given. Fix: build the class from code points (`String.fromCharCode`) or re-type it with a tool that keeps escapes.
- Nothing else from the list is left.

## What must be looked at on a phone (added to round 4's list)

Android:
1. Home, an event card with a countdown, system text at its largest: the three cells and «تبدأ خلال» are inside the card, nothing cut on either side. Same in English («days / hours / min»).
2. A management message with bullets and a «label: text» line, first line Latin: every block starts on the right. An event page and a service page drawn by the same component.
3. Home golden opportunity with its photo, then in airplane mode without it: the call to action is readable in both, light and dark.
4. Light theme, one pass over Home, Projects, Markets, Requests, Payments, Account: the small gold texts (links, prices, pills) are darker and readable; dark theme looks exactly as before.
5. The payment sheet in the dark theme: the small lock beside «دفع آمن» is visible.

iPhone:
1. The golden company cards and the home message cards: a Latin name or a text that opens with a Latin word sits on the right (before, iPhone put it on the left; Android never did).
2. The same countdown check with Larger Text on.
3. A management message as in Android item 2.

## Checks run (round 5)

- `npx tsc --noEmit` — exit 0 (twice: after my last edit, and again after two other sessions edited `Composer.tsx` and `MembershipGate.tsx`; my lines are still in both).
- `npx eslint src` (the whole app) — exit 0, no warnings.
- Unit check of `markParagraphs()` / `textDir()` (19 cases) — all pass.
- Scan for raw direction characters in `app/src`: none in any file I edited; one file of another session (`lib/validation.ts`, above).
- Recount script: `colors.gold` as text at 16 px or below — 3 left, all in the two files I may not touch; icons at 16 px or below — 5 left (a star, two title icons, two in `AdvisorChat.tsx`).
- Not run: no device, emulator, Metro, OTA or build. The countdown's 126 pt is computed from its styles, not measured on a screen.
