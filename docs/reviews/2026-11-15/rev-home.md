# rev-home — home tab, tab bar, account tab, popups, banners, small static screens

Review date: 2026-11-15. All 22 files of the area were read once. Nothing was run on a device or emulator (rules); every behaviour below is from reading the code. Paths are under `app/src/`.

Round 2 (coordinator decisions, same day): items 1–9 are applied and listed under `Fixed` with «decision N». Not applied by decision: taller chips (P3), the intro film from the server, the 4-tab layout. `app/contact.tsx` belongs to the coordinator; my two earlier edits there are listed, nothing was touched after the freeze.

Round 3 (2026-11-16, owner request «لما يوصل رسالة من الإدارة ينور تحت هنا»): built, see the next section. JavaScript only, no new package.

## Round 5 — three points of the final emulator pass (2026-11-16)

- **1 · the gold strip no longer cuts in English** — `app/(tabs)/index.tsx`, `UnreadMessagesStrip`: the label has the first line to itself and shrinks (to 75 %) before it is ever cut; the second line carries the title (one line, its own direction, starting where the label starts) and «اقرأ الرسالة» at the end. The action grows at most 10 % with the system font, so the title keeps the room. Several unread messages: the count line and the chevron only, as before.
- **2 · the message preview starts at the message's own words** — `components/PostsBlock.tsx`: new `postPreview(body)` drops the server's greeting line («الأستاذ/ …،», «Dear …,» and the blank line after it — the exact shapes of `greeting` in `server/src/posts/routes.ts`) before the media lines are dropped; used by the card's two-line preview and by the inbox row (`app/(tabs)/news.tsx`, which had the same preview). The message screen is untouched and keeps the greeting. A body that is only the greeting still shows it. Checked with six sample bodies in Node (Arabic, English with a name, English «member», CRLF, greeting only, a message that opens with its own «Dear all, …» sentence — left alone).
- **3 · «راسل الإدارة» bottom area** — `app/contact.tsx`: the composer no longer pads the bottom inset (the bar under the screen already covers it when the keyboard is closed; with the keyboard open it was the blank strip), and while the keyboard is closed the hint line keeps `ADVISOR_DOCK_RISE + 2` pt of air under it, so the raised advisor button no longer crosses it. With the bar's geometry (54 pt circle rising 18 pt) the crown's top is 17 pt above the bar's edge and the hint's text now ends 24 pt above it. The advisor composer uses 12 pt because a wide field sits there; a centred line of text sits exactly above the crown, so it needs the full rise.

Needs a look on the emulator: the strip in English at the normal font and at the largest one (label whole, title whole or ended with «…» only when it is truly long); the home card of a signed-in member showing the message's first words in both languages; «راسل الإدارة» with the keyboard closed (hint clear of the button) and open (field flush above the keys, no blank strip), in Arabic and English.

Checks: `npx tsc --noEmit` → exit 0. `npx eslint` on `(tabs)/index.tsx`, `(tabs)/news.tsx`, `PostsBlock.tsx`, `contact.tsx` → exit 0. Not run: Metro, emulator, device.

## Round 4 — the affiliate complaint and the Android emulator findings (2026-11-16)

JavaScript only; my files plus the two call sites `i18n/chooseLanguage.ts` and `theme/theme.ts`. No string-table edit, no key missing.

