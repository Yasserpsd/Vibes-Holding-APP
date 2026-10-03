import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M16: the in-app registration forms (شركاء النجاح public, the workshop behind the account) and
// the dashboard's notification-recipients list over the NOTIFY_EMAIL fallback.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

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
let memberToken = '';
let memberId = 0;
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

const PARTNER_ANSWERS = {
  firstName: 'سالم',
  lastName: 'العتيبي',
  country: 'السعودية',
  city: 'الرياض',
  whatsapp: '+966500000001',
  email: 'salem@example.com',
  company: 'شركة تجربة',
  stage: 'بدأت بتحقيق دخل',
  sector: 'التجارة والتجزئة',
  summary: 'منصة تجارة متخصصة تبحث عن شركاء.',
  deck: 'نعم',
  ownership: '1',
  nda: '1',
};

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'عضو النماذج', country: 'sa', phone, email, password: 'secret123', persona: 'entrepreneur', bio: 'حساب اختبار نماذج التسجيل داخل التطبيق.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  const member = await signUp('m16.member@gmail.com', '0558618841');
  memberToken = member.token;
  memberId = member.id;
  adminToken = (await signUp('m16.admin@gmail.com', '0558618842')).token;
  hub.members.add(memberId);
  await get('/api/me?fresh=1', memberToken);
});

after(async () => {
  await app.close();
});

test('the definitions answer publicly, in both languages, and an unknown key is 404', async () => {
  const ar = await get('/api/forms/success-partners');
  assert.equal(ar.statusCode, 200);
  assert.equal(ar.json().form.title, 'التسجيل في شركاء النجاح');
  assert.equal(ar.json().form.access, 'everyone');
  assert.ok((ar.json().form.fields as { key: string }[]).some((field) => field.key === 'nda'));

  const en = await get('/api/forms/workshop?lang=en');
  assert.equal(en.statusCode, 200);
  assert.equal(en.json().form.title, 'Workshop registration');

  assert.equal((await get('/api/forms/nothing')).statusCode, 404);
});

test('the services catalogue now points both services at the native forms', async () => {
  const services = await get('/api/services');
  assert.equal(services.statusCode, 200);
  const list = services.json().services as { key: string; action: { type: string; formKey?: string } | null }[];
  assert.deepEqual(list.find((entry) => entry.key === 'success-partners')?.action, { type: 'form', formKey: 'success-partners', label: 'سجّل مشروعك' });
  assert.deepEqual(list.find((entry) => entry.key === 'workshop')?.action, { type: 'form', formKey: 'workshop', label: 'سجّل في الورشة' });
});

test('a guest registers in شركاء النجاح: validated, stored, mailed', async () => {
  const mailCount = mailer.sent.length;

  // Required fields are refused one by one, in the server's own words.
  const missing = await send('POST', '/api/forms/success-partners', { answers: { ...PARTNER_ANSWERS, company: ' ' } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, 'invalid_field');

  const badChoice = await send('POST', '/api/forms/success-partners', { answers: { ...PARTNER_ANSWERS, stage: 'مرحلة من عندي' } });
  assert.equal(badChoice.statusCode, 400);

  const notAgreed = await send('POST', '/api/forms/success-partners', { answers: { ...PARTNER_ANSWERS, nda: '' } });
  assert.equal(notAgreed.statusCode, 400);
  assert.match(notAgreed.json().error.message as string, /وافق/);

  const sent = await send('POST', '/api/forms/success-partners', { answers: PARTNER_ANSWERS });
  assert.equal(sent.statusCode, 201, sent.body);
  assert.equal(sent.json().submission.formKey, 'success-partners');

  assert.equal(mailer.sent.length, mailCount + 1);
  const mail = mailer.sent.at(-1)!;
  assert.match(mail.subject, /تسجيل جديد/);
  assert.match(mail.text, /سالم العتيبي/);
  assert.match(mail.text, /شركة تجربة/);
  assert.deepEqual(mail.to, ['admin@vcmem.com']);
});

test('the English app may send the English choice of a select', async () => {
  const sent = await send('POST', '/api/forms/success-partners', { answers: { ...PARTNER_ANSWERS, stage: 'Started generating revenue', company: 'شركة اللغة' } });
  assert.equal(sent.statusCode, 201, sent.body);
});

test('the workshop form needs the account, registers once, and shows under mine', async () => {
  const guest = await send('POST', '/api/forms/workshop', { answers: { city: 'جدة', mode: 'عبر الإنترنت', bio: 'رائد أعمال.', terms: '1' } });
  assert.equal(guest.statusCode, 401);

  const first = await send('POST', '/api/forms/workshop', { answers: { city: 'جدة', mode: 'عبر الإنترنت', bio: 'رائد أعمال.', terms: '1' } }, memberToken);
  assert.equal(first.statusCode, 201, first.body);

  const again = await send('POST', '/api/forms/workshop', { answers: { city: 'جدة', mode: 'عبر الإنترنت', bio: 'رائد أعمال.', terms: '1' } }, memberToken);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'already_registered');

  const mine = await get('/api/forms/mine', memberToken);
  assert.equal(mine.statusCode, 200);
  assert.equal((mine.json().submissions as { formKey: string }[]).filter((entry) => entry.formKey === 'workshop').length, 1);
});

