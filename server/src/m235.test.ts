import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';
import { buildBodyParams, TEMPLATE_NAMES } from './whatsapp/templates.js';

/** Meta's Graph API as the server sees it: every club template approved in ar + en, every send accepted and kept. */
/** How many variables each new template holds. */
const VARIABLES: Record<string, number> = { club_admin_message: 1, club_pb_credit: 3, club_account_deleted: 1, club_affiliate_update: 2, club_payout_update: 2, club_affiliate_bonus: 3, club_affiliate_cycle: 3 };
const sent: { to: string; template: string; language: string; params: string[] }[] = [];
const graph: typeof fetch = async (input, init) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!url.startsWith('https://graph.facebook.com/')) return json({});
  if (url.includes('/message_templates')) {
    const name = new URL(url).searchParams.get('name') ?? '';
    const body = Array.from({ length: VARIABLES[name] ?? 1 }, (_, index) => `{{${index + 1}}}`).join(' ');
    return json({ data: ['ar', 'en'].map((language) => ({ name, language, status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: body }] })) });
  }
  const message = JSON.parse(String(init?.body ?? '{}')) as { to: string; template: { name: string; language: { code: string }; components?: { parameters: { text: string }[] }[] } };
  sent.push({ to: message.to, template: message.template.name, language: message.template.language.code, params: (message.template.components?.[0]?.parameters ?? []).map((entry) => entry.text) });
  return json({ messages: [{ id: `wamid.test-${sent.length}` }] });
};

const kv = new MemoryKV();
const hub = new MockHubClient({ seed: true });
/** The mock makes every verified account an admin: a plain member is set back by hand. */
const demote = (id: number) => {
  const contact = (hub as unknown as { state: { contacts: Map<number, { role: string }> } }).state.contacts.get(id);
  if (contact) contact.role = 'member';
};
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', WHATSAPP_TOKEN: 'test-token-not-a-real-one-234', WHATSAPP_PHONE_ID: '100234', WHATSAPP_WABA_ID: '200234' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let caller = 0;

const post = (url: string, payload: Record<string, unknown>, token?: string, lang?: string) => {
  caller += 1;
  return app.inject({ method: 'POST', url, payload, remoteAddress: `10.23.5.${(caller % 250) + 1}`, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lang ? { 'x-app-lang': lang } : {}) } });
};

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await post('/api/auth/register', { name: 'سلطان العتيبي', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب لاختبار رسائل واتساب.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

/** The sends are not awaited by the routes. */
async function waitFor(template: string, to: string) {
  for (let i = 0; i < 100; i += 1) {
    const hit = sent.find((entry) => entry.template === template && entry.to === to);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return assert.fail(`${template} never reached ${to}`);
}

before(async () => {
  app = (await buildApp({ config, kv, hub, fetchImpl: graph })).app;
  adminToken = (await signUp('m235.admin@gmail.com', '0558323501')).token;
});

after(async () => {
  await app.close();
});

test('a reply and a message from the management to one member are announced on WhatsApp', async () => {
  const member = await signUp('m235.member@gmail.com', '0558323502');
  const reply = await post(`/api/admin/threads/${member.id}/reply`, { text: 'أهلًا بك، وصلتنا رسالتك.', confirm: true }, adminToken);
  assert.equal(reply.statusCode, 200, reply.body);
  const first = await waitFor('club_admin_message', '966558323502');
  assert.deepEqual([first.language, first.params], ['ar', ['سلطان']]);

  const before = sent.length;
  const message = await post('/api/admin/app/messages', { title: 'تنبيه خاص', body: 'نص الرسالة يبقى داخل التطبيق.', audience: { type: 'member', contactId: member.id, name: 'سلطان العتيبي' } }, adminToken);
  assert.equal(message.statusCode, 201, message.body);
  for (let i = 0; i < 100 && sent.length === before; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1)?.template, 'club_admin_message');
  assert.equal(JSON.stringify(sent).includes('نص الرسالة'), false, 'the words of a message never leave the app');

  // A message for everyone stays in the app.
  const all = await post('/api/admin/app/messages', { title: 'للجميع', body: 'رسالة عامة.', audience: { type: 'all' } }, adminToken);
  assert.equal(all.statusCode, 201, all.body);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(sent.length, before + 1);
});

test('an account deleted by the administration is told on the number it held, only when asked', async () => {
  const told = await signUp('m235+told@example.com', '0558323503');
  const quiet = await signUp('m235+quiet@example.com', '0558323504');
  demote(told.id);
  demote(quiet.id);
  assert.equal((await post(`/api/admin/accounts/${quiet.id}/delete`, { note: 'طلب العضو', confirm: true }, adminToken)).statusCode, 200);
  const gone = await post(`/api/admin/accounts/${told.id}/delete`, { note: 'طلب العضو', tellMember: true, confirm: true }, adminToken);
  assert.equal(gone.statusCode, 200, gone.body);
  await waitFor('club_account_deleted', '966558323503');
  assert.equal(sent.some((entry) => entry.to === '966558323504'), false);
});

test('every notice kind has its template and fills it in order', () => {
  assert.equal(TEMPLATE_NAMES.payout_update, 'club_payout_update');
  assert.deepEqual(buildBodyParams('pb_credit', { list: ['سلطان', 3, 7] }, 'ar'), ['سلطان', '3', '7']);
  assert.deepEqual(buildBodyParams('affiliate_cycle', { list: ['Sultan', '2027-02-01', 10] }, 'en'), ['Sultan', '2027-02-01', '10']);
});
