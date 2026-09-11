# Project brief — تطبيق نادي المستثمرين

Last updated: 2026-09-11 (M3). These are the owner's decisions. If anything here conflicts with what the owner says in a session, ask before acting.

## 1. Entities and contacts
- Publisher and membership seller: شركة المجتمع الافتراضي للاستثمار, the official operator of نادي المستثمرين (vcmem.com). CR 2050179051, VAT 311933896300003, Riyadh, Al Olaya.
- Parent: فايبز القابضة (شركة ذبذبات للاستثمار القابضة), owner of the «نادي المستثمرين®» trademark. Founder: م. سالم المسرحي.
- Management (the only management number): +966 55 831 8777.
- Studio bookings (بودكاست الملتقى): +966 53 846 1110.
- Club size: 11,000+ members. Target 20,000, then 100,000 after the app launch.

## 2. Architecture
The app calls only `server/`. The server talks to:
- **vcmem.com hub** (WordPress, Vibes AI Assistant plugin in hub mode): accounts, e-mail OTP, memberships, AI chat (n8n workflow "Vibes Web Agent"), staff console, admin roles. REST namespace `vibes-ai/v1`.
- **vibesholding.com Projects Bank** (plugin `projects-directory-pro`): projects feed and unlocks.
- **Paymob KSA**: real-world services only, Intention API, per-payment notification URL pointing to the server.
- **App stores via RevenueCat** (later): membership purchase → server → hub activation.
- **News sources + OpenAI API** (later): classification, deduplication and ranking only.

### 2.1 Hub bridge (later milestone)
The hub needs server-to-server endpoints secured by a bridge key. They are added to the Vibes AI Assistant plugin in a Claude chat session where the owner uploads the current plugin zip. Never guess the plugin's code.
Needed: register with OTP, verify/resend OTP, login returning a token for the server, profile get/update/avatar, delete account, membership status (unactivated, or annual with days left, AI «رصيد», project unlocks left), activate membership from a store purchase, chat send (text/voice/image) and history, staff-reply webhook to the server (for push), admin check.

### 2.2 Projects Bank feed
- `GET https://vibesholding.com/wp-json/pb/v1/projects?key=…` (plus `/ping`). The key lives in server env only.
- Post type `project`. Meta: project_number, company_name, founder_name, whatsapp, email, website, pitch_deck, project_gallery, project_details (Arabic body; post_content is empty), project_details_en, excerpt_en, title_en, company_name_en, founder_name_en, is_featured (golden flag), featured_order, golden_partner_url, views_count. Taxonomies: `sector`, `project_stage`.
- whatsapp, email, website and pitch_deck are private (CLAUDE.md rule 4).
- Unlocks live in table `wp_pdp_unlocks`, keyed by the hub contact id. A paid member gets 5 project unlocks per membership year. Golden projects never deduct credit and route to golden_partner_url.
- A server-to-server unlock endpoint is added to the Projects Bank plugin in a later milestone (the owner uploads the plugin zip in a Claude chat).
- Sort options used on the web: الأحدث / الأكثر مشاهدة / اكتشف / المشاريع الذهبية.

## 3. Accounts (mirror the hub; the hub enforces them)
- E-mail: Gmail, iCloud, Outlook, or a Saudi `.sa` domain only, verified by e-mail OTP.
- Phone: Saudi and GCC numbers only, Saudi by default, format `0558318777` (no spaces, no country code); other GCC countries selectable. Notice text: «التسجيل متاح للسعوديين والمقيمين ودول مجلس التعاون».
- Mandatory persona: «رائد أعمال — لدي مشروع مميز» / «مستثمر — أبحث عن فرص شراكة واعدة» / «محايد — شريك المستقبل وسأحدد توجهي لاحقًا». Mandatory short bio. Optional job title, photo, social links, company website.
- States: guest → registered but unpaid «عضوية غير مفعّلة» (message «برجاء تفعيل عضويتك») → annual member (360-day countdown) → admin (promoted in the hub).
- Guests may browse public content: project list and project pages without private fields, the golden portal, and Saudi decisions news.
- In-app account deletion is required by both stores.

