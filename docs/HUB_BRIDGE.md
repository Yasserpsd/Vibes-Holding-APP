# Hub bridge — accounts, OTP, login, membership status, AI advisor

How the app server talks to the vcmem.com hub (WordPress, plugin **Vibes AI Assistant** in hub mode). Written from the plugin source (v2.4.0, `includes/class-vai-hub.php`); nothing here is guessed.

## 1. Principle: the app server is a tenant site of the hub
The hub already exposes a site-facing API for every website of the ecosystem:

```
POST https://vcmem.com/wp-json/vibes-ai/v1/hub/{op}
Header: X-VAI-Site-Key: <site key>        (created in the hub admin → «المواقع»)
Body:   JSON
```

Each tenant site identifies a visitor by a `uuid` (any string of letters, digits and dashes, 8+ chars). Accounts (`vai_contacts`), e-mail OTP, passwords, memberships and admin roles all live in the hub. The app server therefore:

- keeps **no member registry** (CLAUDE.md rule 2);
- generates one hub `uuid` per app session (`app-<random uuid>`), logs in with it, and stores it hashed together with an opaque app token (`session:<sha256(token)>` in the `kv` table, expiry `SESSION_DAYS`, default 180);
- never shows the hub uuid or the site key to the app. The app only holds its own Bearer token (expo-secure-store).

## 2. Hub operations used (all in plugin 2.4.0 except `delete_account`)
| Op | Purpose | Notes |
|---|---|---|
| `register` | create an account (name, country, phone, email, password, persona, bio, job_title) | hub sends the 6-digit e-mail code (30 min); creates/merges the contact bound to the uuid |
| `resend_code` | resend the e-mail code | 1 per minute per contact |
| `verify` | confirm the code → account verified | auto-activates membership when the phone/e-mail is in the pre-paid `vai_members` list |
| `login` | e-mail or phone + password | attaches the uuid to the account; unverified accounts get `pending:true` and a new code |
| `account` | the contact for a uuid (`public_contact()`) | membership (`is_member`, `member_left`, `member_end`, `member_expired`), AI daily «رصيد» (`daily_limit`, `daily_left`), `is_admin`, profile fields |
| `profile` | update name, job_title, company, city, website, bio, social, avatar (data URL), password | e-mail/phone changes are also supported by the hub but not exposed in the app yet |
| `logout` | drop the visitor row for the uuid | |
| `reset_request` / `reset_confirm` | forgot password (6-digit e-mail code, 20 min) | |
| `delete_account` | **new in plugin 2.4.1** | password required; wipes personal data, messages, visitors, tokens, sessions and leads of the contact; payment rows stay; e-mails the team |
| `config` | `widget_config()`: bot name, welcome text, quick menu, membership card, link library, `voice` flag | read by the advisor service every 30 minutes; the membership card and the membership/payment links feed the app's block list |
| `message` | send a member message: `message`, optional `page_url` + `page_title` (screen context), `ip`; `image` / `audio` data URLs (≤ 4 MB / ≤ 6 MB, not used by the app yet) | stores the user row, forwards to the n8n workflow, answers `{ message_id, waiting }`; `gated: true` + `gate` (membership / daily / rate / site_cap) when the hub refuses; `{ ok: false, error: "n8n" }` (HTTP 200) when the workflow is unreachable |
| `poll` | replies after a message id (`after`) | assistant, human (staff console) and system rows, plus `waiting`, `timeout`, `human` |
| `history` | last 40 rows of the account's conversation | the hub stores messages per contact, not per site: the app shows the same conversation as the websites |

Errors come back as WordPress `WP_Error` JSON (`code`, `message` in Arabic, `data.status`). The server forwards code and message to the app unchanged, except `unauthorized` (bad site key → `hub_config`, 502) and unknown ops (`hub_not_supported`, 501, shown while the hub still runs plugin 2.4.0).

## 3. Server endpoints (Fastify, `server/src/auth`)
| Method & path | Auth | Answer |
|---|---|---|
| `GET /api/auth/config` | – | GCC countries with local patterns, personas, phone/e-mail policy texts, `registrationOpen`, `adminOnly`, `hubMode`, `testCode` (mock only) |
| `POST /api/auth/register` | – | `{ pendingToken, email, mailSent, text }` |
| `POST /api/auth/resend` | – | `{ mailSent, text }` |
| `POST /api/auth/verify` | – | `{ token, me }` (signed in) |
| `POST /api/auth/login` | – | `{ token, me }` or `{ pending: true, pendingToken, email, text }` |
| `POST /api/auth/reset/request`, `POST /api/auth/reset/confirm` | – | `{ ok }` |
| `GET /api/me` (`?fresh=1` bypasses the 60 s cache) | Bearer | `{ me }` |
| `PATCH /api/me` | Bearer | `{ me }` |
| `POST /api/auth/logout` | Bearer | `{ ok }` |
| `DELETE /api/me` (`{ password }`) | Bearer | `{ ok }` |
| `GET /api/advisor/history` | Bearer | `{ messages, profile: { botName, welcome, suggestions }, me }` |
| `POST /api/advisor/message` (`{ text, context?: { type: "project", id } }`) | Bearer | `{ messageId, waiting, human, gate, me }`; hub errors keep their code and Arabic text |
| `GET /api/advisor/poll?after=<id>` | Bearer | `{ messages, waiting, timeout, human, me }` |

