import { createHash } from 'node:crypto';

import { EMAIL_POLICY_TEXT, normEmail, normPhone, phoneIntl, phoneLocal } from './phone.js';
import { MOCK_HUB_VERSION, MockAdmin } from './mockAdmin.js';
import { MockChat } from './mockChat.js';
import { blankContact, newMockState, nextId, seedDemo, type MockContact } from './mockData.js';
import { HubError, type HubBody, type HubClient, type HubContact, type HubOp, type HubResponse } from './types.js';

/**
 * In-memory stand-in for the hub, used locally and in tests (never in production).
 * Rules for testers: the e-mail code is always 123456; every verified account counts as a hub
 * admin (so the test-environment admin gate passes); an e-mail containing "+member@" becomes an
 * active member on verification and one containing "+expired@" an expired member.
 * Bridge v2 (docs/BRIDGE_V2.md): the dashboard ops live in mockAdmin.ts over the same contacts; `seed: true`
 * adds the demo club of mockData.ts (the server's own mock hub does, tests start empty).
 */
export const MOCK_CODE = '123456';
const MOCK_DAILY_LIMIT = 20;
const ALLOWED_DOMAINS = ['gmail.com', 'icloud.com', 'outlook.com', 'hotmail.com', 'live.com'];
const PERSONAS = ['neutral', 'entrepreneur', 'investor'];

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const str = (body: HubBody, key: string, max = 500): string =>
  typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, max) : '';
const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** Bridge v2 answers carry fields the generic `HubResponse` does not list (see `HubResults`). */
const answer = <T extends { ok: true }>(value: T): HubResponse => value as unknown as HubResponse;

function emailAllowed(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return ALLOWED_DOMAINS.includes(domain) || domain.endsWith('.sa');
}

export class MockHubClient implements HubClient {
  readonly mode = 'mock' as const;
  private readonly state = newMockState();
  private readonly contacts = this.state.contacts;
  private readonly visitors = new Map<string, number>();
  private readonly chat: MockChat;
  private readonly admin: MockAdmin;

