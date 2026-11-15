# rev-platform — app shell, iOS binary vs Android binary (2026-11-15)

Scope read once: `app/src/app/_layout.tsx`, all of `app/src/lib/**` and `app/src/config/**`, `UpdateGate`, `RetiredBuildGate`,
`SplashFlash`, `SyncPoller`, `ScreenTracker`, `PushRegistrar`, `AdsAttribution`; read-only: `app.config.ts`, `eas.json`,
`plugins/**`, `locales/**`, `patches/**`, `package.json`. iOS was reviewed by reading only (no Mac here).

## Fixed

Round 1 — crash and unhandled-rejection guards (no behaviour change):

- `app/src/app/_layout.tsx:49,184` — `SplashScreen.preventAutoHideAsync()` / `hideAsync()` rejections are caught (they
  were unhandled promises at module scope / in an effect).
- `app/src/lib/notifications.ts:43-50` — `setNotificationHandler` (called at module scope of the root layout) is wrapped:
  a throw there would have been a launch crash for every member.
- `app/src/lib/queryCache.ts:64-78` — the cache snapshot (`dehydrate` + `JSON.stringify`) runs inside a timer; a throw
  was an uncaught error (fatal in a release build). Now the snapshot is skipped and the next change writes a new one.
- `app/src/components/UpdateGate.tsx:77` — the store button's `Linking.openURL` rejection is caught.

Round 2 — the coordinator's decisions (2026-11-15), all applied:

1. **P1** `app/src/app/_layout.tsx:62,139,151` — an OTA downloaded at launch reloads the app only within 30 s of the
   launch; later it stays pending (the «restart» banner offers it, the next launch applies it).
2. **P2** `app/src/app/_layout.tsx:57,176-182` — 12 s splash watchdog: the app opens with whatever is ready.
3. **P3** `app/src/lib/adsAttribution.ts:84-96,108` — iOS: `whenActive()` before the tracking primer and prompt.
   Android never reaches it (returns at line 101). Not tried on an iPhone: needs one TestFlight pass.
4. `app/src/lib/checkout.ts:1-12` — scheme fallback `env.isProduction ? 'investorsclub' : 'investorsclub-preview'`.
5. From rev-api, `app/src/app/_layout.tsx:66-82` — the query default `retry` gives one more try only to a lost
   connection, a 5xx, 408 and 429 (any other 4xx is final); `focusManager` follows `AppState`, so stale queries on
   screen refetch when the app returns to the foreground (and interval queries pause in the background).
6. `app/src/lib/queryCache.ts:33-39,80-97` — the ticket and recordings queries (`['agenda','ticket',…]`,
   `['agenda','recordings',…]`) are kept out of the file, and dropped from an older file on restore; a removal
   (sign-out clears the cache) is written at once instead of a second later. The cache reports each removed query
   synchronously while `clear()` is still emptying it, so the write runs in a microtask: one write, with the cache
   already empty.
7. `app/src/lib/purchases.ts` — (a) `:12-13,164` `PurchaseResult` gains `{ status: 'pending' }`, returned for
   `PAYMENT_PENDING_ERROR`; (b) `:52-55` the anchors of `riyalPrice` accept LRM / RLM / Arabic letter mark where they
   accepted spaces (one `GAP` constant: whitespace, U+200E, U+200F, U+061C). Checked in Node against 9 price strings.
8. `app/src/components/UpdateGate.tsx:12,139-140` — `textAlign: 'left'` → `textAlign: textStart`.
9. `app/src/app/_layout.tsx:64,142-173` — back in the foreground with the last successful check older than 3 hours:
   check and fetch in the background, never a reload. Same guards as the launch check (optional native module, every
   failure swallowed); a failed look does not count, so the next return to the foreground tries again.

Round 3 — the members' complaint «شاشة سودا بدون سبب» (coordinator task, 2026-11-16; plan in
`docs/reviews/2026-11-16/complaint-black-screen-at-launch.json`). JavaScript only, every native call behind the
optional-module check. New files: `lib/reloadApp.ts`, `lib/crashGuard.ts`, `components/LaunchCover.tsx`,
`components/CrashScreen.tsx`.

