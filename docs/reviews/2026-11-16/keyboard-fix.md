# Keyboard fix — Android emulator proof (rev-android-run, 2026-11-16)

Complaint: `complaint-signup-form-cannot-be-filled.json`. Session: `rev-android-run`.
Environment: debug build of the working tree, emulator `Medium_Phone_API_36.1` (Android 16, 1080×2400, 420 dpi),
Metro on 8081, local mock API on 3009 (mock hub, read-only feeds). Never TEST or production. No package added,
JavaScript only, no git command that changes the tree.

## Result

| Goal | Android (emulator) | iPhone |
|---|---|---|
| The field being typed in is visible with the keyboard open | Yes, on all four full-screen wrappers | Not checked (no iOS here) |
| The submit / send button can be reached with the keyboard open | Yes | Not checked |
| Nothing jumps | Yes — the jump to the top of the service form is gone | Not checked |
| Empty band under the native header (item 24) | Gone | No change expected |
| Advisor composer under the raised button, chip off the edge (items 15, 16) | Fixed | Not checked |
| Modal sheets with a text field | Six checked, none covered, no change | — |

`npx tsc --noEmit`: exit 0. `npx eslint src` (whole app): exit 0, after the follow-up below.

Follow-up the same night (coordinator's second message): the two `react-hooks/immutability` errors in
`FormField.tsx` are gone, item 23 (typed text 10 px from the border) is fixed in the three inputs that had it, and
the tree was walked once more — see «Follow-up» and «Final pass» at the end.

## What was wrong

1. **No room for the keyboard on Android.** Expo 57 forces edge-to-edge, so Android no longer resizes the window
   for the keyboard and React Native adds no inset of its own. The four wrappers used
   `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, which on Android is a plain `View`: the lower fields,
   the composer and the submit button stayed behind the keys.
2. **The service form jumped to its top when a field was tapped.** Android's scroll view scrolls by itself to the
   focused input (`scrollsChildToFocus`, on by default). Inside the tilted paper card
   (`PaperCard pinned`, `rotate(-0.4deg)`) that native measurement is wrong and it threw the page to offset 0.
3. **Nothing scrolled the focused field into view** once the room existed: a field low on the page stayed under
   the keys until the member scrolled by hand.
4. **Band under the header.** `Screen` added the top safe-area inset although the native header already covers
   the status bar.
5. **Advisor.** The raised advisor button rises above the tab bar and covered the bottom of the composer; the
   «تسأل عن: …» pill had its side margins added to `maxWidth: 100%`, so a long title pushed its ✕ off the edge.

## What changed, file by file

Only files named in the task. `FormEmbed.tsx` needed no change (its fields are `FormField`); the diff it shows in
the tree (`isEmail`) belongs to another session. `ProfileCompletionGate.tsx` and `contact.tsx` also carry another
session's edits (`cleanEmail`, `markParagraphs`) next to mine.

### `app/src/components/Screen.tsx`
- `KeyboardAvoidingView`: `behavior="padding"` on both platforms, `keyboardVerticalOffset={headerHeight}`
  (0 where there is no header). iOS is exactly what it was yesterday.
- `safeEdges`: the `top` edge is dropped when a header exists (`headerHeight > 0`). Tab screens have no header and
  keep it.
- New `useFieldScroller(scrollRef)` + `FieldScrollProvider` / `useFieldScroll()` (exported):
  tracks the scroll offset and the viewport height, measures the focused row with `measureLayout` against the
  scroll content and scrolls the smallest distance that leaves 20 dp of air. Two triggers: a field takes focus
  (80 ms when the keyboard is already up, 450 ms fallback otherwise) and the scroll view gets shorter (the
  keyboard opened or grew — 60 ms).
- `scrollsChildToFocus={false}` on the scroll view (Android-only prop; this is what removes the jump to the top).

### `app/src/components/FormField.tsx`
- Reports focus and blur of its row (label + input + hint or error line) to `useFieldScroll()`.
- The row keeps serving `anchorRef` (scroll to the first error) through `useImperativeHandle`; checked on the
  emulator: «Create account» on an empty form still scrolls to the first red field.

### `app/src/components/ProfileCompletionGate.tsx`
- `behavior="padding"` on both platforms, no offset (the cover starts at the top of the screen).
- Same field scroller as `Screen`.
- The status-bar inset moved from the scrolled content to the cover, so scrolled lines do not slide under the
  clock.

### `app/src/app/contact.tsx`
- `behavior="padding"` on both platforms with the header height as the offset (iOS unchanged).

### `app/src/components/advisor/AdvisorChat.tsx`
- `behavior="padding"` on both platforms; offset 0 on Android (the tab bar hides while typing), the iOS tab-bar
  offset is unchanged.
- `useKeyboardOpen()`; the composer gets 12 dp of room (`DOCK_CROWN_ROOM`) while the keyboard is closed.
- The context pill sits in a padded row (`contextRow`) instead of carrying side margins.

### `app/src/components/advisor/Composer.tsx`
- New optional prop `bottomRoom` (default 0).

## What the screenshots show

Folder: `docs/reviews/2026-11-16/android-shots/` (40 files from this first run, light mode, Arabic and English; the
follow-up adds two `*-signin-email-padding-*` shots and 55 `final-*` shots in dark mode).

| Screen | Before | After |
|---|---|---|
| Sign-up, last fields | `before-signup-keyboard-ar-light` — field and button behind the keys | `after-signup-keyboard-ar-light`, `after-signup-password-keyboard-ar-light`, `after-signup-keyboard-en-light` — field above the keys, «إنشاء حساب» reached by scrolling |
| Advisor composer | `before-advisor-keyboard-ar-light` (English: yesterday's `2026-11-15/android-shots/advisor-keyboard-en-dark`) | `after-advisor-keyboard-ar-light`, `after-advisor-keyboard-en-light` — flush above the keys; `after-advisor-closed-ar-light`, `after-advisor-closed-en-light` — clear of the raised button |
| Service request form, lower field | `before-service-form-keyboard-ar-light` — page thrown to its top | `after-service-form-keyboard-ar-light`, `after-service-form-keyboard-en-light` — field visible, no jump; `after-service-form-button-ar-light`, `after-service-form-button-en-light` — pay button reached with the keyboard open |
| «راسل الإدارة» | `before-contact-keyboard-ar-light` | `after-contact-keyboard-ar-light`, `after-contact-keyboard-en-light` |
| Profile-completion cover | none (raised only after the fix) | `after-completion-keyboard-ar-light` (taken before the status-bar inset moved), `after-completion-closed-en-light`, `after-completion-keyboard-en-light`, `after-completion-button-en-light`, `after-completion-error-keyboard-en-light` (row with its error line above the keys) |

Three-button navigation (English): `after-service-form-keyboard-3button-en-light` (field was at the very bottom,
already focused: the reveal ran from the keyboard-opened trigger), `after-advisor-closed-3button-en-light`,
`after-advisor-keyboard-3button-en-light`. Gesture navigation: every other shot.

Small screen:
- `adb shell wm size 720x1280` as asked (at the emulator's 420 dpi this is 274×488 dp, smaller than any real
  phone): `after-signup-keyboard-small-en-light`, `after-signup-button-small-en-light` pass.
  `after-advisor-keyboard-small-en-light` does **not** fully pass — see finding 2.
- The same size at 320 dpi (360×640 dp, a real small phone): `after-signup-keyboard-small360-en-light`,
  `after-signup-button-small360-en-light`, `after-advisor-closed-small360-en-light`,
  `after-advisor-keyboard-small360-en-light` all pass.
- Size and density were reset afterwards.

## Modal sheets (item 5)

Checked with the keyboard open, Arabic: `WhatsappVerify`, `PasswordPrompt`, `OptionPicker`, `RateProjectModal`,
the golden interest sheet, `CountryPicker` (`modal-*-keyboard-ar-light`). In all six the field and the buttons
stay above the keys: `behavior='height'` works inside a `Modal` on Android. **No change made.**
`PhoneConfirmAlert` could not be raised locally (it opens only on a WhatsApp-gated action; the local server runs
with the code step off).

## Not reached / not checked

- **iPhone.** Nothing here runs iOS. Written so iOS keeps its behaviour (`padding` and the offsets it already
  had; `scrollsChildToFocus` is ignored there). To look at on a real iPhone: a form under a header (the reveal
  now also runs on iOS when a field takes focus), the advisor tab with the keyboard closed (12 dp more air under
  the composer), the completion cover, «راسل الإدارة».
- Dark mode was not re-shot (no colour or theme code touched).
- `PhoneConfirmAlert` (above). No "before" shot of the completion cover.
- One Android version only (API 36). On a device that still resizes the window, the padding computes to 0 by
  itself (the view's bottom is already above the keyboard).
- Hardware or floating keyboards; landscape (the app is portrait-locked).

## Findings left for the coordinator (not fixed)

1. **(Fixed in the follow-up — see «Follow-up» below; kept here as the record of the finding.)**
   **A focused field with the golden glow loses its inner padding on Android.** The focused style adds
   `boxShadow: shadows.glowGoldFaint`; on Android the text and placeholder then hug the border while typing.
   Proven on the advisor composer: with the glow `after-advisor-keyboard-3button-en-light` («hello» against the
   border), without it `finding-composer-without-glow-en-light` (normal padding). The test line was put back.
   Same style in three of my files: `Composer.tsx` `inputFocused`, `contact.tsx` `inputFocused`,
   `FormField.tsx` `inputFocused` (dark screens such as the sign-in e-mail; form cards are not affected).
   Fix: no `boxShadow` in the focused style on Android (gold border only), one line each. It removes the glow on
   Android, so it is a design decision.
2. **Advisor on a very short screen.** At 274×488 dp the header (two lines), the pill, the «One PDF, up to 10 MB»
   line and the field need about 217 dp and 205 dp are left above the keys: the lower 13 dp of the field goes
   under them. Passes at 360×640 dp. If wanted, hiding the PDF hint line while the keyboard is open
   (`Composer.tsx`) frees 22 dp.
3. `contact.tsx`: the composer keeps `paddingBottom: insets.bottom`, a blank strip between the field and the hint
   while the keyboard is open; with it closed the hint still sits under the raised button (yesterday's item).
4. `WhatsappVerify`, edit-number step: two «لاحقًا» buttons.
5. Completion cover in English: the title row «Welcome <name>, complete your details» touches both screen edges.
6. From the complaint's plan, outside my file list and untouched: Arabic-Indic digits in the code fields, the OTA
   reload guard.

## Run notes

- Bundles served by Metro (day 2): 00:31:09 first bundle (before shots), 00:46:06 first bundle with the fix,
  00:52:39, 01:01:12, 01:01:40 English restart, 01:04:22, 01:06:33 glow test, 01:11:01 glow line restored,
  01:24:11 lint fix in `FormField.tsx` (re-checked: reveal on focus, scroll to the first error).
- A fourth local mock account (no job title) was added to raise the completion prompt again; the third one had
  snoozed it for seven days.
- Emulator settings restored: gesture navigation, size and density reset. Metro, the local API and the emulator
  were stopped at the end.

## Follow-up (coordinator's second message)

### 1. Lint
`FormField.tsx` no longer writes into the `anchorRef` prop: the row keeps its own ref and serves the screen's
anchor through `useImperativeHandle(anchorRef, () => row.current, [])`. No `eslint-disable`.
`npx eslint src`: exit 0. `npx tsc --noEmit`: exit 0. Re-checked on the emulator: an empty «Create account»
still scrolls to the first red field, and a focused row is still revealed above the keys.

### 2. Item 23 — typed text 10 px from the field border
- **Cause (proven on the emulator):** the focused style put `boxShadow` on the `TextInput` itself. Setting a box
  shadow swaps the input's Android background, and Android then resets the input's padding to the stock EditText
  inset (4 dp ≈ 10 px at this density). The gold border alone does not do it. It is in `FormField.tsx` as rev-auth
  said, but in `inputFocused` (the glow), not in the Latin style: the Arabic and English fields behaved the same.
- **Fix:** the glow moved to a plain `View` around the input (`collapsable={false}`, same corner radius); the
  input keeps only the gold border. The glow looks the same, the padding stays. Same change in the two other
  inputs with the identical style, both keyboard files: `advisor/Composer.tsx` and `app/contact.tsx`.
- **Shots:** `before-signin-email-padding-en-light` → `after-signin-email-padding-en-light`;
  dark: `final-signin-email-keyboard-ar-dark`, `final-signin-email-keyboard-en-dark` (yesterday's
  `2026-11-15/android-shots/signin-keyboard-en-dark` is the "before"); composer `final-advisor-keyboard-ar-dark`,
  `final-advisor-keyboard-en-dark`; contact `final-contact-keyboard-ar-dark`, `final-contact-keyboard-en-dark`.
- Not touched (outside my files): `app/src/app/auth/verify.tsx` `codeFocused` has the same glow-on-the-input
  style. Its digits are centred, so nothing shows, but the mechanism is the same.

## Final pass

One bundle of the frozen tree: cold start 01:36:15 (no source file changed after 01:34:43; checked by file time
at the end). The language and theme restarts re-read the same tree. Local mock server, emulator API 36, gesture
navigation. Data seeded locally for the pass: two agenda events, one message from the management to every
account, one «راسل الإدارة» thread with a reply.
Shots: `final-*` in `android-shots/` (55 files).

### What is right (Arabic dark and English dark)

| Step | Result | Shots |
|---|---|---|
| Sign-up form, keyboard | Last field above the keys, «إنشاء الحساب» reached | `final-signup-top-ar-dark`, `final-signup-keyboard-ar-dark`, `final-signup-button-ar-dark`, `final-signup-keyboard-en-dark` |
| Sign-in | Typed e-mail keeps its padding, glow intact, signs in | `final-signin-email-keyboard-ar-dark`, `-en-dark` |
| Home | Gold strip of the unread management message on top; bottom bar and the inbox badge | `final-home-ar-dark`, `final-home-en-dark`, `final-home-guest-ar-dark`, `final-home-guest-en-dark` |
| Inbox tab | List, «تعليم الكل كمقروء», badges | `final-inbox-ar-dark`, `-en-dark` |
| Projects | Opens on «اكتشف» / «Discover», filter button visible, freshness line («آخر تحديث للبنك قبل دقيقة») | `final-projects-ar-dark`, `-en-dark` |
| One project | Header, summary, stage line, competitors | `final-project-ar-dark`, `final-project-lower-ar-dark`, `final-project-en-dark` |
| Advisor | Composer clear of the raised button; flush above the keys; pill inside the row | `final-advisor-closed-*`, `final-advisor-keyboard-*` |
| Account | Sign-out, language and theme all open the app's own dialog | `final-account-*`, `final-dialog-signout-*`, `final-dialog-language-*`, `final-dialog-theme-*` |
| Membership | Status card, paper cards | `final-membership-ar-dark`, `-en-dark` |
| Services, one service form | List and prices; form field above the keys, no jump | `final-services-*`, `final-service-ar-dark`, `final-service-form-keyboard-ar-dark`, `-en-dark` |
| Agenda | Cards without a photo; fee line («بدون رسوم», «الأعضاء: 450 — غير الأعضاء: 950») | `final-agenda-ar-dark`, `-en-dark` |
| «راسل الإدارة» | Header and back arrow; thread; field above the keys with its padding | `final-contact-ar-dark`, `final-contact-keyboard-ar-dark`, `final-contact-en-dark`, `final-contact-keyboard-en-dark` |
| Videos | Header, «ابدأ من هنا» row. «كل الفيديوهات» is empty locally (no YouTube key on the local server) | `final-videos-ar-dark`, `-en-dark` |
| Largest system font (200 %) | Bottom bar labels fit in both languages; event cards right; dialogs right | `final-font200-home-*`, `final-font200-agenda-*`, `final-font200-account-bottom-en-dark`, `final-font200-dialog-language-en-dark` |

No red screen, no crash, no blank page during the pass. Logcat: 0 `FATAL EXCEPTION`, no JavaScript error.
Four `ReactNoCrashSoftException` lines («reactInstance is null» on `RCTDeviceEventEmitter.emit`), one at each
language or theme restart: React Native's own teardown noise, nothing shows on screen. Metro: no error; the only
warnings are the dev push-token line.

### What is wrong or needs a decision (nothing fixed — outside my files)

1. **Riyal symbol at the largest font.** The symbol stays at its normal size while the digits grow: it looks like
   a small raised mark with a gap after it. In English the «Save 15,000 … with your membership» pill also runs
   past the right edge of the screen. — `final-font200-service-en-dark`, `final-font200-service-ar-dark`,
   `final-font200-services-ar-dark` — `app/src/components/SarText.tsx` (the inline image's height comes from the
   style's `fontSize` only, never multiplied by the system font scale); the pill: `app/src/app/service/[key].tsx`.
2. **Gold strip in English is cut.** «New message from the management» shows as «New message from the m…» at the
   normal font size (Arabic fits). At 200 % it is «New message fr…» and the Arabic title is cut too. —
   `final-home-en-dark`, `final-home-guest-en-dark`, `final-font200-home-en-dark` —
   `app/src/app/(tabs)/index.tsx`, `UnreadMessagesStrip`.
3. **Home card «رسائل الإدارة» shows only the greeting.** For a signed-in account the preview is
   «الأستاذ/ ناصر،» (English: «Dear member,») and then «…»; none of the message's own words. A guest, who gets
   no greeting, sees the text. — `final-home-ar-dark`, `final-home-en-dark` against `final-home-guest-en-dark` —
   `app/src/components/PostsBlock.tsx` (the two-line preview) with the greeting added in
   `server/src/posts/routes.ts` (`personal`).
4. **To confirm, not clearly a defect:** after «تسجيل الخروج» the app stayed on the account tab as a guest instead
   of the welcome screen (this install had used «المتابعة كضيف» earlier), and the inbox badge still shows «+1»
   for the guest. — `final-account-guest-after-signout-ar-dark` — `app/src/auth/AuthProvider.tsx`,
   `app/src/app/(tabs)/account.tsx`.
5. Small: the English placeholder of «Meetup topic» is longer than its field and a sliver of its second line
   shows. — `final-service-form-keyboard-en-dark` — the placeholder text of the service form.
6. Unchanged from the first report: with the keyboard closed the hint under the «راسل الإدارة» field is crossed
   by the raised advisor button (`final-contact-ar-dark`, `final-contact-en-dark`, `app/src/app/contact.tsx`);
   the advisor on a 274×488 dp screen.

### Not reached in the final pass

- **Welcome screen in dark.** After the guest choice above, sign-out no longer returns to it and the `welcome`
  deep link does nothing for a guest. It was seen in light at the start of the run in both languages (three
  buttons and the language button, nothing wrong); clearing the app's data to force it would have reset the
  language, the theme and the dev settings mid-pass.
- iPhone, as before.

### Run notes (follow-up)

- Bundles: 01:32:29 first after the Metro restart, 01:33:49 with the `FormField.tsx` glow frame (item 23
  check), 01:36:15 the final-pass bundle. The served bundle was fetched from Metro at the end and holds the last
  edits (`glowFrame`, `inputFrameFocused`).
- The first launch after the emulator restart showed a red «loadJSBundleFromAssets» screen: the dev app could
  not reach Metro until `adb reverse tcp:8081 tcp:8081` was set again. Environment only, not the app.
- Font scale back to 1.0. Metro, the local API and the emulator stopped at the end.
