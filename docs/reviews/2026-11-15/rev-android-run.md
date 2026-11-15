# rev-android-run — Android emulator visual pass (2026-11-15)

Session `rev-android-run`. The app was run from the shared working tree on the Android emulator while the other
eleven sessions were editing `app/src`. Nothing in `app/src`, `server/src` or the configs was edited by this session.
Screenshots: `docs/reviews/2026-11-15/android-shots/` (60 files, `<screen>-<ar|en>-<dark|light>.png`).

## Setup

| Item | Value |
| --- | --- |
| Device | AVD `Medium_Phone_API_36.1` (Android 16, API 36, 1080x2400, 420 dpi, gesture navigation, device language English) |
| Binary | local debug APK, `gradlew assembleDebug -PreactNativeArchitectures=x86_64` from the existing `app/android` (no prebuild), built 13:29–13:32, id `com.vcmem.investorsclub.preview` 1.3.3. The old release-style preview APK on the emulator was uninstalled first (no storage for both). |
| Metro | `expo start --port 8081`. First run hung (12 min, no bundle, `/status` silent) and was killed, as the memory note predicts; the restart bundled in 6 s. |
| API | local server on `127.0.0.1:3009`, never TEST or production: mock hub (seeded demo club), mock Paymob, memory store, real read-only feeds (Projects Bank feed = 259 projects, public news sources), no AI key. Runner kept outside the repo. It answers accounts as ordinary members (the plain mock makes everyone an admin, and admins skip the member gates). |
| Accounts | two test members registered by script with real-looking names: one active member (investor), one not yet a member (entrepreneur). Credentials stay in the scratchpad. Two agenda events were seeded through the local admin API (one without fees, one paid workshop: 950 / members 450 / list 1,500). |
| Fast Refresh | switched OFF in the debug app after it corrupted the first screens (see «Development artifacts»), so each bundle below is a clean cold start of the tree as it was at that minute. |

Bundle times (each one is the working tree at that moment):

| Time | Event |
| --- | --- |
| 13:44:05 | first bundle after the Metro restart (1903 modules) — English, dark |
| 13:46:55, 13:50:59, 13:55:20 | cold starts (English dark pass: sign-in, home, projects, project, inbox, advisor, account, membership) |
| 14:03:50 | restart by the language switch → Arabic dark pass |
| 14:13–14:19 | emulator froze (see «Crashes and errors»), restarted |
| 14:19:43 | cold start (Arabic dark: card, about, contact, theme dialog, welcome, sign-up, sign-in) |
| 14:25:17 | restart by the theme switch → Arabic light pass, large font, three-button navigation |
| 14:32:12 | cold start in airplane mode (offline test), then back online: player, non-member account |

## Crashes and errors

- **No app crash, no red screen, no JavaScript error** in the whole pass. `adb logcat -s AndroidRuntime:E ReactNativeJS:E` stayed empty; the only JS warning is the dev-only «push token (dev only)» line.
- **Emulator freeze, 14:13** (not proven to be the app): right after a featured video started playing inline on the videos list, Android's `system_server` stopped answering. Head of what the device printed:
  `*** SERVICE 'activity' DUMP TIMEOUT (10000ms) EXPIRED ***` and
  `E SensorsMultiHal: Dropping 1 events after blockingWrite failed (is system_server running?)`.
  A `uiautomator dump` was running against the playing video at that moment, which is a known way to hang this image. After the restart the full player (`/watch`) played and closed normally. Worth one retry on a real Android phone, nothing more.
- Debug-only: in airplane mode the debug build showed «Unable to load script» until Metro was pointed at `localhost:8081`. A store build carries its own bundle, so this is not an app defect.

## Visual defects

### A. Serious — the keyboard hides what the member is typing (every Android text field)

The binary runs edge-to-edge (`edgeToEdgeEnabled=true`), and React Native does not resize or pad the window for the keyboard in that mode (`ReactRootView` only emits keyboard events). The screens rely on `adjustResize`, so nothing moves.

