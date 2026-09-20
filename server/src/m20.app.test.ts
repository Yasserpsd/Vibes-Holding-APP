import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { HubError, type HubBody, type HubClient, type HubOp, type HubResponse } from './hub/types.js';
import { NEWS_SNAPSHOT_KEY, newsIdOf } from './news/service.js';
import type { NewsItem, NewsSnapshot } from './news/types.js';
import { MockPbBridge, type PbBridge, type PbMember, type PbUnlock } from './projectsBank/bridge.js';
import { SNAPSHOT_KEY } from './projectsBank/service.js';
import type { FeedSnapshot, PublicProject } from './projectsBank/types.js';
import { MemoryKV } from './store.js';
import { toFeedItem } from './sync/feed.js';

/** The mock hub with a record of every call; it can fail the `publish` op or pose as a hub older than 2.7.0. */
class SpyHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly calls: { op: HubOp; body: HubBody }[] = [];
  failPublish = false;
  old = false;
  readonly inner = new MockHubClient({ seed: true, replyDelayMs: 20 });

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    this.calls.push({ op, body });
    if (this.old && /^(admin_|changes$|publish$|feed$)/.test(op)) throw new HubError('hub_not_supported', 'هذه الخدمة غير متاحة حاليًا', 501);
    if (this.failPublish && op === 'publish') throw new HubError('hub_unreachable', 'تعذّر الاتصال بالنادي الآن، حاول بعد قليل', 502);
    return this.inner.call(op, body);
  }

  lastMessage(): HubBody {
    const call = this.calls.filter((entry) => entry.op === 'message').at(-1);
    assert.ok(call, 'a message reached the hub');
    return call.body;
  }
}

/** Projects Bank answering more than the contract's four fields: only the four may reach the app. */
class ChattyPb extends MockPbBridge implements PbBridge {
  override async unlock(member: PbMember, pid: number): Promise<PbUnlock> {
    const answer = await super.unlock(member, pid);
    return { ...answer, contact: { ...answer.contact, founder_private_phone: '0500000000', notes: 'داخلي' } as PbUnlock['contact'] };
  }
}

const project = (overrides: Partial<PublicProject>): PublicProject => ({
  id: 1,
  number: null,
  slug: null,
  title: 'مشروع',
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
  ...overrides,
});

const TECH = { slug: 'tech', name: 'تقنية' };
const FOOD = { slug: 'food', name: 'أغذية' };
const LEAKY_DETAILS = [
  'منصة توصيل تربط المتاجر الصغيرة بمناديب مستقلين داخل الأحياء، وتعمل في ثلاث مدن.',
  'نموذج العمل: عمولة على كل طلب مع اشتراك شهري للمتاجر.',
  'المطلوب: شريك تشغيلي بخبرة في الخدمات اللوجستية.',
  'العائد المتوقع: 40% سنويًا مضمون.',
  'للتواصل واتساب: 0555123456 أو founder@delivery.example.com أو https://delivery.example.com/contact وحسابنا @delivery_sa',
].join('\n');
const projects = [
  project({ id: 11, number: '110', title: 'تطبيق توصيل الأحياء', companyName: 'شركة الأحياء', founderName: 'سالم', sector: TECH, stage: { slug: 'growth', name: 'نمو' }, hasPitchDeck: true, details: LEAKY_DETAILS, modifiedAt: '2026-02-01T00:00:00.000Z' }),
  project({ id: 12, number: '120', title: 'منصة شحن للمتاجر', sector: TECH, stage: { slug: 'cash', name: 'مرحلة تحقيق الدخل ( Cash Flow )' }, excerpt: 'منصة تربط المتاجر بشركات الشحن وتعمل بعمولة على كل طلب.' }),
  project({ id: 13, number: '130', title: 'تطبيق حجوزات ملاعب', sector: TECH, stage: { slug: 'idea', name: 'مرحلة الفكرة' }, excerpt: 'فكرة تطبيق لحجز الملاعب.' }),
  project({ id: 14, number: '140', title: 'مطبخ سحابي', sector: FOOD, stage: { slug: 'growth', name: 'نمو' }, excerpt: 'مطبخ يخدم المتاجر والمطاعم في الأحياء مع مناديب توصيل.' }),
  project({ id: 15, number: '150', title: 'مصنع عبوات', sector: { slug: 'industry', name: 'صناعة' }, excerpt: 'مصنع عبوات بلاستيكية.' }),
  project({ id: 16, title: 'شركة ذهبية', isGolden: true, goldenPartnerUrl: 'https://vibesholding.com/offer/' }),
  ...[21, 22, 23, 24, 25].map((id) => project({ id, title: `مشروع إضافي ${id}`, sector: FOOD })),
];

