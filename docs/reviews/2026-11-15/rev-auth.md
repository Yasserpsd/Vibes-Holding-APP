# rev-auth — sign-in, sign-up, profile and account security (2026-11-15)

Scope: every file on the rev-auth list was read once (6 auth screens, welcome / persona / phone-confirm / profile-edit / security x3 / delete-account, `auth/**`, 17 components). Outside them only targeted greps (api/auth.ts, api/client.ts, lib/appLock.ts, lib/validation.ts, i18n/direction.ts, server auth routes and service, hub/phone.ts, expo-router query parsing, Screen/FormField).

Three rounds: (1) the review and the clear fixes; (2) a re-check of every claim at the owner's request, with corrections; (3) the coordinator's decisions, applied.

All paths below are under `app/src/`.

## Fixed

### Round 1 — clear defects

- `app/security-2fa.tsx:121,128-135` — the two-factor screen offered «تفعيل» (and showed «غير مفعّلة») while the status request was still loading or had failed, so an account that already had 2FA on was offered «تفعيل» and then met a confusing server refusal (`totp_code_needed`). Now the state shows «…» until the server answers, a failed request shows the error with a retry button, and the action buttons appear only once the real state is known.
- `components/DeletionBanner.tsx:30-45` — «تراجع عن الحذف» had `try/finally` without `catch`: offline or a server refusal became an unhandled promise rejection and the member saw nothing. Now the error text shows inside the band.
- `app/delete-account.tsx:98` — after the deletion is scheduled, `['delete-state']` is invalidated. The countdown band of حسابي (`app/(tabs)/account.tsx:113`) had already cached «not scheduled», the tab stays mounted and no refetch-on-focus is wired, so a member returning saw no countdown and no «تراجع» door until something else refetched it.
- `components/VoiceFill.tsx:70-87` — `start()` (permission, audio mode, `prepareToRecordAsync`) had no `try/catch`: a busy microphone or refused audio session was an unhandled rejection with a dead button. Now it ends in an alert with the message.
- `components/CountryPicker.tsx:85-88` and `components/OptionPicker.tsx:64-67` — the search sheet auto-opens the keyboard, and on iOS the sheet (75% of the screen, centred) keeps its lower part behind the keys, so the last rows of the 198-country list (and of the city list) are reachable only after the member dismisses the keyboard or searches. Found by reading the layout, not seen on a device. The sheet is now wrapped in `KeyboardAvoidingView` (same `padding` / `height` pattern as `PasswordPrompt`). Android was not affected: React Native's Modal window already resizes for the keyboard (`ReactModalHostView.kt:332`, `SOFT_INPUT_ADJUST_RESIZE`).
- `components/CountryPicker.tsx:25,37,68` + `components/LoginIdentifier.tsx:92` — new `disabled` prop; in the reset-password «confirm» step the identifier is locked, but the country picker beside the number still opened, and a different country changes the normalised login the server looks up (`normLogin(login, country)`), so the confirm call failed. It is now locked with the rest.
- `components/LoginIdentifier.tsx:78` — the phone / e-mail switch pills were 36 pt high; `hitSlop` brings the tap target to 44 pt without changing the look.
- `components/PhoneConfirmAlert.tsx:125,130,138` — «إعادة الإرسال» and «رقمي غير صحيح» were 20 pt tap targets in the code row and 28 pt before it (caption line 20 pt, 4 pt padding); `hitSlop={12}` makes them 44 and 52 pt.
- `components/WhatsappVerify.tsx:217` — «رقمي غير صحيح» was a bare `<Text onPress>`; now a `Pressable` with `hitSlop={12}`.
- `app/auth/phone.tsx:43-54` — a code screen opened without its `stepToken` (stale link, restored screen) rendered a form that could only fail. It now shows the timed-out notice with «العودة لتسجيل الدخول», like the 2FA screen.
- `app/welcome.tsx` — the full-screen theatre photo goes through `sized()`. Checked with a GET on `api-test…/api/hq`: the HQ photos are `/media/posts/…` links, so the resized WebP variant is really used.
- `app/profile-edit.tsx` — `autoCorrect={false}` on the contact e-mail, website and social-link fields, as the sign-up e-mail field already has. A precaution: no wrong correction was observed on a device.

### Round 3 — the coordinator's decisions

