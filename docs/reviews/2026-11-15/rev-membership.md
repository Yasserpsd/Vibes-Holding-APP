# rev-membership — membership, store purchase, service payments, member card (2026-11-15)

Scope read in full: `membership.tsx`, `checkout/[id].tsx`, `payment/[id].tsx`, `payments/index.tsx`, `card.tsx`, `invite.tsx`,
`MembershipGate.tsx`, `MembershipStatusCard.tsx`, `MembershipUpsell.tsx`, `StorePurchaseCard.tsx`, `WalletCard.tsx`, `SarText.tsx`;
read-only: `lib/purchases.ts`, `lib/checkout.ts`, `api/membership.ts`, `api/payments.ts`.

Hard-rule audit (unchanged by every edit below):
- Rule 3: no screen, error text, fallback or string in my files offers a Paymob/Moyasar link, representative link or web price for the
  membership. `checkout/[id]` and `payment/[id]` handle service payments only. Store-unavailable states say "update the app" / "try later" / "coming soon".
- Rule 5: `payment/[id]` and `checkout/[id]` show "paid" only from the server's `payment.status`; the WebView result only navigates.
  `StorePurchaseCard` and the Gate activate only from the server's `/api/membership/sync` answer, never from the store result.
  The new pending-purchase state shows a notice only; it activates nothing.

## Fixed

### Round 1 — defects with one right answer

- `components/StorePurchaseCard.tsx:189-196` — store settings failing to load (offline / server busy) showed «الاشتراك … يتوفر قريبًا» to a non-member; now the real error with a retry button («يتوفر قريبًا» only when the config loaded but this platform has no key).
- `components/StorePurchaseCard.tsx:141,157` — `buy()` / `restore()` ignore a second tap while the store sheet is opening: no double purchase sheet.
- `components/StorePurchaseCard.tsx:57` + `components/MembershipGate.tsx:205,288` — `storePriceLabel()` strips invisible RTL/LTR marks Play adds around the symbol, so `riyalPrice()` recognises «SAR 1,900.00».
- `components/StorePurchaseCard.tsx:299,304` — «استعادة المشتريات» and the Terms / Privacy links have 44 pt tap targets (were ~26 pt).
- `components/MembershipStatusCard.tsx:51` — status pill label `numberOfLines={1}`.
- `components/WalletCard.tsx:37` — while the wallet query loads (or fails) an ACTIVE member no longer sees «فعّل عضويتك لتستخدم رصيدك»; the account's own status stands in until the bank answers.
- `app/membership.tsx:33-36`, `app/payments/index.tsx:29`, `app/invite.tsx:46`, `app/card.tsx:72` — while the account is still loading from the device the screens show the skeleton, not «زائر» / «سجّل الدخول» to a signed-in member.
- `app/payment/[id].tsx:66-71` — when a payment settles the «مدفوعاتي» list cache is invalidated, so the list no longer keeps «بانتظار الدفع» for a paid payment.
- `app/checkout/[id].tsx:143-206` — missing error state: a WebView load failure (offline, DNS) was a blank iOS page / Android error page; now an overlay with `errors.network` + `common.retry` that remounts the WebView at the checkout URL. Navigations the app cancels itself are ignored via `ownCancel`.
- `app/checkout/[id].tsx:126` — bottom safe-area padding: the gateway's pay button no longer sits under the home indicator / gesture bar.
- `app/card.tsx:407,490-519` — LIGHT THEME: the always-black card used `colors.black` (near-white in light) for its frame and logo disc and `textSecondary/textMuted` (dark navy-grey) for its small text → unreadable. Frame/logo disc now a fixed black, text uses `onPhotoSoft` / `onPhotoMuted`.
- `app/card.tsx:136,140,154,495` — VIP badge, inactive badge and category pill `numberOfLines={1}`; `numberBlock` `flexShrink: 1` (a long promo code cannot squeeze the membership number off the row).

### Round 2 — the coordinator's decisions (all applied)

