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
- App name: the OFFICIAL store listing name on BOTH stores is **«Investors Club»** (owner, 2026-10-17); preview builds stay «نادي المستثمرين (تجريبي)». (The on-device launcher name can stay Arabic or follow the stores — owner decides at submission.)
- App icon: the OFFICIAL icon is the club MARK alone (the golden «i» roundel already used at the app's start) — no wordmark text (owner, 2026-10-17).
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
`STORE_TERMS_URL` / `STORE_PRIVACY_URL` are unset. **Store forms use the PRODUCTION
server's URLs — verified LIVE (HTTP 200, 2026-10-18) on both services:**

- Privacy policy URL (both stores): `https://club-api-prod-production.up.railway.app/legal/privacy`
- Terms / EULA URL: `https://club-api-prod-production.up.railway.app/legal/terms`
- Account deletion URL (Google Play form): `https://club-api-prod-production.up.railway.app/legal/account-deletion`

(The test server serves the same pages. If the owner later attaches a custom domain to the
production service, update these URLs in both consoles — they are editable any time.)

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

**Status (2026-10-16): CREATED.** The owner registered **`ceo@vibesholding.com`** on the hub
himself, it holds an ACTIVE ANNUAL MEMBERSHIP and he verified the sign-in works (2026-10-16;
an app login check waits for the first production build). It is a normal member, NOT admin
(reviewers never get admin).
The password stays with the owner and goes into App Store Connect → App Review Information and
Google Play → App access when the consoles are set up. Quick optional check: sign in with it in
the vcmem.com widget. Note: the hub refuses a duplicate phone across accounts.

## 5. Store consoles — checklists (owner signs in and clicks; Claude preps each step)

### App Store Connect (M7 iOS + M8)
- [ ] Accept the latest agreements; complete **Paid Apps** agreement, banking and tax forms.
- [ ] Create the app: bundle id `com.vcmem.investorsclub`, name **«Investors Club»** (owner's official store name, 2026-10-17), primary language Arabic, primary category Business (or Finance — owner's call; wording = business club, no promised returns).
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

## 6. Data safety / App Privacy — FINAL answers (match `/legal/privacy`; completed 2026-10-18)

Common facts: data encrypted in transit (HTTPS); account deletion in-app + web page; **no
ads, no tracking across apps, no third-party analytics SDK**; the M33 analytics id is a
random app-generated identifier not linked to the account; push (FCM) tokens are collected
to deliver notifications.

### Google Play «Data safety» — question by question

**Overview questions**
- Does your app collect or share any of the required user data types? → **Yes**
- Is all of the user data collected by your app encrypted in transit? → **Yes**
- Do you provide a way for users to request that their data is deleted? → **Yes** →
  deletion URL = `https://club-api-prod-production.up.railway.app/legal/account-deletion`

**Data types** (everything below: Shared = **No**; Collected = Yes; Ephemeral = No;
«processors acting on our behalf» — Google Play Billing, Paymob, RevenueCat, Expo push, the
LLM provider — are service providers, not "sharing" in Play's sense):

| Data type | Required/Optional | Purposes |
|---|---|---|
| Personal info → **Name** | Required | Account management, App functionality |
| Personal info → **Email address** | Required | Account management, App functionality |
| Personal info → **Phone number** | Required | Account management, App functionality |
| Financial info → **Purchase history** | Optional (only members/buyers) | App functionality (membership + service payments; card details stay with Google Play / Paymob) |
| Messages → **Other in-app messages** (advisor chat, form answers) | Optional | App functionality |
| App activity → **App interactions** (opened screen names) | Required | Analytics (first-party only, daily aggregates) |
| Device or other IDs → **Device or other IDs** (random analytics id + push token) | Required | Analytics (random id, NOT linked to account), App functionality (push token) |

- Account creation: «Username and password» (+ optional Google / Apple sign-in).
- NOT collected (answer No everywhere else): location, contacts, calendar, photos/videos*,
  audio, files, health, browsing history, installed apps, SMS/call logs.
  (*If a future feature uploads member photos, add Photos/videos → App functionality then.)

### Apple «App Privacy» (App Store Connect → App Privacy)

- Data used to **track** you: **none** (no tracking, no ATT prompt needed).
- Data **linked to you**:
  - Contact Info → Name, Email Address, Phone Number — App Functionality
  - Purchases → Purchase History — App Functionality
  - User Content → Other User Content (advisor messages, form answers) — App Functionality
  - Identifiers → User ID (hub account id, push token) — App Functionality
- Data **not linked to you**:
  - Usage Data → Product Interaction (opened screen names) — Analytics
  - Identifiers → Device ID (random app-generated id, first-party analytics only) — Analytics

## 7. Store listing copy — FINAL (2026-10-18; sources: M82 canonical definition + HQ copy + docs/membership-copy-2026-10-17.md)

Wording rules applied: «بدون رسوم» never «مجاني», «رصيد», «الشراكات», no prices (the store
shows the IAP price itself — rule 3), no promised returns, valuation/returns disclaimer included.

### Names (both stores)
- App name: **Investors Club** (14 chars — fits both 30-char limits)
- Apple subtitle (≤30 chars): **مجتمع أعمال حصري في الرياض**
- Google short description (≤80 chars):
  **مجتمع أعمال حصري للمحايدين ورواد الأعمال والمستثمرين — تطبيق واحد ومقر في الرياض**

### Full description — Arabic (primary listing, both stores)

```
نادي المستثمرين® مجتمع أعمال حصري للمحايدين ورواد الأعمال والمستثمرين، يقدّم خدماته لأعضائه عبر تطبيق واحد ومقر دائم في قلب العاصمة السعودية الرياض. من السعودية إلى العالم… عضويتك معك أينما كنت؛ فلديك عام كامل تستفيد فيه من جميع مزايا النادي، حضورياً في مقر النادي بمدينة الرياض بالمملكة العربية السعودية، وعبر الإنترنت، وتستكشف المشاريع وفرص الشراكة، لتبني علاقات قد تفتح لك أبوابًا لا يفتحها المال وحده.

ماذا تجد داخل التطبيق؟

• بنك مشاريع يضم أكثر من 260 مشروعًا اجتازت الفحص والتقييم، مع رصيد يفتح لك التفاصيل الكاملة والتواصل المباشر مع المؤسسين لمناقشة فرص الشراكة.
• المشاريع الذهبية: فرص مختارة يتواصل معها الأعضاء مباشرة دون خصم من الرصيد.
• مستشار ذكي متاح على مدار الساعة برصيد استخدام يومي متجدد، للاستفسارات والصياغة والتحليل.
• أحدث الفعاليات: ملتقيات وورش عمل وأمسيات على مدار السنة، تُقام في المقر وتُبث عبر الإنترنت للأعضاء في كل مكان.
• أخبار مختارة من مصادرها الأصلية، تقرأها من المصدر مباشرة.
• خدمات المنظومة بخصومات للأعضاء: استوديو بودكاست، تصميم المواقع والتطبيقات، قاعة اجتماعات، خدمات تسويقية، ومنصة «اصنع ملتقاك».
• مبادرة «شخصية ومسيرة» لتقديم نفسك وخبراتك لأعضاء النادي بدون رسوم.

وحين تصل إلى الرياض، فالنادي بيتك الثاني في عالم الأعمال، ولا داعي لأن تحمل همّ متطلبات عملك الأساسية؛ فقد وفّرنا لك قاعة اجتماعات لاستقبال ضيوفك، ومقرًّا مجهّزًا يتسع لـ80 شخصًا مع منصة متكاملة لاستضافة ملتقياتك وورش عملك الخاصة، و15 مكتبًا للاستخدام المؤقت، واستوديو بودكاست لتصل رسالتك، وحاضنة أعمال تحتضن مشروعك. كلها متاحة لك بصفتك عضوًا، مع خصومات تخفّف تكاليف أعمالك.

العضوية السنوية تُشترى داخل التطبيق كاشتراك سنوي متجدد تلقائيًا، ويمكن إلغاء التجديد في أي وقت من إعدادات المتجر.

المحتوى داخل التطبيق لأغراض التعريف بفرص الشراكة والخدمات، ولا يُعد عرضًا تعاقديًا أو ضمانًا لعوائد.
```

### Full description — English (secondary locale, optional at first submission)

```
Investors Club® is an exclusive business community for explorers, entrepreneurs and investors, serving its members through one app and a permanent headquarters in the heart of Riyadh, Saudi Arabia. From Saudi Arabia to the world — your membership travels with you: a full year to enjoy every club benefit, in person at the Riyadh HQ and online, exploring projects and partnership opportunities and building relationships that open doors money alone cannot.

Inside the app:

• A projects bank of 260+ vetted projects, with credit that unlocks full details and direct contact with founders to discuss partnership opportunities.
• Golden projects: selected opportunities members can contact directly at no credit cost.
• A smart advisor available around the clock with a daily renewing usage credit.
• Club events: meetups, workshops and evening sessions all year, held at the HQ and streamed online to members everywhere.
• Curated news, read straight from the original source.
• Member discounts on ecosystem services: podcast studio, web and app design, meeting room, marketing services, and the «Host your meetup» stage.

When you arrive in Riyadh, the club is your second home for business: a meeting room for your guests, an 80-seat equipped venue with a full stage for your own meetups and workshops, 15 flexible desks, a podcast studio, and a business incubator — all available to you as a member, with discounts that lower your costs.

The annual membership is purchased in-app as an auto-renewing yearly subscription; renewal can be cancelled any time from your store settings.

In-app content presents partnership opportunities and services; it is not a contractual offer or a guarantee of returns.
```

### Apple keywords (≤100 chars)
`نادي المستثمرين,استثمار,ريادة أعمال,شراكات,مشاريع,الرياض,السعودية,business,investors,club`

### Graphics
- Icon: the club MARK alone (golden «i» roundel, no text) — M82b. 1024×1024 PNG for Apple,
  512×512 for Play (source: the start-screen mark in `app/assets/`, regenerated ®-free 2026-10-04).
- Feature graphic (Play, 1024×500) + screenshots: take from the preview build on the owner's
  phone or the emulator — Arabic UI, at least 4 phone screenshots per store (home, projects
  bank, project page, membership). Prepare at submission time.

## 8. Reviewer notes (paste as written)

### App Store Connect → App Review Information → Notes
```
Investors Club is an Arabic-first (RTL) business-club app for a private members club in Riyadh, Saudi Arabia. Content language is Arabic (an English UI is included).

Sign in with the provided demo account (email + password; no SMS/2FA). The account already holds an ACTIVE annual membership, so all member features are unlocked: projects bank with full project details, smart advisor chat, events, services and the membership card.

The annual membership is an auto-renewing subscription sold via in-app purchase (product: club_membership_annual). Other in-app payments (club services) are real-world services for club members fulfilled at the Riyadh HQ, paid via the Paymob payment gateway, per guideline 3.1.3(e) — they are not digital content.

Account deletion: in-app under Account (حسابي) → delete account, and via the web page listed in the privacy policy.
```

### Google Play → App access → instructions
```
All member functionality requires signing in. Use the provided demo credentials (email + password, no 2FA). The demo account holds an active annual membership, so every member screen is reachable: projects bank (full details), advisor chat, events, services, membership card. The app is Arabic-first (RTL); an English UI is included.
```

(Credentials themselves: `ceo@vibesholding.com` + the password the owner holds — he types it
into both consoles; never in git or chat.)

## 9. Order of operations

1. ~~Legal pages in code~~ ✅ this session (deploys with the next push).
2. Production Railway service + Postgres + hub production site key (owner in browser with Claude).
3. Demo account: owner approves details → register on production → verify → dashboard grant → test login.
4. Consoles (section 5) with the owner; data safety forms from section 6.
5. RevenueCat production + keys on Railway production.
6. Production builds (`eas build --profile production`) — **only with the owner's explicit OK in that message** (EAS quota); iOS first needs the Apple app + certificates.
7. Launch = owner's word only. Current environment stays TEST until then.
