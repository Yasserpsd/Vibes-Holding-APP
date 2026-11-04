import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { compareVersions } from './appVersion.js';
import { cityKeyOf, cityChoices } from './affiliate/cities.js';
import { saudiIbanIssue } from './affiliate/iban.js';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M195 (owner, 2026-11-04): real form checks (Saudi IBAN mod-97, English account name, a city from the list,
// an address that is not a name, no dots in a name), the English source options and mails for English
// applicants, the admin mail's «لغة العضو» line, and the forced-update floor (426 update_required).
const config = loadConfig({
  LOG_LEVEL: 'silent',
  HUB_MODE: 'mock',
  NEWS_REFRESH_MINUTES: '0',
  VIDEOS_REFRESH_MINUTES: '0',
  NOTIFY_EMAIL: 'admin@vcmem.com',
  PUBLIC_URL: 'https://api-test.vibesholdingsa.com',
  MIN_APP_VERSION: '1.3.0',
});

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
let englishToken = '';
let englishId = 0;
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers: { ...bearer(token), ...headers } });
const send = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: Record<string, unknown>, token?: string, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { ...bearer(token), ...headers } });

let nextPhone = 7724250;
async function signUp(email: string, name = 'عضو نادي المستثمرين'): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', {
    name,
    country: 'sa',
    phone: `055${(nextPhone += 1)}`,
    email,
    password: 'secret123',
    persona: 'neutral',
    bio: 'حساب اختبار لنماذج التطبيق في M195.',
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

const APPLY = {
  entityType: 'individual' as const,
  bankName: 'البنك الأهلي السعودي',
  accountName: 'Faris Salem Almasrahi',
  iban: 'SA23 1000 0004 6000 0009 0602',
  city: 'dammam',
  cityOther: '',
  address: 'حي الشاطئ، شارع الأمير محمد، مبنى 12',
  heardFrom: 'منصة إكس',
};

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  const member = await signUp('m195+member@gmail.com');
  memberToken = member.token;
  hub.members.add(member.id);
  await get('/api/me?fresh=1', memberToken);
  const english = await signUp('m195+english@gmail.com', 'Faris Almasrahi');
  englishToken = english.token;
  englishId = english.id;
  hub.members.add(englishId);
  await get('/api/me?fresh=1', englishToken);
  adminToken = (await signUp('m195.admin@gmail.com')).token;
});

after(async () => {
  await app.close();
});

test('the Saudi IBAN check: SA, 24 characters, mod-97', () => {
  assert.equal(saudiIbanIssue('SA23 1000 0004 6000 0009 0602'), null);
  assert.equal(saudiIbanIssue('sa4420000001234567891234'), null);
  assert.equal(saudiIbanIssue('AE070331234567890123456'), 'start');
  assert.equal(saudiIbanIssue('SA2310000004600000090'), 'length');
  assert.equal(saudiIbanIssue('SA23 1000 0004 6000 0009 0603'), 'checksum');
});

test('the city list: keys, names of older bundles, and «other»', () => {
  assert.equal(cityKeyOf('الدمام'), 'dammam');
  assert.equal(cityKeyOf('Riyadh'), 'riyadh');
  assert.equal(cityKeyOf('Dammqm'), 'other');
  assert.equal(cityChoices('en').find((city) => city.value === 'khobar')?.label, 'Al Khobar');
  assert.equal(cityChoices('ar').at(-1)?.label, 'أخرى');
});

