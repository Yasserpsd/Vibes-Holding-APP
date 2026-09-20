import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { MOCK_MEMBERSHIP_PAY_URL, MOCK_MEMBERSHIP_URL, MOCK_SITE_URL } from '../hub/mockChat.js';
import { SNAPSHOT_KEY } from '../projectsBank/service.js';
import type { FeedSnapshot, PublicProject } from '../projectsBank/types.js';
import { MemoryKV } from '../store.js';
import { BlockList, stripUrls, toActions, type AdvisorAction } from './sanitize.js';

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

const project: PublicProject = {
  id: 7,
  number: '70',
  slug: 'delivery',
  title: 'تطبيق توصيل',
  titleEn: null,
  companyName: null,
  companyNameEn: null,
  founderName: null,
  founderNameEn: null,
  excerpt: null,
  excerptEn: null,
  details: null,
  detailsEn: null,
  image: null,
  gallery: [],
  sector: null,
  stage: null,
  isGolden: false,
  featuredOrder: null,
  goldenPartnerUrl: null,
  hasPitchDeck: false,
  contactRule: null,
  viewsCount: 0,
  modifiedAt: null,
};

const post = async (url: string, payload: Record<string, unknown>, token?: string) =>
  app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = async (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', {
    name: 'سالم التجريبي',
    country: 'sa',
    phone,
    email,
    password: 'secret123',
    persona: 'investor',
    bio: 'مستثمر مهتم بفرص الشراكة في قطاع التقنية.',
  });
  assert.equal(registered.statusCode, 200);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200);
  return verified.json().token as string;
}

before(async () => {
  await kv.set(SNAPSHOT_KEY, { fetchedAt: '2026-09-11T00:00:00.000Z', projects: [project], pageUrls: { 7: 'https://vibesholding.com/project/delivery/' } } satisfies FeedSnapshot);
  const built = await buildApp({ config, kv, hub: new MockHubClient({ replyDelayMs: 60 }) });
  app = built.app;
  await built.projects.start();
});

after(async () => {
  await app.close();
});

test('advisor routes need a session', async () => {
  assert.equal((await get('/api/advisor/history')).statusCode, 401);
  assert.equal((await post('/api/advisor/message', { text: 'مرحبا' })).statusCode, 401);
  assert.equal((await get('/api/advisor/poll?after=0')).statusCode, 401);
});

test('history starts empty with the hub profile, minus membership links and payment prompts', async () => {
  const token = await signUp('salem+member@gmail.com', '0558318777');
  const res = await get('/api/advisor/history', token);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = res.json();
  assert.deepEqual(body.messages, []);
  assert.equal(body.profile.botName, 'المستشار');
  assert.ok(body.profile.welcome.includes('حياك الله'));
  assert.ok(!body.profile.welcome.includes(MOCK_MEMBERSHIP_URL));
  assert.deepEqual(body.profile.suggestions, ['ما هو بنك المشاريع؟', 'كيف أختار مشروعًا مناسبًا؟']);
  assert.equal(body.me.membership.status, 'active');
});

test('a member sends a message with project context and gets the filtered reply', async () => {
  const token = await signUp('noura+member@gmail.com', '0558318778');
  assert.equal((await post('/api/advisor/message', { text: '   ' }, token)).statusCode, 400);

  const sent = await post('/api/advisor/message', { text: 'ما رأيك في هذا المشروع؟', context: { type: 'project', id: 7 } }, token);
  assert.equal(sent.statusCode, 200);
  const sentBody = sent.json();
  assert.equal(typeof sentBody.messageId, 'number');
  assert.equal(sentBody.waiting, true);
  assert.equal(sentBody.gate, null);

  const early = (await get(`/api/advisor/poll?after=${sentBody.messageId}`, token)).json();
  assert.deepEqual(early.messages, []);
  assert.equal(early.waiting, true);

  await sleep(120);
  const later = (await get(`/api/advisor/poll?after=${sentBody.messageId}`, token)).json();
  assert.equal(later.waiting, false);
  assert.equal(later.messages.length, 1);
  const reply = later.messages[0];
  assert.equal(reply.role, 'assistant');
  assert.ok(reply.text.includes('«تطبيق توصيل (مشروع رقم 70)»'), reply.text);
  assert.ok(!reply.text.includes(MOCK_MEMBERSHIP_URL), reply.text);
  assert.ok(!reply.text.includes('paymob'), reply.text);
  assert.ok(reply.text.includes(MOCK_SITE_URL), reply.text);
  assert.deepEqual(
    reply.actions.map((action: AdvisorAction) => action.type),
    ['quick_replies', 'link', 'membership', 'video'],
  );
  assert.equal(reply.actions[1].url, MOCK_SITE_URL);
  assert.ok(!JSON.stringify(reply.actions).includes(MOCK_MEMBERSHIP_PAY_URL));

  const history = (await get('/api/advisor/history', token)).json();
  assert.deepEqual(
    history.messages.map((message: { role: string }) => message.role),
    ['user', 'assistant'],
  );
  assert.equal(history.messages[0].text, 'ما رأيك في هذا المشروع؟');
});

