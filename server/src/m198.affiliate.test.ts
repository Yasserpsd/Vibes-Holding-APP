import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { AffiliateService, AFFILIATES_KEY, type AffiliateRecord } from './affiliate/service.js';
import { latinPrefix, newShortCode, normalizeShortCode } from './affiliate/shortCode.js';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { InvitesService } from './invites/service.js';
import { LogMailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { MemoryKV } from './store.js';

// M198 (owner, 2026-11-04): the affiliate's SHORT referral code («FAR-27») — unique per affiliate, resolved
// by the link and by the register form, while the hub keeps receiving the membership number only.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com', PUBLIC_URL: 'https://api-test.vibesholdingsa.com' });

/** The mock hub makes every verified account an admin; chosen ids become plain members here. */
class LeveledHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly members = new Set<number>();
  private readonly inner = new MockHubClient();
  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const response = await this.inner.call(op, body);
    const contact = response.contact;
    if (contact && this.members.has(contact.id)) return { ...response, contact: { ...contact, is_admin: 0, role: 'member' } };
    return response;
  }
}

const hub = new LeveledHub();
const mailer = new LogMailer();
let built: BuiltApp;
let app: BuiltApp['app'];
let adminToken = '';
const affiliates: { token: string; id: number; cardNumber: string; shortCode: string }[] = [];

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

let nextPhone = 7719250;
const register = (email: string, extra: Record<string, unknown> = {}) =>
  send('POST', '/api/auth/register', {
    name: 'عضو نادي المستثمرين',
    country: 'sa',
    phone: `055${(nextPhone += 1)}`,
    email,
    password: 'secret123',
    persona: 'neutral',
    bio: 'حساب اختبار لرمز الإحالة المختصر.',
    ...extra,
  });

async function signUp(email: string, extra: Record<string, unknown> = {}): Promise<{ token: string; id: number }> {
  const registered = await register(email, extra);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const APPLY = {
  entityType: 'individual' as const,
  bankName: 'البنك الأهلي السعودي',
  accountName: 'Faris Al Otaibi',
  iban: 'SA44 2000 0001 2345 6789 1234',
  city: 'الرياض',
  address: 'حي العليا، شارع الأمير محمد بن عبدالعزيز',
  heardFrom: 'منصة إكس',
  heardFromNote: '',
};

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  adminToken = (await signUp('m198.admin@gmail.com')).token;
  // Two affiliates whose names share the same three letters — the number must tell them apart.
  for (const [email, name] of [
    ['m198.faris1@gmail.com', 'فارس العتيبي'],
    ['m198.faris2@gmail.com', 'فارس الدوسري'],
  ] as const) {
    const member = await signUp(email, { name, persona: 'investor' });
    hub.members.add(member.id);
    await get('/api/me?fresh=1', member.token);
    const cardNumber = (await get('/api/me', member.token)).json().me.cardNumber as string;
    affiliates.push({ ...member, cardNumber, shortCode: '' });
  }
});

after(async () => {
  await app.close();
});

test('the prefix is the first three Latin letters of the name, the article dropped; the alias normalizes', () => {
  assert.equal(latinPrefix('فارس العتيبي'), 'FAR');
  assert.equal(latinPrefix('الفارس'), 'FAR');
  assert.equal(latinPrefix('خالد الفوزان'), 'KHA');
  assert.equal(latinPrefix('Khaled Al Saud'), 'KHA');
  assert.equal(latinPrefix('محمد'), 'MHM');
  assert.equal(latinPrefix('عبدالله'), 'ABD');
  assert.equal(latinPrefix('Jo'), 'JOX');
  assert.equal(latinPrefix('   '), 'INV');

  assert.equal(normalizeShortCode('far2'), 'FAR2');
  assert.equal(normalizeShortCode('far 27'), 'FAR-27');
  assert.equal(normalizeShortCode('FAR-027'), 'FAR-27');
  assert.equal(normalizeShortCode('far27'), 'FAR-27');
  assert.equal(normalizeShortCode('FAR-٢٧'), 'FAR-27');
  // A membership number, two letters or nothing at all is NOT a short code.
  assert.equal(normalizeShortCode('I-0000000042'), null);
  assert.equal(normalizeShortCode('FA-1'), null);
  assert.equal(normalizeShortCode(''), null);

  // The digit moves up until it is free.
  const first = newShortCode('فارس العتيبي', []);
  assert.equal(first, 'FAR2');
  assert.equal(newShortCode('فارس الدوسري', [first]), 'FAR3');
  assert.equal(newShortCode('فارس الدوسري', [first, 'far3']), 'FAR4');
});