1. **Every reload and every not-ready frame is the opening screen** (plan priority 1).
   - `app/src/lib/reloadApp.ts` — `reloadApp()`: the expo-updates reload page is brand black `#0B0B0B` with the emblem
     at 160 points, no spinner, fading out; if the native side refuses the options, the plain reload; in development
     the dev reload. Never throws; answers `false` when this binary cannot restart itself. Used by `restart()` in
     `i18n/direction.ts:110-113` (language, theme, direction), the launch check (`_layout.tsx:172`), the banner button
     (`UpdateGate.tsx:105`) and the recovery screen.
   - `app/src/components/LaunchCover.tsx` + `_layout.tsx:210-214` — a static cover (brand black, the emblem, no
     fonts / t() / tokens / hooks) instead of `return null`.
   - The same cover replaces the bare views of `auth/GuestGate.tsx:95` and of the `null` state of
     `components/AppLockGate.tsx:76`.
   - `components/SplashFlash.tsx` — until the artwork has decoded the cover shows the emblem on brand black instead
     of a bare black view; the 700 ms hold starts when the artwork is on screen; an artwork that fails or has not
     loaded after 1.5 s is skipped.
   - One limit found in the native code: the reload page reads `file:`, `http(s):` and `data:` pictures only. On
     Android a bundle that still runs from the binary's own resources (the first session after an install) names
     the emblem by resource id, so that reload shows the brand black alone (no spinner) and the launch cover draws
     the emblem as soon as JavaScript is back. Downloaded bundles and iPhone are not affected.
2. **Error boundaries and the global handler** (priorities 2 and 3).
   - `_layout.tsx:104-113` — the root `ErrorBoundary` export and `unstable_settings.screenErrorBoundary` (one broken
     screen keeps the app alive). Both draw `components/CrashScreen.tsx`: brand black, the emblem, one fixed sentence
     in the app's language (Arabic when it cannot be read) and «إعادة تشغيل التطبيق» / «Restart the app», which
     deletes `query-cache.v1.json` (`dropQueryCacheFile()`, `lib/queryCache.ts:56`) and reloads; a binary that cannot
     reload redraws the tree. The per-screen variant adds «رجوع» / «Back». No provider hooks, no themed styles, no
     shared button; it also hides the native splash (a throw in the first frame left it up).
   - `lib/crashGuard.ts`, imported first (`_layout.tsx:2`) — release builds only: a fatal error outside render (a
     timer, a listener, an onPress) is no longer handed to the native side, on both platforms; it is written to the
     device log (`crash guard […]`).
   - **Rollback kept, only where it can still happen** (corrected after the independent review, 2026-11-16):
     expo-updates rolls a broken update back only for an error raised BEFORE the first view is mounted; once any
     content has appeared it marks the launch successful and its plan is «wait for a remote update, then crash»
     (`ErrorRecoveryHandler.kt` `handleContentAppeared`, checked). The root layout mounts `<LaunchCover/>` at its
     first commit, so my first version (a pass-through for 8 s) re-threw screen errors when no rollback was possible
     and would have torn the host down — the very black window this work cures. Now the pass-through needs all of:
     first JavaScript start of the process, a downloaded update, **before the root layout's first commit**
     (`markFirstCommit()`, `_layout.tsx:116-120`, `lib/crashGuard.ts:53-68`), and inside the first 8 s. In practice:
     a throw at module scope or in the very first render of the root layout still reaches expo-updates (update
     marked failed, previous one starts); every later error is caught. The boundary and the global handler use the
     same function (`nativeRollbackStands()`). State that cannot be read counts as «nobody is watching».
   - **Consequence to know:** a downloaded update whose home screen (or any screen) throws AFTER the launch cover is
     no longer rolled back automatically; members see the recovery screen until a fixed update is published. That
     is the trade-off the challenge named; it makes a smoke test of every production OTA, and the crash beacon,
     more important.