- **1. `components/AppLockGate.tsx:14,24,37-50,73-75`** — the gate starts covered: `locked` is `null` until the saved setting is read (bare cover, no prompt, nothing to press), `false` opens, `true` locks and asks for the face/fingerprint. A read that throws means «not locked», and a watchdog opens the cover after 4 s if the read never answers, so the member is never trapped.
- **2a. `auth/AuthProvider.tsx:134`** — `signIn` ends with `void queryClient.invalidateQueries()`: everything a guest loaded is asked again as the member.
- **2b. `auth/storage.ts:54` + `auth/AuthProvider.tsx:61`** — `clearDeckFiles()` deletes every `deck-*` file in `FileSystem.cacheDirectory` at sign-out (and on a refused session); it is wrapped so it cannot throw. See «not applied» for the `removeQueries` half.
- **2c. `auth/AuthProvider.tsx:185-191`** — while the session is alive and `me === null`, coming back to the app (`AppState` → `active`) calls `refresh()`.
- **2d. `auth/AuthProvider.tsx:100,193` + `app/welcome.tsx:51` + `app/auth/login.tsx:80`** — when the opening `authApi.me` answers 401, `sessionExpired` is remembered and the gate and the sign-in screen show the existing sentence `errors.code.session_expired` in a warning `Notice`. It is forgotten on a sign-in, when the visitor chooses «المتابعة كضيف», or when the sign-in screen is left.
- **3. `app/delete-account.tsx:157`** — the hint `deleteAccount.socialHint` under `deleteAccount.warning` (the key is in both tables).
- **4. `components/PhoneCodeStep.tsx:58`** — `setCode('')` first in the `catch`.
- **5. `app/profile-edit.tsx:30-45,56-62`** — `splitStoredPhone()`: the picker starts on the country of the stored number. The hub shows a Saudi number as 05… (or its nine digits) and every other country as dial code + number (`server/src/hub/phone.ts` `phoneLocal`); the longest dial code whose remainder fits the country's length wins, `sa` when nothing matches or the country list has not arrived. The field shows the national digits of that country, and an untouched number is still not sent.
- **6. `app/auth/reset.tsx:21,37-42,63,149-160`** — «أعد الإرسال» counts down 60 s after each message with the same timer pattern and the string `auth.verify.resendIn` as the e-mail code screen; it is disabled and muted while it counts.
- **7. `components/ProfileCompleteness.tsx:45,64,150-151`** — the module-scope `I18nManager.isRTL` read is gone; `isRTL()` from `@/i18n/direction` is read while rendering and picks the arc's transparent side.
- **9. `app/auth/register.tsx:54`** — the double-encoded Arabic quote in the M212 comment is readable again (one comment line, no code change).

## Problems not fixed

**High**

1. **An Apple/Google member cannot delete the account with a password they never chose.** `delete-account.tsx` → `PasswordPrompt` → server `/api/me/delete/start` → `service.passwordMatches()`, which logs into the hub with that password. The hub gives a social-born contact «a random unusable pass_hash» (brief, M46, hub 2.8.0), and `m117.deletion.test.ts` has no social-account case. Two ways out exist (حسابي ← إعدادات الأمان sets a new password with no current-password check; «نسيت كلمة المرور» works for these accounts since M197), and since round 3 the hint on the deletion screen says so. Apple guideline 5.1.1(v) asks for deletion without a dead end; the review itself has passed so far because the reviewer's demo account has a password, so the review risk is an assessment, not an observed rejection. The real fix is the server flow the coordinator schedules separately.

**Medium**