1. Advisor tab, ar + en, dark: with the keyboard open the whole composer (field, attach, microphone, send) is behind the keyboard; typed text cannot be seen — `advisor-keyboard-ar-dark.png`, `advisor-keyboard-en-dark.png` — `app/src/components/advisor/AdvisorChat.tsx:251` (`KeyboardAvoidingView behavior` is `undefined` on Android).
2. Service request form, ar, dark: tapping a field opens the keyboard, the page jumps back to its top and the field stays under the keyboard — `form-keyboard-ar-dark.png` (the form itself: `service-form-ar-dark.png`) — `app/src/app/service/[key].tsx`, `app/src/components/FormEmbed.tsx`, `app/src/components/Screen.tsx`.
3. Sign-up, ar, dark: the job-title field and the «إنشاء حساب» button are under the keyboard — `signup-keyboard-ar-dark.png` — `app/src/app/auth/register.tsx`, `app/src/components/Screen.tsx`.

### B. Wrong information on screen

4. Agenda list, ar, dark: the paid workshop card reads «رسوم غير الأعضاء: 950 — الأعضاء بدون رسوم» while members pay 450 (the event page shows 450 correctly) — `agenda-ar-dark.png` against `event-ar-dark.png` — `app/src/app/agenda/index.tsx:118` (string `agenda.fee`); the home card tag «رسوم لغير الأعضاء» has the same meaning — `app/src/components/AgendaBlock.tsx:97`.
5. Prices, ar, dark: the riyal symbol is drawn on top of the last digit — list price «30,000» on the service page, the amount «15,000» above «ادفع الآن», the struck price «1,500» on the event page — `service-ar-dark.png`, `service-form-ar-dark.png`, `event-ar-dark.png` — `app/src/components/SarText.tsx` (the large / struck variants; «950», «450», «13,500» are fine).
6. Projects list, ar + en: the tile «كل القطاعات» says 258 beside the pill «259 مشروع» — `projects-ar-dark.png`, `projects-en-dark.png` — `app/src/components/SectorStrip.tsx` / `app/src/app/(tabs)/projects.tsx` (sum of the sector counts against the total).

### C. Layout and visual defects

