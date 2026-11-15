# rev-api — app ↔ API contract, hard rules, live smoke test (2026-11-15)

Scope: `app/src/api/**` (edited), `server/src/**` (read only), read-only GET smoke test against the test and the production API.

## Fixed

- `app/src/api/client.ts:115-120` — a 2xx answer with an empty or non-JSON body threw a raw `SyntaxError`; it is now a typed `ApiError` (`bad_response`) like every other failure.
- `app/src/api/queries.ts:68-86,94-99` — the wallet card («رصيد بنك المشاريع» on home, account and services) kept the old balance after a project was unlocked: the card sits on tabs that stay mounted and nothing invalidated `['projects-wallet']`. `projectsApi.unlock` now makes every mounted wallet card refetch.
- `app/src/api/queries.ts:86` — the wallet key now carries the membership status: after buying the membership the card no longer answers «فعّل عضويتك» from a cached `isMember: false` for up to a minute.
- `app/src/api/agenda.ts:67-82,111-130` — agenda keys now carry the account (`['agenda','list',account]`, `['agenda','event',id,account]`, ticket, recordings). Fees, `mine`, `mustPay`, the ticket and the recordings are per account; a guest who signed in saw guest prices and «not registered» from the still-fresh cache. Prefix `['agenda']` invalidations (register, SyncPoller) still match.
- `app/src/api/content.ts:233` — `useAccountKey` exported (the agenda hooks use it).
- `app/src/api/payments.ts:22` — `Payment.provider` gains `'hub'` (the server lists website payments with it).
- `app/src/api/posts.ts:22` — `Post.kind` gains `'popup'` (reachable by id from a push or a link).
- `app/src/api/payments.ts:60-77` (coordinator decision, round 2) — `usePayment` stops polling a payment that is still `created` after 10 minutes on the screen. The last state stays; opening the screen again or pulling to refresh asks the server again. Both callers (`checkout/[id].tsx`, `payment/[id].tsx`) are unchanged.
- `docs/reviews/2026-11-15/error-codes.json` (coordinator decision, round 2) — 55 `errors.code.<code>` entries with an Arabic and an English sentence each, for the coordinator's merge script. None of the 55 keys exists in `ar.json` or `en.json` today. See problem 2 for two notes on the merge.

## Problems not fixed

### Medium