One line per item
- **A · applied** — `app/(tabs)/index.tsx` and `app/(tabs)/account.tsx`: both pull-to-refresh handlers now `invalidateQueries({ queryKey: ['affiliate'] })` (invalidate, so a guest's disabled query sends nothing). The push line of the plan (`PushRegistrar.tsx`) was not in my list and is not done.
- **B1 (item 35) · applied** — `components/GlobalTabBar.tsx` now uses the navigator's own numbers (read in expo-router's bottom-tabs): bar 49 pt over the bottom inset, no side padding, item padding 5, icon 25 pt in a 31×28 box, active mark a 38 pt circle, badge at top −3 / end −3. Before it was 3 pt taller, its icons 3 pt inward (the «8 px»), its mark a pill. The advisor circle sits in the same icon box as in the tabs bar.
- **B2 (item 17) · applied** — a tab the persona hides keeps an empty slot in both bars (`tabBarButton: () => null` instead of `href: null` in `(tabs)/_layout.tsx`; an empty slot in `GlobalTabBar.tsx`), so the advisor circle stays in the middle: two slots on each side. The hidden screen stays reachable by its path, as before.
- **B3 (item 30) · applied** — `components/MarketsStrip.tsx`: the tile label is one line that shrinks to fit (down to 75 %). `app/(tabs)/account.tsx`: e-mail and phone are one line each, shrink to fit (down to 70 %), the e-mail with a middle ellipsis as the last resort. The tab labels were done in round 3.
- **B4 (item 26) · applied** — `app/(tabs)/index.tsx` quick actions: two lines, and a label slightly too long shrinks to fit (down to 80 %) instead of ending in «…». The two pills «Start your consult..» / «Request your me…» of the same finding are in `components/ServiceTile.tsx` (not my file).
- **B5 (item 28) · applied** — `app/(tabs)/index.tsx` gold door cards: the hint line is two lines, so «…Google Play و App Store» wraps between words.
- **B6 (item 25) · applied** — the same `spacing.sm` under a section's description everywhere on the home: the partners and videos strips (`index.tsx`), «جولة في النادي» (`ClubTourStrip.tsx`) and the markets tiles under «الأخبار» (`MarketsStrip.tsx`). The agenda, people and meetups strips and the «قدّم من هنا» button already carry it in their own files (`AgendaBlock`, `PeopleBlock`, `MeetupsBlock`).
- **B7 (item 41) · applied** — `components/MarketsStrip.tsx` `ChangeText`: a zero change has no arrow and the muted colour (also on the markets screen, which shares it).
- **B8 (item 18) · applied** — new `components/AppDialog.tsx`: `showAppDialog({ title, message?, actions })` + `AppDialogHost`. The golden card and fade/pop of the other popups, token colours, centred text and full-width answers (nothing to mirror between the two languages), closed by the Android back key and a tap outside (both take the `cancel` answer), no `zIndex`; it holds the screen so no automatic popup opens over it; with no host on screen it falls back to the system dialog. Used by sign-out (`account.tsx`), language (`i18n/chooseLanguage.ts`) and theme (`theme/theme.ts`). The host is mounted inside `AdminPopup` (already in the root layout for the whole launch) — **no line to add in `_layout.tsx`**.

