# rev-projects — Projects Bank and partnerships (2026-11-15)

Scope: `(tabs)/projects.tsx`, `project/[id].tsx`, `deck.tsx`, `golden.tsx`, `golden/[code].tsx`, `partners.tsx`,
`portal/entrepreneurs.tsx`, and the components `ProjectCard`, `ProjectFiltersSheet`, `ProjectsBankCarousel`,
`GoldenCompanyCard`, `GoldenOpportunity`, `SectorStrip`, `MonthlyDeal`, `PortalCard`, `LockedNotice`,
`StructuredText`, `Highlight`, `Stars`, `components/project/*`. Every file was read once. 19 files changed.

Round 2: the coordinator's eight decisions are applied (marked «decision N» below). Two parts of decision 8 were
not applied, with the reason, under `Problems not fixed`.

Round 3 (2026-11-16): the app side of the complaint «بنك المشاريع ثابت طول الوقت» and the emulator findings in my
files (`rev-android-run.md` items 6, 12, 13, 14, 19, 20, 31, 38, 40) are applied — see «Round 3» at the end of
`Fixed`. Seven files changed in this round; JavaScript only (safe on runtimes 1.2.0 to 1.3.3).

Hard rule 4 — result: holds on the client. `PublicProject` has no contact fields; the contact data exists only in
the `project-access` query (`gcTime: 0`, keyed by account), which is NOT in the persisted cache (`KEEP_ROOTS` keeps
`projects`, not `project`, `project-access` or `deck`). Nothing in my files logs (`console.*`: none). The pitch deck
link reaches `deck.tsx` only from the unlocked contact card; a deep link cannot open a locked project's deck because
the link itself is never sent to a member who did not unlock (it would have to be known already).

## Fixed

Unlock flow (`components/project/ProjectUnlock.tsx`) — charging semantics untouched
- `:49`, `:84` — a second tap in the same frame could send two unlock requests (the `unlocking` state updates after the render); a ref now blocks it.
- `:106` — after ANY failed unlock (not only 402/403/409) the access state is read again (a GET, nothing is charged). A lost answer after the server already took the project used to leave «تواصل مع المؤسس» and the old balance on screen until the page was reopened.
- `:190` — an unlocked project whose answer carried no contact object showed the title «بيانات التواصل مع المؤسس» over nothing; it now shows the existing sentence `unlock.empty`.

Pitch deck (`app/deck.tsx`)
- `:38` — the founder's PDF is untrusted input: pdf.js 3.11.174 runs font code through `eval` by default (CVE-2024-4367). `isEvalSupported:false` closes it.
- `:84` — the `url` param is accepted only when it is an http(s) link (a deep link could pass `file://` or any scheme to the download and to `Linking.openURL`); anything else shows the existing «تعذّر عرض الملف» notice.
- `:60` — the download lands in `deck-….pdf.part` and is moved into place when complete; an interrupted download used to leave a half file that every later opening trusted (blank viewer forever).
- `:34`, `:175` — missing loading and error states. Android: after the download the screen stayed plain black while pdf.js loaded and drew, and stayed black for good if the CDN script did not load. Now a spinner until the first page is drawn, and the existing «تعذّر عرض الملف» + «افتح في المتصفح» view on failure. iOS: spinner until the WebView finishes, the same failure view on a WebView error.
- `:28`, `:112` — decision 3: a 45-second timer switches to the failed view when the first page never arrives.
- `:103–104` — decision 3: a non-PDF deck goes back when there is a screen behind it, otherwise `router.replace('/')` (it used to call `router.back()` into nothing and stay on a blank dark screen).

List (`app/(tabs)/projects.tsx`)
- `:102` — search box: a `TextInput` reads left/right physically; it now starts on the language's side like `FormField` (Arabic typed on the right on both platforms).
- `:50` — «حسب اهتماماتي» stayed on (hidden) after sign-out and kept filtering the guest's list.
- `:126` — «فلترة» button: tap target raised with `hitSlop` (was about 32 pt).
- `:209` — missing error state: a page that failed to load while scrolling left the list silently cut; a «إعادة المحاولة» footer (existing string `common.retry`) asks for it again, and `onEndReached` stops re-firing the failing request.
- `:231` — the separator was an inline component (every separator remounted on each keystroke of the search); no visible change.
- `:233` — decision 4: `keyboardDismissMode="on-drag"`.
- `:259` — decision 7: the bank's count pill uses `formatProjectCount()` (whole numbers, so the count-up never shows a wrong noun form).

