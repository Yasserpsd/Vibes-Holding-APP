import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M11 «شخصية ومسيرة»: the member applies (active membership only), the admin approves, edits or
// rejects from the dashboard, the approved profiles are the public people of the app's home.
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
let profileId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

const application = {
  title: 'رئيس تنفيذي',
  company: 'شركة الاختبار للاستثمار',
  bio: 'مسيرة ممتدة في بناء الشركات الناشئة وقيادة فرق الاستثمار داخل المملكة وخارجها.',
  milestones: ['تأسيس أول شركة عام 2015', 'قيادة جولة استثمارية كبرى'],
  links: [{ label: 'الموقع', url: 'https://example.test/ceo' }],
};

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name: 'شخصية الاختبار', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار شخصية ومسيرة في التطبيق.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  const member = await signUp('m11+member@gmail.com', '0558618821');
  memberToken = member.token;
  memberId = member.id;
  adminToken = (await signUp('m11.admin@gmail.com', '0558618822')).token;
  hub.members.add(memberId);
  await get('/api/me?fresh=1', memberToken);
});

after(async () => {
  await app.close();
});

test('applying needs a session and an active annual membership; the words are validated', async () => {
  assert.equal((await send('POST', '/api/profiles/apply', application)).statusCode, 401);

  // The admin account holds no active membership in the mock, so the door closes on him too.
  const refused = await send('POST', '/api/profiles/apply', application, adminToken);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error.code, 'membership_required');

  const short = await send('POST', '/api/profiles/apply', { ...application, bio: 'قصير' }, memberToken);
  assert.equal(short.statusCode, 400);
});

test('the member applies: pending, mailed to the management, hidden from the public list', async () => {
  const before = mailer.sent.length;
  const applied = await send('POST', '/api/profiles/apply', application, memberToken);
  assert.equal(applied.statusCode, 201, applied.body);
  assert.equal(applied.json().profile.status, 'pending');
  profileId = applied.json().profile.id as string;

  assert.equal(mailer.sent.length, before + 1);
  assert.match(mailer.sent.at(-1)?.subject ?? '', /شخصية ومسيرة/);

  const pub = await get('/api/people');
  assert.equal(pub.statusCode, 200);
  assert.equal((pub.json().people as unknown[]).length, 0);
  assert.ok((pub.json().intro as string).includes('شخصيات نادي المستثمرين'));

  const mine = await get('/api/profiles/me', memberToken);
  assert.equal(mine.json().profile.status, 'pending');
});

test('the admin approves: the profile is public with its words, and the detail page answers', async () => {
  assert.equal((await get('/api/admin/profiles', memberToken)).statusCode, 403);

  const listed = await get('/api/admin/profiles', adminToken);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal((listed.json().profiles as { id: string }[])[0]?.id, profileId);

  const decided = await send('POST', `/api/admin/profiles/${profileId}/decision`, { action: 'approve' }, adminToken);
  assert.equal(decided.statusCode, 200, decided.body);
  assert.equal(decided.json().profile.status, 'approved');

  const pub = await get('/api/people');
  const people = pub.json().people as { id: string; name: string; title: string }[];
  assert.equal(people.length, 1);
  assert.equal(people[0]?.id, profileId);
  assert.equal(people[0]?.title, application.title);

  const person = await get(`/api/people/${profileId}`);
  assert.equal(person.statusCode, 200);
  assert.match(person.json().person.bio as string, /قيادة فرق الاستثمار/);
  assert.equal((person.json().person.milestones as string[]).length, 2);
});

test('an edit of an approved profile waits as a draft while the public keeps the approved words', async () => {
  const edited = await send('POST', '/api/profiles/apply', { ...application, bio: 'نسخة معدلة من النبذة لمراجعة الإدارة قبل الظهور للعموم في التطبيق.' }, memberToken);
  assert.equal(edited.statusCode, 201);
  assert.equal(edited.json().profile.status, 'approved');
  assert.ok(edited.json().profile.draft);

  const person = await get(`/api/people/${profileId}`);
  assert.match(person.json().person.bio as string, /قيادة فرق الاستثمار/);

  const approved = await send('POST', `/api/admin/profiles/${profileId}/decision`, { action: 'approve' }, adminToken);
  assert.equal(approved.json().profile.draft, null);
  const after = await get(`/api/people/${profileId}`);
  assert.match(after.json().person.bio as string, /نسخة معدلة/);
});

test('a rejection needs a note and the member reads it; re-applying returns to pending', async () => {
  const noNote = await send('POST', `/api/admin/profiles/${profileId}/decision`, { action: 'reject' }, adminToken);
  assert.equal(noNote.statusCode, 400);

  const rejected = await send('POST', `/api/admin/profiles/${profileId}/decision`, { action: 'reject', note: 'أضف تفاصيل أدق عن مسيرتك المهنية.' }, adminToken);
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().profile.status, 'rejected');
  assert.equal((await get('/api/people')).json().people.length, 0);

  const mine = await get('/api/profiles/me', memberToken);
  assert.match(mine.json().profile.note as string, /تفاصيل أدق/);

  const again = await send('POST', '/api/profiles/apply', application, memberToken);
  assert.equal(again.json().profile.status, 'pending');
  assert.equal(again.json().profile.note, '');
  await send('POST', `/api/admin/profiles/${profileId}/decision`, { action: 'approve' }, adminToken);
});

test('the dashboard enters and orders profiles by hand and edits the owner\'s intro line', async () => {
  const created = await send(
    'POST',
    '/api/admin/profiles',
    { fields: { name: 'ضيف الشرف', title: 'مستشار', company: '', bio: 'ملف أدخلته الإدارة يدويًا كما قرر المالك في 2026-09-11 ليظهر مباشرة.', milestones: ['محطة يدوية'], links: [], photo: null } },
    adminToken,
  );
  assert.equal(created.statusCode, 201, created.body);
  const manualId = created.json().profile.id as string;
  assert.equal(created.json().profile.status, 'approved');

  // The manual profile is ordered before the member's (smaller order first).
  const ordered = await send('PUT', `/api/admin/profiles/${manualId}`, { order: 1 }, adminToken);
  assert.equal(ordered.statusCode, 200);
  const people = (await get('/api/people')).json().people as { id: string }[];
  assert.equal(people.length, 2);
  assert.equal(people[0]?.id, manualId);

  const config = await send('PUT', '/api/admin/profiles/config', { intro: 'أنت من شخصيات النادي — قدم ملفك اليوم.' }, adminToken);
  assert.equal(config.statusCode, 200);
  assert.equal((await get('/api/people')).json().intro, 'أنت من شخصيات النادي — قدم ملفك اليوم.');

  const removed = await send('DELETE', `/api/admin/profiles/${manualId}`, undefined, adminToken);
  assert.equal(removed.statusCode, 200);
  assert.equal((await get('/api/people')).json().people.length, 1);
});