Things to know
- `account.menu.hq` in English («Club headquarters and my visits») is long for a quarter-width tile; it now shrinks to stay on two lines — to roughly 8–8.5 pt by my estimate from the tile width, not measured on a phone (the floor is 80 % of the 10 pt label). A shorter English value (for example «Club HQ & visits») would keep the full size — the key exists, only its English text would change.
- The dialog answers are stacked and full-width (sign-out: «تسجيل الخروج» in the danger colour, then «إلغاء»).
- While this round ran, `npx tsc` showed five errors in `components/MembershipGate.tsx` (another session's edit in progress); they were gone on the next run.

Needs a look on a phone (Android emulator first)
1. Open a page from a tab and go back: the bar must not move by a pixel — icons, labels, the active circle and the advisor circle (items 35).
2. An entrepreneur account (Projects hidden): the advisor circle in the middle in both bars, with an empty slot where Projects was.
3. System font at 1.3: «السوق السعودي» whole, the account e-mail on one line.
4. English home: «Club headquarters…» tile on two lines without «…»; Arabic home as an entrepreneur: the «انشر تطبيقك» hint on two lines.
5. The gaps under «الأخبار», «شركاؤنا», the videos strip and «جولة في النادي».
6. Gold at 0 %: grey, no arrow.
7. The three questions (language, theme, sign-out) in Arabic and English, dark and light: the app's card, back key closes, a tap outside closes; choosing a language or theme still restarts the app; the language question on the welcome screen too.
8. Pull-to-refresh on the home and on حسابي as an approved affiliate: one `GET /api/affiliate` each; as a guest, none.

Checks: `npx tsc --noEmit` → exit 0 (second run; see above). `npx eslint` on `(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/account.tsx`, `GlobalTabBar.tsx`, `AppDialog.tsx`, `AdminPopup.tsx`, `MarketsStrip.tsx`, `ClubTourStrip.tsx`, `i18n/chooseLanguage.ts`, `theme/theme.ts` → exit 0. Not run: Metro, emulator, device.

## Round 3 — unread management messages (2026-11-16)

Code comments carry the tag `M242`; if the brief gives this work another number it is one find-and-replace.

What was built, file by file
- `lib/readPosts.ts` (new) — the device-local read state: the ids this device opened (newest 300, stored in parts because ids are 36 characters) and a baseline time saved at the first launch of the feature. Unread = published after the baseline and not in the set; nothing is unread until the stored state has loaded. Exports `useUnreadPosts()` (from `useLatestPosts(10)`, newest first), `markPostRead`, `markAllPostsRead`, plus `useReadPosts` / `isPostUnread` for a row that draws its own dot. Writes are queued one at a time; a mark made before the stored list is in waits for it (a message opened straight from a push).
- `lib/badges.ts` — `inbox` is now `useUnreadPosts().length` (the other three counts unchanged). New `useAppIconBadge()`: writes the icon number when the count changes and when the app returns to the foreground; signed out = 0; writes nothing while the account, the read state or the feed is still loading.
- `lib/notifications.ts` — new `setAppBadge(count)`: optional-module check for the badge module, `setBadgeCountAsync` only when the function exists and only when the number differs from the icon's current one, every failure swallowed.
- `app/posts/[id].tsx` — `markPostRead(id)` once the post has loaded.
- `app/(tabs)/_layout.tsx` and `components/GlobalTabBar.tsx` — while a message is unread the inbox tab shows the gold «unread» envelope (`mail-unread`), a soft gold glow breathing behind it (`NeonPulse`, still under «reduce motion»; drawn before the icon, the count after it, no `zIndex`), the count badge, and the accessibility label `inbox.tabUnread`. Same 40×30 glow in both bars. `GlobalTabBar` also mounts `useAppIconBadge()` (it lives for the whole launch).
- Both bars, item 8 — the labels no longer follow the system font size (`tabBarAllowFontScaling: false`, `allowFontScaling={false}`) and shrink to fit (`adjustsFontSizeToFit`, down to 75 %) before they are ever cut. In the (tabs) bar the label is drawn by a small `TabLabel` with the navigator's own label style, so a phone where the words fit looks the same.
- `app/(tabs)/index.tsx` — `UnreadMessagesStrip`, the first thing on the page: one unread → `inbox.newFromManagement` + the title (one line, `textDir`) + `inbox.openMessage`, a tap opens the message; several → `inbox.newFromManagementCount`, a tap opens the inbox tab. Gold, ink on gold, 48 pt minimum; gone when nothing is unread.
- `app/(tabs)/news.tsx` — a message row is lit (gold dot, gold icon box, heavier title) while unread instead of «newer than the last visit»; the header count is the unread count; `inbox.markAllRead` under the header only while something is unread. Entering the tab still resets the dots of events, projects and profiles, never the messages.
- `components/PostsBlock.tsx` — `PostCard` shows a gold dot and a semi-bold title while unread (ink-gold dot on the pinned paper sheet); new `MarkAllReadButton`.
- `app/posts/index.tsx` — opening the list no longer marks anything read (the old `markSeen('posts')` is gone); `MarkAllReadButton` on top while something is unread.
- `components/PushRegistrar.tsx` — checked, not changed: a push of type `post` already invalidates `['posts']` (`server/src/posts/routes.ts:152` sends that type).

Things to know
- The first launch with this bundle takes every existing message as read (the baseline), so nobody opens the app to a lit tab for old messages. The light starts with the next message.
- In the inbox tab every title was already semi-bold, so an unread message there is bold (one step heavier) — otherwise the two states would look the same. On the message cards (home block, messages list) unread is semi-bold over the regular title, as asked.
- The read state belongs to the device, not the account: two accounts on one phone share it.
- `inbox.unread` is used as the screen-reader prefix of an unread row.

Needs a look on a real phone
1. Send a management message: the tab lights in both bars (a tab screen and a detail screen), the gold strip tops the home, the dot shows in the inbox, the messages list and the home block; open the message → all of them go out.
2. Two unread messages: the strip shows the count and opens the inbox tab; «تعليم الكل كمقروء» clears everything.
3. The glow behind the envelope in light mode and in dark mode, and with «reduce motion» on (it must hold still).
4. App icon number — iPhone: it needs the notification permission, and going from N to 0 also empties the notification centre (iOS behaviour). Samsung: the launcher shows the number. Pixel-style launchers show no number at all (nothing to fix in JavaScript).
5. The Samsung phone with the larger system font: the five labels whole in both bars, «بنك المشاريع» not cut; and an iPhone at the default size looks as before.
6. An old binary (runtime 1.2.0): the app opens and the lights work; the icon number is simply absent if that binary has no badge module.

Checks: `npx tsc --noEmit` → exit 0. `npx eslint` on `(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/news.tsx`, `posts/[id].tsx`, `posts/index.tsx`, `GlobalTabBar.tsx`, `PostsBlock.tsx`, `PushRegistrar.tsx`, `lib/badges.ts`, `lib/readPosts.ts`, `lib/notifications.ts` → exit 0. `mail-unread` / `mail-unread-outline` are in the Ionicons type (tsc). Not run: Metro, emulator, device.

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