test('an unactivated account is pointed to the in-app membership screen after the free replies', async () => {
  const token = await signUp('guest@gmail.com', '0558318779');
  let gate: Record<string, unknown> | null = null;
  for (let i = 0; i < 6 && !gate; i += 1) {
    const res = await post('/api/advisor/message', { text: `رسالة ${i + 1}` }, token);
    assert.equal(res.statusCode, 200);
    gate = res.json().gate;
  }
  assert.ok(gate);
  assert.equal(gate.type, 'membership');
  assert.equal(gate.membership, true);
  assert.equal(gate.expired, false);
  assert.ok(!String(gate.text).includes('http'));
  assert.ok(!('card' in gate) && !('mgmt' in gate));
});

test('an expired member is told to renew from the membership screen', async () => {
  const token = await signUp('old+expired@gmail.com', '0558318780');
  const gate = (await post('/api/advisor/message', { text: 'مرحبا' }, token)).json().gate;
  assert.equal(gate.type, 'membership');
  assert.equal(gate.expired, true);
});

test('stripUrls removes blocked and payment links and keeps allowed markdown links tappable', () => {
  const block = new BlockList([MOCK_MEMBERSHIP_URL]);
  assert.equal(
    stripUrls(`اشترك من ${MOCK_MEMBERSHIP_URL}. الموقع: [النادي](${MOCK_SITE_URL})`, block),
    `اشترك من . الموقع: [النادي](${MOCK_SITE_URL})`,
  );
  // A blocked markdown link goes with its label.
  assert.equal(stripUrls(`التفاصيل في [صفحة العضوية](${MOCK_MEMBERSHIP_URL}) الآن`, block), 'التفاصيل في الآن');
  assert.equal(stripUrls('ادفع هنا https://accept.paymob.com/api/acceptance/x', block), 'ادفع هنا');
  assert.equal(stripUrls('ادفع هنا https://vcmem.com/pay/123/ اليوم', block), 'ادفع هنا اليوم');
});

test('toActions keeps phone-friendly widgets only and drops web payment buttons from cards', () => {
  const block = new BlockList([MOCK_MEMBERSHIP_URL]);
  const actions = toActions(
    [
      { type: 'card', card: { key: 'studio', title: 'بودكاست الملتقى', price: '2500 SAR', bullets: ['حلقة كاملة'], buttons: [{ label: 'ادفع واطلب الخدمة', url: 'https://vcmem.com/offer/studio/' }, { label: 'تفاصيل الخدمة', url: 'https://vcmem.com/studio/' }] } },
      { type: 'open_page', url: MOCK_MEMBERSHIP_URL },
      { type: 'prefill_form', form: 'contact' },
      { type: 'admin', op: 'report_today' },
      { type: 'link', label: 'المقر ↗', url: 'https://vcmem.com/hq/' },
    ],
    block,
  );
  assert.deepEqual(actions, [
    { type: 'card', title: 'بودكاست الملتقى', price: '2500 SAR', note: null, bullets: ['حلقة كاملة'], url: 'https://vcmem.com/studio/' },
    { type: 'link', label: 'المقر', url: 'https://vcmem.com/hq/' },
  ]);
});