test('the dashboard lists the submissions and the handled toggle keeps the admin name', async () => {
  assert.equal((await get('/api/admin/forms', memberToken)).statusCode, 403);

  const listed = await get('/api/admin/forms', adminToken);
  assert.equal(listed.statusCode, 200);
  const submissions = listed.json().submissions as { id: string; formKey: string; contactId: number | null; name: string; handled: boolean }[];
  assert.ok(submissions.length >= 3);
  const partner = submissions.find((entry) => entry.formKey === 'success-partners' && entry.contactId === null);
  assert.ok(partner, 'the guest submission is in the list');
  assert.equal(partner.name, 'سالم العتيبي');
  assert.ok((listed.json().forms as { key: string }[]).some((entry) => entry.key === 'workshop'));

  const done = await send('POST', `/api/admin/forms/${partner.id}/handled`, { handled: true }, adminToken);
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().submission.handled, true);
  assert.ok(done.json().submission.handledBy);

  const back = await send('POST', `/api/admin/forms/${partner.id}/handled`, { handled: false }, adminToken);
  assert.equal(back.json().submission.handled, false);
  assert.equal(back.json().submission.handledBy, null);
});

test('the notification recipients: env fallback, dashboard list, validation, reset', async () => {
  const initial = await get('/api/admin/notify', adminToken);
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json().settings, { recipients: ['admin@vcmem.com'], source: 'env', envRecipients: ['admin@vcmem.com'], by: null, at: null });

  assert.equal((await send('PUT', '/api/admin/notify', { recipients: [] }, adminToken)).statusCode, 400);
  assert.equal((await send('PUT', '/api/admin/notify', { recipients: ['not-a-mail'] }, adminToken)).statusCode, 400);

  const saved = await send('PUT', '/api/admin/notify', { recipients: ['Owner@vcmem.com', 'team@vcmem.com', 'owner@vcmem.com'] }, adminToken);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json().settings.recipients, ['owner@vcmem.com', 'team@vcmem.com']);
  assert.equal(saved.json().settings.source, 'dashboard');

  // The very next notification mail goes to the dashboard's list, not the variable's.
  const mailCount = mailer.sent.length;
  const sent = await send('POST', '/api/forms/success-partners', { answers: { ...PARTNER_ANSWERS, company: 'شركة القائمة' } });
  assert.equal(sent.statusCode, 201);
  assert.equal(mailer.sent.length, mailCount + 1);
  assert.deepEqual(mailer.sent.at(-1)!.to, ["owner@vcmem.com", "team@vcmem.com"]);

  const reset = await send('DELETE', '/api/admin/notify', undefined, adminToken);
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().settings.source, 'env');

  await send('POST', '/api/forms/success-partners', { answers: { ...PARTNER_ANSWERS, company: 'شركة الرجوع' } });
  assert.deepEqual(mailer.sent.at(-1)!.to, ['admin@vcmem.com']);
});
