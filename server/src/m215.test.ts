import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { AUDIT_KEY, type AuditEntry } from './dashboard/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { dropTrunkZero, hubNumber, nationalDigits, normLogin, phoneIntl } from './hub/phone.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';
import { normalizePhone } from './whatsapp/phone.js';

test('a stray zero never reaches WhatsApp', () => {
  assert.equal(normalizePhone('+20 0100 123 4567'), '201001234567');
  assert.equal(normalizePhone('00200100 123 4567'), '201001234567');
  assert.equal(normalizePhone('+44 07911 123456'), '447911123456');
  assert.equal(normalizePhone('+966 00 503844438'), '966503844438');
  assert.equal(normalizePhone('0966503844438'), '966503844438');
  assert.equal(normalizePhone('09660503844438'), '966503844438');
  assert.equal(normalizePhone('00503844438'), '966503844438');
});

test('the zero stays where it belongs to the number', () => {
  assert.equal(dropTrunkZero('2250701234567'), '2250701234567');
  assert.equal(dropTrunkZero('390612345678'), '390612345678');
  assert.equal(normalizePhone('201001234567'), '201001234567');
  assert.equal(normalizePhone('0100123456'), null);
});

test('the forms clean what the member typed', () => {
  assert.equal(nationalDigits('00551623111', 'sa'), '551623111');
  assert.equal(nationalDigits('+966 0551623111', 'sa'), '551623111');
  assert.equal(nationalDigits('٠٥٥١٦٢٣١١١', 'sa'), '551623111');
  assert.equal(nationalDigits('055 162 3111', 'sa'), '551623111');
  assert.equal(nationalDigits('0100 123 4567', 'eg'), '1001234567');
  assert.equal(nationalDigits('abc', 'sa'), '');
  assert.equal(hubNumber('00551623111', 'sa'), '0551623111');
  assert.equal(hubNumber('551623111', 'sa'), '0551623111');
  assert.equal(hubNumber('0 51234567', 'kw'), '51234567');
  assert.equal(hubNumber('0100 123 4567', 'eg'), '1001234567');
  assert.equal(hubNumber('abc', 'sa'), 'abc');
  assert.equal(phoneIntl('sa', '00551623111'), '966551623111');
  assert.equal(phoneIntl('kw', '051234567'), '96551234567');
  assert.equal(phoneIntl('sa', '0551623'), '');
  assert.equal(normLogin('+966 0551623111'), '966551623111');
  assert.equal(normLogin('+20 0100 123 4567', 'eg'), '201001234567');
});

const mailer = new LogMailer();
const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let caller = 0;

const post = (url: string, payload: Record<string, unknown>, token?: string) => {
  caller += 1;
  return app.inject({ method: 'POST', url, payload, remoteAddress: `10.21.5.${(caller % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
};

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await post('/api/auth/register', { name: 'سلطان العتيبي', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب لاختبار إشعار العضوية الشرفية.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const adminMails = () => mailer.sent.filter((mail) => mail.to.includes('admin@vcmem.com'));

before(async () => {
  app = (await buildApp({ config, kv, hub: new MockHubClient({ seed: true }), mailer })).app;
  adminToken = (await signUp('m215.admin@gmail.com', '0558321501')).token;
});

after(async () => {
  await app.close();
});

test('a number typed with a doubled zero registers clean', async () => {
  const member = await signUp('m215.zero@gmail.com', '00558321502');
  const me = (await app.inject({ method: 'GET', url: '/api/me?fresh=1', headers: { authorization: `Bearer ${member.token}` } })).json().me;
  assert.equal(me.phone, '0558321502');
});

test('an honorary grant and revoke write their own note and mail the management', async () => {
  const member = await signUp('m215.partner@gmail.com', '0558321503');
  const before = adminMails().length;

  const given = await post(`/api/admin/accounts/${member.id}/honorary`, { on: true, confirm: true }, adminToken);
  assert.equal(given.statusCode, 200, given.body);
  const grantMail = adminMails().at(-1)!;
  assert.equal(adminMails().length, before + 1);
  assert.match(grantMail.subject, /منح العضوية الشرفية/);
  assert.match(grantMail.text, /m215\.partner@gmail\.com/);
  assert.match(grantMail.text, /شريك رسمي في عقد تأسيس/);

  const audit = (await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? [];
  const entry = audit.find((row) => row.action === 'honorary' && row.contactId === member.id && row.result === 'ok');
  assert.match(entry?.note ?? '', /منح العضوية الشرفية/);

  const taken = await post(`/api/admin/accounts/${member.id}/honorary`, { on: false, note: 'انتهت الشراكة', confirm: true }, adminToken);
  assert.equal(taken.statusCode, 200, taken.body);
  const revokeMail = adminMails().at(-1)!;
  assert.match(revokeMail.subject, /سحب العضوية الشرفية/);
  assert.match(revokeMail.text, /انتهت الشراكة/);
});

test('a refused grant mails nobody', async () => {
  const member = await signUp('m215.twice@gmail.com', '0558321504');
  assert.equal((await post(`/api/admin/accounts/${member.id}/honorary`, { on: true, confirm: true }, adminToken)).statusCode, 200);
  const count = adminMails().length;
  assert.notEqual((await post(`/api/admin/accounts/${member.id}/honorary`, { on: true, confirm: true }, adminToken)).statusCode, 200);
  assert.equal(adminMails().length, count);
});