1. **P1** `app/checkout/[id].tsx:128` — `gestureEnabled: false`. **P2** `:243` — the amount uses `goldDark`. **P3** `app/payments/index.tsx:55` — the empty state uses the shared `StateView empty`; dead `empty` style removed.
2. **Android pending purchase** (`{ status: 'pending' }` from rev-platform's `purchases.ts`) —
   `components/StorePurchaseCard.tsx:34,87,147,216,226`: new phase `storePending` → the card stays, shows `store.pending` in the calm gold notice (no red, no support link), no price / Subscribe button, «استعادة المشتريات» still there (`restore()` returns to the phase it came from, `:156`).
   `components/MembershipGate.tsx:57,146,155-169,194-200`: same notice in the popup with a real «استعادة المشتريات» button (phase `restoring`) and Close; the Subscribe button is not rendered in this state. Nothing is activated or polled here — the server stays the only activator.
3. **Leave guard** `app/checkout/[id].tsx:62-94` — `usePreventRemove(status === 'created' && !leaving, …)` (from `expo-router/react-navigation`, the vendored React Navigation): Android back, the header back button and the gesture all raise one `Alert` with `checkout.leaveTitle` / `leaveText` / `stay` / `leave`. No question once the payment is paid or failed (guard off), nor when the app navigates: `finish()` now sets `leaving` and an effect does the `router.replace`, so the guard is already down; a `done.current` check in the callback is the second safety.
4. **Return-page match** `app/checkout/[id].tsx:20-38,178` — `isReturnPage()`: path must end with `/pay/return` AND the host must be the app's API host, or end with `.vibesholdingsa.com` or `.up.railway.app` (regex parse, no `URL` dependency; user-info and port stripped). Anything else is an ordinary navigation.
5. **Late confirmation** `app/payment/[id].tsx:46,72-83,123-128` — two minutes after the payment was created and still `created`, `payment.createdLate` + `SupportLink` appear under the waiting text (the support message carries the service name and the transaction number).
6. **Gateway reason** `app/payment/[id].tsx:98-101,130` — the «سبب البوابة» line shows only when the text is in the app's language (Arabic letters in Arabic mode, none in English mode); otherwise the general failure sentence stands alone.
7. **Gate legal text** `components/MembershipGate.tsx:209-215` + `components/StorePurchaseCard.tsx:260-282` — `store.legal` and the Terms / Privacy links (new exported `StoreLegalLinks`, shared with the card) under the price; a link closes the popup first. The popup body is now a `ScrollView` inside the card (`:178`, `popWrap maxHeight: '100%'`) so the longer popup scrolls on a short screen instead of running off it.
8. **Invoice** `app/payment/[id].tsx:103,146,152-158` — paid payment with an invoice number: a «رقم الفاتورة» row and a «عرض الفاتورة» button that opens `<API base>/pay/invoice/<payment id>` inside the app through `/webpage`. Checked in `server/src/payments/routes.ts:192` (`GET /pay/invoice/:id`, public, paid payments only, the uuid is the key) and `service.ts:510` (same path in the mailed link).
9. **`settle()` cap** `components/StorePurchaseCard.tsx:36-51,128-137` + `components/MembershipGate.tsx:108-121` — shared `syncMembershipOnce()` gives up an attempt after 8 s; an attempt that already took ≥ 3 s is not followed by the 3 s pause. Worst case is now 8 × 8 s instead of 8 × 33 s; the normal case (fast answers) is unchanged.
10. **Card gold** `app/card.tsx:47-53` and every gold use on the card — fixed `GOLD` constants (the dark palette's champagne scale) beside `SILVER`; no flipping gold token is left on the black card. **Gate `Modal`** `components/MembershipGate.tsx:173` — `statusBarTranslucent`.
11. **Duplicate payment screen** `app/payment/[id].tsx:95-97` — one line: «فتح صفحة الدفع» uses `router.replace` instead of `push`, so the checkout's own final `replace` leaves one payment screen. Side effect to know: leaving that reopened checkout with back now lands on the screen before the payment screen (the list or the service).

## Problems not fixed

- **Not now (coordinator's decision):** an «expiring soon» state on the status card / member card; moving `trackMembershipPurchase` (`lib/purchases.ts`) behind the server's activation; server-side validation that membership content (`activationNote`, `statusTexts`, WhatsApp items) carries no payment link.
- **low — server still stores raw gateway text.** The app now hides a reason that is not in the app's language (item 6), but in English mode an internal line such as `amount mismatch (999)` still shows. Proper fix is server-side: member-safe, localized `failureReason` (`server/src/payments/moyasar.ts:109`, `service.ts`).
- **low — `riyalPrice()` itself** (`lib/purchases.ts`) still misses bidi marks for any caller other than my two (see «Shared-file changes» 1).
- **low — unverified on a device** (no web target; only the Android-run session may start the emulator). Worth one pass each:
  1. checkout: Android back / header back → the leave question; «مغادرة» leaves, «البقاء» stays; after a real or mock payment the screen moves to the status screen with NO question (this is the path that must not regress);
  2. checkout opened offline → the retry overlay;
  3. Gate popup on a short phone (≤ 640 dp high) → it scrolls, nothing clipped; the Terms link closes the popup and opens the page;
  4. Play test card «slow card, approves after a few minutes» → the pending notice in the card and in the popup;
  5. member card in the light theme.
- **info — indentation.** Inside the new `<ScrollView>` of `MembershipGate.tsx` (`:178-233`) the children keep their old indentation (scripts that rewrite files were ruled out this round); lint passes, a formatter pass can tidy it.

## Shared-file changes needed

1. `app/src/lib/purchases.ts` `riyalPrice()` — the two anchors use `\s`, which does not match U+200E / U+200F / U+061C. old: `^\\s*${CURRENCY.source}\\s*(${AMOUNT.source})$` and `^\\s*(${AMOUNT.source})\\s*${CURRENCY.source}\\s*$`; new: replace each `\\s` with `[\\s\\u200e\\u200f\\u061c]`. Optional — my `storePriceLabel()` already strips the marks for the card, the popup and the home card.
2. `server/src/payments/*` — member-safe `failureReason` (above). Outside the app.
3. Already landed by other sessions and used here: `PurchaseResult` `pending` (rev-platform); the strings `checkout.leaveTitle`, `checkout.leaveText`, `checkout.stay`, `checkout.leave`, `payment.createdLate`, `payment.invoiceNo`, `payment.viewInvoice` (present in both tables).

## Checks run

- `cd app && npx tsc --noEmit` → exit 0, no errors (run after the last edit, with rev-platform's `pending` type and the other sessions' edits in the tree).
- `cd app && npx eslint src/app/membership.tsx "src/app/checkout/[id].tsx" "src/app/payment/[id].tsx" src/app/payments/index.tsx src/app/card.tsx src/app/invite.tsx src/components/MembershipGate.tsx src/components/MembershipStatusCard.tsx src/components/StorePurchaseCard.tsx src/components/WalletCard.tsx` → no output (clean).
- Read, not run: the vendored React Navigation in `node_modules/expo-router/build/react-navigation` — `usePreventRemove` is exported through `expo-router/react-navigation`; the native stack honours it (`preventNativeDismiss`, `onHeaderBackButtonClicked`, `onNativeDismissCancelled`); re-dispatching `data.action` is not prevented twice (`VISITED_ROUTE_KEYS` in `useOnPreventRemove.js`).
- i18n check (node over `ar.json` / `en.json`): every key used by my files exists in both languages; no «مجان…», «كريديت», «صفقات», «فايبز القابضة» in the membership / store / payment / card / invite / wallet / gate strings.
- Not run: emulator / device, unit tests (none exist for these screens).
- Files unchanged: `MembershipUpsell.tsx`, `SarText.tsx` (no defect found).
