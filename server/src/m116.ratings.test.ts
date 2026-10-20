import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { SNAPSHOT_KEY } from './projectsBank/service.js';
import type { PublicProject } from './projectsBank/types.js';
import { MemoryKV } from './store.js';

// M116 «تقييمات المشاريع»: stars + comments, the dashboard's manual entries and pinned stars,
// the «الأعلى تقييمًا» sort, the privacy rule (nothing leads back to the rater's account), the
// complete-profile gate on rating, and the members screen's interests labels.
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

function project(id: number, title: string): PublicProject {
  return {
    id,
    number: `P-${id}`,
    slug: `p-${id}`,
    title,
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
    modifiedAt: `2026-01-0${id}T00:00:00.000Z`,
  };
}

const hub = new LeveledHub();
const kv = new MemoryKV();
let built: BuiltApp;
let app: BuiltApp['app'];
let raterToken = '';
let raterId = 0;
let bareToken = '';
let adminToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(email: string, phone: string, complete = true): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'حساب تقييم', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار التقييمات.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const token = verified.json().token as string;
  if (complete) {
    const completed = await send('PATCH', '/api/me', { jobTitle: 'مدير', company: 'شركة الاختبار', city: 'الرياض', website: 'https://example.test', social: 'https://x.com/test' }, token);
    assert.equal(completed.statusCode, 200, completed.body);
  }
  return { token, id: verified.json().me.id as number };
}

before(async () => {
  // Two projects in the feed snapshot: the service loads it at start (no PB key needed).
  await kv.set(SNAPSHOT_KEY, { projects: [project(1, 'مشروع الأول'), project(2, 'مشروع الثاني')], fetchedAt: new Date().toISOString() });
  built = await buildApp({ config, kv, hub, mailer: new LogMailer() });
  app = built.app;
  await built.projects.start();
  const rater = await signUp('m116.rater@gmail.com', '0558619961');
  raterToken = rater.token;
  raterId = rater.id;
  hub.members.add(rater.id);
  await get('/api/me?fresh=1', raterToken);
  bareToken = (await signUp('m116.bare@gmail.com', '0558619962', false)).token;
  hub.members.add((await get('/api/me', bareToken)).json().me.id as number);
  await get('/api/me?fresh=1', bareToken);
  adminToken = (await signUp('m116.admin@gmail.com', '0558619963')).token;
});

after(async () => {
  await app.close();
});

test('rating needs a session and a complete profile; anyone complete rates, member or not', async () => {
  assert.equal((await send('POST', '/api/projects/1/reviews', { stars: 5 })).statusCode, 401);
  const gated = await send('POST', '/api/projects/1/reviews', { stars: 5 }, bareToken);
  assert.equal(gated.statusCode, 403);
  assert.equal(gated.json().error.code, 'profile_incomplete');
  const ok = await send('POST', '/api/projects/1/reviews', { stars: 4, comment: 'مشروع واعد جدًا' }, raterToken);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().summary.stars, 4);
  assert.equal(ok.json().summary.count, 1);
});

test('the public list shows name, stars and comment only — nothing reaches the account', async () => {
  const answer = await get('/api/projects/1/reviews');
  assert.equal(answer.statusCode, 200);
  const review = answer.json().reviews[0];
  assert.equal(review.stars, 4);
  assert.equal(review.comment, 'مشروع واعد جدًا');
  assert.ok(review.name);
  assert.ok(!('contactId' in review), 'contactId must never go public');
  assert.ok(!('email' in review) && !('phone' in review));
  // Signed in, the rater sees his own review flagged.
  const mine = await get('/api/projects/1/reviews', raterToken);
  assert.equal(mine.json().reviews[0].mine, true);
});

test('resubmitting updates the same review instead of adding a second one', async () => {
  const again = await send('POST', '/api/projects/1/reviews', { stars: 5, comment: 'بعد الملتقى: ممتاز' }, raterToken);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().summary.count, 1);
  assert.equal(again.json().summary.stars, 5);
});