7. News list (`/news`), ar, dark: no header and no back arrow; the title «الأخبار» sits under the status bar — `newslist-ar-dark.png` — `app/src/app/news/index.tsx:139` (`SafeAreaView edges={[]}`) and no `Stack.Screen name="news/index"` in `app/src/app/_layout.tsx`.
8. Contact (message the management), ar, dark: no header, no title, no back arrow; the hint line under the field runs behind the raised advisor button — `contact-ar-dark.png` — `app/src/app/contact.tsx`, `app/src/app/_layout.tsx` (no registration), `app/src/components/GlobalTabBar.tsx`.
9. Event cards without a cover image, ar, dark + light: the placeholder calendar icon is drawn through the title and the details; in light mode the card is a grey-to-black block with weak countdown labels — `agenda-ar-dark.png`, `home3-ar-dark.png`, `home2-ar-light.png` — `app/src/app/agenda/index.tsx`, `app/src/components/AgendaBlock.tsx`.
10. Light mode, every pushed screen: black wedges behind the rounded top corners of the bottom bar — `project-locked-ar-light.png`, `membership-ar-light.png` — `app/src/components/GlobalTabBar.tsx` / the wrapper `View` in `app/src/app/_layout.tsx` (about line 204).
11. Light mode: the badges «عضو» (dark text on dark green) and «غير مفعّلة» (dark text on dark gold) are hard to read — `account-ar-light.png`, `membership-ar-light.png` — `app/src/components/MembershipStatusCard.tsx`.
12. Light mode, picture not loaded (offline or slow network): the golden opportunity title is white on a near-white placeholder — `offline-home-ar-light.png` — `app/src/components/GoldenOpportunity.tsx`.
13. Golden opportunity card, ar, dark: the sector and stage chips float in the middle of the photo, across its subject — `home1-ar-dark.png` — `app/src/components/GoldenOpportunity.tsx`.
14. Projects list, ar, light: the stage chip and the views count over the photo are barely readable — `projects-ar-light.png` — `app/src/components/ProjectCard.tsx`.
15. Advisor tab, ar, dark + light: the raised advisor button covers the bottom edge of the composer (worse in English, where the placeholder takes two lines) — `advisor-ar-dark.png`, `advisor-ar-light.png` — `app/src/app/(tabs)/_layout.tsx` (dock crown), `app/src/components/advisor/Composer.tsx`.
16. Advisor, ar, dark: the chip «تسأل عن: …» with a long title runs off the left edge; its ✕ is half off-screen — `advisor-ar-dark.png` — `app/src/components/advisor/AdvisorChat.tsx`.
17. Entrepreneur persona (Projects tab hidden), ar, light: with four tabs the raised advisor button is no longer in the middle of the bar — `home-nonmember-4tabs-ar-light.png` — `app/src/app/(tabs)/_layout.tsx`, `app/src/components/GlobalTabBar.tsx`.
18. Language, theme and sign-out dialogs, ar + en: plain white system dialog inside the dark app, teal buttons, system font; in Arabic the title is on the left and the layout is left-to-right; the Android back key does not close them — `language-switch-en-dark.png`, `theme-switch-ar-dark.png` — `app/src/i18n/chooseLanguage.ts`, `app/src/theme/theme.ts`, `app/src/app/(tabs)/account.tsx` (`Alert.alert`).
19. Project page, ar, dark + light: the Latin company line («Fionta Seven») is left-aligned on the right-to-left page — `project-ar-dark.png` — `app/src/app/project/[id].tsx` (needs `textAlign: textStart`).
20. Project page, ar + en: the «آخر تحديث» value shows bold digits and a regular month («**1** نوفمبر **2026**») — `project-ar-dark.png` — `app/src/app/project/[id].tsx` / `app/src/components/project/`.
21. Member card, ar, dark: «Investors Club» is printed twice (name, then spaced capitals); «Promo Code» and «Membership No.» are English while the other labels are Arabic — `card-ar-dark.png` — `app/src/app/card.tsx`.
22. News item, ar, dark: the chip «مصدر رسمي» is cut to «مصدر رس…» — `newsitem-ar-dark.png` — `app/src/app/news/[id].tsx`.
23. Sign-in, ar + en: the typed e-mail starts about 10 px from the field border (placeholders and the phone field keep about 46 px) — `signin-keyboard-en-dark.png` — `app/src/components/LoginIdentifier.tsx` / `app/src/app/auth/login.tsx`.
24. Screens with a native header and the page title block (sign-up, sign-in, membership, services, agenda, card, service): an extra empty band as tall as the status bar under the header; while scrolling, content is cut about 63 px below the header — `signup-keyboard-ar-dark.png` (card cut at y≈273, header ends at 210), `membership-en-dark.png` — `app/src/components/Screen.tsx` (top safe-area inset added although the header already covers it).
25. Home sections, ar + en: the last line of the section description touches what follows — «أحدث الفعاليات» cards and the «قدّم من هنا» button under «شخصية ومسيرة» — `home3-ar-dark.png` — `app/src/components/SectionHeader.tsx`, `app/src/app/(tabs)/index.tsx`.
26. Home, en, dark: the tile «Club headquarters a…» and the pills «Start your consult..», «Request your me…» are cut — `home1-en-dark.png` — `app/src/app/(tabs)/index.tsx` (quick actions), `app/src/components/ServiceCard.tsx`.
27. Home, ar: the section title «حصريًا للأعضاء — Members Exclusive» puts English inside the Arabic screen and wraps to two lines — `home4-ar-dark.png` — string `home.partners…` in `app/src/i18n/strings/ar.json` or the server's partners title.
28. Home banner, ar, light: one-line mixed text is cut inside the English name: «…على Google Play و…App S» — `home-nonmember-4tabs-ar-light.png` — `app/src/components/ServiceTile.tsx` / `RotatingBanner.tsx`.
29. Inbox rows and carousel snippets, ar: the single-line ellipsis is clipped to two dots «..» — `inbox-ar-dark.png` — `app/src/app/(tabs)/news.tsx`, `app/src/components/NewsCarousel.tsx` (padding on a `Text` with `numberOfLines`).
30. Large system font (1.3), ar, light: tab label «بنك المشاريع» becomes «بنك المشار…»; market tile «السوق السعودي» becomes «السوق السعو..»; the account e-mail wraps as «…@gmail» / «.com» — `largefont-home-ar-light.png`, `largefont-projects-ar-light.png`, `largefont-account-ar-light.png` — `app/src/app/(tabs)/_layout.tsx` and `GlobalTabBar.tsx` (label), `app/src/components/MarketsStrip.tsx`, `app/src/app/(tabs)/account.tsx`.
31. Projects list, ar + en: the «فلترة» button is the last item of the horizontally scrolling sort row, off-screen until the row is dragged — `projects-ar-dark.png` (button not visible), `projects-filters-ar-dark.png` — `app/src/app/(tabs)/projects.tsx:115`.
32. Videos list, ar, dark: a featured video plays inside its small card with YouTube's own title, logo and controls crowded on top of each other — `player-ar-dark.png` — `app/src/components/VideoCard.tsx`, `YouTubeEmbed.tsx`. The full player works; the page under the video is empty — `player-ar-light.png` — `app/src/app/watch.tsx`.
33. «اقرأ من المصدر», dark: the in-app browser opens with a white toolbar inside the dark app (no screenshot kept) — the `openBrowserAsync` call used by `app/src/app/news/[id].tsx`.
34. Three-button navigation, light: the tab bar inset is right, but the system bar is a flat grey band under the white bar — `nav3button-home-ar-light.png` — navigation bar colour is not set (`app/app.config.ts`).
35. The bottom bar on pushed screens is not the same shape as the tabs' own bar (icons about 8 px inward, active mark a pill instead of a circle), so it shifts when a page opens — compare `projects-ar-dark.png` with `project-ar-dark.png` — `app/src/components/GlobalTabBar.tsx` against `app/src/app/(tabs)/_layout.tsx`.

