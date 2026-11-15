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
   accepted spaces (one `GAP` constant = `[\s‎‏؜]*`). Checked in Node against 9 price strings.
8. `app/src/components/UpdateGate.tsx:12,139-140` — `textAlign: 'left'` → `textAlign: textStart`.
9. `app/src/app/_layout.tsx:64,142-173` — back in the foreground with the last successful check older than 3 hours:
   check and fetch in the background, never a reload. Same guards as the launch check (optional native module, every
   failure swallowed); a failed look does not count, so the next return to the foreground tries again.

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
| **low** | **The lock and «retired» covers are plain views**: a native `Modal` opened by another component draws above them, Android's back button pops the hidden screens under them, and `AppLockGate` shows the app for a moment at a cold start (the lock setting is read asynchronously, `locked` starts `false`). | `AppLockGate.tsx` is not in my list; needs a small redesign (start covered until the setting is read). |
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

## Checks run

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
