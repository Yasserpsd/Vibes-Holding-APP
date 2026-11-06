# Vibes AI Assistant (hub) 2.28.0 — «عضوية شرفية» (M205)

> **للمالك (تحديث 2026-11-06):** الإصدار **Vibes AI Assistant 2.28.0** جاهز ومجرَّب، وملفه في مجلد New Era:
> «1- بلجن المساعد 2.28.0 (vcmem ثم باقي المواقع)» ← `vibes-ai-assistant-2.28.0.zip`. المطلوب رفعه على vcmem.com.
> قبل رفعه يرد زر «منح العضوية الشرفية» في اللوحة برسالة «تحتاج تحديث إضافة الهب» ولا يتغير شيء عند الأعضاء.
> التغيير كاملًا في `vibes-ai-assistant-2.28.0.diff` بجانب هذا الملف.

The rest is for whoever edits the plugin. It is a contract: the app server (`server/src`) already speaks it, and
`server/src/hub/mock.ts` + `server/src/hub/mockAdmin.ts` are a working reference implementation
(`server/src/m205.honorary.test.ts` are the acceptance tests on the server side).

## What it is

An honorary membership given only to an official partner in the founding contract («عقد التأسيس») of one of the
Vibes Ventures companies (owner, 2026-11-06). Only the administration gives it, after checking that, and takes it
back when the partnership ends. It has no duration: it never lapses, has no end date, no renewal reminder, and no store subscription behind it.
It gives everything the annual membership gives.

Rule 2 of the project stands: the flag is stored in the hub and nowhere else. The app server only relays it.

## 1. Storage

Two new columns on the contacts table (dbDelta + a bumped db version, like the earlier column additions):

| column | type | meaning |
| --- | --- | --- |
| `honorary` | `tinyint(1) NOT NULL DEFAULT 0` | 1 = holds the honorary membership |
| `honorary_at` | `datetime NULL` | UTC time it was given; NULL when `honorary = 0` |

**The honorary membership sits over the paid clock, it does not replace it.** A store purchase or a Paymob payment
still starts or extends the paid period while it is on, and when it is taken back the paid clock alone decides again:
still a member if a paid period is running, expired or unpaid otherwise.

**As built in 2.28.0** (same answers on the wire, simpler inside): while `honorary = 1` the contact is put in the state
the whole plugin already treats as «a member with no end date» (`is_member = 1`, `member_started_at NULL`), so no gate,
list, count or reminder had to change. The paid clock is kept aside in three more columns — `paid_is_member`,
`paid_started_at`, `paid_days` — and `member_change()` writes there for an honorary contact
(`member_apply_under_honorary()`); `honorary_change()` moves the clock aside on a grant and back on a revoke, in one
transaction with its history row.

## 2. Giving and taking back — `admin_grant` only

`POST /hub/admin_grant` (trusted site + an admin `uuid`, exactly the checks the op has today) accepts two more
values of `action`:

| action | effect | event kind |
| --- | --- | --- |
| `honorary` | `honorary = 1`, `honorary_at = now` | `honorary` |
| `honorary_revoke` | `honorary = 0`, `honorary_at = NULL` | `honorary_revoked` |

- `days` is ignored for both (the server sends `0`); `note` is stored on the event like the other actions.
- Same guards as today: the caller must be a verified admin (`not_admin`, 403), the target must exist
  (`no_contact`, 404) and have a confirmed e-mail (`invalid`, 400).
- `honorary` on a contact that already has it, or `honorary_revoke` on one that does not: refuse with code
  `invalid`, HTTP 409 (messages: «العضوية الشرفية ممنوحة لهذا الحساب من قبل» / «هذا الحساب لا يحمل عضوية شرفية»).
- While `honorary = 1`, the three existing actions `activate`, `extend` and `revoke` are refused with code
  **`honorary`**, HTTP 409, message «هذا الحساب يحمل العضوية الشرفية وهي بلا مدة: اسحبها أولًا لتعديل الاشتراك».
  (The dashboard hides those buttons for an honorary member; this is the server-side guard.)
- Answer, as today: `{ ok: true, contact: public_contact(), event: {…} }`.
- The hub's own admin page may offer the same two actions, behind the same admin check. Nothing else may.

