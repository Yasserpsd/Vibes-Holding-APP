import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

/** Meta's Graph API as the server sees it: every club template approved in ar + en, every send accepted and kept. */
const sent: { to: string; template: string; language: string; params: string[] }[] = [];
const graph: typeof fetch = async (input, init) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!url.startsWith('https://graph.facebook.com/')) return json({});
  if (url.includes('/message_templates')) {
    const name = new URL(url).searchParams.get('name') ?? '';
    const body = name === 'club_membership_active' ? '{{1}} {{2}}' : '{{1}}';
    return json({ data: ['ar', 'en'].map((language) => ({ name, language, status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: body }] })) });
  }
  const message = JSON.parse(String(init?.body ?? '{}')) as { to: string; template: { name: string; language: { code: string }; components?: { parameters: { text: string }[] }[] } };
  sent.push({ to: message.to, template: message.template.name, language: message.template.language.code, params: (message.template.components?.[0]?.parameters ?? []).map((entry) => entry.text) });
  return json({ messages: [{ id: `wamid.test-${sent.length}` }] });
};

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', WHATSAPP_TOKEN: 'test-token-not-a-real-one-234', WHATSAPP_PHONE_ID: '100234', WHATSAPP_WABA_ID: '200234' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let caller = 0;

const post = (url: string, payload: Record<string, unknown>, token?: string, lang?: string) => {
  caller += 1;
  return app.inject({ method: 'POST', url, payload, remoteAddress: `10.23.4.${(caller % 250) + 1}`, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lang ? { 'x-app-lang': lang } : {}) } });
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
  app = (await buildApp({ config, kv, hub: new MockHubClient({ seed: true }), fetchImpl: graph })).app;
  adminToken = (await signUp('m234.admin@gmail.com', '0558323401')).token;
});

after(async () => {
  await app.close();
});

test('the honorary notice speaks the language the member runs the app in', async () => {
  const arabic = await signUp('m234.arabic@gmail.com', '0558323402');
  const english = await signUp('m234.english@gmail.com', '0558323403');
  // Registered in Arabic, then switched the app to English: the device says so.
  const device = await post('/api/push/tokens', { token: 'ExponentPushToken[m234-english-device]', platform: 'ios' }, english.token, 'en');
  assert.equal(device.statusCode, 200, device.body);

  for (const member of [arabic, english]) assert.equal((await post(`/api/admin/accounts/${member.id}/honorary`, { on: true, confirm: true }, adminToken)).statusCode, 200);
  assert.equal((await waitFor('club_honorary_membership', '966558323402')).language, 'ar');
  const notice = await waitFor('club_honorary_membership', '966558323403');
  assert.equal(notice.language, 'en');
  assert.deepEqual(notice.params, ['سلطان']);
});

test('a membership given from the dashboard reaches WhatsApp; a revoke does not', async () => {
  const member = await signUp('m234.granted@gmail.com', '0558323404');
  const given = await post(`/api/admin/accounts/${member.id}/grant`, { action: 'activate', days: 365, confirm: true }, adminToken);
  assert.equal(given.statusCode, 200, given.body);
  const notice = await waitFor('club_membership_active', '966558323404');
  assert.equal(notice.language, 'ar');
  assert.equal(notice.params[0], 'سلطان');
  assert.match(notice.params[1] ?? '', /\d{4}/);

  const before = sent.length;
  assert.equal((await post(`/api/admin/accounts/${member.id}/grant`, { action: 'revoke', confirm: true }, adminToken)).statusCode, 200);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(sent.length, before);
});