test('an approved affiliate gets a short code: unique, in his link, his share text and his mail', async () => {
  for (const affiliate of affiliates) {
    const applied = await send('POST', '/api/affiliate/apply', APPLY, affiliate.token);
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal((await send('POST', '/api/affiliate/agreement', {}, affiliate.token)).statusCode, 200);
    const approved = await send('POST', `/api/admin/affiliates/${affiliate.id}/decision`, { status: 'approved' }, adminToken);
    assert.equal(approved.statusCode, 200, approved.body);
    const row = approved.json().affiliate as AffiliateRecord;
    assert.match(row.shortCode ?? '', /^FAR[2-9]$/);
    affiliate.shortCode = row.shortCode ?? '';

    const mine = await get('/api/affiliate', affiliate.token);
    assert.equal(mine.statusCode, 200, mine.body);
    assert.equal(mine.json().code, affiliate.shortCode);
    assert.equal(mine.json().link, `https://api-test.vibesholdingsa.com/r/${affiliate.shortCode.toLowerCase()}`);
    assert.ok((mine.json().shareText as string).includes(affiliate.shortCode));
    assert.ok(!(mine.json().shareText as string).includes(affiliate.cardNumber));

    // The decision mail names the short code (and the link carrying it).
    const mail = mailer.sent.at(-1);
    assert.match(mail?.text ?? '', new RegExp(affiliate.shortCode, 'i'));
  }
  assert.notEqual(affiliates[0]?.shortCode, affiliates[1]?.shortCode);

  // The dashboard list shows both the alias and the membership number.
  const list = await get('/api/admin/affiliates', adminToken);
  const rows = list.json().affiliates as AffiliateRecord[];
  for (const affiliate of affiliates) {
    const row = rows.find((entry) => entry.contactId === affiliate.id);
    assert.equal(row?.shortCode, affiliate.shortCode);
    assert.equal(row?.code, affiliate.cardNumber);
  }
});

test('the referral page answers to the short code in any spelling and to the membership number', async () => {
  const [faris] = affiliates;
  assert.ok(faris);
  for (const form of [faris.shortCode, faris.shortCode.toLowerCase(), `${faris.shortCode.slice(0, 3)}-${faris.shortCode.slice(3)}`, faris.cardNumber]) {
    const page = await get(`/r/${encodeURIComponent(form)}`);
    assert.equal(page.statusCode, 200, `${form}: ${page.statusCode}`);
    assert.match(page.body, new RegExp(`id="ref-code">${faris.shortCode}<`));
  }
  const unknown = await get('/r/ZZZ-99');
  assert.equal(unknown.statusCode, 302);
});

test('M202: «دعوة عضو» gives an approved representative his short code; a plain member keeps his number', async () => {
  const [faris] = affiliates;
  assert.ok(faris);
  const invite = (await get('/api/invites', faris.token)).json() as { code: string; shareText: string };
  assert.equal(invite.code, faris.shortCode);
  assert.ok(invite.shareText.includes(faris.shortCode));
  assert.ok(!invite.shareText.includes(faris.cardNumber));

  const member = (await get('/api/invites', adminToken)).json() as { code: string };
  assert.equal(member.code, (await get('/api/me', adminToken)).json().me.cardNumber);
});

