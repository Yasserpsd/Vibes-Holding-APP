# Stores file — M7 (store accounts) + M8 (store readiness)

Working document for taking نادي المستثمرين to the App Store and Google Play.
Status lives in `docs/PROJECT_BRIEF.md` (M7/M8); this file holds the facts, checklists
and form answers so any session can continue. Nothing here switches anything to
production — every go-live step needs the owner's explicit word.

## 1. Identities (fixed facts)

- Publisher: **VIBES VENTURES COMPANY HOLDING** — D-U-N-S **98-306-4922**.
- Apple Developer + Google Play Console accounts: **info@vibesholding.com** (created 2026-10-11).
- Legal entity behind the hub: شركة المجتمع الافتراضي للاستثمار (vcmem.com).
- App ids: production **com.vcmem.investorsclub**, preview **com.vcmem.investorsclub.preview**.
- App name: production «نادي المستثمرين», preview «نادي المستثمرين (تجريبي)».
- Subscription: entitlement `membership`, product **`club_membership_annual`** (annual, auto-renewing), name «العضوية السنوية لنادي المستثمرين». Sold in-app only (CLAUDE.md rule 3).
- EAS project `41f3ea2d-5f89-4e33-87c1-ccb795d9166a`, owner `vibes-holding`, runtime 1.1.0.

## 2. Legal pages (DONE in code, this session)

The API server serves its own store-facing pages (`server/src/legal/`, Arabic + English):

- `GET /legal/privacy` — privacy policy; **declares the M33 first-party analytics** (opened
  screen names + a random device id to our own server, daily aggregates, no third-party SDK,
  no per-member browsing history).
- `GET /legal/terms` — terms of use (membership auto-renewal wording, «ليست عرضًا تعاقديًا أو ضمانًا لعوائد»).
- `GET /legal/account-deletion` — Google-required public deletion page: explains in-app
  deletion (حسابي ← حذف الحساب) and takes a request form → mails the management
  (ownership verified by e-mail before any deletion; honeypot + 5/hour per IP).

`GET /api/membership/store` falls back to `<PUBLIC_URL>/legal/terms|privacy` when
`STORE_TERMS_URL` / `STORE_PRIVACY_URL` are unset. **Store forms should use the PRODUCTION
server's URLs** once that service exists (section 3), e.g. `https://<prod-domain>/legal/privacy`.

## 3. Production environment (prepared, NOT live)

**Status (2026-10-16, done with the owner in the browser):** `club-api-prod` is UP at
`https://club-api-prod-production.up.railway.app` — `APP_ENV=production`, its own Postgres
(service name **`Postgres-DmnD`**; the rename to Postgres-prod did not stick, references use
the real name), live hub (the test site key for now — a separate production site row is still
recommended before launch), SMTP active, Paymob test keys in live mode (real keys at go-live).
Removed from the copy of the test variables: `S3_*` (5), `UPLOADS_SWEEP`, `HUB_WEBHOOK_SECRET`,
`REVENUECAT_PUBLIC_KEY_ANDROID`; `APPLE_APP_IDS=com.vcmem.investorsclub`. No users are pointed
at it: the preview app still talks to the test server, and no production build exists yet.

One Railway project, a second service next to the test one. Owner clicks in Railway; Claude preps.

| Piece | Test (today) | Production (to create) |
|---|---|---|
| API service | `vibes-holding-app-production.up.railway.app` (name says production, env is TEST) | **`club-api-prod`** → `https://club-api-prod-production.up.railway.app` (created 2026-10-16, root `/server`, branch `main`, port 8080) |
| Postgres | attached to test | its own new Postgres (never share the test DB) |
| `APP_ENV` | `test` | `production` |
| Hub | live hub, test site key | live hub, a **second trusted site row** in the hub's «المواقع» page («خادم التطبيق — الإنتاج», admin powers ticked) → its own `HUB_SITE_KEY` |
| Paymob | TEST integration 33439 / mock | the live integrations of MID 28390 (33090 card, 33089 Apple Pay) — `config.ts` refuses mock in production. Never recreate keys or touch the existing callback URLs (rule 6) |
| RevenueCat | — | production project keys + webhook → `https://<prod-domain>/api/webhooks/revenuecat` |

Variables for the production service = `server/.env.example` with: `APP_ENV=production`,
`HUB_MODE=live` + the new `HUB_SITE_KEY`, same SMTP/`NOTIFY_EMAIL` mailbox, live `PAYMOB_*`,
`REVENUECAT_*` (section 5), `GOOGLE_CLIENT_IDS` (same web client id) and `APPLE_APP_IDS`
(`com.vcmem.investorsclub`), its own S3 bucket values, `ADMIN_ORIGINS` when the dashboard
switches. Notes:

- The hub's `app_webhook_url` and the PB plugin's `pdp_bridge_webhook` each point at ONE
  server (the test one today). They move to production **at go-live only**; until then the
  production service learns changes by polling refresh. Same for the dashboard
  (`VITE_API_URL`) and the posts bucket owner (`UPLOADS_SWEEP=1` on exactly one service).
- `app/eas.json` production profile: set `EXPO_PUBLIC_API_URL` to the production domain
  once the service exists (today it still points at the test URL).
- Firebase: add an Android app for `com.vcmem.investorsclub` in project `vibes-holding`,
  download its `google-services.json`, store as an EAS **production** file variable
  (`GOOGLE_SERVICES_JSON`); FCM V1 key already on expo.dev (M42).
- Google sign-in on the production Android build: register the production keystore's SHA-1
  (from `eas credentials`) on an Android OAuth client in the same Google Cloud project.

## 4. Demo account for store reviewers