3. **Cache stamp and the gate's limit** (priorities 4 and 5).
   - `lib/queryCache.ts:27-45,86,108` — the snapshot carries the bundle that wrote it (the update id, else
     `embedded-<version>`); a file from another bundle, and every file written before the stamp, is not painted.
   - `auth/GuestGate.tsx:15,87-94` — the opening cover gives way after 4 s; the reads still correct the state when
     they answer.
4. **Option B** (priority 6) — `_layout.tsx:155-172,204-208`: an update found at launch reloads the app only while
   the launch cover / splash is still showing (`firstScreenShown` is false). Second lock, `memberMayBeTyping()` in
   `lib/reloadApp.ts`: no focused text input, keyboard closed, not on `/auth`, `/form`, `/service`, `/profile-edit`,
   `/contact`, `/posts/compose`, `/people/apply`, `/checkout` (the path is noted by `ScreenTracker.tsx:22-25`).
   Otherwise the update stays pending for the banner and the next cold start. The 30-second rule of round 2 is gone.
5. **Priority 7 (a)** — `i18n/direction.ts:124-128`: `syncDirection` deletes its attempt key only when it exists
   (one read instead of a delete and a mirror rewrite on every launch). 7 (b) and priority 8 left, as instructed.
6. **Emulator report.**
   - Item 10 — `_layout.tsx:232`: the wrapper of the stack and the bottom bar takes the page colour (`colors.black`,
     read at render): no black wedges behind the bar's corners in the light theme.
   - Item 8 — `_layout.tsx:273`: `contact` is registered with the detail header and `contact.title`.
   - Item 33 — **not applied, cannot be fixed in JavaScript**: see «Problems not fixed».
7. **Text plan priority 7** — `_layout.tsx:232`: `direction: isRTL() ? 'rtl' : 'ltr'` on that same root container.

## Problems not fixed