const newsUrl = 'https://www.spa.gov.sa/N2400000';
const newsItem: NewsItem = {
  id: newsIdOf(newsUrl),
  sourceId: 'spa',
  sourceName: 'وكالة الأنباء السعودية',
  tier: 'official',
  lang: 'ar',
  title: 'مجلس الوزراء يقر نظام الاستثمار المحدّث',
  snippet: 'أقر مجلس الوزراء في جلسته اليوم نظام الاستثمار المحدّث.',
  url: newsUrl,
  image: null,
  publishedAt: new Date().toISOString(),
  verifiedAt: new Date().toISOString(),
  classifiedBy: 'keywords',
  hidden: false,
  duplicateOf: null,
  topics: ['economy'],
  decision: true,
  businessAngle: true,
  relevance: 90,
};

const kv = new MemoryKV();
const hub = new SpyHub();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });
let built: Awaited<ReturnType<typeof buildApp>>;
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let memberToken = '';
let guestToken = '';
let caller = 0;

const post = (url: string, payload: Record<string, unknown>, token?: string) => {
  caller += 1;
  return app.inject({ method: 'POST', url, payload, remoteAddress: `10.2.0.${(caller % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
const send = (method: 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token: string) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function signUp(target: typeof app, email: string, phone: string): Promise<string> {
  const registered = await target.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `10.3.0.${(caller += 1) % 250}`, payload: { name: 'عضو التجربة', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب لاختبار بنك المشاريع داخل التطبيق.' } });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await target.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

before(async () => {
  await kv.set(SNAPSHOT_KEY, { fetchedAt: '2026-09-20T00:00:00.000Z', projects, pageUrls: { 11: 'https://vibesholding.com/project/delivery/' } } satisfies FeedSnapshot);
  await kv.set(NEWS_SNAPSHOT_KEY, { version: 1, items: [newsItem], updatedAt: new Date().toISOString() } satisfies NewsSnapshot);
  built = await buildApp({ config, kv, hub });
  app = built.app;
  await built.projects.start();
  await built.news.start();
  memberToken = await signUp(app, 'm20+member@gmail.com', '0558318711');
  guestToken = await signUp(app, 'm20.unpaid@gmail.com', '0558318712');
});

after(async () => {
  built.projects.stop();
  await app.close();
});

const CONTACT_KEYS = ['whatsapp', 'email', 'website', 'pitchUrl'];

test('access: a session is required, contact data appears only after this member unlocked this project', async () => {
  const anonymous = await get('/api/projects/11/access');
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.headers['cache-control'], 'no-store');
  assert.equal((await post('/api/projects/11/unlock', {})).statusCode, 401);
  assert.equal((await get('/api/projects/999/access', memberToken)).statusCode, 404);

  const notMember = (await get('/api/projects/11/access', guestToken)).json();
  assert.deepEqual([notMember.state, notMember.isMember, notMember.balance, notMember.contact], ['not_member', false, null, null]);
  const refused = await post('/api/projects/11/unlock', {}, guestToken);
  assert.deepEqual([refused.statusCode, refused.json().error.code], [403, 'not_member']);

  const closed = await get('/api/projects/11/access', memberToken);
  assert.equal(closed.headers['cache-control'], 'no-store');
  assert.deepEqual(closed.json(), { state: 'can_unlock', isMember: true, balance: { credits: 5, granted: 0, used: 0, left: 5 }, contact: null, message: null });
  assert.ok(!/whatsapp":"\+|@example|pitch\//.test(closed.body), 'nothing of the founder before the unlock');

  const opened = await post('/api/projects/11/unlock', {}, memberToken);
  assert.equal(opened.statusCode, 200, opened.body);
  assert.deepEqual([opened.json().ok, opened.json().already, opened.json().left], [true, false, 4]);
  assert.deepEqual(Object.keys(opened.json().contact), CONTACT_KEYS);
  assert.ok(opened.json().contact.whatsapp.startsWith('+9665') && opened.json().contact.pitchUrl.endsWith('.pdf'));

  // Opening it again takes nothing; the access answer now carries the same contact.
  const again = (await post('/api/projects/11/unlock', {}, memberToken)).json();
  assert.deepEqual([again.already, again.left], [true, 4]);
  const access = (await get('/api/projects/11/access', memberToken)).json();
  assert.deepEqual([access.state, access.balance.used, access.balance.left], ['unlocked', 1, 4]);
  assert.deepEqual(access.contact, opened.json().contact);
  // Another member-less account still sees nothing, and the public project never carries contact fields.
  assert.equal((await get('/api/projects/11/access', guestToken)).json().contact, null);
  const open = (await get('/api/projects/11')).json().project;
  for (const key of ['whatsapp', 'email', 'website', 'pitch_deck', 'pitchUrl']) assert.ok(!(key in open), key);

  const golden = (await get('/api/projects/16/access', memberToken)).json();
  assert.deepEqual([golden.state, golden.contact], ['golden', null]);
  assert.equal((await post('/api/projects/16/unlock', {}, memberToken)).statusCode, 409);
});

test('unlock: the balance runs out at the allowance (402 no_credit) and the state says exhausted', async () => {
  for (const id of [12, 13, 14, 15]) assert.equal((await post(`/api/projects/${id}/unlock`, {}, memberToken)).statusCode, 200);
  const none = await post('/api/projects/21/unlock', {}, memberToken);
  assert.deepEqual([none.statusCode, none.json().error.code], [402, 'no_credit']);
  const access = (await get('/api/projects/21/access', memberToken)).json();
  assert.deepEqual([access.state, access.balance.left, access.contact], ['exhausted', 0, null]);
});

test('rule 4: whatever Projects Bank answers, only the four contract fields leave the server, each one checked', async () => {
  const otherKv = new MemoryKV();
  await otherKv.set(SNAPSHOT_KEY, { fetchedAt: '2026-09-20T00:00:00.000Z', projects } satisfies FeedSnapshot);
  const holder: { projects: { get(id: number): PublicProject | null } } = { projects: { get: () => null } };
  const other = await buildApp({ config, kv: otherKv, hub: new MockHubClient(), pb: new ChattyPb({ projects: { get: (id) => holder.projects.get(id) } }) });
  holder.projects = other.projects;
  await other.projects.start();
  const token = await signUp(other.app, 'm20.chatty+member@gmail.com', '0558318713');
  const opened = await other.app.inject({ method: 'POST', url: '/api/projects/12/unlock', payload: {}, headers: { authorization: `Bearer ${token}` } });
  assert.equal(opened.statusCode, 200, opened.body);
  assert.deepEqual(Object.keys(opened.json().contact), CONTACT_KEYS);
  assert.ok(!opened.body.includes('founder_private_phone') && !opened.body.includes('0500000000') && !opened.body.includes('داخلي'));
  assert.equal(opened.json().contact.pitchUrl, '', 'no pitch deck on this project');
  const access = await other.app.inject({ method: 'GET', url: '/api/projects/12/access', headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(Object.keys(access.json().contact), CONTACT_KEYS);
  other.projects.stop();
  await other.app.close();
});

test('brief without an OpenAI key: the rules write it from public fields, contact data and yield talk stripped, cached by content', async () => {
  const res = await get('/api/projects/11/brief');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['cache-control'], 'no-store');
  const brief = res.json();
  assert.deepEqual(Object.keys(brief), ['summary', 'table', 'stage', 'strengths', 'risks', 'competitors', 'disclaimer', 'generatedAt', 'source']);
  assert.equal(brief.source, 'rules');
  assert.deepEqual([brief.stage.key, brief.stage.index, brief.stage.total, brief.stage.label], ['growth', 4, 5, 'نمو']);
  assert.equal(brief.stage.steps.length, 5);
  assert.ok(brief.disclaimer.includes('المعلومات تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد'));
  const labels = brief.table.map((row: { label: string }) => row.label);
  assert.ok(['رقم المشروع', 'الشركة', 'المؤسس', 'القطاع', 'المرحلة', 'نموذج العمل', 'المطلوب'].every((label) => labels.includes(label)), labels.join('، '));
  assert.ok(!labels.some((label: string) => /عائد|تواصل/.test(label)), 'no promised returns, no contact rows');
  for (const leak of ['0555123456', 'founder@delivery', 'delivery.example.com', '@delivery_sa', 'مضمون', '40%']) assert.ok(!res.body.includes(leak), leak);

  // Same sector first, then the closest stage; the shared wording brings in a neighbour from another sector.
  assert.deepEqual(brief.competitors.map((row: { id: number }) => row.id).slice(0, 3), [12, 13, 14]);
  assert.ok(brief.competitors[0].why.includes('القطاع نفسه'));
  assert.ok(!brief.competitors.some((row: { id: number }) => row.id === 11 || row.id === 15));

  const again = (await get('/api/projects/11/brief')).json();
  assert.equal(again.generatedAt, brief.generatedAt, 'served from kv');
  const unknown = (await get('/api/projects/15/brief')).json();
  assert.deepEqual([unknown.stage.key, unknown.stage.index, unknown.stage.label], ['unknown', -1, 'غير محددة']);
  assert.equal((await get('/api/projects/999/brief')).statusCode, 404);
  for (const raw of [res.body, (await get('/api/projects/12/brief')).body]) {
    const body = raw.replace(/\d{4}-\d{2}-\d{2}(T[^"]*)?/g, '');
    assert.ok(!/مجان|كريديت|\d-\d/.test(body));
  }
});

test('sync lists the five versions; the feed shows what the sites published and hides the membership sales page', async () => {
  const before = (await get('/api/sync')).json();
  assert.deepEqual(Object.keys(before.v), ['posts', 'projects', 'news', 'content', 'feed']);
  assert.equal((await get('/api/sync')).headers['cache-control'], 'no-store');

  const feed = await get('/api/feed');
  assert.equal(feed.statusCode, 200, feed.body);
  const page = feed.json();
  assert.equal(page.supported, true);
  assert.ok(page.cursor > 0 && page.items.length >= 5);
  assert.deepEqual(Object.keys(page.items[0]), ['id', 'site', 'host', 'url', 'title', 'kind', 'excerpt', 'updatedAt']);
  assert.ok(!/1,900|3,900|membership|اشترك/.test(feed.body), 'rule 3: no web prices, no membership page');
  const projectsOnly = (await get('/api/feed?kinds=project&limit=5')).json();
  assert.ok(projectsOnly.items.length > 0 && projectsOnly.items.every((item: { kind: string }) => item.kind === 'project'));
  assert.deepEqual((await get(`/api/feed?since=${page.cursor}`)).json().items, []);
  assert.equal((await get('/api/feed?limit=500')).statusCode, 400);
});

test('rule 3: a website page that sells the membership or quotes a price never brings it into the feed', () => {
  const row = (overrides: Record<string, unknown>) => toFeedItem({ id: 50, host: 'vcmem.com', site: 'نادي المستثمرين', url: 'https://vcmem.com/about/', title: 'عن النادي', kind: 'page', excerpt: 'نادي أعمال يجمع المستثمرين ورواد الأعمال.', updated_at: '2026-09-01 10:00:00', ...overrides });
  assert.equal(row({})?.excerpt, 'نادي أعمال يجمع المستثمرين ورواد الأعمال.');

  // Sales pages under other names: dropped whole, by address or by title.
  for (const sales of [
    { url: 'https://vcmem.com/annual/', title: 'الباقة السنوية', excerpt: 'الاشتراك السنوي في النادي 3,000 ريال، سجّل الآن عبر الموقع' },
    { url: 'https://vcmem.com/annual/', title: 'الباقة السنوية', excerpt: 'انضم الآن مقابل 2,900 ريال سنويًا' },
    { url: 'https://vcmem.com/annual/', title: 'سعر العضوية', excerpt: 'سعر العضوية 3,000 ريال' },
    { url: 'https://vcmem.com/pricing/', title: 'النادي' },
    { url: 'https://vcmem.com/join/', title: 'النادي' },
    { url: 'https://vcmem.com/%D8%A7%D8%B4%D8%AA%D8%B1%D8%A7%D9%83/', title: 'النادي' },
    { title: 'عرض اليوم الوطني 1,900 ريال' },
    { title: 'النادي', excerpt: 'انضم الآن مقابل 2,900 ريال سنويًا' },
    { title: 'النادي', excerpt: 'الاشتراك السنوي SAR 3000' },
  ]) {
    assert.equal(row(sales), null, JSON.stringify(sales));
  }

  // Any other page keeps its place, without the sentence that quotes a price or calls to subscribe.
  for (const excerpt of ['قيمة التذكرة 3,000 ريال للشخص', 'التذكرة ٥٠٠ ر.س للشخص', 'بقيمة $99 فقط', 'اشترك الآن عبر الموقع', 'مزايا العضوية السنوية عبر الموقع']) {
    assert.deepEqual([row({ excerpt })?.title, row({ excerpt })?.excerpt], ['عن النادي', ''], excerpt);
  }
  // Not prices, not sales: years, counts and «بدون رسوم».
  for (const excerpt of ['تأسس النادي عام 2020 ويضم 300 عضو', 'وصلت 5 رسائل من المستثمرين', 'استشارة أولى بدون رسوم لأصحاب المشاريع', 'مشروع مشترك بين شركتين']) {
    assert.equal(row({ excerpt })?.excerpt, excerpt);
  }
  // The app's own posts were written for the app.
  assert.equal(row({ url: 'app://posts/abc', title: 'أمسية الأعضاء', excerpt: 'انضم إلينا في أمسية الشراكات.' })?.excerpt, 'انضم إلينا في أمسية الشراكات.');
});

test('the public feed never turns a caller’s query into hub calls, and one address is limited', async () => {
  built.feed.bust();
  const before = hub.calls.filter((call) => call.op === 'changes').length;
  const from = (url: string, remoteAddress: string) => app.inject({ method: 'GET', url, remoteAddress });
  const answers = await Promise.all(Array.from({ length: 60 }, (_, index) => from(`/api/feed?since=${index}&limit=${(index % 50) + 1}`, '10.9.0.1')));
  assert.ok(answers.every((res) => res.statusCode === 200));
  assert.equal(hub.calls.filter((call) => call.op === 'changes').length, before + 1, 'sixty different cursors, one hub call');
  assert.deepEqual(hub.calls.filter((call) => call.op === 'changes').at(-1)?.body, { since_id: 0, kinds: [], limit: 100 }, 'nothing of the query reaches the hub');
  const refused = await from('/api/feed?since=61', '10.9.0.1');
  assert.deepEqual([refused.statusCode, refused.json().error.code, refused.headers['cache-control']], [429, 'rate', 'no-store']);
  assert.equal((await from('/api/feed', '10.9.0.2')).statusCode, 200, 'another address is not affected');

  // `since` and `kinds` filter the snapshot.
  const all = (await from('/api/feed', '10.9.0.3')).json();
  const newest = all.items[0].id as number;
  assert.deepEqual((await from(`/api/feed?since=${newest - 1}`, '10.9.0.3')).json().items.map((item: { id: number }) => item.id), [newest]);
  assert.deepEqual((await from('/api/feed?kinds=nothing', '10.9.0.3')).json().items, []);
  assert.equal(hub.calls.filter((call) => call.op === 'changes').length, before + 1);
});

test('an event published from the dashboard reaches the hub feed at once; a hub failure never blocks the post and the next edit retries', async () => {
  const before = (await get('/api/sync')).json().v.posts as number;
  const input = { title: 'أمسية الشراكات', body: 'لقاء شهري للأعضاء في مقر النادي.', status: 'published', kind: 'event', event: { date: '2026-10-05T19:30:00+03:00', place: 'مقر النادي بالرياض', onlineUrl: 'https://meet.example.com/evening' }, images: ['https://cdn.example.com/evening.jpg'] };
  assert.equal((await post('/api/admin/posts', { ...input, event: null }, memberToken)).statusCode, 400, 'an event needs its date');
  assert.equal((await post('/api/admin/posts', { ...input, event: { date: 'غدًا' } }, memberToken)).statusCode, 400);
  const created = await post('/api/admin/posts', input, memberToken);
  assert.equal(created.statusCode, 201, created.body);
  const saved = created.json().post;
  assert.deepEqual([saved.kind, saved.event.place, saved.hubSync.state, saved.hubSync.published], ['event', 'مقر النادي بالرياض', 'ok', true]);
  assert.ok((await get('/api/sync')).json().v.posts > before);

  const card = (await hub.inner.call('feed', { kind: 'event' })) as unknown as { items: { key: string; title: string; image: string; event: { date: string; place: string; online_url: string } }[] };
  assert.deepEqual(card.items.map((item) => [item.key, item.title, item.image, item.event.online_url]), [[saved.id, 'أمسية الشراكات', 'https://cdn.example.com/evening.jpg', 'https://meet.example.com/evening']]);
  const changes = (await get('/api/feed?kinds=app_event')).json();
  assert.deepEqual(changes.items.map((item: { url: string }) => item.url), [`app://posts/${saved.id}`]);
  const shown = (await get(`/api/posts/${saved.id}`)).json().post;
  assert.deepEqual([shown.kind, shown.event.date], ['event', '2026-10-05T19:30:00+03:00']);
  assert.ok(!('hubSync' in shown) && !('author' in shown));

  // The hub is down: the post is saved all the same, the failure is written on it.
  hub.failPublish = true;
  const second = await post('/api/admin/posts', { title: 'إعلان', body: 'نص', status: 'published' }, memberToken);
  assert.equal(second.statusCode, 201, second.body);
  assert.deepEqual([second.json().post.kind, second.json().post.hubSync.state, second.json().post.hubSync.error, second.json().post.hubSync.published], ['post', 'failed', 'hub_unreachable', false]);
  assert.equal((await get(`/api/posts/${second.json().post.id}`)).statusCode, 200);
  hub.failPublish = false;
  const edited = await send('PUT', `/api/admin/posts/${second.json().post.id}`, { title: 'إعلان محدّث', body: 'نص', status: 'published' }, memberToken);
  assert.deepEqual([edited.statusCode, edited.json().post.hubSync.state, edited.json().post.hubSync.published], [200, 'ok', true]);

  // Back to a draft, then deleted: the websites stop showing both.
  const draft = await send('PUT', `/api/admin/posts/${saved.id}`, { ...input, status: 'draft' }, memberToken);
  assert.equal(draft.json().post.hubSync.published, false);
  assert.equal((await send('DELETE', `/api/admin/posts/${second.json().post.id}`, undefined, memberToken)).statusCode, 200);
  assert.deepEqual(((await hub.inner.call('feed', {})) as unknown as { items: unknown[] }).items, []);
});

test('advisor contexts are built on the server from public data: no founder contacts, news in the source’s own words', async () => {
  const ask = async (context: Record<string, unknown>) => {
    const res = await post('/api/advisor/message', { text: 'ما رأيك؟', context }, memberToken);
    assert.equal(res.statusCode, 200, res.body);
    return hub.lastMessage() as { page_url: string; page_title: string; context?: { type: string; id: string; title: string; text: string; selection?: string } };
  };

  const aboutProject = await ask({ type: 'project', id: 11, selection: 'نموذج العمل: عمولة — راسلني 0555123456' });
  assert.deepEqual([aboutProject.context?.type, aboutProject.context?.id, aboutProject.page_url], ['project', '11', 'https://vibesholding.com/project/delivery/']);
  assert.ok(aboutProject.context?.text.includes('منصة توصيل تربط المتاجر') && aboutProject.context.text.includes('القطاع: تقنية'));
  for (const leak of ['0555123456', 'founder@delivery', 'delivery.example.com', '@delivery_sa']) assert.ok(!JSON.stringify(aboutProject.context).includes(leak), leak);
  assert.equal(aboutProject.context?.selection, 'نموذج العمل: عمولة — راسلني');

  const aboutNews = await ask({ type: 'news', id: newsItem.id });
  assert.equal(aboutNews.context?.title, newsItem.title);
  assert.equal(aboutNews.context?.text, `العنوان الأصلي: ${newsItem.title}\nالمصدر: ${newsItem.sourceName}\nمقتطف المصدر: ${newsItem.snippet}`);
  assert.equal(aboutNews.page_url, newsUrl);

  const created = await post('/api/admin/posts', { title: 'ورشة التقييم', body: 'ورشة عملية عن تقييم المشاريع الناشئة.', status: 'published' }, memberToken);
  const aboutPost = await ask({ type: 'post', id: created.json().post.id });
  assert.ok(aboutPost.context?.text.includes('ورشة عملية عن تقييم المشاريع الناشئة.'));
  const draft = await post('/api/admin/posts', { title: 'مسودة سرية', body: 'لا تُنشر', status: 'draft' }, memberToken);
  assert.equal((await ask({ type: 'post', id: draft.json().post.id })).context, undefined, 'a draft is not public data');

  assert.equal((await ask({ type: 'video', id: 'CnWMWS_nDpM' })).context?.type, 'video');
  assert.ok((await ask({ type: 'service', id: 'pitch-deck' })).context?.text.includes('خدمة:'));
  assert.ok((await ask({ type: 'portal', id: 'investor' })).context?.title.includes('المستثمر'));
  const membership = await ask({ type: 'screen', id: 'membership' });
  assert.ok(membership.context?.text.includes('رصيد 2,500 ريال في بنك المشاريع'));
  assert.ok(!/1,900|3,900|paymob/.test(membership.context?.text ?? ''), 'rule 3');
  const golden = await ask({ type: 'screen', id: 'golden' });
  assert.ok(golden.context?.text.includes('المعلومات تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد'), 'valuations carry the disclaimer');
  assert.equal((await ask({ type: 'screen', id: 'somewhere-new' })).context?.text, '');
  assert.ok(Object.values(membership.context ?? {}).every((value) => String(value).length <= 6000));

  assert.equal((await post('/api/advisor/message', { text: 'سؤال', context: { type: 'member', id: 5 } }, memberToken)).statusCode, 400);
  assert.equal((await post('/api/advisor/message', { text: 'سؤال', context: { type: 'screen', id: '../etc' } }, memberToken)).statusCode, 400);
});

test('with a hub older than 2.7.0 the app feed is empty, not an error, and posts still save', async () => {
  hub.old = true;
  try {
    // The snapshot of the newer hub is dropped, as the hub's webhook would do.
    built.feed.bust();
    const feed = await get('/api/feed?limit=7');
    assert.deepEqual([feed.statusCode, feed.json().supported, feed.json().items.length], [200, false, 0]);
    const created = await post('/api/admin/posts', { title: 'إعلان على هب قديم', body: 'نص', status: 'published' }, memberToken);
    assert.deepEqual([created.statusCode, created.json().post.hubSync.state], [201, 'unsupported']);
  } finally {
    hub.old = false;
    built.feed.bust();
  }
});