### D. Minor

36. Membership screen: the headline speaks to an undecided visitor («لم تحدّد وجهتك بعد؟…») although the account is an investor or an entrepreneur — `membership-ar-dark.png` — membership content per persona (server).
37. Membership, non-member, no store on the device: two notices one under the other say the same thing (store subscription comes later) — no screenshot kept — `app/src/components/MembershipStatusCard.tsx`, `StorePurchaseCard.tsx`.
38. Project card: the name is repeated as the company line when both are the same; five empty stars lead the «الأعلى تقييمًا» list — `projects-ar-dark.png` — `app/src/components/ProjectCard.tsx`.
39. Services list: a card without a price keeps its divider and an empty footer — `services-ar-dark.png` — `app/src/components/ServiceCard.tsx`.
40. Filters sheet: the selected chip's glow is cut square at the sheet edge — `projects-filters-ar-dark.png` — `app/src/components/ProjectFiltersSheet.tsx`.
41. Markets strip: gold shows «0%» with a green up arrow — `home1-ar-dark.png` — `app/src/components/MarketsStrip.tsx`.
42. Header title and page title repeat each other with different capitals in English («Sign In» / «Sign in», «Create Account» / «Create account») — `signup-en-dark.png` — `nav.*` strings in `app/src/i18n/strings/en.json`.

### Seen once, already fixed in the tree during the run

- 13:55 bundle: on a pushed screen the bottom bar's «Inbox» opened the news list (no header, no bar) instead of the inbox tab — `newslist-from-bar-en-dark.png`. The 14:03 bundle (a sibling's edit of `GlobalTabBar.tsx`, path `/(tabs)/news`) opens the inbox tab correctly: checked on the device at 14:06.