| Severity | What the member sees / the risk | Why left |
|---|---|---|
| **high** | **Android: the member's id and the hashed e-mail + mobile go to AppsFlyer with no consent step.** On iPhone they wait for «Allow» on the tracking prompt; on Android `askTrackingPermission()` returns `true` at once (`lib/adsAttribution.ts:101`). The member sees nothing. Play's User Data policy and the Saudi PDPL expect a disclosure + consent for ad matching. | Needs a product/legal decision and new copy (a consent line or switch), not a code defect. |
| **medium** | **An affiliate / invite link never reaches the app.** No universal links (iOS `associatedDomains`), no Android App Links, no AppsFlyer deferred-link listener. Only `investorsclub://auth/register?invite=CODE` fills the field; a person who taps `https://api.vibesholdingsa.com/...`, installs and opens the app must type «رمز الدعوة» by hand. | Flow + native config + server (`apple-app-site-association`, `assetlinks.json`): a new binary and a design decision. |
| **medium** | **Android backup carries the session.** `allowBackup="true"` (template default) and `lib/deviceStore.ts` mirrors every secure value — the session token included — in `device-store.v1.json` inside the documents folder. A Google backup / phone-to-phone restore copies it: the new phone opens signed in. (Same file is in an iPhone's iCloud backup.) | Native config (`app.config.ts`, read-only). Edit below. |
| **medium** | **R8 obfuscation (M240) is on for release builds** (`plugins/withAndroidR8.js`) with no extra keep rules; only the release variant runs it, and nothing here shows a release build was exercised (Google sign-in, purchase sheet, push, AppsFlyer). A release-only crash would not show in debug. | Cannot run a release build here. Check the Play pre-launch report of 1.3.3 and do one manual pass on the internal track. |
| **medium** | **A production OTA exported without `APP_ENV=production` shows «النسخة التجريبية متوقفة» to every member** (`RetiredBuildGate` reads `extra.appEnv` from the published config) and points the app at the test API. Operator mistake, already happened on the env side (memory note). | Publishing discipline, not app code; a hardening idea is under «Shared-file changes». |
| **low** | `lib/purchases.ts:54` — a symbol-first price that ENDS with a direction mark («ر.س.‏ 1,900.00‏») is still shown as the store wrote it: the `lead` pattern has no gap before its `$` (the decision covered the existing `\s` only; the `trail` pattern has one). | One token (`${GAP}` before `$` in `lead`), but beyond the decision as written: coordinator decides. |
| **low** | `lib/purchases.ts:19` — the store module is detected with `NativeModules.RNPurchases` only (ads and webview also ask `TurboModuleRegistry`). Works on today's binaries through the interop layer; a future new-architecture-only build of the SDK would hide the purchase button silently. | Report-only file; needs a device test before any change. |
| **low** | **Push permission is asked the instant a member is signed in** (`PushRegistrar` → `obtainPushToken`), with no explaining line, on both platforms (iOS prompt, Android 13+ prompt), possibly on top of the intro film / details popup. A refusal on iOS is final. | Flow change (when to ask), owner's call. |
| **low** | **System UI stays dark in light mode**: `userInterfaceStyle: 'dark'` (+ `expo-system-ui`) forces dark keyboards, alerts (the tracking primer, the theme chooser), share sheets. | Native config; `automatic` needs a full visual pass. |
| **low** | **«قيّمنا» never uses the store app link**: `RateUsPrompt.tsx:69` asks `Linking.canOpenURL('itms-apps://…')` / `('market://…')`; without `LSApplicationQueriesSchemes` (iOS) and a `<queries>` entry (Android 11+) both answer false, so the https page is always used (it still opens the store). | Not my file. Edit below. |
| **low** | **Cold-start notification tap on older binaries**: the bundled `expo-notifications` JS (57.0.18) reads the tap through the native *sync* `getLastNotificationResponse`; a binary whose native side lacks it throws (caught) and the app opens on the home instead of the target screen. | Cannot check the 1.2.0 / 1.3.0 native side from here. |
| **low** | **The lock and «retired» covers are plain views**: a native `Modal` opened by another component draws above them, and Android's back button pops the hidden screens under them. (The cold-start gap of `AppLockGate` is closed: it starts covered, since round 3 with the emblem.) | Needs a small redesign (a Modal, or a back handler), not asked for. |
| **medium** | **Android, emulator item 33: the in-app browser's toolbar stays white inside the dark app.** `lib/openLink.ts` already passes `toolbarColor: colors.black` and `controlsColor: colors.gold`. The installed `expo-web-browser` 57.0.3 drops it on Android: `WebBrowserModule.kt:107-113` builds the colour parameters with `.setSecondaryToolbarColor(color)` for `toolbarColor`, so the top toolbar colour is never set and Chrome follows the phone's own light/dark setting. No JavaScript option reaches it. iPhone is not affected. | Native code of a library: a `patch-package` patch (`app/patches/**` is the coordinator's) and a new binary. Edit below. |
| **medium** | **No crash beacon.** A caught error is written to the device log only (`noteCrash` in `lib/crashGuard.ts`); the server route `POST /api/app/client-error` of the plan does not exist. Until it does, nobody sees which screens fail on members' phones, and a broken OTA that fails AFTER the first 8 s shows the recovery screen to everybody with no signal to us. | Skipped as instructed (server work). `noteCrash()` is the one place to add the request. Every production OTA needs a smoke test on a real phone first. |
| **low** | **Option B: an update found at launch now almost always waits for the next cold start**, because the first screen is usually ready before the download ends. Confirmed in the code: the banner in `UpdateGate` (`PendingOta`, `:86-114`) reads `isUpdatePending` from `useUpdates()`, which the native state machine sets on every finished download — the native launch download (`StartupProcedure.kt:189`) and both JavaScript fetches, the launch check and the three-hour foreground re-check (`FetchUpdateProcedure.kt:122`) — and JavaScript receives it at load (`initialContext`) and by event after. Its button calls `reloadApp()` (`UpdateGate.tsx:105`). **What the member sees:** a small navy-and-gold bar at the top of whatever screen is open — «يرجى إعادة تشغيل التطبيق» with one button; a tap shows the black opening screen with the emblem for a moment and the app reopens on the new version; if he ignores it, the next time the app is opened from closed runs the new version by itself. | The coordinator's decision; noted so the banner is expected on a phone (also in a newcomer's first session). |
| **low** | Android release manifest carries permissions the app does not use: `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE` (≤ API 32). `FOREGROUND_SERVICE_MEDIA_PLAYBACK` + `AudioControlsService` come from `expo-audio` (Play asks for a declaration). | Native config. Edit below. |

Notes without a problem: every native package is required lazily behind a registry check (`requireOptionalNativeModule` /
`TurboModuleRegistry`) — no static import of a native-only package anywhere in `src`; `x-app-binary`, `x-app-version`,
`x-app-platform`, `x-app-gate`, `x-app-lang` ride on every `apiRequest` (the only API `fetch`); the header is simply
absent when the native runtime version cannot be read, never a blocker; the forced-update store links match the store
ids (`id6825963092` = `eas.json` `ascAppId`, `com.vcmem.investorsclub`); the root covers carry no `zIndex` (M240) and
stack in the documented order; the three review-requested iOS texts exist in Arabic and English.

**«iPhone 1.3.0 never applies new OTAs»** — the code shows no cause. `fetchUpdateAsync` answers `isNew` for an update
the native launch check already downloaded (checked in `FetchUpdateProcedure.kt`), every failure is swallowed, and the
banner covers a missed reload. The only way a phone sees nothing is a binary whose runtime has no published update
(the runtime-mismatch explanation already confirmed on Android in the memory note).

## Shared-file changes needed

P1–P3 and the `checkout.ts` fallback are applied (see Fixed, round 2). Still open:

Native patch for emulator item 33 (new file `app/patches/expo-web-browser+57.0.3.patch`, new binary) — in
`node_modules/expo-web-browser/android/src/main/java/expo/modules/webbrowser/WebBrowserModule.kt`, inside
`createCustomTabsIntent`, the FIRST block (`val color = options.toolbarColor`): old `.setSecondaryToolbarColor(color)`
→ new `.setToolbarColor(color)`. The second block (`secondaryToolbarColor`) stays as it is.

Native config — the coordinator applies these himself (new store build 1.3.4):

1. `app/app.config.ts`, the `android: { … }` block (after `predictiveBackGestureEnabled: false,`) — add:
   ```ts
   allowBackup: false,
   blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'],
   ```
2. `app/app.config.ts`, top of the file — optional guard against a production OTA with the test config: throw when
   `process.env.EXPO_PUBLIC_API_URL === 'https://api.vibesholdingsa.com' && APP_ENV !== 'production'` (and the reverse).

JavaScript, OTA-safe:

3. `app/src/components/RateUsPrompt.tsx:69-72` — old:
   ```ts
   if (await Linking.canOpenURL(deepLink)) {
     await Linking.openURL(deepLink);
     return;
   }
   ```
   new (the surrounding `try/catch` already falls back to the web link when it rejects):
   ```ts
   await Linking.openURL(deepLink);
   return;
   ```
4. `app/src/components/AppLockGate.tsx:20` — start covered until the setting is read: `useState<boolean | null>(null)`,
   render the cover for `null` and `true`, set `false` when `lockEnabled()` answers no.
5. `app/src/lib/purchases.ts:54` (mine, waits for a decision) — old
   `` `^${GAP}${CURRENCY.source}${GAP}(${AMOUNT.source})$` `` → new `` `^${GAP}${CURRENCY.source}${GAP}(${AMOUNT.source})${GAP}$` ``.

No change needed in `i18n/**`, `theme/**`, `api/**`, `auth/**`.

## iOS only

- Tracking prompt: asked ~1.5 s after the first screen settles, after a one-button primer; it now waits for the app to
  be active (P3, applied — one TestFlight pass needed). When refused, the SDK still starts but sends no member id /
  e-mail / mobile.
- Permission texts present in both languages: tracking, microphone, Face ID. No camera / photo text is needed (no
  module requests them). `SKAdNetworkItems`: Google, Meta ×2, Snap, TikTok ×2 + the AppsFlyer copy endpoints.
- No `associatedDomains`: https links never open the app.
- Notification permission prompt appears at sign-in with no primer; refusal is final.
- `userInterfaceStyle: 'dark'`: keyboards, alerts and share sheets are dark in light mode.
- `itms-apps://` is not in `LSApplicationQueriesSchemes`, so `canOpenURL` is always false (see RateUsPrompt).
- The session-token mirror file (M125 keychain workaround) sits in Documents and is part of iCloud backups.
- First launch in Arabic restarts once to apply the forced RTL (patch `expo-localization+57.0.2`): the splash shows twice.
- Not verifiable here: privacy manifest warnings, the `aps-environment` entitlement, the purchase sheet — TestFlight only.

## Android only

- `POST_NOTIFICATIONS` is declared (merged release manifest) and the `default` channel is created before the prompt;
  it matches the Firebase default-channel meta-data. targetSdk 36, minSdk 24, edge-to-edge enforced, portrait locked.
- Unused permissions in the release manifest: `SYSTEM_ALERT_WINDOW`, legacy external storage; plus the launcher-badge
  set and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (from `expo-audio`).
- `allowBackup="true"` + the plain session mirror file (see medium above).
- `AD_ID` declared; no consent step before the hashed e-mail / mobile go to AppsFlyer (see high above).
- R8 obfuscation on in release builds since M240 — release variant untested here.
- No App Links (`autoVerify`); only the `investorsclub://` scheme opens the app.
- `market://` needs a `<queries>` entry for `canOpenURL` (see RateUsPrompt).
- Hardware back: blocked on the forced-update cover (Modal), not on the lock / retired covers (it pops hidden screens).
- `predictiveBackGestureEnabled: false` and `enableOnBackInvokedCallback=false` are consistent.
- Keyboard: `windowSoftInputMode=adjustResize`; screens mix `behavior='height'` and none — for the Android-run session.

## To look at on a phone (round 3 — nothing below was run on a device)

A preview-id build shows only the «retired» cover: use a local release build made with `APP_ENV=production` against
the local mock server, or the internal Play track / TestFlight.

1. **Language switch and theme switch** («حسابي»), Android and iPhone: black with the emblem all the way — no white
   page, no blue spinner, no bare black gap, and the emblem does not jump between the reload page, the launch cover
   and the gold artwork. On Android in the first session after an install the reload itself may be plain brand black.
2. **Cold start**, dark and light theme, signed in and as a visitor: splash → gold artwork → first screen, with no
   black frame between; a visitor lands on the welcome screen without seeing the home first.
3. **Update at launch**: publish a test update, open the app. Either one longer opening screen and the new bundle,
   or the «restart» banner on the first screen — never a reload once a screen is visible. Then focus a field on the
   register form while a download is running: no reload, the banner appears.
4. **Recovery screen**: with a temporary throw in one screen's render, opened more than 10 s after launch → the
   per-screen message with «رجوع» and «إعادة تشغيل التطبيق»; «رجوع» returns to a working app, the restart starts
   clean with skeletons once. The same throw inside a root popup → the whole-app message. On Android neither may
   leave a black window. Remove the throw before any OTA.
5. **Rollback, where it still exists**: a test update that throws at module scope (or in the first render of the
   root layout), at a cold start → the app closes or restarts on the previous update, as before. A test update that
   throws in the home screen's render → the recovery screen at once, on Android and iPhone, never a black window
   and never a closed app (this is the case the review corrected).
6. **Throw inside a timer or an onPress** 15 s after launch (Android): the app stays usable and
   `adb logcat -s ReactNativeJS` shows `crash guard [fatal]`.
7. **After an update or a reload**: the first launch shows skeletons once (the cache of the older bundle is dropped),
   the next launch paints at once again.
8. **«راسل الإدارة»**: gold header, the title, a back arrow; the keyboard still keeps the field visible.
9. **Light theme, any pushed screen**: no black wedges behind the rounded top corners of the bottom bar.
10. **Root direction** (text plan 7), both languages on Android: home, a sheet (CountryPicker), a horizontal
    carousel, the native back arrow, the bottom bar — nothing mirrored. English on an Arabic-language iPhone is the
    case it targets and needs a real phone.
11. **Sign-out, then kill the app at once**: the next launch paints nothing of the signed-out member.

## Checks run

- Round 3 (2026-11-16): `npx tsc --noEmit` (whole project) → exit 0. `npx eslint` on `src/app/_layout.tsx`,
  `src/lib/reloadApp.ts`, `src/lib/crashGuard.ts`, `src/lib/queryCache.ts`, `src/components/LaunchCover.tsx`,
  `CrashScreen.tsx`, `SplashFlash.tsx`, `UpdateGate.tsx`, `ScreenTracker.tsx`, `AppLockGate.tsx`,
  `src/auth/GuestGate.tsx`, `src/i18n/direction.ts` → exit 0, no warnings. Read in `node_modules` for the design:
  expo-updates `Updates.js` / `ReloadScreenView.kt` / `ReloadScreenView.swift` (picture schemes, size, failure path),
  `IUpdatesController.kt` + `UpdatesStateContext.kt` (`initialContext.restartCount`), expo-router `useScreens.js`
  (`ErrorBoundary`, `screenErrorBoundary`), expo-web-browser `WebBrowserModule.kt` (item 33). Not done: the Node unit
  test of the restore decision (the module imports React Native), and anything on a device.
- After the review fix (first-commit rule): `npx tsc --noEmit` → exit 0 (the two errors below are gone);
  `npx eslint src/app/_layout.tsx src/lib/crashGuard.ts src/components/CrashScreen.tsx` → exit 0.
- A second `tsc` run a few minutes later (no change of mine in between) shows two errors from other sessions' edits
  in progress, left alone: `src/app/(tabs)/account.tsx(14,31)` cannot find `@/components/AppDialog`, and
  `src/components/MembershipGate.tsx(13,44)` imports `syncMembershipOnce`, which `StorePurchaseCard` does not export
  yet. `eslint` on my twelve files is still clean.
- In `lib/` this round, mine: `reloadApp.ts`, `crashGuard.ts` (new) and `queryCache.ts`. `badges.ts`, `validation.ts`,
  `notifications.ts`, `purchases.ts` and `readPosts.ts` were changed by other sessions.
- `npx tsc --noEmit` (inside `app/`, whole project, after round 2) → exit 0, no errors (the two purchase screens of
  rev-membership compile with the new `pending` status).
- `npx eslint src/app/_layout.tsx src/lib/notifications.ts src/lib/queryCache.ts src/lib/adsAttribution.ts src/lib/checkout.ts src/lib/purchases.ts src/components/UpdateGate.tsx` → exit 0, no warnings.
- `riyalPrice` anchors: a Node script with the same lines, 9 price strings (Latin and Arabic digits, LRM / RLM / ALM,
  no-break space, a dollar price) → all as expected except the trailing-mark case listed under «Problems not fixed».
- Read in `node_modules/@tanstack/query-core`: `QueryCache.clear()` removes query by query and calls the subscribers
  synchronously for each — the reason the removal write waits for a microtask.
- Final diff of my area: 7 files (`_layout.tsx`, `UpdateGate.tsx`, `adsAttribution.ts`, `checkout.ts`,
  `notifications.ts`, `purchases.ts`, `queryCache.ts`), 145 insertions, 28 deletions. Line endings stay CRLF.
- Not verified on a device: none of round 2 was run in the app (no web target; only the Android-run session has the
  emulator). Worth one pass there: sign-out then kill the app (file empty), a 404 screen (no second request), return
  from the background (refetch), and on TestFlight the tracking prompt.
- Read-only evidence: `node_modules` typings for `expo-splash-screen`, `expo-updates`, `expo-notifications`; the local
  prebuild's merged release manifest (`app/android/.../merged_manifests/release`, git-ignored) for the permission list.
- Not run: any build, OTA, Metro, emulator, or request to production. Nothing committed.