Server fact: `adminOnly = APP_ENV !== 'production'` (`auth/service.ts`), so preview/test
refuses non-admin logins by design — **the demo account works against the production
service**, which the production build points at. Registration on the live hub from the
test service is also gated (`HUB_ALLOW_TEST_REGISTRATION`).

Recipe (after the production service is up, details approved by the owner first):
1. Register through the production API (or the app's production build): name, e-mail the
   owner controls, phone, persona, password.
2. Verify with the 6-digit code mailed by the hub (one-time; later sign-ins are
   e-mail + password only — fits Apple review).
3. Activate 365 days from the dashboard: the account's page → grant (hub `admin_grant`,
   action `activate`).
4. Check on a production build (or against the production API): sign-in, member screens,
   Projects Bank, membership shows active.
5. Put the credentials in App Store Connect → App Review Information, and Google Play →
   App access → «All or some functionality is restricted» + instructions.

Agreed details (owner, 2026-10-16): e-mail **`ceo@vibesholding.com`** (the code mail lands
there), name «Store Review», persona مستثمر, phone = a number the owner picks that is NOT
registered to any existing hub account (the hub refuses a duplicate phone), a fresh strong
password kept in the store consoles only. The owner performs the registration and types the
password himself (accounts and credentials stay his); Claude preps the exact steps. Never
give reviewers an admin account.

## 5. Store consoles — checklists (owner signs in and clicks; Claude preps each step)

### App Store Connect (M7 iOS + M8)
- [ ] Accept the latest agreements; complete **Paid Apps** agreement, banking and tax forms.
- [ ] Create the app: bundle id `com.vcmem.investorsclub`, name «نادي المستثمرين», primary language Arabic, primary category Business (or Finance — owner's call; wording = business club, no promised returns).
- [ ] Subscription group «العضوية» → auto-renewable `club_membership_annual`, 1 year, price (owner), localized name «العضوية السنوية لنادي المستثمرين», description without «مجاني» (always «بدون رسوم» if ever needed).
- [ ] App Privacy answers (section 6) + privacy policy URL + Terms (EULA) URL from section 2.
- [ ] App Review Information: demo account + a note that content is Arabic, membership unlocks via the demo account.
- [ ] «Sign in with Apple» capability is already in the app config (`usesAppleSignIn`); the Services ID for web (M49 leftover) can follow later.
- [ ] RevenueCat iOS app + `REVENUECAT_PUBLIC_KEY_IOS` on the production service.

### Google Play Console (M7 Android + M8)
- [ ] Finish account verifications (D-U-N-S done), payments profile, developer page.
- [ ] Create the app: package `com.vcmem.investorsclub`, Arabic default listing.
- [ ] Monetization → Subscriptions → `club_membership_annual`, annual base plan, price (owner).
- [ ] Data safety form (section 6) + privacy policy URL; account deletion URL = `/legal/account-deletion` page.
- [ ] App access: demo account credentials + instructions.
- [ ] App content: ads «No», target audience 18+, financial features declaration (the app sells club services/membership, not regulated financial products — review the form's exact questions together).
- [ ] Internal testing track first with the production package build; production release only on the owner's word.

### RevenueCat
- [ ] Production project: Android app (`com.vcmem.investorsclub`) + iOS app, entitlement `membership`, product `club_membership_annual` attached to the current offering.
- [ ] Webhook → `https://<prod-domain>/api/webhooks/revenuecat`, Authorization header = production `REVENUECAT_WEBHOOK_AUTH`.
- [ ] Railway production: `REVENUECAT_PUBLIC_KEY_ANDROID` (`goog_…`), `REVENUECAT_PUBLIC_KEY_IOS` (`appl_…`), optional `REVENUECAT_SECRET_KEY`.

## 6. Data safety / App Privacy — draft answers (must match `/legal/privacy`)

Common facts: data encrypted in transit (HTTPS); account deletion in-app + web page; **no
ads, no tracking across apps, no third-party analytics SDK**; the M33 analytics id is a
random app-generated identifier not linked to the account.

### Google Play «Data safety»
| Category | Collected? | Shared? | Linked? | Purpose |
|---|---|---|---|---|
| Personal info → Name, Email, Phone | Yes (required for account) | No | Yes | Account management, App functionality |
| Financial info → Purchase history | Yes | No | Yes | App functionality (membership + service payments; card details stay with Google Play / Paymob) |
| Messages → Other in-app messages (advisor chat) | Yes | No | Yes | App functionality |
| App activity → App interactions (screen views) | Yes | No | **No** (random id) | Analytics |
| Device or other IDs (the random analytics id) | Yes | No | No | Analytics |
| Photos/videos (only if the profile/journey upload ships media) | per feature | No | Yes | App functionality |
- Security practices: data encrypted in transit — Yes; users can request deletion — Yes (in-app + URL).
- «Data shared»: none (processors acting on our behalf — Paymob, RevenueCat, Expo, the LLM provider — are service providers, not "sharing" in Play's sense).

### Apple «App Privacy»
- Data used to track you: **none**.
- Data linked to you: Contact Info (name, e-mail, phone), Purchases (purchase history), User Content (advisor messages, form answers), Identifiers (User ID = hub account id).
- Data not linked to you: Usage Data (product interaction — screen views), Identifiers (the random device id used only for first-party analytics).

## 7. Order of operations

1. ~~Legal pages in code~~ ✅ this session (deploys with the next push).
2. Production Railway service + Postgres + hub production site key (owner in browser with Claude).
3. Demo account: owner approves details → register on production → verify → dashboard grant → test login.
4. Consoles (section 5) with the owner; data safety forms from section 6.
5. RevenueCat production + keys on Railway production.
6. Production builds (`eas build --profile production`) — **only with the owner's explicit OK in that message** (EAS quota); iOS first needs the Apple app + certificates.
7. Launch = owner's word only. Current environment stays TEST until then.