test('the application refuses a wrong IBAN, a non-English account name, a typo city and a name as the address', async () => {
  const badChecksum = await send('POST', '/api/affiliate/apply', { ...APPLY, iban: 'SA23 1000 0004 6000 0009 0603' }, memberToken);
  assert.equal(badChecksum.statusCode, 400, badChecksum.body);
  assert.match(badChecksum.json().error.message as string, /الآيبان/);

  const foreign = await send('POST', '/api/affiliate/apply', { ...APPLY, iban: 'AE070331234567890123456' }, memberToken);
  assert.equal(foreign.statusCode, 400, foreign.body);
  assert.match(foreign.json().error.message as string, /SA/);

  const digitsInName = await send('POST', '/api/affiliate/apply', { ...APPLY, accountName: 'Faris 4 Almasrahi' }, memberToken);
  assert.equal(digitsInName.statusCode, 400, digitsInName.body);

  const typoCity = await send('POST', '/api/affiliate/apply', { ...APPLY, city: 'other', cityOther: 'Dammqm1' }, memberToken);
  assert.equal(typoCity.statusCode, 400, typoCity.body);
  assert.equal(typoCity.json().error.code, 'city');

  const nameAsAddress = await send('POST', '/api/affiliate/apply', { ...APPLY, address: 'Faris Salem Almasrahi' }, memberToken);
  assert.equal(nameAsAddress.statusCode, 400, nameAsAddress.body);
  assert.equal(nameAsAddress.json().error.code, 'address');

  // A Latin name that is not the member's own (the real case: «Abdulrahman AlAswad» typed as the address).
  const otherName = await send('POST', '/api/affiliate/apply', { ...APPLY, address: 'Abdulrahman AlAswad' }, memberToken);
  assert.equal(otherName.statusCode, 400, otherName.body);
  assert.equal(otherName.json().error.code, 'address');

  const shortAddress = await send('POST', '/api/affiliate/apply', { ...APPLY, address: 'الدمام' }, memberToken);
  assert.equal(shortAddress.statusCode, 400, shortAddress.body);

  const applied = await send('POST', '/api/affiliate/apply', APPLY, memberToken);
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().application.city, 'الدمام');
  assert.equal(applied.json().application.cityKey, 'dammam');
  assert.equal(applied.json().application.iban, 'SA2310000004600000090602');
  assert.equal(applied.json().application.heardFromNote, '');
});

test('an older bundle may still send a listed city by name, and a typed small town passes letters-only', async () => {
  const byName = await send('POST', '/api/affiliate/apply', { ...APPLY, city: 'الرياض', cityOther: '' }, memberToken);
  assert.equal(byName.statusCode, 200, byName.body);
  assert.equal(byName.json().application.cityKey, 'riyadh');
  const town = await send('POST', '/api/affiliate/apply', { ...APPLY, city: 'other', cityOther: 'رأس تنورة' }, memberToken);
  assert.equal(town.statusCode, 200, town.body);
  assert.equal(town.json().application.city, 'رأس تنورة');
  assert.equal(town.json().application.cityKey, 'other');
});

test('the English app gets English source options and cities; the English applicant gets English mails', async () => {
  const english = await get('/api/affiliate', englishToken, { 'x-app-lang': 'en' });
  assert.equal(english.statusCode, 200, english.body);
  const choices = english.json().heardChoices as { value: string; label: string }[];
  assert.deepEqual(choices[0], { value: 'منصة إكس', label: 'X (Twitter)' });
  assert.equal(choices.at(-1)?.label, 'Other');
  assert.equal((english.json().cities as { value: string; label: string }[]).find((city) => city.value === 'jeddah')?.label, 'Jeddah');
  // The Arabic app keeps the Arabic labels.
  const arabic = await get('/api/affiliate', englishToken);
  assert.equal((arabic.json().heardChoices as { label: string }[])[0]?.label, 'منصة إكس');

  const before = mailer.sent.length;
  const applied = await send('POST', '/api/affiliate/apply', APPLY, englishToken, { 'x-app-lang': 'en' });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(mailer.sent.length, before + 1);
  const agreement = mailer.sent.at(-1);
  assert.match(agreement?.subject ?? '', /Affiliates Program agreement/);
  assert.match(agreement?.text ?? '', /I accept the agreement/);
  assert.match(agreement?.text ?? '', /SAR 250/);

  // The admin mail stays Arabic and names the member's language and the source, with no note.
  const accepted = await send('POST', '/api/affiliate/agreement', {}, englishToken);
  assert.equal(accepted.statusCode, 200, accepted.body);
  const admin = mailer.sent.at(-1);
  assert.match(admin?.subject ?? '', /طلب انضمام لبرنامج ممثلي نادي المستثمرين/);
  assert.match(admin?.text ?? '', /لغة العضو: English/);
  assert.match(admin?.text ?? '', /عرفنا عن طريق: منصة إكس/);
  assert.doesNotMatch(admin?.text ?? '', /كيف تعرّف على النادي/);

  // The decision reaches him in English too.
  const decided = await send('POST', `/api/admin/affiliates/${englishId}/decision`, { status: 'approved' }, adminToken);
  assert.equal(decided.statusCode, 200, decided.body);
  const decision = mailer.sent.at(-1);
  assert.match(decision?.subject ?? '', /approved/);
  assert.match(decision?.text ?? '', /Referral code/);
});

