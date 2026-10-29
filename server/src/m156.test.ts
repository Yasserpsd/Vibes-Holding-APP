import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nameIssueMessage, nameProblem, nameRuleIssue, NameJudge } from './auth/name.js';
import { isRelayEmail, mailAddressOf, profileMissingOf } from './auth/service.js';
import type { HubContact } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { royalHtml, royalText } from './mail/royal.js';

// M156 (owner, 2026-10-29): a royal activation mail to the member's REAL address, no app before a
// complete profile (job + real name + a real address over an Apple relay), and the real-name rule.

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as unknown as import('fastify').FastifyBaseLogger;

test('m156: the name rule accepts real first + family names in Arabic and Latin', () => {
  for (const name of ['محمد العتيبي', 'Nouf Alsufiany', 'عبد الله بن سعود', 'abdullah al-otaibi', 'أبو بكر العتيبي', "Dr. Ahmed D'Souza", 'سَعْد الشَّهْري']) {
    assert.equal(nameRuleIssue(name), null, name);
  }
});

test('m156: the name rule rejects kunyas, single words, placeholders, digits and mash', () => {
  assert.equal(nameRuleIssue('أبو محمد'), 'kunya');
  assert.equal(nameRuleIssue('أم جنا'), 'kunya');
  assert.equal(nameRuleIssue('Abu Khalid'), 'kunya');
  assert.equal(nameRuleIssue('Charif'), 'oneWord');
  assert.equal(nameRuleIssue('سارة'), 'short');
  assert.equal(nameRuleIssue('ناصر ب'), 'oneWord');
  assert.equal(nameRuleIssue('Test User'), 'placeholder');
  assert.equal(nameRuleIssue('عضو تجريبي'), 'placeholder');
  assert.equal(nameRuleIssue('محمد محمد'), 'placeholder');
  assert.equal(nameRuleIssue('محمد 123'), 'symbols');
  assert.equal(nameRuleIssue('asdfgh qwerty'), 'mash');
  assert.equal(nameRuleIssue('aaaaaa bbbb'), 'mash');
  assert.match(nameIssueMessage('kunya', 'ar'), /أبو محمد/);
  assert.match(nameIssueMessage('oneWord', 'en'), /family name/);
});

