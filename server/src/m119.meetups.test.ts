import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MEETUPS_SEED } from './content/meetups.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

/** M119: the five club meetups — their own content block, and one registration form per meetup. */

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', NEWS_REFRESH_MINUTES: '0' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let token = '';

before(async () => {
  app = (await buildApp({ config, kv, hub: new MockHubClient() })).app;
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'عضو الملتقيات', country: 'sa', phone: '0558312299', email: 'meetups.member@gmail.com', password: 'secret123', persona: 'entrepreneur', bio: 'حساب لاختبار ملتقيات النادي.' },
  });
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  token = verified.json().token as string;
});

after(async () => {
  await app.close();
});

test('the meetups content serves the five meetups with per-persona variants, in both languages', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/meetups' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.meetups.length, 5);
  const keys = body.meetups.map((meetup: { key: string }) => meetup.key);
  assert.deepEqual(keys, ['five-minutes', 'private-pitch', 'elite-challenge', 'open-day', 'your-own']);
  // Every meetup points at a registration form and carries its three features; اليوم المفتوح has no film yet.
  for (const meetup of body.meetups) {
    assert.ok(String(meetup.formKey).startsWith('meetup-'));
    assert.equal(meetup.features.length, 3);
  }
  assert.equal(body.meetups.find((meetup: { key: string }) => meetup.key === 'open-day').videoUrl, '');
  // The investor's list leads with the private pitch; the entrepreneur's with 5 minutes.
  assert.equal(body.personas.investor.order[0], 'private-pitch');
  assert.equal(body.personas.entrepreneur.order[0], 'five-minutes');
  // Brand rule: Latin «Vibes Ventures», never the Arabic transliterations, anywhere in the block.
  assert.ok(!JSON.stringify(MEETUPS_SEED).includes('فايبز'));
  const english = await app.inject({ method: 'GET', url: '/api/meetups', headers: { 'x-app-lang': 'en' } });
  assert.equal(english.json().meetups[0].title, '5 Minutes');
});

test('each meetup form exists and a signed-in member can register through it', async () => {
  const definition = await app.inject({ method: 'GET', url: '/api/forms/meetup-five-minutes' });
  assert.equal(definition.statusCode, 200);
  assert.equal(definition.json().form.access, 'signedIn');

  const submitted = await app.inject({
    method: 'POST',
    url: '/api/forms/meetup-five-minutes',
    headers: { authorization: `Bearer ${token}` },
    payload: { answers: { role: 'أعرض مشروعي كرائد أعمال', project: 'مشروع الاختبار', mode: 'حضوريًا في مقر النادي بالرياض', whatsapp: '0558312299' } },
  });
  assert.equal(submitted.statusCode, 201);

  // Repeat registrations stay open: the meetups recur, so a second edition's registration must pass.
  const again = await app.inject({
    method: 'POST',
    url: '/api/forms/meetup-five-minutes',
    headers: { authorization: `Bearer ${token}` },
    payload: { answers: { role: 'أحضر كمستثمر', mode: 'عبر الإنترنت', whatsapp: '0558312299' } },
  });
  assert.equal(again.statusCode, 201);
});