Cards
- `components/ProjectCard.tsx:87–98` — title, company and excerpt follow their own letters (`textDir`, the M177 rule already used by the news cards): a title opening with a Latin brand or a number drew from the left on an Arabic screen.
- `components/ProjectCard.tsx:105` — sector pill: padding moved from the `Text` to a `View` (Android clips a padded Text), `maxWidth: 100%`.
- `components/ProjectCard.tsx:286`, `:305` — «تواصل مع المؤسس» and «اسأل المستشار» were 36 pt high; now 44 pt (tap-target rule).
- `components/ProjectCard.tsx:99` — excerpt ranges use the en dash (see Highlight).
- `components/ProjectsBankCarousel.tsx:86–97` — title follows its letters; sector/stage meta lines are one line each (a long pair wrapped and pushed the overlay up over the photo).
- `components/GoldenOpportunity.tsx:89` — title follows its letters. `:74` — decision 8: the photo goes through `sized()` (a Projects Bank photo passes through untouched by design).
- `components/SectorStrip.tsx:94` — decision 7: the banner count uses `formatProjectCount()`.

Filters sheet (`components/ProjectFiltersSheet.tsx`)
- `:39` — «عرض النتائج» sat on the iPhone home indicator / Android gesture bar (fixed 24 pt padding); the sheet now adds the bottom safe-area inset, like the unlock sheet.
- `:45` — «مسح الفلاتر» tap target raised.
- `:36` — decision 1: `statusBarTranslucent`. `:82` — decision 7: the button count uses `formatProjectCount()`.

