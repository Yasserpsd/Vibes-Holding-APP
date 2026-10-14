import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { PROMO_CODE_RE } from './partners/service.js';
import { MemoryKV } from './store.js';

// M68 «شركاؤنا»: the dashboard-managed partners program and the members' personal promo codes.
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
let adminToken = '';
let memberToken = '';
let unpaidToken = '';
let partnerId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string, persona: 'neutral' | 'entrepreneur' | 'investor'): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'عضو الشركاء', country: 'sa', phone, email, password: 'secret123', persona, bio: 'حساب اختبار برنامج شركاؤنا والبرومو كود.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  adminToken = (await signUp('m68.admin+member@gmail.com', '0558619901', 'investor')).token;
  const member = await signUp('m68+member@gmail.com', '0558619902', 'entrepreneur');
  memberToken = member.token;
  hub.members.add(member.id);
  const unpaid = await signUp('m68.unpaid@gmail.com', '0558619903', 'neutral');
  unpaidToken = unpaid.token;
  hub.members.add(unpaid.id);
  await get('/api/me?fresh=1', memberToken);
  await get('/api/me?fresh=1', unpaidToken);
});

after(async () => {
  await app.close();
});

test('the dashboard manages the partners: create, edit, hide, delete; the app lists only the visible ones', async () => {
  const created = await send('POST', '/api/admin/partners', {
    name: 'بودكاست الملتقى',
    nameEn: 'Al-Moltaqa podcast',
    description: 'استوديو بودكاست مجهّز بالكامل لأعضاء النادي.',
    discount: 'خصم 50% بالبرومو كود',
    url: 'https://almoltaqapodcast.com/studio/',
    order: 1,
  }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  partnerId = created.json().partner.id;

  const hidden = await send('POST', '/api/admin/partners', { name: 'وديني', url: 'https://wdeny.com/', visible: false, order: 2 }, adminToken);
  assert.equal(hidden.statusCode, 201);

  // Members are not admins: the admin routes refuse them.
  assert.equal((await get('/api/admin/partners', memberToken)).statusCode, 403);

  const listed = (await get('/api/admin/partners', adminToken)).json();
  assert.equal(listed.partners.length, 2);
  assert.ok(listed.settings.title.includes('شركاؤنا'));

  const pub = (await get('/api/partners')).json();
  assert.equal(pub.partners.length, 1, 'the hidden partner never reaches the app');
  assert.equal(pub.partners[0].name, 'بودكاست الملتقى');
  assert.equal(pub.promo, null);
  assert.equal(pub.isMember, false);

  // English wording falls back to Arabic when the English field is empty.
  const en = (await get('/api/partners?lang=en')).json();
  assert.equal(en.partners[0].name, 'Al-Moltaqa podcast');
  assert.equal(en.partners[0].description, 'استوديو بودكاست مجهّز بالكامل لأعضاء النادي.');

  const edited = await send('PUT', `/api/admin/partners/${partnerId}`, { discount: 'خصم 40% بالبرومو كود' }, adminToken);
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.json().partner.discount, 'خصم 40% بالبرومو كود');

  const removed = await send('DELETE', `/api/admin/partners/${listed.partners.find((entry: { name: string }) => entry.name === 'وديني').id}`, undefined, adminToken);
  assert.equal(removed.statusCode, 200);
  assert.equal((await get('/api/admin/partners', adminToken)).json().partners.length, 1);
});

test('the program wording is owner-editable', async () => {
  const saved = await send('PUT', '/api/admin/partners/settings', { intro: 'برنامج شركاء النادي: خصومات بالبرومو كود الخاص بك.' }, adminToken);
  assert.equal(saved.statusCode, 200);
  const pub = (await get('/api/partners')).json();
  assert.equal(pub.intro, 'برنامج شركاء النادي: خصومات بالبرومو كود الخاص بك.');
});

test('an active member gets ONE permanent 5-character code with his category letter; a guest or unpaid account gets none', async () => {
  const first = (await get('/api/partners', memberToken)).json();
  assert.equal(first.isMember, true);
  const code = first.promo.code as string;
  assert.match(code, PROMO_CODE_RE);
  assert.equal(code.length, 5);
  assert.equal(code[0], 'E', 'the entrepreneur’s code starts with E');

  // The same member asks again: the same code, never a new one.
  const again = (await get('/api/partners', memberToken)).json();
  assert.equal(again.promo.code, code);

  // An account without an active membership sees the program but no code.
  const unpaid = (await get('/api/partners', unpaidToken)).json();
  assert.equal(unpaid.isMember, false);
  assert.equal(unpaid.promo, null);
  assert.ok(unpaid.membersOnlyText.length > 0);

  // The answer is personal: never cached (CLAUDE.md rule 8).
  const raw = await get('/api/partners', memberToken);
  assert.equal(raw.headers['cache-control'], 'no-store');
});

test('the dashboard looks a code up and reads whose it is', async () => {
  const code = (await get('/api/partners', memberToken)).json().promo.code as string;
  const found = (await get(`/api/admin/partners/promo/${code}`, adminToken)).json();
  assert.equal(found.promo.code, code);
  assert.equal(found.promo.name, 'عضو الشركاء');
  assert.equal(found.promo.personaLabel.includes('رائد'), true);
  assert.ok(found.promo.cardNumber.startsWith('E-'));

  // Lower case finds it too; an unknown code answers null instead of an error.
  assert.equal((await get(`/api/admin/partners/promo/${code.toLowerCase()}`, adminToken)).json().promo.code, code);
  assert.equal((await get('/api/admin/partners/promo/ZZZZ9', adminToken)).json().promo, null);

  // The lookup is the dashboard's: members are refused.
  assert.equal((await get(`/api/admin/partners/promo/${code}`, memberToken)).statusCode, 403);
});