**No other op may set or clear the flag.** `register`, `profile`, `social_login`, `verify`, `activate_member`,
`member_status`, the public `/client/*` routes and the widget must ignore any `honorary` / `honorary_at` field sent
to them. `delete_account` removes the columns with the contact as usual.

## 3. Reading it

### `public_contact()` (every op that answers a contact: `account`, `login`, `profile`, `admin_grant`, `activate_member`, `member_status`…)

Two new fields, always present from 2.28.0:

```
honorary        0 | 1
honorary_since  'Y-m-d' (Riyadh day of honorary_at), '' when honorary = 0
```

and, **while `honorary = 1`**, the membership fields answer as a member with no end:

```
is_member       1
member_left     null
member_end      ''
member_expired  0
stage           the member stage (2)
daily_limit / daily_left   as for any member
pending_pay     0
member_days     unchanged (whatever the paid clock holds, 0 if none)
```

### The admin account shape (`admin_accounts`, `admin_member`, `admin_thread`)

```
honorary        0 | 1
honorary_since  'Y-m-d' | ''
state           'member'   while honorary = 1
is_member       1
never_expires   1          while honorary = 1
member_left     null, member_end ''
```

`sql_state('member')` must count honorary contacts as members and `sql_state('expired')` / `sql_state('unpaid')`
must not (so the `state=member` filter, the counts and the stats agree).

### `admin_stats.totals`

- new: `members_honorary` = contacts with `honorary = 1`.
- `members_active` and `members_no_expiry` include them.
- `expiring` (d7, d30, items) never lists an honorary contact.

### `member_status`

Accepts `contact_id` next to `phone` / `email` (first match wins: id, then e-mail, then phone) and answers the same
`{ ok, found, is_member, contact }`. The app server uses it to show the «عضوية شرفية» badge on a member's page to
other members. An unknown id answers `found: false`.

### `ping`

`version` must report `2.28.0` (the app server compares it to explain an older hub to the admin).

## 4. Everything that acts on membership

- **Expiry job / cron** (whatever flips an ended membership or marks it expired): skip `honorary = 1`.
- **Renewal reminder and expiry mails / WhatsApp**: never sent to `honorary = 1`.
- **`activate_member`** (store purchase) and the Paymob auto-activation: unchanged — they move the paid clock under
  the flag and answer `public_contact()`, which still says honorary. Do not clear the flag. The hub's own member-facing
  «تم تفعيل عضويتك حتى …» mail for these paths should be skipped while `honorary = 1` (the admin copy stays).
- **Gates** (`gate_payload()`, the daily AI limit, member-only content on the satellite sites): an honorary contact
  passes exactly like a paying member.
- **Events**: two new kinds, `honorary` and `honorary_revoked`, with `source = 'admin'`, the admin as actor and the
  note; they appear in `admin_member.events` like the others.
- The hub sends **no** member notice for the grant or for the revoke: the app server sends the WhatsApp message
  (`club_honorary_membership` / `club_honorary_ended`), the fallback e-mail and the push.

## 5. Acceptance (run on the rig before it goes live)

1. A non-admin uuid calling `admin_grant` with `action: honorary` → `not_admin`, nothing changes.
2. Admin grants a verified, never-paid contact → `account` answers `is_member 1, honorary 1, member_left null, member_end ''`;
   `admin_member` answers `state member, never_expires 1, honorary 1`; one `honorary` event.
3. Admin grants a contact whose paid period ended last year → same answers (not expired).
4. `register` / `profile` / `social_login` with `honorary: 1` in the body → the flag stays 0.
5. `activate_member` for an honorary contact → `contact.honorary` still 1, `member_end` still ''.
6. `admin_grant` `activate` / `extend` / `revoke` on an honorary contact → code `honorary`, 409.
7. `honorary_revoke`: the never-paid contact becomes a non-member (`is_member 0`, not `member_expired`); the contact of
   step 5 is a normal member again with the end date of the year he bought.
8. The expiry job and the renewal reminders run over an honorary contact and do nothing.
9. `admin_stats.totals.members_honorary` counts them; `expiring` does not list them.
10. `member_status { contact_id }` answers the contact with `honorary`.
11. `ping.version` is `2.28.0`; an install upgraded from 2.27.1 gets the two columns without losing data.