test('m156: the AI pass only ever adds a FAKE verdict and fails open', async () => {
  const answer = (content: string) => (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch;
  const fake = new NameJudge({ apiKey: 'k', model: 'm', log: silentLog, fetchImpl: answer('FAKE') });
  const real = new NameJudge({ apiKey: 'k', model: 'm', log: silentLog, fetchImpl: answer('REAL') });
  const broken = new NameJudge({ apiKey: 'k', model: 'm', log: silentLog, fetchImpl: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch });
  assert.equal(await fake.judge('صقر الصحراء'), 'fake');
  assert.equal(await real.judge('صقر الصحراء'), 'real');
  assert.equal(await broken.judge('صقر الصحراء'), 'unsure');
  assert.match((await nameProblem('صقر الصحراء', 'ar', fake)) ?? '', /اسم العائلة/);
  assert.equal(await nameProblem('صقر الصحراء', 'ar', real), null);
  assert.equal(await nameProblem('صقر الصحراء', 'ar', broken), null);
  // The rules run before the model: a kunya never reaches it.
  assert.match((await nameProblem('أبو جنا', 'ar', real)) ?? '', /الكنية/);
});

const base = {
  id: 7,
  name: 'نوف السفياني',
  email: 'fp9928zggf@privaterelay.appleid.com',
  phone: '0551234567',
  persona: 'neutral',
  bio: 'باحثة في الاستثمار والتجارة الإلكترونية.',
  job_title: 'مديرة تسويق',
  company: '',
  member_type: 'individual' as const,
  interests: 'التجارة والتجزئة',
  city: '',
  website: '',
  social: '',
  avatar: '',
  verified: 1,
  is_admin: 0,
  role: '',
} as unknown as HubContact;

test('m156: the gate asks for the job, a real name and a real address over an Apple relay (hub 2.26.0 only)', () => {
  assert.deepEqual(profileMissingOf(base), []);
  assert.deepEqual(profileMissingOf({ ...base, job_title: '' }), ['jobTitle']);
  assert.deepEqual(profileMissingOf({ ...base, name: 'أبو جنا' }), ['name']);
  // An older hub never reports contact_email: a relay account is not blocked for a field it cannot store.
  assert.deepEqual(profileMissingOf({ ...base, contact_email: '' }), ['contactEmail']);
  assert.deepEqual(profileMissingOf({ ...base, contact_email: 'nouf@example.test' }), []);
  assert.deepEqual(profileMissingOf({ ...base, email: 'nouf@gmail.com', contact_email: '' }), []);
  assert.equal(isRelayEmail('fp9928zggf@privaterelay.appleid.com'), true);
  assert.equal(isRelayEmail('nouf@gmail.com'), false);
  assert.equal(mailAddressOf({ email: base.email, contact_email: 'nouf@example.test' }), 'nouf@example.test');
  assert.equal(mailAddressOf({ email: base.email, contact_email: '' }), base.email);
});

test('m156: the member gets the royal activation mail at the real address, the admins their royal copy', () => {
  const mailer = new LogMailer();
  const notifier = new Notifier({ mailer, recipients: ['info@vcmem.com'], log: silentLog, appEnv: 'production', publicUrl: 'https://api.example.test' });
  const activation = {
    contactId: 7,
    name: 'نوف السفياني',
    email: 'fp9928zggf@privaterelay.appleid.com',
    contactEmail: 'nouf@example.test',
    phone: '0551234567',
    productId: 'club_membership_annual',
    store: 'APP_STORE',
    reference: '600002879903060',
    days: 365,
    expiresAt: '2027-10-29T17:56:00.000Z',
    environment: 'PRODUCTION',
    lang: 'ar' as const,
    cardNumber: 'VC-0007',
  };
  notifier.memberActivated(activation);
  notifier.membershipActivated(activation);
  assert.equal(mailer.sent.length, 2);
  const [member, admins] = mailer.sent;
  assert.deepEqual(member?.to, ['nouf@example.test']);
  assert.equal(member?.subject, 'عضويتك في Investors Club مفعّلة');
  assert.match(member?.html ?? '', /أهلًا بك يا نوف السفياني/);
  assert.match(member?.html ?? '', /VC-0007/);
  assert.match(member?.html ?? '', /Apple App Store/);
  assert.match(member?.html ?? '', /invoice-stamp\.png/);
  assert.match(member?.html ?? '', /https:\/\/api\.example\.test\/app/);
  assert.match(member?.text ?? '', /رقم العضوية: VC-0007/);
  assert.ok(!(member?.html ?? '').includes('privaterelay'), 'the relay address never shows on the member mail');
  assert.deepEqual(admins?.to, ['info@vcmem.com']);
  assert.match(admins?.subject ?? '', /تفعيل عضوية سنوية من المتجر: نوف السفياني/);
  assert.match(admins?.html ?? '', /بريد التواصل/);
  assert.match(admins?.text ?? '', /المدة: 365 يومًا/);

  // English member, no real address yet: the relay gets it (Apple forwards it), in English.
  notifier.memberActivated({ ...activation, contactEmail: '', lang: 'en', store: 'PLAY_STORE' });
  const english = mailer.sent.at(-1);
  assert.deepEqual(english?.to, ['fp9928zggf@privaterelay.appleid.com']);
  assert.equal(english?.subject, 'Your Investors Club membership is active');
  assert.match(english?.html ?? '', /Google Play/);
});

test('m156: the royal shell escapes values and keeps a text twin', () => {
  const mail = { lang: 'ar' as const, title: 'عنوان', rows: [{ label: 'الاسم', value: '<b>x</b>' }], cta: { label: 'افتح', url: 'https://x.test/a?b=1&c=2' } };
  assert.match(royalHtml(mail), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(royalHtml(mail), /dir="rtl"/);
  assert.match(royalText(mail), /الاسم: <b>x<\/b>/);
  assert.match(royalText(mail), /افتح: https:\/\/x\.test\/a\?b=1&c=2/);
});