## 4. Annual membership (single tier)
- 1,899 SAR per year, promotional «لفترة محدودة», base price 3,900. The in-app store price point is decided later.
- Benefits (server-driven content):
  - Member's project re-posted 3 times a month on club platforms and the app; «شخصية ومسيرة» feature (vcmem.com/famous).
  - Projects Bank credit worth 3,750 SAR = 5 projects.
  - AI advisor with a renewing «رصيد».
  - Online consultation with club experts «بدون رسوم»; priority at ملتقيات and ملتقى «5 دقائق».
  - Riyadh HQ access by booking; club theater (60 seats) and meeting room (8 people, Zoom) at 50%.
  - 50% off: اصنع ملتقاك، Pitch Deck، بودكاست الملتقى studio packages (no usage limit), Momentum website/app design, e-marketing packages, influencer ads, franchise kit (حقيبة امتياز).
  - Up to 20% on «منفذ» products (QDT).
  - «قريبًا»: discounts from وديني القابضة، سكة، وديني سكاي، PV spaces.

## 5. Version 1 features
1. **Home**: dashboard-driven banners and sections. Each banner has an audience (all / members / unactivated / persona) and start and end dates.
2. **Projects Bank**: search in Arabic and English, sector and stage filters, sort options, project page, unlock for paid members.
3. **Golden projects portal** («المشاريع الذهبية», the projects carrying علامة V): the umbrella plus 10 companies, portfolio value 161M SAR. Disclaimer: «المعلومات تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد».
4. **Membership screen**: benefits and status (store purchase in a later milestone).
5. **AI advisor**: the same hub conversation the member has on the websites; text, voice, image. «اسأل المستشار» sends the current screen's context (project or news item).
6. **Services**: list price and member price. Real-world services paid via Paymob. Studio booking: package and preferred time, handed to the studio WhatsApp. Project registration: شركاء النجاح (pvspaces.com/sp/) → specialised committee review → listed in بنك المشاريع only if approved.
7. **News**: fixed «قرارات وأنظمة المملكة» section for everyone; personalized feed by interests chosen at signup; sports only when there is a business angle (club acquisitions, transfer fees, sponsorships, broadcast rights). Source tiers: Saudi official → trusted Saudi media → global.
8. **HQ visit** (paid members only): date, time and purpose → admin confirmation → QR pass valid for that slot only. No walk-ins.
9. **Account**: profile, photo, digital membership card, delete account.

### 5.1 Golden companies (order, valuation, offer page)
- V — فايبز القابضة — vibesholding.com/offer/
- 01 — وديني — 31M — wdeny.com/offer/
- 02 — شركة المجتمع الافتراضي (المشغّل الرسمي لنادي المستثمرين) — 30M — vcmem.com/offer/
- 03 — PV لحاضنات ومسرعات الأعمال — 20M — pvspaces.com/offer/
- 04 — سكة — 15M — sekaride.com/offer/
- 05 — الملتقى — 15M — almoltaqapodcast.com/offer/
- 06 — القضمة السريعة — 10M — qbarabia.com/offer/
- 07 — الصفقات السريعة للتجارة — 10M — qdtco.com/offer/
- 08 — مومنتوم — 10M — momentummix.com/offer
- 09 — الصفقات السريعة للاستثمار — 10M — qdealsi.com/
- 10 — تمكين الامتياز — 10M — franchment.com/offer

Logos are in `https://vibesholding.com/wp-content/uploads/2026/08/`: فايبز-القابضة.png, Wdeny-logo-png.webp, لوجو-المجتمع-الافتراضي.png, PV.png, Seka.webp, Al-Moltaqa.webp, القضمة-السريعة.png, الصفقات-السريعة-للتجارة.webp, مومنتوم-scaled.png, الصفقات-السريعة-للاستثمار.png, تمكين-الامتياز.png. Seed them as editable server content; do not hardcode.

