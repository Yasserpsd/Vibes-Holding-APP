# Bridge v2 — one brain, one dashboard (M20, M21, M25 plugin part, M26)

Contract between the hub plugin (Vibes AI Assistant **2.7.0**, built on the owner's 2.6.0), the Projects Bank plugin (**39.0**, built on 38.1), the n8n workflow (**v4.0**, built on v3.2), this server, the dashboard and the app. Written from the plugin sources (2026-09-20); `docs/HUB_BRIDGE.md` stays valid for the older ops. Every name below is binding for all parts.

Facts that shaped it: 2.6.0 has neither `delete_account` (our 2.4.1 patch was lost) nor `activate_member`; any site key may call any site op; there is no `verified_at`, no activation history, no stored expiry; PB keeps no balance (allowance = global `credits` − unlock rows of the membership year) and knows members only by cookie; the widget sends only page URL and title; n8n feeds the history twice and forces a membership pitch on every turn.

## 1. Hub plugin 2.7.0

### 1.1 Trust
- `vai_sites.trusted TINYINT(1) DEFAULT 0` (DB_VERSION 2.0.0). A checkbox «خادم التطبيق (صلاحيات إدارية)» on the hub's «المواقع» page. Only the app server's row gets it.
- Privileged ops (`activate_member`, `changes`, `publish`, every `admin_*`) answer `403 forbidden` unless `$site->trusted`. They are never added to the `/client/{op}` allowlist.
- Every `admin_*` op also takes `uuid` (the dashboard admin's hub uuid) and answers `403 not_admin` unless that contact has `role='admin' AND admin_verified=1` (rule 2: the hub decides who is an admin). `publish` admits `role IN ('admin','publisher')`.
- The tool key is no longer accepted as `?key=` (header `X-VAI-Key` or body only).

### 1.2 Member events (history the stats need)
Table `vai_events`: `id, contact_id, kind, days, source, ref, actor_id, note, created_at` (keys: `created_at`, `(contact_id,id)`, UNIQUE `ref_key` = `source:ref` when ref is not empty, else NULL).
`kind`: `registered | verified | activated | renewed | revoked | role | deleted`. `source`: `paymob | store | admin | list | manual | app`.
Written by `op_register`, `op_verify`, `op_setpass`, `create_account_for`, `set_member` (through one new `member_change()` primitive), role changes and `delete_account`. New column `contacts.verified_at`.
One-time backfill (`vai_migrated_v27`): `verified` from `trial_started_at`; `activated` from `vai_payments (success=1, action='membership')`, else from `member_started_at` (source `manual`). Backfilled rows carry `note='backfill'`.

`member_change($contact_id, $action, $days, $source, $ref, $actor_id, $note)` with `$action` = `activate | extend | revoke`:
- idempotent on `source:ref` (a repeated store webhook answers `already:true` and changes nothing);
- `extend` on an active member keeps `member_started_at` and adds to `member_days` (remaining days are never lost); on a lapsed or new member it starts from now; welcome mail only on a first activation;
- `set_member()` keeps its signature and delegates, so the Paymob callback path and its URLs are untouched (rule 6).

### 1.3 Ops (POST `/wp-json/vibes-ai/v1/hub/{op}`, header `X-VAI-Site-Key`, JSON body, `ok:true` on success)
| Op | Body | Answer |
|---|---|---|
| `delete_account` | as 2.4.1 (`uuid`, `password`) | `ok`; also clears the 2.5+ columns (`pass_token`, `pass_token_expires`, `verified_at`), writes a `deleted` event |
| `activate_member` | `contact_id, days, reference, product, store` | `ok, contact, already` — `member_change(extend, source 'store', ref reference)` |
| `admin_stats` | `uuid, days` (7–180, default 30) | see 1.4 |
| `admin_accounts` | `uuid, q, state, page, per_page` (≤100); `state`: `all, pending, unpaid, member, expired, admin, publisher, lead` | `ok, total, page, per_page, counts{state:n}, items[Account]` |
| `admin_member` | `uuid, contact_id` | `ok, account: Account, memo, notes, sites[], payments[Payment], tickets[Ticket], leads[Lead], events[Event]` (last 50 each) |
| `admin_payments` | `uuid, q, status (all, ok, failed), action, page, per_page` | `ok, total, sum_cents_ok, items[Payment]` |
| `admin_tickets` | `uuid, q, page, per_page` | `ok, total, items[Ticket]` |
| `admin_leads` | `uuid, q, ltype, page, per_page` | `ok, total, items[Lead]` |
| `admin_threads` | `uuid, q, filter (all, waiting, human, unread), page, per_page` | `ok, total, items[{contact_id, name, phone, site, last_text, last_role, last_at, unread, waiting, human, is_member, intent, intent_label}]` |
| `admin_thread` | `uuid, contact_id, before` (message id, optional) | `ok, account, messages[{id, role, content, by, page_url, at}]` (40 per page, oldest first), `has_more` |
| `admin_reply` | `uuid, contact_id, text` | `ok, message_id` — a staff (`human`) message signed with the admin's name, same path as the console's `send` |
| `admin_mail` | `uuid` | `ok, stats{pending, sent, failed}, items[{id, to_email, subject, kind, status, attempts, created_at, sent_at}]` (last 50, never the body) |
| `admin_grant` | `uuid, contact_id, action (activate, extend, revoke), days, note` | `ok, contact, event` — audit row in `vai_events` (`source 'admin'`, `actor_id`) |
| `admin_set_role` | `uuid, contact_id, role (member, publisher)` | `ok, contact` — admin promotion stays on the hub page (it has its own code step). `public_contact().role` already carries the value; `is_admin` stays admin-only |
| `changes` | `since_id` (knowledge id cursor, 0 = latest 30), `kinds[]`, `limit` (≤100) | `ok, cursor, items[{id, host, site, url, title, kind, excerpt (≤300 chars), updated_at}]` |
| `publish` | `uuid, key, kind (post, event), title, content, url, image, event{date, place, online_url}, remove` | `ok, id` — upserts a knowledge row (`kind` `app_post` / `app_event`, url `app://posts/<key>`) under the calling site so the assistant knows it at once, and keeps the public card for `feed` |
| `feed` (also in the `/client` allowlist, read-only, cached 60 s) | `kind, limit` (≤12) | `ok, items[{key, kind, title, excerpt, url, image, event, at}]` — what the sites show through the shortcode `[vai_feed kind="event" limit="6"]` |
| `message` (existing) | new optional `context{type, id, title, text (≤6000), selection (≤1000)}` and `page_text` (≤6000) | unchanged; both reach n8n as `focus` and `page.live_text` |

Shapes (all times UTC `Y-m-d H:i:s`, plus the day fields in Riyadh time):
- `Account`: `id, name, email, phone, state (pending, unpaid, member, expired, lead), role, persona, job_title, company, city, created_at, verified_at, last_at, last_login_at, site, msg_count, is_member, member_left, member_days, member_end, never_expires, daily_limit, daily_left, intent, intent_label, has_password`.
- `Payment`: `id, txn_id, order_id, amount_cents, currency, success, action, name, phone, email, contact_id, note, created_at`. `Ticket`: `id, ref, contact_id, name, phone, email, event_title, event_date, event_place, source, checked_in, created_at`. `Lead`: `id, contact_id, name, phone, site, ltype, reason, company, notes, status, intent, intent_label, created_at`. `Event`: `id, contact_id, kind, days, source, ref, actor_id, actor_name, note, created_at`.
- List ops never run one query per row: `intent` and today's replies are computed in bulk.

### 1.4 `admin_stats`
```
ok, generated_at, tz: "Asia/Riyadh", days,
totals: { contacts, leads, accounts, pending_email, unpaid, members_active, members_expired, members_no_expiry, admins, publishers },
today:  { signups, verified, activations, renewals, conversations, messages, leads, payments_count, payments_cents },
expiring: { d7, d30, items[{ id, name, phone, email, member_end, days_left }] },   // soonest 20
series: [{ day, signups, verified, activations, renewals, payments_count, payments_cents, conversations, messages, leads }],  // one row per Riyadh day, zero-filled, oldest first
per_site: [{ host, name, conversations, messages }],   // last `days`
mail: { pending, sent, failed },
ai: { replies_today, members_today }
```
`accounts` = verified accounts with or without a password (Paymob-created ones count). `members_active` excludes lapsed rows although `is_member` is never cleared.

### 1.5 Webhook hub → app server (instant sync)
Settings `app_webhook_url`, `app_webhook_secret` (hub settings page, secret shown once). `POST` JSON `{ event, at, data }`, headers `X-VAI-Timestamp` (unix) and `X-VAI-Signature: sha256=<hex hmac_sha256(timestamp + "." + raw_body, secret)>`, non-blocking, 3 s. Events: `knowledge.changed {site, host, count, cursor}`, `member.changed {contact_id, kind}`, `message.staff {contact_id, message_id}`, `message.assistant {contact_id, message_id}`, `payment.recorded {id, action, success}`, `config.changed {rev}`. No personal data in the body; the server asks back with the ops above.

### 1.6 Widget «المستشار» (assets only)
Default name «المستشار». Ask-about-this: a small «اسأل المستشار» chip on hover / long-press over cards, packages, projects, headings, prices (`[data-vai-ask]` first, heuristics second) and over a text selection; it opens the chat with `context{type:'element'|'selection', title, text}` and a visible «تسأل عن: …» pill the visitor can remove. Every message carries `page_text` (main content, ≤6000 chars, scripts and the widget itself excluded). Starter chips from `config.menu`, up to 4 quick replies, typing indicator, markdown links / headings / tables, `dir="auto"`, focus trap + `aria-modal` + `aria-live`, labelled inputs, AA contrast, poll back-off with an offline notice, retry without duplicates, no price or marketing copy hard-coded in JS. Sign-up in two light steps with inline errors and progress; hub validation rules unchanged. `window.VAI.ask(text, context)` for other plugins (Projects Bank cards).

### 1.7 Fixes carried in 2.7.0
`admin_brief()` unread query; `save_note` reachable; `hub/reply` deduplicated by `user_message_id`; the mail page's «نسخة تجريبية» button; `contact.is_admin` in the n8n payload; the current message excluded from `turns`.

## 2. Projects Bank plugin 39.0 (`inc/bridge.php`)
`POST /wp-json/pb/v1/bridge/{op}`, header-only key `X-PB-Bridge-Key` (option `pdp_bridge_key_hash`, sha256, shown once in settings; the feed key is not reused). The caller passes the member's period because PB cannot ask the hub server-side: `member{contact_id, member_end (Y-m-d), member_days, name, email, phone}`.
| Op | Body | Answer |
|---|---|---|
| `ping` | – | `ok, version` |
| `balance` | `member` | `ok, credits, granted, used, left, period_start, unlocked[pid]` (`unlocked` = every year, `used` = this year) |
| `balances` | `members[member]` (≤200) | `ok, items{contact_id: {credits, granted, used, left}}` — two queries in total |
| `unlock` | `member, pid` | `ok, already, left, contact{whatsapp, email, website, pitch_url}`; errors `no_credit 402`, `not_member 403`, `not_found 404` |
| `grant` | `contact_id, amount` (±, never below used), `note, actor` | `ok, granted, left` — table `pdp_grants(id, contact_id, amount, period_start, note, actor, created_at)`, `pdp_gate_db` 39; the website's own allowance uses the same helper `pdp_gate_allowance($contact_id, $period_start)` |
| `unlocks` | `page, per_page, contact_id?` | `ok, total, items[{contact_id, pid, title, name, unlocked_at}]` |
`pdp_gate_do_unlock()` is shared by AJAX and the bridge and holds `GET_LOCK('pdp_unlock_<contact>')` around count-and-insert. Golden projects cost nothing. Project save / publish / trash → non-blocking webhook (setting `pdp_bridge_webhook`, same signature scheme as 1.5 with the bridge key as secret): `project.changed {pid}`.

## 3. n8n «Vibes Web Agent v4.0»
Generated from the owner's v3.2 export by `docs/hub-plugin/n8n/build-v4.mjs`; the `Config` node (keys) is copied untouched and never printed; the output file is written next to the original on the owner's drive, never into git.
Changes: `Simple Memory` disconnected (the hub's `turns` are the only history); membership state lives in the context block only, the pitch at most once per session and never on the app site; content-level anti-repetition rule (never restate what the last three assistant turns already said; answer the new part only); up to 3 tool calls, `maxIterations` 6, medium effort for analysis; prompt cut to identity + rules + protocol, static prices and sample replies removed (facts come from hub knowledge and the services catalog); `focus` (what the visitor points at) and `page.live_text` (≤6000, line breaks kept) injected first; admins exempt from gates; key `vai-<contact or uuid>` never `vai-0`; persona: an adviser with his own reasoning, comparisons, tables and an explicit opinion, inside the ecosystem; app site (`site.host` of the app): no web prices, no payment links, member-first tone. No promised returns; valuations carry the brief's disclaimer.

## 4. Server
- `HubOp` gains the ops of 1.3; `MockHubClient` implements all of them over its in-memory contacts. `PbBridge` (`server/src/projectsBank/bridge.ts`, env `PB_BRIDGE_URL`, `PB_BRIDGE_KEY`, mock when unset and `HUB_MODE=mock`).
- Dashboard API (all `dashboardGuard`, no-store, hub answers cached ≤ 60 s per admin-independent key, busted by webhooks): `GET /api/admin/home?days=` → `{ hub: admin_stats, app: { payments: { series[{day, count, cents, paid}], today, month }, store: { series[{day, purchases, renewals}] }, push: { devices } }, pb: { unlocksToday? }, bridge: { hub: {version, ok}, pb: {version, ok} } }`; `GET /api/admin/accounts`, `GET /api/admin/accounts/:id` (adds `pb: balance`), `GET /api/admin/hub-payments`, `/tickets`, `/leads`, `/threads`, `/threads/:id`, `POST /threads/:id/reply`, `GET /mail`, `POST /api/admin/accounts/:id/grant`, `POST …/role`, `POST …/pb-grant`, `GET /api/admin/audit`. Member lists add `pb{left, used, granted}` beside every active member through one `balances` call. Every write is recorded in kv `admin:audit` (who, when, what, note, result) and needs `confirm: true`.
- App API: `GET /api/projects/:id/access` and `POST /api/projects/:id/unlock` (Bearer; contact data only from PB's answer for this member, rule 4); `GET /api/projects/:id/brief` → `{ summary, table[{label, value}], stage{key, label, index, total, steps[]}, strengths[], risks[], competitors[{id, title, sector, stage, why}], disclaimer, generatedAt }` built only from public feed fields, cached in kv by content hash, deterministic fallback without the OpenAI key; `GET /api/sync` → `{ v: { posts, projects, news, content, feed } }`; `GET /api/feed` (hub `changes`, public fields).
- Advisor: `AdvisorContext` gains `post`, `video`, `screen`; the server resolves every context into `context{type, id, title, text}` from its own public data and sends it with `message`.
- Webhooks: `POST /api/webhooks/hub` and `/api/webhooks/pb` (HMAC + timestamp ±300 s, env `HUB_WEBHOOK_SECRET`, `PB_BRIDGE_KEY`), they bust caches, bump `/api/sync` versions, refresh the PB snapshot, and push a notification for `message.staff`.
- Posts gain `kind: post | event` and `event{date, place, onlineUrl}`; publish / edit / delete calls hub `publish` so the websites' `[vai_feed]` and the assistant learn it at once.
- A hub older than 2.7.0 answers `hub_not_supported`: the dashboard shows «حدّث إضافة الهب إلى 2.7.0» per section instead of failing.

## 5. API (server, as built) — request and response shapes of every new route
Common to all: JSON; every `/api/*` answer carries `Cache-Control: no-store`; errors are `{ error: { code, message } }` (Arabic `message`) with the HTTP status. Hub data keeps the hub's snake_case names (section 1.3 shapes); the server's own data is camelCase. CORS allows `GET, POST, PUT, DELETE` only.

### 5.1 Dashboard (Bearer token of a hub admin, `dashboardGuard`: 401 `unauthorized`, 403 `forbidden`, 403 `otp_required`)
Errors shared by the hub-backed routes: 501 `hub_not_supported` («حدّث إضافة الهب إلى 2.7.0», show it inside the section, do not sign out); 502 `hub_not_trusted` (the hub's «خادم التطبيق» box is not ticked); 403 `not_admin` (the hub says the account is no admin); 502 `hub_unreachable`; 404 `no_contact`. Lists take `q`, `page` (1…), `per_page` (1–100, default 25) and answer `{ ok, total, page, per_page, items[] }`. Hub answers are cached about 45 s (threads 5 s, one thread never) and dropped by webhooks and by every write.

| Route | Query / body | Answer |
|---|---|---|
| `GET /api/admin/home?days=` (7–180, default 30) | – | `{ hub: admin_stats (1.4) \| null, app: { payments: { series[{day, count, cents, paid}], today{count, cents, paid}, month{count, cents, paid} }, store: { series[{day, purchases, renewals}] }, push: { devices } }, pb: { unlocksToday: number \| null }, bridge: { hub: {version, ok}, pb: {version, ok} }, errors: { hub?: {code, message}, pb?: {code, message} } }` — never fails as a whole: a section that could not load is `null` with its entry in `errors`. `count` = payments created that Riyadh day, `paid` / `cents` = paid that day; `month` = the current Riyadh month. `ok` = version ≥ 2.7.0 / 39.0 |
| `GET /api/admin/accounts` | `q, state (all, pending, unpaid, member, expired, admin, publisher, lead), page, per_page` | `{ ok, total, page, per_page, counts{state: n}, items[Account & { pb: {left, used, granted} \| null }], pbError: {code, message} \| null }` — `pb` is set for `state: 'member'` rows (one `balances` call per page); `all` excludes leads |
| `GET /api/admin/accounts/:id` | – | hub `admin_member` answer `& { pb: {credits, granted, used, left, period_start, unlocked[pid]} \| null, pbError }` (`pb` asked for members and expired members) |
| `GET /api/admin/hub-payments` | `q, status (all, ok, failed), action, page, per_page` | `{ ok, total, page, per_page, sum_cents_ok, items[Payment] }` (hub payments; the app's own Paymob payments stay on `GET /api/admin/payments`) |
| `GET /api/admin/tickets` | `q, page, per_page` | `{ ok, total, page, per_page, items[Ticket] }` |
| `GET /api/admin/leads` | `q, ltype, page, per_page` | `{ ok, total, page, per_page, items[Lead] }` |
| `GET /api/admin/threads` | `q, filter (all, waiting, human, unread), page, per_page` | `{ ok, total, page, per_page, items[Thread] }` |
| `GET /api/admin/threads/:id` (`:id` = contact id) | `before` (message id, optional) | `{ ok, account, messages[{id, role, content, by, page_url, at}] (oldest first, 40), has_more }` — opening it marks it read |
| `POST /api/admin/threads/:id/reply` | `{ text (1–4000), confirm: true, requestId? }` | `{ ok, message_id, already }` — a write like the others: `confirm: true` is required (400 `invalid` without it), audited |
| `GET /api/admin/mail` | – | `{ ok, stats{pending, sent, failed}, items[{id, to_email, subject, kind, status, attempts, created_at, sent_at}] }` |
| `POST /api/admin/accounts/:id/grant` | `{ action: activate \| extend \| revoke, days (1–3650, required unless revoke), note (≤300), confirm: true, requestId? }` | `{ ok, already, contact (hub public_contact), event (Event) }` |
| `POST /api/admin/accounts/:id/role` | `{ role: member \| publisher, note, confirm: true, requestId? }` | `{ ok, already, contact }` — 400 `invalid` for an admin account (that role stays on the hub page) |
| `POST /api/admin/accounts/:id/pb-grant` | `{ amount (integer −50…50, not 0; projects, not riyals), note, confirm: true, requestId? }` | `{ ok, already, granted, left }` — 409 `not_member` for a non-member; 400 `below_used`; 501 `pb_not_configured` / `pb_not_supported`; 502 `pb_config` / `pb_unreachable` |
| `GET /api/admin/audit?limit=` (1–500, default 100) | – | `{ entries[{ id, at, actor{id, name, email}, action (grant, role, pb_grant, reply), contactId, params, note, result (ok, error), error, requestId }] }` newest first (kv `admin:audit`, last 1000; failed writes are recorded too) |

Writes without `confirm: true` answer 400 `invalid` and reach nothing. `requestId` (`[A-Za-z0-9_-]{8,64}`, made by the dashboard per tap) makes a write idempotent: the same id for the same action and account replays the first answer with `already: true` and calls neither the hub nor PB again — also when the twin arrives while the first is still running (it waits for it; if the first fails, both get its error). A write the hub / PB applied answers 200 even when its audit entry cannot be saved (retried once, then logged); the answer is also kept in memory so a retry replays it while kv is down.

### 5.2 App
| Route | Auth | Answer |
|---|---|---|
| `GET /api/projects/:id/access` | Bearer | `{ state, isMember, balance: {credits, granted, used, left} \| null, contact: {whatsapp, email, website, pitchUrl} \| null, message: string \| null }`. `state`: `golden` (costs nothing, use the project's public `goldenPartnerUrl`), `not_member` (`message` = what to show), `can_unlock`, `exhausted`, `unlocked` (`contact` present), `unavailable` (the PB bridge is down or not set up; `message` says so; hide the button). `contact` is non-null only in `unlocked`; empty strings mean the founder gave none. 404 `not_found` |
| `POST /api/projects/:id/unlock` | Bearer, body `{}` | `{ ok, already, left, contact{whatsapp, email, website, pitchUrl} }`. Errors: 402 `no_credit`, 403 `not_member`, 404 `not_found`, 409 `golden`, 429 `rate` (30 an hour per account), 501 `pb_not_configured` |
| `GET /api/projects/:id/brief` | none | `{ summary, table[{label, value}], stage{key, label, index, total, steps[]}, strengths[], risks[], competitors[{id, title, sector, stage, why}], disclaimer, generatedAt, source: 'ai' \| 'rules' }`. `stage.key`: `idea, prototype, launch, revenue, growth, unknown`; `index` is 0-based into `steps` (5 Arabic labels), `-1` when unknown; `label` is the feed's own wording. `competitors[].id` opens `/api/projects/:id`. 404 `not_found`, 429 `rate`. First call of a project may take up to 25 s with an OpenAI key (cached afterwards by content) |
| `GET /api/sync` | none | `{ v: { posts, projects, news, content, feed } }` — numbers (ms of the last change, 0 = never). Served from memory (kv is read once), cheap to poll. Compare each with the last seen value for inequality and refetch that part. `posts`: dashboard create / edit / delete; `projects`: PB webhook or a refresh that brought other content; `news`: a run that stored new items; `content`: hub `config.changed` or a newer seed at boot; `feed`: hub `knowledge.changed` |
| `GET /api/feed?since=&kinds=&limit=` (`since` = last `cursor`, `kinds` comma separated, `limit` 1–100, default 30) | none | `{ cursor, items[{id, site, host, url, title, kind, excerpt, updatedAt}], supported }` newest first; `since=0` = latest 30. Served from one snapshot of the hub's latest rows (asked from the hub at most once a minute, at once after `knowledge.changed` or a post handed to the hub); `since` / `kinds` / `limit` filter that snapshot and never reach the hub, so a client far behind gets the latest rows, not the whole history. 429 `rate` above 60 requests per 15 min per address. Rule 3: membership / payment / pricing pages (by address or title) and any page quoting a price together with membership wording are dropped; another page whose excerpt quotes a price or calls to subscribe keeps its place with `excerpt: ''`. `kind`: `page, post, project, service, app_post, app_event, …`; the app's own posts come as `url: app://posts/<post id>`. `supported: false` with no items = hub older than 2.7.0 |
| `GET /api/posts`, `GET /api/posts/:id` | none | each post gains `kind: 'post' \| 'event'` and `event: {date, place, onlineUrl} \| null` (`date` = `YYYY-MM-DD` or an ISO date-time) |
| `POST /api/advisor/message` | Bearer | `context` may now be `{type:'project', id:number}`, `{type:'news', id}`, `{type:'portal', id}`, `{type:'service', id}`, `{type:'post', id: post uuid}`, `{type:'video', id: YouTube id}`, `{type:'screen', id}` (`[a-z0-9-]{1,40}`; known: `home, projects, golden, membership, services, hq, news, videos, posts, advisor, account, about`), each with an optional `selection` (≤1000 chars the member highlighted). The app sends only type and id: the server builds the text. Answer unchanged |

Dashboard posts (`POST /api/admin/posts`, `PUT /api/admin/posts/:id`): body gains `kind` (default `post`) and `event: { date, place?, onlineUrl? }` (required when `kind: 'event'`; 400 `invalid` «اكتب موعد الفعالية»). The answered post carries `hubSync: { state: ok | failed | unsupported, at, error, published }` = how the hand-over to the hub's `publish` went (`failed` is retried on the next edit; never blocks saving).

### 5.3 Webhooks (called by the plugins, not by the dashboard or the app)
`POST /api/webhooks/hub` — headers `X-VAI-Timestamp`, `X-VAI-Signature` (1.5), secret `HUB_WEBHOOK_SECRET`. `POST /api/webhooks/pb` — the same scheme with `PB_BRIDGE_KEY` as the secret, header names `X-PB-*` or `X-VAI-*`. Answers: 200 `{ ok: true }`, `{ ok: true, ignored: true }` (unknown event), `{ ok: true, duplicate: true }` (same signature again); 401 `bad_signature` / `stale` (outside ±300 s); 400 `invalid`; 503 `not_configured` (no secret on the server). The signature is checked over the raw body in constant time.

### 5.4 `/health`
Gains `bridge: { hub: {version, ok}, pb: {version, ok}, checkedAt, pbMode: live | mock | off, brief: openai | rules, hubWebhook: boolean }` (the last background check; nulls before the first).