  /** options.replyDelayMs: how long a canned chat reply stays hidden (the real workflow takes a few seconds). */
  constructor(options: { replyDelayMs?: number; seed?: boolean } = {}) {
    this.chat = new MockChat(options.replyDelayMs ?? 1500);
    this.admin = new MockAdmin({ state: this.state, chat: this.chat, visitors: this.visitors, publicContact: (contact) => this.publicContact(contact) });
    if (options.seed) seedDemo(this.state, this.chat, Date.now());
  }

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    switch (op) {
      case 'ping':
        return answer({ ok: true, hub: 'mock', site: 'app', version: MOCK_HUB_VERSION });
      case 'register':
        return this.register(body);
      case 'resend_code':
        return this.resendCode(body);
      case 'verify':
        return this.verify(body);
      case 'login':
        return this.login(body);
      case 'logout':
        this.visitors.delete(this.uuid(body, false));
        return { ok: true };
      case 'account': {
        const contact = this.byUuid(body);
        return { ok: true, contact: contact ? this.publicContact(contact) : null };
      }
      case 'profile':
        return this.profile(body);
      case 'reset_request': {
        const account = this.findAccount(str(body, 'login', 190));
        if (account) account.resetPending = true;
        return { ok: true, sent: true };
      }
      case 'reset_confirm':
        return this.resetConfirm(body);
      case 'delete_account':
        return this.deleteAccount(body);
      case 'activate_member':
        return this.activateMember(body);
      case 'member_status': {
        // M44: the hub answers other systems about a person's membership by phone or e-mail.
        const contact = this.findAccount(str(body, 'email', 190)) ?? this.findAccount(str(body, 'phone', 40));
        return contact ? { ok: true, found: true, contact: this.publicContact(contact) } : { ok: true, found: false };
      }
      case 'config':
        return this.chat.config();
      case 'message': {
        const contact = this.byUuid(body);
        if (!contact || !contact.passHash) throw new HubError('bad_uuid', 'معرّف الزائر غير صحيح', 400);
        return this.chat.message(contact.id, this.publicContact(contact), body);
      }
      case 'poll': {
        const contact = this.byUuid(body);
        return this.chat.poll(contact?.id ?? null, contact ? this.publicContact(contact) : null, body);
      }
      case 'history': {
        const contact = this.byUuid(body);
        return this.chat.history(contact?.id ?? null, contact ? this.publicContact(contact) : null);
      }
      case 'admin_stats':
        return answer(this.admin.stats(body));
      case 'admin_accounts':
        return answer(this.admin.accounts(body));
      case 'admin_member':
        return answer(this.admin.member(body));
      case 'admin_payments':
        return answer(this.admin.payments(body));
      case 'admin_tickets':
        return answer(this.admin.tickets(body));
      case 'admin_leads':
        return answer(this.admin.leads(body));
      case 'admin_threads':
        return answer(this.admin.threads(body));
      case 'admin_thread':
        return answer(this.admin.thread(body));
      case 'admin_reply':
        return answer(this.admin.reply(body));
      case 'admin_mail':
        return answer(this.admin.mail(body));
      case 'admin_grant':
        return answer(this.admin.grant(body));
      case 'admin_set_role':
        return answer(this.admin.setRole(body));
      case 'changes':
        return answer(this.admin.changes(body));
      case 'publish':
        return answer(this.admin.publish(body));
      case 'feed':
        return answer(this.admin.feed(body));
      default:
        throw new HubError('not_found', 'عملية غير معروفة', 404);
    }
  }

  private uuid(body: HubBody, strict = true): string {
    const uuid = str(body, 'uuid', 64).replace(/[^a-zA-Z0-9-]/g, '');
    if (uuid.length < 8 && strict) throw new HubError('bad_uuid', 'معرّف الزائر غير صحيح', 400);
    return uuid;
  }

  /** Store purchase → membership: `member_change(extend)`, idempotent on the store reference (plugin 2.7.0). */
  private activateMember(body: HubBody): HubResponse {
    const id = Number(body.contact_id);
    const contact = Number.isInteger(id) ? this.contacts.get(id) : undefined;
    if (!contact || !contact.verified) throw new HubError('not_found', 'الحساب غير موجود', 404);
    const { already } = this.admin.memberChange(contact, 'extend', Number(body.days), 'store', str(body, 'reference', 190), 0, str(body, 'product', 120));
    return { ok: true, contact: this.publicContact(contact), already };
  }

  private byUuid(body: HubBody): MockContact | null {
    const id = this.visitors.get(this.uuid(body));
    return id ? (this.contacts.get(id) ?? null) : null;
  }

  private findAccount(login: string): MockContact | null {
    const email = normEmail(login);
    const phone = email ? '' : normPhone(login);
    for (const contact of this.contacts.values()) {
      if (!contact.passHash) continue;
      if (email && contact.email === email) return contact;
      if (phone && contact.phoneNorm === phone) return contact;
    }
    return null;
  }

  private create(): MockContact {
    const contact = blankContact(nextId(this.state, 'contact'), Date.now());
    this.contacts.set(contact.id, contact);
    return contact;
  }

  /** M32, as plugin 2.7.2 resolves `referral`: digits → an existing, verified, active member — or the registration is refused. */
  private resolveReferral(body: HubBody): MockContact | null {
    const referral = str(body, 'referral', 40);
    if (!referral) return null;
    const id = Number.parseInt(referral.replace(/\D+/g, ''), 10);
    const contact = id > 0 ? this.contacts.get(id) : undefined;
    if (!contact || !contact.passHash || !contact.verified || this.publicContact(contact).is_member !== 1) {
      throw new HubError('referral', 'كود الدعوة غير صحيح أو عضوية صاحبه غير سارية — راجعه مع من دعاك، أو امسحه وأكمل التسجيل', 400);
    }
    return contact;
  }

  private register(body: HubBody): HubResponse {
    const name = str(body, 'name', 120);
    const country = str(body, 'country', 5).toLowerCase() || 'sa';
    const email = normEmail(str(body, 'email', 190));
    const persona = str(body, 'persona', 20).toLowerCase();
    const bio = str(body, 'bio', 600);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) throw new HubError('invalid', 'الاسم مطلوب', 400);
    const phoneNorm = phoneIntl(country, str(body, 'phone', 40));
    if (!phoneNorm) throw new HubError('phone', 'رقم الجوال غير صحيح أو ناقص — اكتبه بدون مسافات وبدون رمز الدولة', 400);
    if (!PERSONAS.includes(persona)) throw new HubError('invalid', 'اختر فئتك: محايد، رائد أعمال، أو مستثمر', 400);
    if (bio.length < 10) throw new HubError('invalid', 'اكتب نبذة مختصرة عنك (سطر على الأقل) لنكمل التسجيل', 400);
    if (!email) throw new HubError('invalid', 'البريد الإلكتروني مطلوب — يصلك عليه رمز التفعيل', 400);
    if (!emailAllowed(email)) throw new HubError('email_domain', `${EMAIL_POLICY_TEXT} — هذا البريد غير مقبول`, 400);
    if (password.length < 6) throw new HubError('invalid', 'كلمة المرور 6 أحرف على الأقل', 400);
    const referrer = this.resolveReferral(body);
    const uuid = this.uuid(body);
    const existing = [...this.contacts.values()].find(
      (contact) => contact.passHash && (contact.email === email || contact.phoneNorm === phoneNorm),
    );
    if (existing?.verified) {
      throw new HubError('exists', 'عندك حساب بهذا البريد أو الجوال — سجّل الدخول، أو استخدم «نسيت كلمة المرور»', 409);
    }
    const contact = existing ?? this.create();
    Object.assign(contact, {
      name,
      phone: phoneLocal(phoneNorm),
      phoneNorm,
      email,
      jobTitle: str(body, 'job_title', 150),
      persona,
      bio,
      passHash: hash(password),
      verified: false,
    });
    if (referrer && referrer.id !== contact.id) contact.referredBy = referrer.id;
    if (!existing) this.admin.event(contact.id, 'registered');
    this.visitors.set(uuid, contact.id);
    return {
      ok: true,
      pending: true,
      mail_sent: 1,
      contact: this.publicContact(contact),
      referred_by: contact.referredBy,
      referred_name: contact.referredBy ? (this.contacts.get(contact.referredBy)?.name ?? '') : '',
      text: `أرسلنا رمز التفعيل إلى ${email}`,
    };
  }

  private resendCode(body: HubBody): HubResponse {
    const contact = this.byUuid(body);
    if (!contact || !contact.passHash || contact.verified) throw new HubError('invalid', 'لا يوجد حساب بانتظار التفعيل', 400);
    return { ok: true, mail_sent: 1, text: `أعدنا إرسال الرمز إلى ${contact.email}` };
  }

  private verify(body: HubBody): HubResponse {
    const contact = this.byUuid(body);
    const code = str(body, 'code', 10).replace(/\D+/g, '');
    if (!contact || !contact.passHash) throw new HubError('invalid', 'لا يوجد حساب بانتظار التفعيل', 400);
    if (contact.verified) return { ok: true, contact: this.publicContact(contact), already: true };
    if (code !== MOCK_CODE) throw new HubError('bad_code', 'الرمز غير صحيح أو انتهت صلاحيته', 400);
    contact.verified = true;
    contact.verifiedAt = Date.now();
    this.admin.event(contact.id, 'verified');
    if (contact.email.includes('+member@')) {
      contact.isMember = true;
      contact.memberStartedAt = Date.now();
      this.admin.event(contact.id, 'activated', { days: contact.memberDays, source: 'list' });
    } else if (contact.email.includes('+expired@')) {
      contact.isMember = true;
      contact.memberStartedAt = Date.now() - 400 * 86_400_000;
    }
    return { ok: true, contact: this.publicContact(contact) };
  }

  private login(body: HubBody): HubResponse {
    const password = typeof body.password === 'string' ? body.password : '';
    const account = this.findAccount(str(body, 'login', 190));
    if (!account || !password || account.passHash !== hash(password)) {
      throw new HubError('bad_login', 'البريد/الجوال أو كلمة المرور غير صحيحة', 401);
    }
    this.visitors.set(this.uuid(body), account.id);
    account.lastLoginAt = Date.now();
    if (!account.verified) {
      return { ok: true, pending: true, mail_sent: 1, contact: this.publicContact(account), text: `حسابك بانتظار التفعيل — أرسلنا الرمز إلى ${account.email}` };
    }
    return { ok: true, contact: this.publicContact(account) };
  }

  private profile(body: HubBody): HubResponse {
    const contact = this.byUuid(body);
    if (!contact || !contact.passHash) throw new HubError('no_account', 'سجّل الدخول أولًا', 401);
    if (str(body, 'name', 120)) contact.name = str(body, 'name', 120);
    const fields: [keyof MockContact & string, string, number][] = [
      ['jobTitle', 'job_title', 150],
      ['company', 'company', 190],
      ['city', 'city', 120],
      ['website', 'website', 300],
      ['bio', 'bio', 600],
      ['social', 'social', 800],
    ];
    for (const [field, key, max] of fields) {
      if (key in body) (contact as unknown as Record<string, string>)[field] = str(body, key, max);
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (password) {
      if (password.length < 6) throw new HubError('invalid', 'كلمة المرور 6 أحرف على الأقل', 400);
      contact.passHash = hash(password);
    }
    return { ok: true, contact: this.publicContact(contact) };
  }

  private resetConfirm(body: HubBody): HubResponse {
    const account = this.findAccount(str(body, 'login', 190));
    const code = str(body, 'code', 10).replace(/\D+/g, '');
    const password = typeof body.password === 'string' ? body.password : '';
    if (!account || !account.resetPending || code !== MOCK_CODE) throw new HubError('bad_code', 'الرمز غير صحيح أو انتهت صلاحيته', 400);
    if (password.length < 6) throw new HubError('invalid', 'كلمة المرور 6 أحرف على الأقل', 400);
    account.passHash = hash(password);
    account.resetPending = false;
    return { ok: true };
  }

  private deleteAccount(body: HubBody): HubResponse {
    const contact = this.byUuid(body);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!contact || !contact.passHash) throw new HubError('no_account', 'سجّل الدخول أولًا', 401);
    if (!password || contact.passHash !== hash(password)) throw new HubError('bad_login', 'كلمة المرور غير صحيحة', 401);
    for (const [uuid, id] of this.visitors) {
      if (id === contact.id) this.visitors.delete(uuid);
    }
    this.contacts.delete(contact.id);
    this.chat.forget(contact.id);
    this.admin.event(contact.id, 'deleted');
    return { ok: true };
  }

  private publicContact(contact: MockContact): HubContact {
    const endMs = contact.memberStartedAt !== null ? contact.memberStartedAt + contact.memberDays * 86_400_000 : null;
    const daysLeft = contact.isMember && endMs !== null ? Math.ceil((endMs - Date.now()) / 86_400_000) : null;
    const active = contact.isMember && (daysLeft === null || daysLeft > 0);
    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      stage: contact.verified ? (active ? 2 : 1) : 0,
      is_member: active ? 1 : 0,
      member_left: daysLeft,
      member_days: contact.memberDays,
      member_end: endMs !== null ? isoDate(endMs) : '',
      member_expired: contact.isMember && !active ? 1 : 0,
      daily_limit: MOCK_DAILY_LIMIT,
      daily_left: active ? MOCK_DAILY_LIMIT : null,
      has_account: contact.passHash ? 1 : 0,
      verified: contact.verified ? 1 : 0,
      role: contact.role,
      is_admin: contact.verified && contact.role === 'admin' ? 1 : 0,
      job_title: contact.jobTitle,
      persona: contact.persona,
      website: contact.website,
      social: contact.social,
      avatar: contact.avatar,
      company: contact.company,
      city: contact.city,
      bio: contact.bio,
      pending_pay: contact.passHash && contact.verified && !contact.isMember ? 1 : 0,
    };
  }
}
