# rev-services — الخدمات، النماذج الديناميكية، الطلبات، برنامج الممثلين

Area: `services`, `service/[key]`, `form/[key]`, `requests`, `affiliate/*`, `ServiceCard`, `ServiceTile`, `FormEmbed`, `FormField`, `FormFileField`, `components/form/*`. All 15 files read once.

## Fixed

- `components/FormEmbed.tsx` — every required field now fails INSIDE its own field (red border + the message in the member's language: `form.error.required` / `form.error.choose` / `form.agree` / `form.error.email`), with the red summary on top (`ErrorSummary`) and a scroll to the first red field (new optional `scrollRef` prop, passed by `form/[key].tsx`). The line under the button still names the first problem for a long form. Typing in a field clears its red state and the stale line.
- `components/FormEmbed.tsx` — phone and e-mail fields are forced left-to-right even when the server forgets `latin`, with `phone-pad` / `email-address` keyboards, `textContentType` and `autoComplete`; e-mail shape is checked before sending.
- `components/FormEmbed.tsx` — a failed submit showed `error.message` raw (an English «Network request failed» on a plain network error); now `errorMessage()` (member's language).
- `components/FormEmbed.tsx` — a once-only form no longer flashes the empty form before «already sent» (waits for the member's own submissions); after success the page scrolls back to the top where the confirmation is.
- `components/FormField.tsx` — an error or warning on a field inside a paper sheet now uses the light palette's red (`FieldError`) instead of the dark-theme token red; every input gets `accessibilityLabel={label}` (screen readers).
- `components/FormFileField.tsx` — shows the accepted types + 25 MB cap above the picker, and a specific message for an unsupported type, both through `tOptional` so nothing breaks before the two new strings exist (see below).
- `app/form/[key].tsx` — a form key that no longer exists (404) shows a proper not-found state with a button to the services, not a retry; the screen owns the `scrollRef`.
- `app/service/[key].tsx` — same not-found state for a deleted service (old deep link / notification); `pay()` ignores a second tap while paying; the WhatsApp handover cannot report the same request to the management twice and no longer leaves an unhandled rejection if WhatsApp cannot open.
- `app/services/index.tsx` — pull-to-refresh, an empty state when the list has no services, a stale comment removed.
- `components/ServiceTile.tsx` — the English saving line «Save 1,000 SAR with your membership» was cut to «Save 1,000 SAR with your memb…» on a half-width tile; English now reserves two lines (read at render time).
- `components/ServiceCard.tsx` — `accessibilityRole="button"` + the title as label.
- `app/requests/index.tsx` — pull-to-refresh; no sign-in prompt flashing while the account is still restoring (`status === 'loading'`); an unknown status/kind from a newer server no longer renders a raw key / a «?» icon / an undefined colour; English title falls back to the Arabic one instead of an empty line; the amount keeps thousands separators and halalas; «افتح الصفحة» now has a 44 pt tap target.
- `app/affiliate/index.tsx` — pull-to-refresh (the only way to see an approval or a new referral without leaving the screen); the link and the short code are `selectable` (long-press copy on iOS and Android — no clipboard package is installed); the share button falls back to the plain link when an older server sends no `shareText` (was a dead button); no sign-in flash while loading.
- `app/affiliate/apply.tsx` — no sign-in flash while loading; after sending, `router.back()` falls back to `/affiliate` when there is nothing behind the screen (deep link).
- `app/affiliate/payout.tsx` — the payout form only checked «not empty»: now the same checks as the application (English account name, Saudi IBAN with mod-97, bank name) with red messages under each field, the IBAN is normalised before sending, double submit is blocked, and a guest or a not-approved account (old link) is redirected to `/affiliate` instead of a blank screen.

### Second round — the coordinator's decisions (M241), all applied

- **Decision 1** — everything first applied before the "choices go to the coordinator" rule stays: pull-to-refresh on the three screens, the e-mail shape check, the payout checks and redirect, scroll-to-top after a successful submit, the once-only wait, the share fallback, `selectable` link and code.
- **Decision 2, required mark** — `components/form/FormParts.tsx`: new `RequiredMark` (a small « *» in the form theme's error red, inside the label's own Text). `components/FormField.tsx`: new `required` prop. `components/FormEmbed.tsx`: every required text / textarea / select / file field wears it, the consent box does not. `components/FormFileField.tsx`: new `required` prop. `app/service/[key].tsx`: the request-detail fields of a service wear it too (they are all required, see decision 4).
- **Decision 3, upload progress and cancel** — `api/forms.ts`: `uploadFormFile(formKey, file, { onProgress, signal })` now runs through `FileSystem.createUploadTask` (progress 0 to 1, cancel through an `AbortSignal`, rejects with the new `UploadCancelledError`). A binary without the task's native methods (`uploadTaskStartAsync` / `networkTaskCancelAsync` on `ExponentFileSystem`), or a task that cannot start (`ERR_UNAVAILABLE` / a missing listener), falls back to the present `uploadAsync`. `components/FormFileField.tsx`: «جارٍ رفع الملف… 45%», a thin progress bar, and an «إلغاء» button (`common.cancel`); cancelling frees the field at once and a late answer is ignored; leaving the form aborts the upload.
- **Decision 4, WhatsApp check** — `app/service/[key].tsx` `handOver`: the first empty request field is named with `form.missing` and WhatsApp does not open (nothing is reported to the management for an empty request).
- **Decision 5** — `form.file.hint` and `form.file.badType` exist in both tables now; the `tOptional` calls stay and show them.
- **Decision 6, amounts** — `app/requests/index.tsx`: the private `sarAmount` is gone, `formatSar` from `@/lib/format` instead. `app/affiliate/index.tsx`: balance, withdrawn, commission (three sentences), bonuses, the cycle allowance (two sentences) and each payout amount use `formatSar`; the counts (members, days, target, cycle number) stay `formatNumber`. `app/affiliate/payout.tsx`: the amount to withdraw uses `formatSar`.

### Third round — two findings of the Android emulator run (both are in `components/ServiceTile.tsx`; the run named `ServiceCard.tsx`, but both screenshots show the grid tile)

- **Item 39** (`services-ar-dark.png`) — a tile without a price and without a saving no longer draws the gold filament and the two empty reserved lines under its summary; a price without a saving no longer keeps an empty second line. The inner pressable now fills its wrapper (`press: { flex: 1 }` — it was missing, which is why the two tiles of a row were already 6 pt apart in the screenshot), so every card reaches the height of the tallest tile in its row and the grid stays even.
- **Item 26** (`home1-en-dark.png`) — in English the call-to-action pill takes a second line («Start your / consultation», «Request your / meetup») instead of ending in «…»; it sits beside the 42 pt icon ring, so the tile is no taller. Arabic keeps its one-line pill, untouched (the wrap styles apply in English only).

### Fourth round — final emulator pass, item 1 (`final-font200-service-en-dark.png`)

- `app/service/[key].tsx` — the savings pill under the price («Save 15,000 … with your membership») ran past the right edge with a 200% system font. It is now never wider than its column (`maxWidth: '100%'`), its sentence wraps inside it in both languages (`flexShrink: 1`, no `numberOfLines`), and the radius is 16 pt — the same full pill on one line, a rounded box when wrapped. `tsc` exit 0 (the earlier `RichText.tsx` errors are gone), `eslint` exit 0. Not re-shot on the emulator.

## Problems not fixed

- **medium — `meetup/[key].tsx` renders `FormEmbed` without `scrollRef`** (rev-community applies it): the red fields and summary work there, only the auto-scroll to the first error waits for `<Screen scrollRef={scrollRef}>` + `<FormEmbed … scrollRef={scrollRef} />`.
- **low — required marks on `affiliate/apply` and `affiliate/payout` were NOT added.** Every field there is required, and the city picker (`OptionPicker`, not my file) cannot take the mark, so a partly starred form would make the city look optional. Proposal: leave these all-required forms without marks, or give `OptionPicker` a `required` prop and star all of them.
- **low — the plain-upload fallback cannot stop half-way.** On a binary without the upload task the «إلغاء» button frees the field and discards the result, but the bytes keep going until the upload ends.
- **low — `request.note` (management note) may be Arabic in the English app.** The affiliate notes follow the M239 rule (hidden when Arabic in English); the requests list shows the Arabic note as it is, because hiding it would also hide real information. Better: the server sends `noteEn`.
- **low — `affiliate/index.tsx`:** an `approved` status without a `balance` object falls to the «not applied» pitch; `introText` / `agreementText` come from the server and must be English from the server in English mode (not checked here).
- **low — keyboard on Android.** `Screen` uses `KeyboardAvoidingView` with `behavior` undefined on Android (relies on the window resizing). On an edge-to-edge build this should be verified on the emulator with a long form (`form/[key]`, `affiliate/apply`): the focused field and the submit button must stay visible. I did not touch `Screen`.
- **low — `FormFileField`:** when a file is picked from iCloud / Google Drive the picker may report no `size`; the 25 MB check then passes and the server answers with its own refusal (shown as the generic failure line). Fine in practice.

## Shared-file changes needed

Done by the coordinator or by me in the second round: the two `form.file.*` strings, the `affiliate.homeNudge` wording, `formatSar` in `lib/format.ts`, and `api/forms.ts` (edited by me with the coordinator's permission). Still open:

1. `app/src/app/meetup/[key].tsx` — pass `scrollRef` to `Screen` and to `FormEmbed` (rev-community).
2. Optional: `components/OptionPicker.tsx` — a `required` prop rendering `<RequiredMark />` inside its label, if the all-required affiliate forms should be starred.

## Checks run

- `cd app; npx tsc --noEmit` → exit 0, no errors (last run after the second round's final edit; other sessions' edits were in the tree).
- `npx eslint` on all 14 files I changed (`api/forms.ts`, `services/index`, `service/[key]`, `form/[key]`, `requests/index`, `affiliate/index|apply|payout`, `ServiceCard`, `ServiceTile`, `FormEmbed`, `FormField`, `FormFileField`, `form/FormParts`) → exit 0, no warnings.
- Third round (2026-11-16): `npx eslint src/components/ServiceTile.tsx` → exit 0. `npx tsc --noEmit` → exit 2 with three errors, none in my files: `src/components/advisor/RichText.tsx(19,15)` `Cannot find name 'textDir'` and `(158,48)`, `(188,26)` `Cannot find name 'START_EDGE'` — another session's edit in progress (the file is modified in the tree); left untouched.
- Not run: any device or emulator (not allowed for this session; the app has no web target). Behaviour above is from reading the code and the `expo-file-system` 57.0.7 source. To eyeball once on a device before the 1.3.4 build: a real upload on both platforms (percentage moves, «إلغاء» stops it, a second pick works after a cancel), the FormEmbed scroll-to-first-error, the Android keyboard on a long form, and the long-press copy on the affiliate link.
- Copy scan of my files: no «مجاني / مجانًا / مجانية», no hyphen-minus between numbers, no colloquial Arabic added.