### 5.2 Services and current web links
- Pitch Deck: 5,000 SAR (https://paymob.link/2rXb1); members 2,500 (https://paymob.link/gSyCE). Executed by شركة PV.
- اصنع ملتقاك: 30,000 SAR (vibesholding.com/urmeet/); members 50% (https://paymob.link/vkfVr).
- Studio: prices are kept in the hub settings; page almoltaqapodcast.com/studio/ with anchors #basic #advanced #full #theater #outdoor #addons; members 50%; bookings through the studio WhatsApp.
- Workshops: vcmem.com/workshop/. Current workshop «مشروعك من الفكرة إلى التنفيذ», October 17 to 19, 2026, at the HQ plus online, 290 SAR instead of 1,200 (https://paymob.link/tH3EE), members 50%.
- Any other member service: the management number.

These links are the current web flow. The target in-app flow is server-created Paymob intentions linked to the member's account.

### 5.3 HQ facts
الرياض، شارع الأمير محمد بن عبدالعزيز (التحلية سابقًا)، برج الجوهرة، حي العليا — 400 m², 15 offices, meeting rooms, theater and stage, coffee shop.
Map: https://maps.app.goo.gl/A8JZpNt5AgzC33m56 — Tour video: YouTube `XERenNWNziA`.

### 5.4 Videos (YouTube IDs)
Club story `CnWMWS_nDpM` · 11,000+ members `KUzcLImZc-c` · How the club works `3hvxhZL-gsM` · Club categories `TzeJOrO4nMI` · سكة `vLI-G989nIk` · اصنع ملتقاك `xpxKMnj_Nzk` · ملتقى 5 دقائق `ReJljicbEJc` · HQ tour `XERenNWNziA`

## 6. Brand assets (official)
- Club gold logo (transparent): https://vcmem.com/wp-content/uploads/2025/11/لوجو-نادي-المستثمرين-جوولد-شفاف.png
- شركاء النجاح: https://vcmem.com/wp-content/uploads/2025/08/English-PNG-copy.webp
- بنك المشاريع: https://vcmem.com/wp-content/uploads/2026/09/بنك-المشاريع.png
- فايبز القابضة: https://vcmem.com/wp-content/uploads/2025/11/Vibes-Logo-png-small.webp
- PV: https://vcmem.com/wp-content/uploads/2026/09/PV.png
- Zoom icon: https://vcmem.com/wp-content/uploads/2026/09/zoom-video-meeting-app-icon-free-vector-copy.webp
- Visual identity: premium gold with black and white. The final palette is confirmed with the owner at the design step.

## 7. Environments
- **test** (now): Railway environment `test`; Paymob TEST secret and public keys with TEST integration IDs; preview builds only.
- The hub and the Projects Bank exist only as live systems. In test, the server reads them read-only. Never trigger a real membership activation, a real payment, or e-mails to non-admin users. Test login with existing admin accounts only; do not create registrations on the live hub without the owner's approval.
- **production**: only after the owner's explicit go-live.

## 8. Milestones
- [x] **M1 — App shell and first APK** (no backend): Expo app in `app/` with TypeScript, expo-router, forced RTL, IBM Plex Sans Arabic and theme tokens. Bottom tabs: الرئيسية، بنك المشاريع، المستشار، الأخبار، حسابي, each a placeholder screen in Arabic with the club logo. `APP_ENV` config and app variants (preview and production ids), eas.json profiles, EAS Update configured. Build the preview APK and give the owner the install link. Also `.gitignore`, a README with setup steps, and the first push to the private GitHub repo.
  - Status (2026-09-11): done. Expo SDK 57 app in app/ (expo-router in src/app, tabs, forced RTL via expo-localization plugin, IBM Plex Sans Arabic, tokens in src/theme/tokens.ts, app.config.ts with APP_ENV variants, eas.json, EAS Update channel preview created). First preview APK: build 1258df03 on the EAS dashboard (builds page of @vibes-holding/vibes-holding). Repo: github.com/Yasserpsd/Vibes-Holding-APP. Open items for M2: set EXPO_PUBLIC_API_URL per EAS profile once the server exists; confirm final palette with the owner; verify RTL and fonts on a real device.
- [x] **M2 — Server and read-only content**: server skeleton on Railway `test`; Projects Bank in the app (list, search, filters, project page without private fields); golden portal from seeded server content.
  - Status (2026-09-11): done and deployed. Railway project "faithful-nurturing", service Vibes-Holding-APP (root directory `server`, auto-deploys from main), environment still named production on Railway but APP_ENV=test; public URL https://vibes-holding-app-production.up.railway.app (health shows 260 projects synced and the feed key fingerprint 40:3cfb9a9e, which matches the owner's server/.env). Variables on Railway: APP_ENV, DATABASE_URL (${{Postgres.DATABASE_URL}}), HOST, LOG_LEVEL, PB_FEED_KEY, PB_FEED_URL, PB_REFRESH_MINUTES. app/.env and eas.json (development, preview) point at that URL. server/ = Fastify 5 + TypeScript + Zod + pg (Node 24, ESM); key/value table `kv` in Postgres with in-memory fallback when DATABASE_URL is empty; golden portal seeded at boot (server/src/content/golden.ts, key `content:golden`); Projects Bank synced every PB_REFRESH_MINUTES from the vibesholding feed, mapped to a public whitelist (server/src/projectsBank/mapper.ts) before caching, so whatsapp/email/website/pitch_deck never leave the server. Endpoints: /health, /api/projects (q, sector, stage, sort=latest|views|discover|golden, page, limit), /api/projects/filters, /api/projects/:id, /api/golden; all /api/* answers carry Cache-Control: no-store. 11 node:test tests pass (npm test). App: TanStack Query + expo-web-browser (lazy-loaded with a system-browser fallback because the M1 APK lacks the native module); screens src/app/(tabs)/projects.tsx, src/app/project/[id].tsx, src/app/golden.tsx; home links to both. Feed verified with the key in server/.env: plugin v38.1, 260 projects, envelope {ok,count,generated,rules,projects[]}, each item has top-level id/number/title/title_en/url/image/sector/project_stage (strings)/golden/partner_url/contact_rule (golden_direct|members_only)/modified plus meta (company_name, founder_name, project_details plain text, excerpt, is_featured, has_pitch_deck, views_count); the feed already omits whatsapp/email/website/pitch_deck, the server still whitelists. The feed `rules` text carries web membership prices and is never exposed. Open items for M3: the owner runs `eas update --channel preview` from app/ (OTA, no new build) and checks the new screens, RTL and fonts on the M1 APK; confirm /health reports storage "postgres" on Railway (else fix the DATABASE_URL reference); the next native build must include expo-web-browser (in-app browser) and expo-secure-store.
- Content decision (2026-09-11): «شخصية ومسيرة» member profiles and «أخبار النادي» club news are entered manually from the admin dashboard (server-driven content), not synced from WordPress; the Projects Bank stays automatic (feed); the AI advisor is connected to both (owner's words: «AI هو اللي يكون مربوط بالاثنين»; confirm the exact meaning when M4 starts). This content milestone comes after M3 (the owner chose to start M3 first).
- [x] **M3 — Real accounts**: hub bridge → registration, OTP and login in the app; membership status; preview login limited to admins.
  - Status (2026-09-11): merged (PR #1) and deployed; Railway runs the mock hub until HUB_SITE_KEY is set. The first two M3 OTA updates closed the app on the M1 APK: a lazy require() of expo-secure-store (missing from that binary) is reported as a fatal JS error before try/catch runs. Fixed in commit 3bdd954 (requireOptionalNativeModule gate for ExpoSecureStore and ExpoWebBrowser), reproduced and verified on the local Android emulator by embedding the exported bundle in the M1 APK, and published as OTA group 26befa11; devices self-heal through expo-updates error recovery or by reinstalling the APK. The hub bridge is the hub's existing tenant-site API (`POST /wp-json/vibes-ai/v1/hub/{op}` with `X-VAI-Site-Key`; the app server is a site of the hub, one hub uuid per app session) — full contract and owner steps in `docs/HUB_BRIDGE.md`. Server: `server/src/hub` (live client + mock), `server/src/auth` (sessions hashed in `kv`, service, routes), `/api/auth/config|register|resend|verify|login|reset/*|logout`, `/api/me` (GET/PATCH/DELETE), `/api/membership` (seeded benefits, no prices); env `HUB_MODE`, `HUB_URL`, `HUB_SITE_KEY`, `HUB_ALLOW_TEST_REGISTRATION`, `SESSION_DAYS`; test rules: admin-only login and registration closed on the live hub; 21 node:test tests pass. Plugin: Vibes AI Assistant 2.4.1 = 2.4.0 + op `delete_account` (zip placed next to the original on the owner's D: drive; diff in `docs/hub-plugin/`). App: `src/auth` (AuthProvider, secure-store token with in-memory fallback for the M1 APK), screens `auth/login|register|verify|reset`, `membership`, `profile-edit`, the account tab and a membership link on home; `expo-secure-store` added. Open items: owner pushes (Railway redeploys in mock mode: code 123456, every account admin) and runs `eas update --channel preview`; owner creates the app site in the hub «المواقع» and sets `HUB_SITE_KEY` + `HUB_MODE=live` on Railway, then tests login with a hub admin account; owner uploads plugin 2.4.1 (needed only for «حذف الحساب»); the next preview APK (needs the owner's OK) must be built so sessions persist (expo-secure-store) and the in-app browser works.
- [ ] **M4 — AI advisor**: chat through the hub, same conversation as the websites.
- [ ] **M5 — News engine**: source polling, AI classification, fixed Saudi decisions section, personalized feed.
- [ ] **M6 — Services and HQ**: Paymob in test mode for services; HQ visit booking with QR pass.
- [ ] **M7 — Store accounts**: iOS test builds (TestFlight or ad hoc), push notifications, membership IAP via RevenueCat, admin dashboard.
- [ ] **M8 — Store readiness and launch**: privacy policy, account deletion web page, data safety forms, demo account for Apple review, launch.