Project page (`app/project/[id].tsx`)
- `:116`, `:126` — title and the English sub-title follow their own letters.
- `:133–135` — sector / stage / number pills: padding on a `View`, one line each (Android clipping; long English stage names such as «Founding and prototype · adviser's estimate»).
- `:79`, `:85` — gallery keys include the index (a photo repeated in the feed produced duplicate React keys and a wrong page dot).
- `:36–37`, `:192`, `:241` — decision 2: `project.disclaimer` shows under «عن المشروع» only when the advisor brief settled without data (the page reads the same cached brief query — no second request), so the disclaimer is never on the page twice and never flashes while the brief is still loading.

Ratings
- `components/project/RateProjectModal.tsx:74` — decision 1: `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`; `:70` `statusBarTranslucent`. `:79` — close button tap target raised (was 42 pt). Android back already closes the sheet (`onRequestClose`).
- `components/project/ProjectReviews.tsx:43–44` — «لا توجد تقييمات بعد — كن أول من يقيّم» showed while the reviews were still loading and after a failed load; now a spinner while loading and the sentence only for a real empty answer. `:61` — decision 8: the rater's photo goes through `sized()`.
- `components/Stars.tsx:28` — the average prints with one decimal at most (a raw 4.3333 could reach the member). Stars direction under RTL is correct (the row flips, first star on the right).

Text
- `components/Highlight.tsx:24` — new `rangeDashes()`: a hyphen between two numbers («5-10 مليون», «7%-8%») becomes an en dash, so the first value sits on the right in Arabic (CLAUDE.md copy rule). Dates and phone-like chains are left alone. Applied to every `Highlight` (advisor table, strengths, risks, «عن المشروع») and the card excerpt.
- `components/project/ProjectBrief.tsx:171`, `:216` — keys include the index (two identical strength/risk lines collided).
- `components/StructuredText.tsx:158–163` — a photo line measured the ORIGINAL upload with `Image.getSize` while drawing the `sized()` variant (two downloads, the heavy one first), and re-measured on every parent render; it now measures the sized file once per link.
- `components/StructuredText.tsx:222` — decision 8: the video tile's hard-coded `#0B0B0D` is gone; it keeps the themed `colors.surfaceElevated` it already inherits from `media` (a YouTube poster covers it anyway).

Golden and partners
- `app/golden/[code].tsx:162` — decision 1: `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`. One structural step was needed for it to work: the `KeyboardAvoidingView` only hugged the sheet, and «height» on such a wrapper pushes the sheet DOWN (the wrapper shrinks, the sheet overflows below it). It now fills the window with `justifyContent: 'flex-end'` (`sheetWrap`, `:222`) and the backdrop is an absolute layer — the same shape as the rating sheet and the app's other keyboard modals. The look is unchanged.
- `app/golden/[code].tsx:42–45` — decision 6: a 404 for the offer code shows `offer.notFound` with no retry button (the server answers 404 for an unknown code, `server/src/content/routes.ts:82`); other failures keep the error view with retry.
- `app/golden/[code].tsx:148` — decision 6: the interest note is cleared after a successful send.
- `app/golden/[code].tsx:65`, `:108`, `app/golden.tsx:64`, `components/GoldenCompanyCard.tsx:30`, `app/partners.tsx:115` — decision 8: logos and offer pictures go through `sized()`.
- `app/golden.tsx:90` — decision 6: `golden.empty` when the server returns no companies.
- `app/partners.tsx:135` — decision 5: «الشراء من الشريك» is hidden when the partner has neither WhatsApp nor a link.

Round 3 — the «static bank» complaint (A) and the emulator findings (B); line numbers are the current ones
- A1 — `app/(tabs)/projects.tsx:66` the tab opens on «اكتشف» (owner, 2026-11-16); `:38`, `:87` that chip leads the row whatever order the server sends; the built-in fallback list starts with it too.
- A2 — refetch on return when the data is older than five minutes, not on every focus: the tab (`projects.tsx:99`), the home carousel (`ProjectsBankCarousel.tsx:62`) and the golden opportunity card (`GoldenOpportunity.tsx:62`; it reads the same query and is the only one of the two on some homes). `cancelRefetch: false`, so two of them on one screen share one request.
- A3 — `projects.tsx:212` the freshness line «آخر تحديث للبنك {time}» beside the count pills, from `filters.updatedAt` through `formatRelativeTime` (plain quiet text with a clock icon, not a third pill; hidden when the server sends no date).
- A4 — `projects.tsx:43`, `:105` the pages are flattened with each project id once, so a turn of the rotation during scrolling never shows a project twice (and never two rows with one key).
- B5 (item 6) — `projects.tsx:94`, `:176` the «كل القطاعات» tile shows the bank's own total (`useProjectsCount`, the lightest request; until it answers, the list's total when no filter is on) instead of the sum of the sector counts.
- B6 (item 31) — `projects.tsx:152` «فلترة» is pinned at the end of the sorts row, outside the scrolling part.
- B7 (item 38) — `components/ProjectCard.tsx:28`, `:51` the company line is dropped when it is the project's own name (spacing and letter case set aside); `:101` the stars show only when the project has a rating.
- B8 (item 14) — `components/ProjectCard.tsx:73`, `:186` the photo's scrim is the bottom-up `gradients.scrim` (the same in both themes) and fades in with the photo; `:218`, `:238` the stage chip and the views count carry a dark backing with `onPhotoGold` text in both themes (the light theme's navy overlay with dark-gold text was the unreadable pair).
- B8 (item 12) — `components/GoldenOpportunity.tsx:57`, `:67`, `:101` the scrim and the on-photo white come only once the photo has actually loaded; without a photo (missing, failed, still loading) the title and the chips wear the theme's colours (`:172–176`).
- B8 (item 13) — `components/GoldenOpportunity.tsx:161` the sector and stage chips ride the card's top edge instead of floating across the photo's subject.
- B9 (item 19) — `app/project/[id].tsx:131` the Latin company line starts at the start edge and still reads left to right (`ownDirection()`, new in `components/Highlight.tsx:25`: `textAlign: textStart` + the writing direction of the text's own letters). The same helper now aligns the project title on the page (`:120`), the card's title, company and excerpt (`ProjectCard.tsx:97–108`), the carousel title and the opportunity title, so a Latin-only name no longer jumps to the far edge on any of them.
- B10 (item 20) — `components/Highlight.tsx:18` a written date («1 نوفمبر 2026», "1 November 2026", "November 1, 2026") lights up as ONE span, so the whole value has one weight.
- B11 (item 40) — `components/ProjectFiltersSheet.tsx:111–112` the chip list runs to the sheet's edges and pads its content, so the selected chip's glow has 16 pt of room instead of being cut at the list's bounds.

## Problems not fixed

Round 3 — for the coordinator
- **The golden opportunity card on the home still shows five empty stars on an unrated project** (`GoldenOpportunity.tsx:113`); item 38 named the project card only, so I left it. Same one-line condition if wanted: `project.rating && project.rating.stars !== null`. The project page keeps its stars on purpose (they are the button that opens the rating sheet).
- **The glow of a selected SORT chip is still cut at the ends of the scrolling sorts row** (`projects.tsx:153`, a ScrollView clips at its bounds). Not in the list of items; the fix is the same padding trick as the filters sheet.
- **A date written with Arabic-Indic digits lights up whole too; a date without a year («1 نوفمبر») does not** — the day alone would still be bold. The server's own format always has the year.

Decision 8, the two parts not applied
- **`components/SectorStrip.tsx:158` — `rgba(20,16,5,0.14)` left as is.** It is the tint of the icon circle on the SELECTED tile, whose surface is the gold gradient — the same in both themes — so nothing here follows the theme; the value is `goldInk` at 14 %. No token holds it and `tokens.ts` is not mine. If a token is wanted: add `goldInkFaint: 'rgba(20, 16, 5, 0.14)'` to both palettes in `theme/tokens.ts`, then `iconCircleSelected: { backgroundColor: colors.goldInkFaint }`.
- **`components/ProjectsBankCarousel.tsx:126`, `:139` left as is.** Both sit over the photo (the caption scrim and the inactive page dots), which the decision excludes; the photo is dark in both themes.

Decided «not now» by the coordinator (kept here so they are not lost)
- **medium — large decks on Android.** The whole PDF is read as base64 and pushed through the WebView bridge (`app/deck.tsx:133`); a 25 MB+ deck is slow and can exhaust memory (the member then gets «افتح في المتصفح», never a crash loop). Fix with the next item.
- **medium — pdf.js comes from cdnjs at view time**, pinned to 3.11.174 (`app/deck.tsx:25`). The deck does not open on Android without access to that CDN, and the version is the last v3 (the CVE is mitigated in this pass, not removed). Proposed: ship pdf.js ≥ 4.2.67 as an app asset and let it read the cached file by URL.
- **low — the project card is one big button containing two buttons** (`components/ProjectCard.tsx:45`). VoiceOver on iOS reads the card as a single element, so «تواصل مع المؤسس» / «اسأل المستشار» are not reachable separately. Proposed: card body pressable with `accessibilityLabel={project.title}`, the actions as siblings outside it.
- **low — Projects Bank photos are not resized.** `sized()` passes them through by design (`lib/imageUrl.ts:16`), so covers and galleries download the originals. Needs a server-side variant route for PB images.
- **low — no pull-to-refresh on the project page and `/golden`.**
- **low — deck files stay in the OS cache after sign-out** (`deck-<hash>.pdf`) — being done by rev-auth in `AuthProvider`.

Still to be seen on a device (nothing here could be run)
- **medium — the keyboard in the rating sheet and the «سجّل اهتمامك» sheet on Android.** The pattern is the app's proven one, and the interest sheet was reshaped to match it, but neither sheet has been opened on a phone since. Check on the emulator: focus the comment / phone field — the send button must stay above the keyboard, the sheet must come back down when the keyboard closes, and a tap on the dim area must still close the sheet.
- **low — the deck viewer states** (spinner, 45 s timer, failed view) and **the search box direction** are verified by reading the code only.
- **Round 3, to look at on a phone (Arabic and English, dark and light):**
  - Projects tab, fresh open: «اكتشف» is the first chip and the selected one; «فلترة» is visible without dragging the row, at the row's end, and the sorts still scroll beside it.
  - The tile «كل القطاعات» and the pill show the same number; the line «آخر تحديث للبنك …» sits beside the pills and wraps cleanly on a narrow screen.
  - Scroll the list to its end: the number of cards equals the pill, no duplicate-key warning in the log.
  - Leave the tab for more than five minutes and come back: one refetch (the pull spinner shows briefly), none when coming back sooner.
  - Light theme: the stage chip and the views count on the cards read clearly; a card without a photo keeps readable chips on the placeholder.
  - Home, light theme, offline or slow network: the golden opportunity title is dark on the placeholder and turns white with the scrim when the photo arrives; the chips are on the card's top edge.
  - Project page: «Fionta Seven» starts on the right in Arabic, on the left in English; «آخر تحديث» shows one weight.
  - Filters sheet: the glow of «كل القطاعات» / «كل المراحل» is no longer cut square; the chips keep their old alignment with the section titles.

Reported as asked, not changed
- **Unlock semantics.** The confirm sheet and the local cache both assume one project costs exactly 1 («بعد الفتح» = left − 1, `used + 1`, `ProjectUnlock.tsx:95`, `:268`); the server is idempotent (`already` takes nothing, `server/src/projectsBank/access.ts:66`), so a retry after a lost answer never charges twice. «رصيد» wording is correct everywhere; the `exhausted` state shows the balance and points to the club's management (no payment link — rule 3 intact).

Checked and fine
- The stage label never shows «اخري» (the server places it on the five steps; an estimated one carries the note under the stepper). No promised-returns wording in the strings of this area. English mode uses the server's English fields (`x-app-lang`, `localizeProject`) and the persisted cache is dropped on a language switch. No `zIndex`, no module-scope colours, no «مجاني / كريديت / الصفقات». The filters sheet applies at once, clears both filters, shows live counts; empty result, pull-to-refresh and paging (20 per page) work as written.

## Shared-file changes needed

- `app/src/i18n/strings/en.json`, key `golden.vibesPage`: old `Vibes Ventures's offer page` → new `Vibes Ventures' offer page`.
- `app/src/i18n/strings/ar.json` + `en.json`, key `projects.count`: no longer read by my files after decision 7 (`formatProjectCount` replaced all three uses); remove it if nothing else reads it.
- `app/src/i18n/strings/ar.json`, key `nav.partners`: the Arabic value is the English «Members Exclusive» — for the coordinator to confirm it is intended.
- `app/src/theme/tokens.ts` (optional, see decision 8 above): `goldInkFaint` for `SectorStrip.tsx:158`.

## Checks run

- `npx tsc --noEmit` (inside `app/`) — exit 0; last run after the final edit of round 2.
- `npx eslint` on the 19 changed files — exit 0, no warnings; last run after the final edit of round 2.
- `rangeDashes()` run in Node on sample lines: «5-10 مليون» → «5–10», «7%-8%» → «7%–8%», «1,000-2,500» → «1,000–2,500», «٥-١٠» → «٥–١٠»; unchanged: «2026-11-15», «+966-55-1234567», «B2B-2», «بدون أرقام - هنا».
- The keys `project.disclaimer`, `golden.empty`, `offer.notFound` exist in both tables, and `formatProjectCount` exists in `lib/format.ts` (read before use).
- Round 3 (2026-11-16): `npx tsc --noEmit` exit 0 and `npx eslint` exit 0 on the seven files changed (`(tabs)/projects.tsx`, `project/[id].tsx`, `ProjectCard.tsx`, `ProjectFiltersSheet.tsx`, `ProjectsBankCarousel.tsx`, `GoldenOpportunity.tsx`, `Highlight.tsx`), run after the last edit. The date pattern was run in Node on the server's two formats (`ar-SA-u-ca-gregory-nu-latn` → «1 نوفمبر 2026», `en-GB` → "1 November 2026") plus "November 1, 2026" and an Arabic-Indic date: each comes out as one span; lines without a date split exactly as before.
- Not run: nothing on a device or emulator (only the Android-run session may).
- No errors seen in files outside my area at the time of the last run.