### Development artifacts — not defects

- With Fast Refresh on, each edit by another session re-evaluated `app/src/i18n/index.ts`, which resets `lang` to `'ar'`: the English app then showed an Arabic header with a right-side back arrow, and Arabic server content under English labels. A cold start is correct. A store build has no Fast Refresh.
- The wallet figure «1 من 5 المشاريع المفتوحة» beside «5 المتبقي» comes from the mock Projects Bank bridge (`unlockedCount: 1`).
- English mode showed the two seeded events in Arabic: they were seeded without English text and the local server has no translator.

## Looks right

Screenshots kept as proof of the screens that are fine: `welcome-ar-dark.png`, `signin-ar-dark.png`, `signup-ar-dark.png`,
`signup-ar-light.png`, `home2-ar-dark.png`, `home1-ar-light.png`, `project-locked-ar-dark.png`, `project-locked-en-dark.png`,
`inbox-en-dark.png`, `inbox-ar-light.png`, `account1-ar-dark.png`, `account2-ar-dark.png`, `account1-en-dark.png`
(the spinner over the name is my own pull-to-refresh), `about-ar-dark.png`, `videos-ar-dark.png`, `workshops-ar-dark.png`.

- Welcome (ar dark, ar light, en dark); sign-in layout (ar, en); sign-up layout (ar dark, ar light, en).
- Home: hero, quick tiles (Arabic), markets strip, news carousel, «رقم اليوم», services cards, meetups, partners, videos, both directions mirrored correctly.
- Projects list, filters sheet (Android back closes it), project page: picture, advisor summary, stage stepper (right-to-left order), risks, competing projects, lock card with the balance.
- Inbox tab (ar dark, ar light, en dark); news item body and tags; the source opens inside the app.
- Account tab (ar dark, ar light, en dark); membership screen (ar dark, ar light, en dark); services list; service page; workshops; about; event page; member card layout; videos list; full player.
- Latin values inside Arabic: phone numbers (`+966 55 162 3111`, `0551230001`), e-mail, promo code, membership number, percentages and dates all read in the right order.
- Android back: pops every pushed screen, closes the filter sheet and the keyboard, returns from a tab to Home, leaves the app from Home and from Welcome.
- Rotation: the app stays in portrait. Three-button navigation: the bar sits fully above the system bar. Nothing was found under the status bar except the news list (item 7).
- Offline (airplane mode after a first launch): the app opens signed in, paints Home, Projects and Inbox from the saved cache, and the advisor shows a clear «تعذّر الاتصال بالخادم» message with a retry button.

## Not reached

- iOS (cannot run on this PC); English in light mode (not requested).
- Store purchase of the membership: no Play billing in a local debug build; the screen shows the «coming» notices instead.
- A real advisor conversation: the local server has no AI key and no message was sent, so bubbles, voice and file replies were not seen.
- Payment checkout (Moyasar), «My payments», «My requests» with data, HQ booking and pass, invite, profile edit, security screens, delete account, affiliate apply and payout, golden projects pages, meetup pages, guide, markets, deck, portal, people and posts (no local data).
- Finishing a sign-up through the screen (adb cannot type an Arabic name; the WhatsApp code step is off locally) and guest mode.
- Workshop recordings (Bunny), push notification banners, TalkBack, other screen sizes and densities, a slow real network.
- Large font was checked on Home, Projects and Account only; three-button navigation on Home and one project page only.

## State left on the emulator

- The debug APK replaces the old preview build under `com.vcmem.investorsclub.preview`; its dev settings have Fast Refresh off and the bundle host `localhost:8081`. Google Password Manager is set to «Never» for this app. Font scale 1.0, gesture navigation and airplane mode off were restored; auto-rotate was left off.
- Metro (8081), the local API (3009) and the emulator were stopped at the end.