test('the dashboard enters the old meetup feedback by hand and it counts in the average', async () => {
  const added = await send('POST', '/api/admin/ratings/1/reviews', { name: 'عبدالله المطيري', stars: 4, comment: 'أعجبني العرض في الملتقى' }, adminToken);
  assert.equal(added.statusCode, 201, added.body);
  assert.equal(added.json().review.source, 'manual');
  const summary = (await get('/api/projects/1/reviews')).json().summary;
  assert.equal(summary.count, 2);
  assert.equal(summary.stars, 4.5);
});

test('the pinned stars win over the average and can be cleared', async () => {
  const pinned = await send('PUT', '/api/admin/ratings/1/override', { stars: 3.5 }, adminToken);
  assert.equal(pinned.statusCode, 200);
  assert.equal(pinned.json().summary.stars, 3.5);
  assert.equal((await get('/api/projects/1/reviews')).json().summary.stars, 3.5);
  const cleared = await send('PUT', '/api/admin/ratings/1/override', { stars: null }, adminToken);
  assert.equal(cleared.json().summary.stars, 4.5);
});

test('«الأعلى تقييمًا» leads the sorts and orders the bank; every project carries its rating', async () => {
  const sorts = (await get('/api/projects/filters')).json().sorts as { key: string }[];
  assert.equal(sorts[0]?.key, 'top');
  const page = await get('/api/projects?sort=top');
  assert.equal(page.statusCode, 200);
  const items = page.json().items as { id: number; rating: { stars: number | null; count: number } }[];
  const [first, second] = items;
  assert.ok(first && second);
  assert.equal(first.id, 1, 'the rated project leads');
  assert.equal(first.rating.stars, 4.5);
  assert.equal(second.rating.count, 0);
});

test('a member review from the app can only be hidden or deleted, never rewritten', async () => {
  const all = (await get('/api/admin/ratings/1', adminToken)).json().reviews as { id: string; source: string; contactId: number | null }[];
  const memberReview = all.find((entry) => entry.source === 'member');
  assert.ok(memberReview);
  assert.equal(memberReview.contactId, raterId, 'the dashboard may see who rated');
  const rewrite = await send('PUT', `/api/admin/ratings/reviews/${memberReview.id}`, { stars: 1 }, adminToken);
  assert.equal(rewrite.statusCode, 400);
  const hide = await send('PUT', `/api/admin/ratings/reviews/${memberReview.id}`, { hidden: true }, adminToken);
  assert.equal(hide.statusCode, 200);
  const summary = (await get('/api/projects/1/reviews')).json();
  assert.equal(summary.reviews.length, 1, 'the hidden review left the public list');
  assert.equal(summary.summary.count, 1);
  const unhide = await send('PUT', `/api/admin/ratings/reviews/${memberReview.id}`, { hidden: false }, adminToken);
  assert.equal(unhide.statusCode, 200);
});

test('the ratings overview names the projects; an unknown project cannot be rated', async () => {
  const overview = await get('/api/admin/ratings', adminToken);
  assert.equal(overview.statusCode, 200);
  const row = (overview.json().rows as { projectId: number; title: string; count: number }[]).find((entry) => entry.projectId === 1);
  assert.equal(row?.title, 'مشروع الأول');
  assert.equal(overview.json().catalog.length, 2);
  assert.equal((await send('POST', '/api/projects/99/reviews', { stars: 5 }, raterToken)).statusCode, 404);
});

test('the members screen carries each account\'s interests beside the persona filter', async () => {
  const saved = await send('PUT', '/api/me/interests', { keys: ['invest', 'other'], other: 'التعدين' }, raterToken);
  assert.equal(saved.statusCode, 200, saved.body);
  const accounts = await get('/api/admin/accounts?q=&state=all', adminToken);
  assert.equal(accounts.statusCode, 200);
  const row = (accounts.json().items as { id: number; interests?: string[] }[]).find((entry) => entry.id === raterId);
  assert.ok(row?.interests?.length === 2, JSON.stringify(row?.interests));
  assert.ok(row.interests.some((label) => label.includes('التعدين')));
  const detail = await get(`/api/admin/accounts/${raterId}`, adminToken);
  assert.equal((detail.json().interests as string[]).length, 2);
});
