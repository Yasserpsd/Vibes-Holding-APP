# rev-home — home tab, tab bar, account tab, popups, banners, small static screens

Review date: 2026-11-15. All 22 files of the area were read once. Nothing was run on a device or emulator (rules); every behaviour below is from reading the code. Paths are under `app/src/`.

Round 2 (coordinator decisions, same day): items 1–9 are applied and listed under `Fixed` with «decision N». Not applied by decision: taller chips (P3), the intro film from the server, the 4-tab layout. `app/contact.tsx` belongs to the coordinator; my two earlier edits there are listed, nothing was touched after the freeze.

## Fixed

Tab bar
- `app/(tabs)/_layout.tsx:90` — **decision 1.** Android: the bar rode above the keyboard (the window resizes) and ate the room of the advisor composer and the searches. `tabBarHideOnKeyboard` on Android only; iOS unchanged.
- `components/GlobalTabBar.tsx:51,81,86` — **decision 1.** The twin bar (every non-tab screen) leaves while the keyboard is open, Android only (`keyboardDidShow` / `keyboardDidHide`, removed on unmount).
- `components/GlobalTabBar.tsx:24` — **decision 8.** The twin bar's inbox button went to `/news`, a URL that two screens own (the inbox tab and the news list); it now names the tab itself, `/(tabs)/news` (a route the typed-routes file lists).
- `components/GlobalTabBar.tsx:36` — **decision 8.** News pages no longer light the inbox tab; only `/posts` does. News pages fall back to the home section.
- `components/GlobalTabBar.tsx:85-86` — found while doing decision 8: the twin bar hid itself on the path `/news`, so the NEWS LIST (a stack screen with that same path) had no bottom bar at all — against «الشريط ثابت في كل الصفحات». The list is recognised by its first route segment (`news`, checked in expo-router's `getRouteInfoFromState`: `news/index` → `['news']`, the tab → `['(tabs)', 'news']`) and the bar shows there.
- `app/(tabs)/_layout.tsx:104` — the advisor dock has no visible label, so the screen reader announced nothing; `tabBarAccessibilityLabel` added.
- `lib/personaTabs.ts:12-16` — **decision 4.** `home` and `index` hide the same tab in both bars.

Home
- `app/(tabs)/index.tsx:76-80,92-111` — pull-to-refresh refreshed 5 of the home's requests; people, agenda, meetups, the Projects Bank strip and the HQ photos kept their old data. All ten refresh now, with `allSettled` + `finally` so one failure never leaves the spinner stuck.
- `app/(tabs)/index.tsx:145` — an account with an empty name got a greeting with a blank name; no greeting in that case.
- `app/(tabs)/index.tsx:478` — advisor suggestion chips are 32 pt tall; `hitSlop={6}` gives a 44 pt target (look unchanged).
- `app/(tabs)/index.tsx:590` — **decision 9.** Partner logos go through `sized()`.

Account
- `app/(tabs)/account.tsx:96,189` — **decision 2.** «تسجيل الخروج» asks first (system alert, existing keys `account.menu.signOut` + `common.cancel`; no new strings).
- `app/(tabs)/account.tsx:226` — **decision 9.** The avatar goes through `sized()`.
- `app/(tabs)/account.tsx:86-93` — the refresh spinner could stay forever if `refresh()` threw; `try/finally`.
- `app/(tabs)/account.tsx:129,328` — hard-coded `#25D366` replaced by the `colors.whatsapp` token (same value).
- `components/PlaceholderScreen.tsx:23,60` — the guest's account (emblem + up to seven buttons) was a fixed, centred `View`: on a small phone or a large system font the top and bottom were clipped with no way to scroll. It scrolls now; nothing changes where it already fits (also used by the guest advisor tab).

Popups
- `components/GuestNudge.tsx:31-47` — **decision 3.** The guest nudge opened at 90 s on top of whatever was up. It now waits for a free screen, takes the launch slot (`claimAutoPopup()`, M128) and holds the screen while open. Effect: a guest who already got an automatic popup in this launch (an admin popup) sees no nudge until the next launch; the workshop ad does not take the slot, so it does not block the nudge.
- `components/GentlePopups.tsx:73-79,91-93` — **decision 6.** The details card: the words scroll inside a card capped at 86 % of the window, the two buttons always stay on screen.
- `components/RateUsPrompt.tsx:91` — the rate sheet did not hold the screen, so a sequenced popup (WhatsApp confirmation) could open beside it. `usePopupHold` added.
- `components/RateUsPrompt.tsx:95` — it opened from the saved account before the session was confirmed (the «addViewAt» Android crash class documented in `GentlePopups`); now requires `confirmed`.
- `components/AdminPopup.tsx:20,31` — `/welcome` added to the quiet routes: a guest's admin popup could open over the sign-up gate. The same list keeps it off `/checkout`, `/payment`, `/form`, `/watch`, `/profile-edit`. `components/GentlePopups.tsx:23,40` — same list.
- `components/AdminPopup.tsx:109` — a long body pushed «إغلاق» off the screen (the card never shrank, so the inner ScrollView never scrolled; on iPhone there was no way out). `flexShrink: 1`.
- `GentlePopups.tsx:68`, `AdminPopup.tsx:78`, `GuestNudge.tsx:58`, `IntroVideo.tsx:107`, `RateUsPrompt.tsx:137` — Android: the dim backdrop stopped under the status bar; `statusBarTranslucent`, as the app's other modals already do.

Banners
- `components/SlotBanner.tsx` — **decision 5.** The box follows the picture's own shape (measured on the sized variant), between 100 and 320 pt; 150 pt until measured. A wide banner with text shows whole; a very tall photo is capped and keeps the cover crop. Used by the home (when the HQ gallery is empty) and «عنّا».
- `components/RotatingBanner.tsx:50,62` — the prefetch and the size probe used the ORIGINAL picture while the slide draws the sized variant: every photo was downloaded twice and the swap still hitched. Both use `sized(…, 360)` now.
- `components/IntroVideo.tsx:39` — **decision 9.** The poster (lines 51 and 113 read it from `useIntroFilm`) goes through `sized()` when it is the HQ photo; the YouTube thumbnail is left as is.

Small screens
- `app/webpage.tsx:28-39,53-56` — **decision 7.** Android hardware back goes one step back inside the page while the WebView has history, and leaves the screen otherwise (listener only while the screen is focused).
- `app/webpage.tsx:14,41` — only `http(s)` addresses load: the route takes its URL from a param, so a link from outside the app could put a `javascript:` / `file:` address under our header.
- `app/webpage.tsx:26,65-75` — a failed load showed a blank page or a raw system error; now the app's own error state with «إعادة المحاولة».
- `app/about.tsx:45,109` — **decision 9.** The club logo and the section logos go through `sized()`.
- `app/about.tsx:87` — `mailto:` with no mail app rejected unhandled; caught.
- `app/contact.tsx` (before the freeze) — the message box used `textStart`; a TextInput reads it as the physical left, so Arabic was typed from the left: `inputStart()` + writing direction. And when the thread failed to load the screen showed the «no messages yet» empty state; now the error state with retry.
- `app/markets.tsx:45` — «اسأل المستشار» pill is 36 pt; `hitSlop={6}` (look unchanged).
- `components/SupportLink.tsx:23,32` — the WhatsApp support line is a 28 pt row; `hitSlop={10}` (look unchanged).

Note on decision 9: `sized()` only rewrites our own uploads (`/media/posts/…`); any other link (an external logo, a YouTube thumbnail) passes through untouched, and the server answers the original when it cannot resize (checked in `server/src/media/images.ts`), so none of these calls can lose a picture.

## Problems not fixed

Not applied by the coordinator's decision
- **P3 · Low — two controls are visibly small**: advisor chips 32 pt (`app/(tabs)/index.tsx:700`, `paddingVertical: 6` → 9) and the markets pill 36 pt (`app/markets.tsx:93`, `paddingVertical: spacing.xs` → `spacing.sm`). The tap target is already 44 pt through `hitSlop`.
- **Medium — the intro film addresses are hard-coded** (`components/IntroVideo.tsx:29-32`, two YouTube URLs); the owner cannot change the film from the dashboard. Needs a server field (e.g. `introFilm: { ar, en }` in `/api/home`).
- **Low — a persona that hides Projects gets 4 tabs**, so the golden advisor circle is no longer in the middle (2nd of 4).
- **Info — `WorkshopAd` does not take the launch slot** (the owner's daily ad, kept as it is): one launch can show the ad and then one more automatic popup after it closes — never two at once.

Still open
- **Medium — `/news` is still owned by two screens** (`app/(tabs)/news.tsx` and `app/news/index.tsx`). The twin bar no longer depends on it, but every other `'/news'` link keeps whatever the router picks: the home's «كل الأخبار» (`components/NewsCarousel.tsx:134`, untouched — it opens the news list exactly as before this round), `app/news/interests.tsx:80` and the advisor's `SCREEN_ROUTES.news` (`components/advisor/screens.ts:13`). Which screen wins was read from the router's code by rev-news-videos, not seen on a device. The clean end state is to give the news list its own path; that is a route-name change (not mine to make).
- **Medium — iPhone keyboard on «راسل الإدارة»** (`app/contact.tsx`, the `KeyboardAvoidingView`): no `keyboardVerticalOffset` although the screen has a native header (`AdvisorChat` passes one). If the composer sits partly behind the keyboard on iPhone, pass the header height (`useHeaderHeight()`). Needs a device; live since M36 without a complaint.
- **Low — the send icon is mirrored in English too** (`app/contact.tsx`, style `sendIcon: { transform: [{ scaleX: -1 }] }`): right for Arabic, but in English mode the paper plane points backwards. One right answer: `sendIcon: { transform: isRTL() ? [{ scaleX: -1 }] : [] }` (`isRTL` is already imported there). Coordinator's file.
- **Low — the Projects tab can flash for the entrepreneur** on a first launch with no cache (`useHiddenTabs` is empty until `/api/home` answers, then the tab leaves). With the persisted cache it is instant.
- **Low — the two bars are built separately** (`(tabs)/_layout.tsx` uses the navigator's bar, `GlobalTabBar.tsx` draws its own): heights and label baselines cannot be compared without a device; worth one look when moving between a tab and a detail screen on iPhone and Android.
- **Info — checked and clean**: no call to pay for membership outside the app in any of the 22 files (hard rule 3); every account row and home shortcut points to an existing route; all marketing text on the home comes from the server; no `zIndex` anywhere in the area; no module-scope token reads; timers and listeners are all cleared on unmount; a failing section request never blanks the home (only `/api/home` with no cached copy shows the error state, with retry).

## Shared-file changes needed

- `app/src/lib/personaTabs.ts` — done by me (decision 4).
- `app/src/app/contact.tsx` (coordinator) — the `sendIcon` line above; and keep my two earlier edits when merging (the `inputStart()` alignment of the composer and the thread's error state).
- No i18n, theme, api or shared-component edits are needed (only existing keys and tokens are used).

## Checks run

- `npx tsc --noEmit` (inside `app/`) → exit 0, no output, after the last edit of round 2.
- `npx eslint` on the 17 changed files → exit 0, no warnings, after the last edit: `(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/account.tsx`, `about.tsx`, `markets.tsx`, `webpage.tsx`, `GlobalTabBar.tsx`, `GentlePopups.tsx`, `AdminPopup.tsx`, `RotatingBanner.tsx`, `SlotBanner.tsx`, `GuestNudge.tsx`, `IntroVideo.tsx`, `RateUsPrompt.tsx`, `PlaceholderScreen.tsx`, `SupportLink.tsx`, `lib/personaTabs.ts`. `contact.tsx` was linted clean with my two edits before the freeze; not re-run after the coordinator's edits.
- Decision 8: `/(tabs)/news` is in the generated typed routes (`.expo/types/router.d.ts`); the segment rule was read in `node_modules/expo-router/build/global-state/getRouteInfoFromState.js` (route names split on `/`, a trailing `index` dropped).
- Script over the 22 files (round 1): every static `t('…')` key exists in both `ar.json` and `en.json`; the five `markets.group.*` keys exist in both. Round 2 added no keys.
- `grep` over `ar.json` for «مجان», «كريديت», «صفقة/صفقات», «فايبز القابضة», «فيبس فينشرز» → no hits.
- `grep` for hex / rgba literals in the 22 files → one left on purpose (`RotatingBanner` dots, white over a photo). `grep zIndex` in the 22 files → no hits.
- Not run: Metro, emulator, device, `eas`. Before the 1.3.4 build, worth one look on a phone: (1) Android — both bars leave and return with the keyboard (advisor tab, a form); (2) the twin bar's «بريد وارد» opens the inbox, and the news list now shows the bottom bar; (3) Android back inside a legal page; (4) the dimmed status bar behind the five popups; (5) the sign-out alert on both platforms; (6) a banner in the «عنّا» slot at its own shape.
- Files read and left unchanged: `+not-found.tsx`, `guide.tsx`, `ClubTourStrip.tsx`, `MarketsStrip.tsx`, `AffiliateHomeCard.tsx`.
