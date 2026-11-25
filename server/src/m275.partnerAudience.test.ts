import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { SNAPSHOT_KEY } from './projectsBank/service.js';
import { MemoryKV } from './store.js';
import { remindAudience, type RemindDeps } from './whatsapp/tell.js';

// M275 (owner, 2026-11-25): «فئة شركاء النجاح» — a message for the Success Partners alone, the members filter that
// finds them, and their project's page in the bank.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', WHATSAPP_TOKEN: 'test-token-not-a-real-one-275', WHATSAPP_PHONE_ID: '100275', WHATSAPP_WABA_ID: '200275' });
const PAGE = 'https://vibesholding.com/project/one';

const whatsappTo: string[] = [];
const pushedTo: string[] = [];
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url === 'https://exp.host/--/api/v2/push/send') {
    const messages = JSON.parse(String(init?.body)) as { to: string; data: { type: string } }[];
    pushedTo.push(...messages.filter((message) => message.data.type === 'post').map((message) => message.to));
    return json({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) });
  }
  if (!url.startsWith('https://graph.facebook.com/')) return json({});
  if (url.includes('/message_templates')) {
    const name = new URL(url).searchParams.get('name') ?? '';
    return json({ data: ['ar', 'en'].map((language) => ({ name, language, status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: name === 'club_membership_active' ? '{{1}} {{2}}' : '{{1}}' }] })) });
  }
  const message = JSON.parse(String(init?.body ?? '{}')) as { to: string; template: { name: string } };
  if (['club_account_notice', 'club_admin_message'].includes(message.template.name)) whatsappTo.push(message.to);
  return json({ messages: [{ id: `wamid.${whatsappTo.length}` }] });
};

const hub = new MockHubClient();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let caller = 0;
type User = { token: string; id: number; phone: string };
const users = {} as Record<'partner' | 'paid' | 'unpaid', User>;