`me` = `{ id, name, email, phone, persona, personaLabel, bio, jobTitle, company, city, website, social, avatarUrl, verified, isAdmin, membership: { status: unactivated | active | expired, daysLeft, endDate, aiDailyLimit, aiDailyLeft } }`.

All `/api/*` answers carry `Cache-Control: no-store`. Auth endpoints have a small per-IP limiter on top of the hub's own limits. Pending tokens live 30 minutes (the hub code's lifetime).

`messages[]` = `{ id, role: user | assistant | staff | system, text, at, by, image, audio, actions[] }`. `server/src/advisor/sanitize.ts` filters every reply before it reaches the app (CLAUDE.md rule 3): the hub's membership card becomes a `{ type: "membership" }` action (the app opens its own membership screen); links to the membership page and any Paymob / checkout / pay URL are removed from the text, from `link` / `open_page` actions and from service cards; the hub's gate texts (which sell the web membership) are replaced by app texts; web-only widgets (`prefill_form`, `scroll_to`, `handoff`, `request_contact`, `admin`) are dropped. Kept: `quick_replies`, `link`, `video`, service `card` (title, price, bullets, details link). The block list comes from the hub `config` (membership card buttons + link-library entries about العضوية / الدفع) plus fixed rules, cached 30 minutes.

Project context («اسأل المستشار» on a project page): the app sends `context: { type: "project", id }`; the server turns it into `page_title` (title + رقم المشروع) and `page_url` = the project's public page on vibesholding.com, which the hub uses for `page_excerpt()` (synced knowledge). That URL stays server-side (`ProjectsService.pageUrl()`, stored in the feed snapshot) and is never part of the public project.

## 4. Environment rules (test vs production)
- `APP_ENV=test` (now): **login is admitted for hub admins only** (`role=admin` and `admin_verified`, CLAUDE.md rule 9). A non-admin login is logged out of the hub again and answered `403 admin_only`.
- `APP_ENV=test` + live hub: **registration is closed** (`403 registration_closed`) unless the owner sets `HUB_ALLOW_TEST_REGISTRATION=1` (brief §7: no registrations on the live hub without approval).
- `HUB_MODE=mock` (local runs, tests, and Railway until the site key exists): in-memory fake hub, e-mail code always `123456`, every verified account counts as admin, an e-mail containing `+member@` becomes an active member and `+expired@` an expired one. Refused when `APP_ENV=production`.

Variables: `HUB_MODE` (`live` | `mock`; default `live` when `HUB_SITE_KEY` is set, else `mock`), `HUB_URL` (default `https://vcmem.com`), `HUB_SITE_KEY`, `HUB_ALLOW_TEST_REGISTRATION`, `SESSION_DAYS`. `/health` shows `hub.mode`, `hub.registrationOpen`, `hub.adminOnly` and, in test, the site key fingerprint.

## 5. Owner steps to go live with the real hub (test environment)
1. vcmem.com admin → **Vibes AI → المواقع** → add a site: name «تطبيق نادي المستثمرين», host `app.vcmem.com` (any unique host; it only labels the app in the hub). Copy the generated key once.
2. Railway → service Vibes-Holding-APP → Variables: `HUB_SITE_KEY=<key>`, `HUB_MODE=live` (`HUB_URL` may stay default). Redeploy.
3. Check `https://vibes-holding-app-production.up.railway.app/health` → `hub.mode: "live"`, `hub.registrationOpen: false`, `hub.adminOnly: true`.
4. Sign in from the app with an existing hub **admin** account (e-mail or phone + password).
5. Upload plugin **2.4.1** (`vibes-ai-assistant-2.4.1.zip`, next to the original zip on the owner's D: drive; diff in `docs/hub-plugin/`) through WordPress → Plugins → Add New → Upload → Replace current. The only change is the `delete_account` op and the version number; nothing else in the plugin moves. Until then the app's «حذف الحساب» answers «هذه الخدمة غير متاحة حاليًا».
6. Vibes AI → **التوجيهات والروابط**: add a directive for the app site (the workflow receives `site.host` = the host chosen in step 1), for example: «إذا كان الموقع هو تطبيق نادي المستثمرين فلا تذكر أسعار العضوية ولا روابط الدفع أو الاشتراك؛ وجّه العضو إلى شاشة العضوية داخل التطبيق». The server already removes membership and payment links, but the wording of the replies comes from the workflow.

## 6. Later milestones on the same bridge
- Advisor voice and image: `message` already accepts `audio` (data URL, Arabic only, transcribed by the hub) and `image` (jpeg/png/webp data URL); the app needs native modules (expo-audio, expo-image-picker) and therefore a new APK before they can be used.
- M7 store purchase → hub membership activation: needs a new server-to-server op (`activate_member`) in the plugin; `set_member()` already exists inside the hub.
- Push on staff replies: a webhook from the hub to this server (new plugin code).
- Projects Bank unlocks: separate endpoint in the Projects Bank plugin (brief §2.2).