test('a new member registers with the short code: the hub receives the membership number', async () => {
  const [faris, other] = affiliates;
  assert.ok(faris && other);
  const registered = await register('m198.referral@gmail.com', { inviteCode: faris.shortCode.toLowerCase(), name: 'عضو محال' });
  assert.equal(registered.statusCode, 200, registered.body);

  const mine = await get('/api/affiliate', faris.token);
  const referrals = mine.json().referrals as { name: string; paid: boolean }[];
  assert.equal(referrals.length, 1);
  assert.equal(referrals[0]?.name, 'عضو محال');
  // The other FAR-affiliate was not credited.
  assert.equal(((await get('/api/affiliate', other.token)).json().referrals as unknown[]).length, 0);

  // The membership number still works as the invite code, and a short code nobody holds is refused.
  const byNumber = await register('m198.referral2@gmail.com', { inviteCode: faris.cardNumber, name: 'عضو ثان' });
  assert.equal(byNumber.statusCode, 200, byNumber.body);
  assert.equal(((await get('/api/affiliate', faris.token)).json().referrals as unknown[]).length, 2);
  const bogus = await register('m198.bogus@gmail.com', { inviteCode: 'ZZZ-99', name: 'عضو ضائع' });
  assert.equal(bogus.statusCode, 400, bogus.body);
  assert.equal(bogus.json().error.code, 'invite_code');
});

test('records saved before M198 get their short codes on the next load, and keep them', async () => {
  const kv = new MemoryKV();
  const legacy = (contactId: number, name: string): AffiliateRecord => ({
    contactId,
    name,
    email: `${contactId}@gmail.com`,
    phone: '0550001111',
    code: `I-${String(contactId).padStart(10, '0')}`,
    status: 'approved',
    entityType: 'individual',
    bankName: 'بنك',
    accountName: 'Account Holder',
    iban: 'SA4420000001234567891234',
    city: 'الرياض',
    address: 'حي العليا، شارع الأمير محمد بن عبدالعزيز',
    heardFrom: 'منصة إكس',
    heardFromNote: '',
    appliedAt: `2026-11-0${contactId - 79}T10:00:00.000Z`,
    agreementSentAt: '2026-11-01T10:00:00.000Z',
    agreementAcceptedAt: '2026-11-01T10:00:00.000Z',
    decidedAt: '2026-11-01T10:00:00.000Z',
    decidedBy: 'الإدارة',
    adminNote: null,
  });
  await kv.set(AFFILIATES_KEY, { affiliates: [legacy(81, 'سارة القحطاني'), legacy(80, 'سارة الشمري')] });
  const notifier = new Notifier({ mailer: new LogMailer(), recipients: [], log: built.app.log, appEnv: 'test' });
  const invites = new InvitesService({ kv, hub, notifier, log: built.app.log });
  const service = new AffiliateService({ kv, invites, notifier, log: built.app.log, publicUrl: 'https://api-test.vibesholdingsa.com' });

  const first = await service.find(80);
  const second = await service.find(81);
  assert.match(first?.shortCode ?? '', /^SAR[2-9]$/);
  assert.match(second?.shortCode ?? '', /^SAR[2-9]$/);
  assert.notEqual(first?.shortCode, second?.shortCode);
  // The same alias on every load, and persisted by the queued write.
  assert.equal((await service.find(80))?.shortCode, first?.shortCode);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stored = (await kv.get<{ affiliates: AffiliateRecord[] }>(AFFILIATES_KEY))?.affiliates ?? [];
  assert.deepEqual(
    stored.map((record) => [record.contactId, record.shortCode]).sort(),
    [
      [80, first?.shortCode],
      [81, second?.shortCode],
    ],
  );

  // Both forms resolve, and the invite channel maps the alias to the membership number.
  assert.equal((await service.findByCode(first?.shortCode ?? ''))?.contactId, 80);
  assert.equal((await service.findByCode('I-0000000081'))?.contactId, 81);
  assert.equal(await invites.prepare(` ${(second?.shortCode ?? '').toLowerCase()} `), 'I-0000000081');
  assert.equal(await invites.prepare('I-0000000080'), 'I-0000000080');
});