2. **The password changes without the current password** (`security.tsx` → `updateMe({ password })`; the server's `PATCH /api/me` schema has `password` only and `server/src/auth/service.ts:883` forwards it to the hub). Anyone holding an unlocked phone with the app open can take the account over. Coordinator: not now (server flow).
3. **In the English app, 16 member-facing sign-in errors show «Something went wrong while loading the data».** The server sends the code with an Arabic message (`server/src/auth/guard.ts:33`); `api/client.ts` `localMessage` shows `errors.code.<code>` in English and falls back to `errors.generic` when the key is missing. Missing: `totp_bad_code`, `totp_locked`, `totp_expired`, `totp_code_needed`, `totp_off`, `totp_mandatory`, `phone_no_whatsapp`, `phone_proof_busy`, `phone_proof_required`, `phone_code_off`, `phone_first_reopen`, `social_off`, `social_token`, `social_keys`, `persona_unsupported`, `invite_unavailable`. The Arabic app is fine. The sentences are being written by rev-api for the coordinator to merge. Not audited: codes that come from the hub plugin itself (its source is not in this repo).
4. **An expired session found during use** (a 401 on a later request, through `setUnauthorizedHandler`) still turns the member into a guest without the new notice: round 3 covers the opening request only, as decided. The screen that made the request can show the server's sentence if it displays errors.

**Low**

5. `PhoneCodeStep` accepts exactly four digits while `verify.tsx` / `reset.tsx` accept 4–6. Coordinator: not now.
6. The session token is mirrored to a plain sandbox file next to SecureStore (M125, iOS 26 keychain loss). A documented owner decision; recorded as a conscious trade-off.
7. The Apple button is an `AppButton` with the Apple logo, not the system `AppleAuthenticationButton`. Coordinator: not now.
8. `AppLockGate`: the cover is not drawn in the app switcher (the cold-start part is fixed in round 3).
9. `profile-edit.tsx`: a member who changes only the country in the picker, with the same digits, sends nothing (`phoneChanged` compares the digits). Unchanged by round 3; proposal: count a changed country as a changed number.
10. Cosmetic: JSX indentation inside `PhoneProofField.tsx:79-89`.
11. Not verified on a device (no emulator allowed for this session): everything in this report was checked by reading the code, `tsc` and `eslint`. In particular the cold-start cover of `AppLockGate` (a bare cover now stands behind the splash for every member until the setting is read), the `KeyboardAvoidingView` inside the picker sheets on iOS, the session-expired notice on the gate, and Google sign-in on Android showing the account chooser after a sign-out.

### Coordinator items not applied

- **2b, second half — `queryClient.removeQueries({ queryKey: ['deck'] })`: not added.** Sign-out goes through `clearLocal`, which already calls `queryClient.cancelQueries()` and `queryClient.clear()` (`auth/AuthProvider.tsx:66-67`); `clear()` removes every query, `['deck']` included, so the extra line would do nothing.
- **8 — `components/DeletionBanner.tsx:65` colour: not applied.** `theme/tokens.ts` has `warning` in both palettes and no soft/background variant of it, and I may not edit `tokens.ts`. Proposal: add `warningSoft` to both palettes (dark `rgba(217, 162, 27, 0.08)`, light `rgba(184, 132, 42, 0.10)`), then `backgroundColor: colors.warningSoft` on that line.

Checked and fine: Apple only on iOS with `isAvailableAsync`, Google only on Android with a client id and Play services; cancelled Apple/Google sign-in is silent (`ERR_REQUEST_CANCELED`, `SIGN_IN_CANCELLED`, `type: 'cancelled'`); a first social sign-in goes to the sign-up form and the app creates the account only with the proven number (`socialComplete`); the name rule is a local warning plus an empty-name error, both present in Arabic and English (`form.nameWarning`, `form.error.name.empty`; the server's `nameProblem` is unused since M207); `gateMissing` filters by the bundle's own list (M168); `signOut` clears the whole query cache, the saved account file, the push token and the store identity; a 401 signs out only for the current token (`bad_login` and `bad_password` do not); biometric lock turns on only after a successful prompt, stays off when no biometrics are enrolled, falls back to the device passcode, and a missing native module returns `true`.

## Shared-file changes needed

None from this session any more:
- `deleteAccount.socialHint` was added to `ar.json` and `en.json` by the coordinator and is now used.
- The 16 English `errors.code.*` sentences (problem 3) are with rev-api.
- Optional: `warningSoft` in `theme/tokens.ts` (see «not applied», item 8).

## Checks run

- Round 1: `cd app; npx tsc --noEmit` and `npx eslint` on the changed files — no errors.
- Round 2 (owner's re-check): both again, exit 0. Every claim was compared with the code; one was wrong (English error coverage: the first grep had missed codes passed to `new AuthError(…)`) and five wordings were tightened.
- Round 3: `npx tsc --noEmit` exit 0; `npx eslint` exit 0 on the 20 files changed across the rounds (`AppLockGate`, `AuthProvider`, `auth/storage`, `welcome`, `auth/login`, `auth/reset`, `auth/register`, `auth/phone`, `delete-account`, `profile-edit`, `security-2fa`, `PhoneCodeStep`, `ProfileCompleteness`, `CountryPicker`, `DeletionBanner`, `LoginIdentifier`, `OptionPicker`, `PhoneConfirmAlert`, `VoiceFill`, `WhatsappVerify`), on the tree as the other sessions had left it at that moment.
- Greps and reads: server error codes in `server/src/auth` against `errors.code.*` in `en.json`; expo-router query parsing (`URLSearchParams` semantics, so `+` in the register link params decodes as a space); `/api/me/delete/start` password check; `server/src/hub/phone.ts` for the stored number's shape; Face ID permission and Apple/Google plugins in `app.config.ts`; one read-only GET on the test API for the HQ photo links.
- Not run: any emulator, device or Metro (not allowed for this session); the app has no web target. No git command that changes the tree; nothing committed.