test('a name with a dot or a digit is a username, not a name', async () => {
  const dotted = await send('PATCH', '/api/me', { name: 'yasser.designer' }, memberToken);
  assert.equal(dotted.statusCode, 400, dotted.body);
  const numbered = await send('POST', '/api/auth/register', {
    name: 'yasser4.designer',
    country: 'sa',
    phone: `055${(nextPhone += 1)}`,
    email: 'm195+username@gmail.com',
    password: 'secret123',
    persona: 'neutral',
    bio: 'حساب اختبار لقاعدة الأسماء.',
  });
  assert.equal(numbered.statusCode, 400, numbered.body);
  assert.match(numbered.json().error.message as string, /الحروف فقط/);
});

test('the forced-update floor: an older binary gets 426 on app calls, the status tells a fresh launch', async () => {
  assert.equal(compareVersions('1.2.9', '1.3.0'), -1);
  assert.equal(compareVersions('1.3.0', '1.3'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);

  const old = await get('/api/affiliate', memberToken, { 'x-app-platform': 'android', 'x-app-version': '1.2.0' });
  assert.equal(old.statusCode, 426, old.body);
  assert.equal(old.json().error.code, 'update_required');
  assert.match(old.json().error.message as string, /تحديث/);
  const oldEnglish = await get('/api/affiliate', memberToken, { 'x-app-platform': 'ios', 'x-app-version': '1.2.0', 'x-app-lang': 'en' });
  assert.match(oldEnglish.json().error.message as string, /update/i);

  const current = await get('/api/affiliate', memberToken, { 'x-app-platform': 'android', 'x-app-version': '1.3.0' });
  assert.equal(current.statusCode, 200, current.body);
  // No version header (a bundle older than M195) passes while APP_REQUIRE_VERSION is off; the dashboard (no platform header) always passes.
  const unversioned = await get('/api/affiliate', memberToken, { 'x-app-platform': 'android' });
  assert.equal(unversioned.statusCode, 200, unversioned.body);
  const dashboard = await get('/api/affiliate', memberToken, { 'x-app-version': '0.1.0' });
  assert.equal(dashboard.statusCode, 200, dashboard.body);

  const status = await get('/api/app/status?version=1.2.0');
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().updateRequired, true);
  assert.equal(status.json().minVersion, '1.3.0');
  assert.match(status.json().storeUrls.ios as string, /apps\.apple\.com/);
  const fresh = await get('/api/app/status?version=1.3.0');
  assert.equal(fresh.json().updateRequired, false);

  // The dashboard raises the floor; the environment value gives way.
  const raised = await send('PUT', '/api/admin/app/min-version', { minVersion: '1.4.0' }, adminToken);
  assert.equal(raised.statusCode, 200, raised.body);
  const blocked = await get('/api/affiliate', memberToken, { 'x-app-platform': 'android', 'x-app-version': '1.3.0' });
  assert.equal(blocked.statusCode, 426, blocked.body);
  const cleared = await send('PUT', '/api/admin/app/min-version', { minVersion: '' }, adminToken);
  assert.equal(cleared.json().minVersion, '1.3.0');
});