const call = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, token?: string) => {
  caller += 1;
  return app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: `10.75.1.${(caller % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
};

let phone = 8527500;
async function signUp(email: string, name: string, admin = false): Promise<User> {
  phone += 1;
  const registered = await call('POST', '/api/auth/register', { name, country: 'sa', phone: `055${phone}`, email, password: 'secret123', persona: 'investor', bio: 'حساب لاختبار رسائل شركاء النجاح.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await call('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const user = { token: verified.json().token as string, id: verified.json().me.id as number, phone: `96655${phone}` };
  if (!admin) {
    // The mock makes every verified account an admin: a plain member is set back by hand.
    (hub as unknown as { contacts: Map<number, { role: string }> }).contacts.get(user.id)!.role = 'member';
    await call('GET', '/api/me?fresh=1', undefined, user.token);
  }
  assert.equal((await call('POST', '/api/push/tokens', { token: `ExponentPushToken[m275-device-of-${user.id}]`, platform: 'ios' }, user.token)).statusCode, 200);
  return user;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

before(async () => {
  const kv = new MemoryKV();
  const project = { id: 1, number: 'P-1', slug: 'one', title: 'مشروع أول', sector: null, stage: null, gallery: [] };
  await kv.set(SNAPSHOT_KEY, { projects: [project], fetchedAt: new Date().toISOString(), pageUrls: { '1': PAGE } });
  const built = await buildApp({ config, kv, hub, fetchImpl: fetchStub });
  app = built.app;
  await built.projects.start();
  adminToken = (await signUp('m275.aud.admin@gmail.com', 'ناصر العلي', true)).token;
  users.partner = await signUp('m275.aud.partner@gmail.com', 'فهد الدوسري');
  users.paid = await signUp('m275.aud.paid@gmail.com', 'سالم القحطاني');
  users.unpaid = await signUp('m275.aud.unpaid@gmail.com', 'خالد الحربي');
  assert.equal((await call('POST', `/api/admin/accounts/${users.paid.id}/grant`, { action: 'activate', days: 30, note: 'اختبار', confirm: true }, adminToken)).statusCode, 200);
  assert.equal((await call('POST', `/api/admin/accounts/${users.partner.id}/partner`, { on: true, projectId: 1, note: '', confirm: true }, adminToken)).statusCode, 200);
  await settle();
});

after(async () => {
  await app.close();
});

test('a message for the Success Partners reaches them alone: the app, the notification, WhatsApp and the counts', async () => {
  const reach = await call('POST', '/api/admin/posts/reach', { audience: { type: 'partners' } }, adminToken);
  assert.deepEqual(reach.json(), { members: 1, devices: 1 }, reach.body);

  whatsappTo.length = 0;
  pushedTo.length = 0;
  const created = await call('POST', '/api/admin/posts', { title: 'لشركاء النجاح', body: 'نص الرسالة.', status: 'published', audience: { type: 'partners' } }, adminToken);
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().post.id as string;
  await settle();

  const seen = async (token?: string) => ((await call('GET', '/api/posts?limit=50', undefined, token)).json().posts as { id: string; audience: string }[]).find((post) => post.id === id);
  // The installed app reads it like a category message.
  assert.equal((await seen(users.partner.token))?.audience, 'persona');
  assert.equal(await seen(users.paid.token), undefined);
  assert.equal(await seen(users.unpaid.token), undefined);
  assert.equal(await seen(), undefined);
  assert.equal((await call('GET', `/api/posts/${id}`, undefined, users.paid.token)).statusCode, 404);

  assert.deepEqual(pushedTo, [`ExponentPushToken[m275-device-of-${users.partner.id}]`]);
  assert.deepEqual(whatsappTo, [users.partner.phone]);

  const follow = await call('GET', `/api/admin/posts/${id}/follow`, undefined, adminToken);
  assert.deepEqual((follow.json().rows as { contactId: number }[]).map((row) => row.contactId), [users.partner.id]);
});

test('the WhatsApp reminder of such a message tells the partners only', async () => {
  const told: string[] = [];
  const account = (id: number, partner: 0 | 1) => ({ id, name: 'ماجد العمري', phone: `050000000${id}`, state: 'member', persona: 'investor', honorary: 0, partner });
  const items = [account(1, 1), account(2, 0)];
  const deps = {
    hub: { mode: 'mock' as const, call: async () => ({ ok: true as const, items, total: items.length, page: 1, per_page: 100, counts: {} }) },
    push: { langOf: async () => null },
    whatsapp: { enabled: true, toldToday: async () => ({ accounts: new Set<number>(), phones: new Set<string>() }), sendNotice: async (_kind: string, input: { phone: string }) => (told.push(input.phone), { channel: 'whatsapp' }) },
  } as unknown as RemindDeps;
  await remindAudience(deps, { uuid: 'admin-uuid', persona: null, partners: true, members: [], done: new Set(), ref: 'post:p1', now: Date.parse('2026-11-25T09:00:00Z') });
  assert.deepEqual(told, ['0500000001']);
});

test('the members list filters the partners, counts them, and their project opens in the bank', async () => {
  const list = await call('GET', '/api/admin/accounts?persona=partners', undefined, adminToken);
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual((list.json().items as { id: number }[]).map((item) => item.id), [users.partner.id]);
  assert.equal(list.json().total, 1);
  const counts = (await call('GET', '/api/admin/personas?state=all', undefined, adminToken)).json() as { partners: number; investor: number };
  assert.equal(counts.partners, 1);
  assert.ok(counts.investor >= 3, 'a partner keeps his category');

  assert.equal((await call('GET', `/api/admin/accounts/${users.partner.id}`, undefined, adminToken)).json().partnerProject.url, PAGE);
  const partners = (await call('GET', '/api/admin/success-partners', undefined, adminToken)).json();
  assert.equal(partners.partners[0].project.url, PAGE);
  assert.equal(partners.projects[0].url, PAGE);
});