1. **The test server holds LIVE Moyasar keys.** `GET https://api-test.vibesholdingsa.com/health` answers `payments: { mode: "live", gateway: "moyasar", keys: "live" }`. A service payment tried in a preview build is a real charge. Left: an environment decision (Railway variables) for the coordinator. Proposed: if it is intended, nothing to do; otherwise club-api-test gets a `sk_test_` key.
2. **English app: about 50 member-facing server error codes have no English sentence.** The server writes every error message in Arabic (checked live: `x-app-lang: en` still gets the Arabic text), so the English app shows the general «something went wrong» unless `errors.code.<code>` exists (`client.ts`, `localMessage`). Missing: `totp_bad_code`, `totp_locked`, `totp_expired`, `totp_code_needed`, `totp_required`, `already_registered`, `closed`, `full`, `not_cancellable`, `wallet_exhausted`, `already_voted`, `poll_closed`, `membership_required`, `not_member`, `phone_proof_required`, `phone_proof_busy`, `phone_no_whatsapp`, `phone_code_off`, `invite_code`, `invite_unavailable`, `short_code`, `short_code_taken`, `affiliate_exists`, `agreement_pending`, `not_affiliate`, `no_application`, `no_balance`, `payout_min`, `payout_open`, `store_unavailable`, `social_token`, `social_off`, `invalid_email`, `invalid_field`, `invalid_media`, `media_processing`, `unsupported_type`, `message_too_long`, `empty_message`, `already_requested`, `no_credit`, `exhausted`, `expired`, `not_started`, `not_payable`, `not_confirmed`, `persona_unsupported`, `update_required`, `pb_unreachable`, `pb_error`, `hub_not_supported`. Left: `app/src/i18n/**` belongs to another session. A screen that prints its own sentence for one of these is not affected.
   **Round 2:** the sentences are written in `docs/reviews/2026-11-15/error-codes.json` (these codes plus rev-auth's `totp_off`, `totp_mandatory`, `phone_first_reopen`, `social_keys`). Two notes for the merge: (a) in the English app a table sentence wins over the server's own text, so `errors.code.closed` replaces a form's own English «closed» text (`content/en/forms.ts`) with the general «Registration is currently closed.» when a closed form is submitted; (b) `exhausted`, `expired` and `not_started` are the discount-code sentences (`discounts/service.ts:203-206`), the only place the server sends those codes. In the Arabic app the server's own sentence still shows first; the Arabic entries are the fallback.
3. **No refetch when the app comes back to the foreground.** `focusManager` and `onlineManager` are never wired (no match in `app/src`), so TanStack's refetch-on-focus and refetch-on-reconnect never fire on a phone. Tabs stay mounted, so account data (payments, HQ visits, requests, contact thread) stays as it was until a pull-to-refresh; only what `SyncPoller` watches refreshes by itself. Left: the fix is in `app/src/app/_layout.tsx`, not mine.
4. **Sign-in does not refresh what the guest already loaded.** `AuthProvider.signIn` removes only `['posts']` and `['post']`. Keys without the account (`['person', id]`, `['people']`, `['form', key]`, `['interests']`, `['projects', { mine: '1' }]`) keep the guest answer until it goes stale. Left: `app/src/auth/**` is not mine; it is one line.
5. **Every 4xx is requested twice.** `retry: 1` (`_layout.tsx:51`) also retries 401, 403, 404 and 426 one second later. It doubles failing calls and delays the error state by a second. Left: `_layout.tsx` is not mine.
6. **`/health` is public and says a lot.** Hub host, admin OTP and TOTP state, push token counts, backup times and sizes, storage endpoint, video CDN host and library id; on test also a key fingerprint and the gateway key mode and length. No secret value, but more than a stranger needs. Left: a server change (`server/src/app.ts:591`). Proposed: keep `{ ok, env, time }` public and move the rest behind `dashboardGuard`.

### Low

7. **Any 401 on a call that carried the session token signs the member out, except `bad_login`** (`client.ts:113`). The server passes hub statuses through unchanged (`auth/guard.ts:33`), so a hub 401 with another code on a signed-in call would end the session (the mock hub answers `no_account` 401 on a profile update for an account without a password). Not seen live. Left: sign-in semantics. Proposed: sign out only for `unauthorized` and `session_expired`, or turn hub 401s on session routes into 409 inside `guard()`.
8. **User-specific pages outside `/api/` send no `Cache-Control`:** `/pay/invoice/:id` (name and amounts) and `/pay/return`. Nothing caches them today: no CDN sits in front, only Railway's edge. Proposed: `no-store` on `/pay/*` in `server/src/payments/routes.ts`.
9. **`/api/workshop-ad` (`public, max-age=600`) and `/api/markets` (`public, max-age=30`) override the global `no-store`.** Both are the same for everybody, so rule 8 holds; they are the only two `/api/` answers a proxy may keep.
10. **The persisted query cache keeps account-shaped answers on disk for up to 24 hours** (`lib/queryCache.ts`, `KEEP_ROOTS`): `posts` (targeted messages), `agenda` (the ticket with name and QR, signed recording links), `partners` (the member's promo code). Sign-out clears the cache and the file is rewritten one second later; an app killed inside that second leaves the file for the next launch. Proposed (file not mine): write the empty snapshot at once when the cache is cleared, and keep the ticket and recordings queries out of the file.
11. **`usePayment` polls every 3 seconds for as long as a payment stays `created`** (`payments.ts:63`): an abandoned checkout left open polls without end. **Applied in round 2** by the coordinator's decision (see «Fixed»).
12. **No HSTS header** on either API host. Phones always call https; it matters only for the browser pages (`/pay/*`, `/legal/*`).
13. **`membership.activationNote` on production still says the in-app subscription «يتوفر مع الإصدار القادم»** while the store config is live. It is dashboard copy, shown by `MembershipStatusCard`. Proposed: the coordinator checks the wording against the live subscription and updates it from the dashboard.
14. **`server/src/config.ts:50` and `server/.env.example:159`** carry two real account e-mails as the default of `PHONE_CODE_EXEMPT` (the store-review accounts). Not a secret; a default that skips the WhatsApp code is better kept in Railway variables only.

15. **A request that hits its deadline carries the same code as no connection** (`client.ts:93`, code `network`). No screen reads the code today, so the member sees nothing wrong. Not applied: it is a choice, not a defect (I applied it and took it back after the coordinator's rule). Proposed: set a flag in the deadline callback (`client.ts:82`) and throw the code `timeout` when it fired, same sentence.

### Checked and found correct

- **Rule 8:** one root hook sets `no-store` on every `/api/*` answer (`server/src/app.ts:188`), errors included (confirmed live on 404, 400 and 401).
- **Rule 4:** `toPublicProject` picks fields one by one; whatsapp, email, website and pitch deck are never copied, and phones, e-mails, links and «المؤسس:» lines are cut from the free text (`projectsBank/mapper.ts:129`). The search index, the kv snapshot, the brief and the advisor context are built from that public shape. Contact data exists only in `/api/projects/:id/access` and `/unlock`, for a project the Projects Bank itself lists as unlocked for that member. Live: list, search, golden, discover and detail carry only `hasPitchDeck` (a boolean) and `contactRule`.
- **Rule 5:** Paymob settles only in `handleWebhook` after `verifyWebhook` (HMAC, amount compared); Moyasar re-reads the invoice from Moyasar's API; the return page and the app only read the stored status. With Moyasar live, the Paymob webhook secret is a random value.
- **Rule 3:** no service sells the membership; website payments are listed with an empty `checkoutUrl`; `/api/membership/store` returns the store product and RevenueCat public SDK keys only.
- **Rule 7:** title, snippet, URL, image and time come from the feed or the source page; OpenAI returns `topics`, `decision`, `business_angle` and `relevance` only.
- **Rule 1:** no key-like value in tracked files. The matches are fake values in tests and RevenueCat public SDK keys in `docs/`. `server/.env`, `.env.admin.local`, `.secrets.local/`, `.rc-webhook-auth.local` and `app/.env` are git-ignored.
- **Client:** every request carries the token, `x-app-lang`, `x-app-platform`, `x-app-gate`, `x-app-version` and `x-app-binary`; deadlines are 15 s for reads and 30 s for writes; nothing is logged. This design has no refresh token: a rejected session signs out once (`token === currentToken` stops a storm), and sign-out clears the whole query cache.
- **Paths and methods:** all 140 app calls have a server route with the same method and path (script over both source trees).
- **Shapes:** every public answer matches the app's types, and the Arabic and English answers have the same shape on both hosts.
- **Older clients:** the deliberate shims are in place (`x-app-gate`, `founderName: null` kept in the type, `phone_code_whatsapp_only` for bundles before M204, no proof means no block in the update gate). Nothing found that breaks runtimes 1.2.0 to 1.3.3.

### Coordinator decisions, round 2

- Not now, not applied: problem 15 (the `timeout` code) and problem 7 (the 401 sign-out rule).
- Server items (problems 6 and 8, and anything else under `server/`) go to the coordinator's separate server pass. Nothing was edited in `server/`.

## Shared-file changes needed

1. `app/src/app/_layout.tsx:51` — the query defaults:
   - old: `queries: { staleTime: 60_000, retry: 1 },`
   - new: `queries: { staleTime: 60_000, retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) },` (import `ApiError` from `@/api/client`).
2. `app/src/app/_layout.tsx` — after the `queryClient` constant, wire the foreground refetch (no new package; `focusManager` from `@tanstack/react-query`, `AppState` from `react-native`):
   ```ts
   focusManager.setEventListener((handleFocus) => {
     const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
     return () => subscription.remove();
   });
   ```
3. `app/src/auth/AuthProvider.tsx:120-121` — in `signIn`, after the two `removeQueries` lines, add `void queryClient.invalidateQueries();` so every mounted screen asks again as the member.
4. `app/src/i18n/strings/en.json` (and `ar.json` for parity) — add `errors.code.<code>` for the codes in problem 2.
5. `app/src/lib/queryCache.ts` — problem 10: flush at once when the cache is empty; skip the ticket and recordings queries.

## Checks run

- `npx tsc --noEmit` in `app/` → exit 0 (run again after round 2).
- `npx eslint src/api` in `app/` → exit 0 (run again after round 2).
- `error-codes.json`: parsed by Node; 55 keys, every one has `ar` and `en`, none already in `ar.json` or `en.json`, no Arabic inside an English sentence, none of the forbidden words.
- Route match: a script over `app/src` and `server/src` → 140 app calls, 140 matched (302 server routes).
- Secrets scan: `git grep -I -E` over tracked files for `sk_live` / `sk_test`, `sk-…`, `AIza…`, `AKIA…`, GitHub and Slack tokens, private-key blocks, JWTs, `appl_` / `goog_`; locations only, values masked.
- Live smoke test: 184 GET requests (92 per host), no sign-in, no admin route, no POST, about 3 per second. Test: median 291 ms, slowest 852 ms. Production: median 127 ms, slowest 498 ms. Another 13 GETs on test for error shapes and 6 for headers.
- Side effects of the smoke test, for the record: `GET /api/news/:id` counts a news read (2 on production, 2 on test) and `GET /api/app/status` counts a launch in the version statistics (2 on each host). `/api/projects/:id/brief` was not called: its first call spends an AI request.

### Smoke-test table

Status and time are Arabic / English. Every 200 row matched the app's types in both languages. `/api/health` does not exist (the app never calls it; the route is `/health`). On test, the English decisions list was empty (data, not shape).

| Route | test ar/en | prod ar/en | ms test (ar/en) | ms prod (ar/en) | Cache-Control |
|---|---|---|---|---|---|
| `/health` | 200/200 | 200/200 | 852/261 | 498/113 | none |
| `/api/health` | 404/404 | 404/404 | 285/248 | 100/96 | no-store |
| `/api/app/status?version=1.3.3&binary=1.3.2` | 200/200 | 200/200 | 444/281 | 130/123 | no-store |
| `/api/strings?lang=*` | 200/200 | 200/200 | 302/277 | 114/275 | no-store |
| `/api/auth/config` | 200/200 | 200/200 | 292/269 | 123/141 | no-store |
| `/api/home` | 200/200 | 200/200 | 291/278 | 119/127 | no-store |
| `/api/membership` | 200/200 | 200/200 | 368/348 | 182/116 | no-store |
| `/api/membership/store` | 200/200 | 200/200 | 286/282 | 154/114 | no-store |
| `/api/about` | 200/200 | 200/200 | 335/317 | 219/119 | no-store |
| `/api/guide` | 200/200 | 200/200 | 309/305 | 139/117 | no-store |
| `/api/meetups` | 200/200 | 200/200 | 297/291 | 137/113 | no-store |
| `/api/services` | 200/200 | 200/200 | 391/497 | 174/126 | no-store |
| `/api/images` | 200/200 | 200/200 | 288/302 | 159/107 | no-store |
| `/api/golden` | 200/200 | 200/200 | 317/367 | 143/112 | no-store |
| `/api/news/topics` | 200/200 | 200/200 | 285/304 | 110/119 | no-store |
| `/api/news/feed?page=1&limit=5` | 200/200 | 200/200 | 248/281 | 140/113 | no-store |
| `/api/news/feed?scope=home&page=1&limit=8` | 200/200 | 200/200 | 308/407 | 204/120 | no-store |
| `/api/news/number` | 200/200 | 200/200 | 257/278 | 314/110 | no-store |
| `/api/news/decisions?page=1&limit=5` | 200/200 | 200/200 | 282/252 | 231/117 | no-store |
| `/api/projects?q=&sort=latest&page=1&limit=5` | 200/200 | 200/200 | 463/347 | 277/104 | no-store |
| `/api/projects?q=<ar word>&sort=top&page=1&limit=5` | 200/200 | 200/200 | 329/278 | 160/123 | no-store |
| `/api/projects?q=&sort=golden&page=1&limit=5` | 200/200 | 200/200 | 275/278 | 165/120 | no-store |
| `/api/projects?q=&sort=discover&page=1&limit=5` | 200/200 | 200/200 | 260/286 | 133/130 | no-store |
| `/api/projects/filters` | 200/200 | 200/200 | 294/282 | 102/118 | no-store |
| `/api/videos?page=1&limit=5` | 200/200 | 200/200 | 337/340 | 135/119 | no-store |
| `/api/agenda` | 200/200 | 200/200 | 416/417 | 188/133 | no-store |
| `/api/posts?limit=5` | 200/200 | 200/200 | 277/273 | 107/116 | no-store |
| `/api/popups` | 200/200 | 200/200 | 281/306 | 152/167 | no-store |
| `/api/people` | 200/200 | 200/200 | 285/437 | 169/133 | no-store |
| `/api/partners` | 200/200 | 200/200 | 285/305 | 135/115 | no-store |
| `/api/markets` | 200/200 | 200/200 | 322/363 | 235/109 | public, max-age=30 |
| `/api/sync` | 200/200 | 200/200 | 279/297 | 193/112 | no-store |
| `/api/discounts/active` | 200/200 | 200/200 | 432/278 | 113/118 | no-store |
| `/api/workshop-ad` | 200/200 | 200/200 | 286/264 | 120/119 | public, max-age=600 |
| `/api/interests` | 200/200 | 200/200 | 253/268 | 145/111 | no-store |
| `/api/badges` | 200/200 | 200/200 | 298/364 | 175/128 | no-store |
| `/legal/privacy` | 200/200 | 200/200 | 262/294 | 131/127 | none |
| `/legal/terms` | 200/200 | 200/200 | 257/252 | 115/124 | none |
| `/legal/account-deletion` | 200/200 | 200/200 | 291/277 | 145/129 | none |
| `/api/projects/:id` | 200/200 | 200/200 | 266/318 | 135/116 | no-store |
| `/api/projects/:id/reviews` | 200/200 | 200/200 | 279/278 | 130/135 | no-store |
| `/api/golden/offer/01` | 200/200 | 200/200 | 299/380 | 128/116 | no-store |
| `/api/news/:id` | 200/200 | 200/200 | 266/294 | 114/134 | no-store |
| `/api/videos/:id` | 200/200 | 200/200 | 259/269 | 110/132 | no-store |
| `/api/agenda/:id` | 200/200 | 200/200 | 275/284 | 115/149 | no-store |
| `/api/services/meetup` | 200/200 | 200/200 | 350/364 | 117/153 | no-store |
