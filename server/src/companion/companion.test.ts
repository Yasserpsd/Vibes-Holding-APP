import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MockHubClient } from '../hub/mock.js';
import { LogMailer } from '../mail/mailer.js';
import { MemoryKV } from '../store.js';

/** M87: the advisor's daily persona push — template drafts over live data, one wave a day, inside the send hour. */

const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

let built: BuiltApp;
const pushes: { persona: string; title: string; body: string; data: Record<string, unknown> }[] = [];

// 2026-10-18 08:30 UTC = 11:30 Riyadh — inside the send hour.
const IN_HOUR = Date.parse('2026-10-18T08:30:00Z');
const OUT_OF_HOUR = Date.parse('2026-10-18T18:30:00Z');

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), mailer: new LogMailer() });
  built.push.broadcastPersona = async (persona, message) => {
    pushes.push({ persona, title: message.title, body: message.body, data: message.data ?? {} });
    return { sent: 1, failed: 0, dropped: 0 };
  };
});

after(async () => {
  await built.app.close();
});

test('drafts speak to each persona from live data and never use banned wording', async () => {
  const drafts = await built.companion.drafts(IN_HOUR);
  for (const draft of Object.values(drafts)) {
    assert.ok(draft.title.length > 3 && draft.body.length > 20);
    assert.ok(!/مجان/u.test(`${draft.title} ${draft.body}`), 'بدون رسوم، أبدًا «مجاني»');
  }
  // The three personas get three DIFFERENT messages.
  assert.equal(new Set(Object.values(drafts).map((draft) => draft.body)).size, 3);
});

test('the daily wave fires once inside the send hour, taps open the advisor, and the next day fires again', async () => {
  assert.equal(await built.companion.tick(OUT_OF_HOUR), false, 'outside the hour nothing goes out');
  assert.equal(await built.companion.tick(IN_HOUR), true);
  assert.equal(pushes.length, 3);
  assert.deepEqual(new Set(pushes.map((entry) => entry.persona)), new Set(['investor', 'entrepreneur', 'neutral']));
  assert.ok(pushes.every((entry) => entry.data.screen === '/advisor'));

  // The same day never double-sends, whatever the tick cadence.
  assert.equal(await built.companion.tick(IN_HOUR + 20 * 60_000), false);
  assert.equal(pushes.length, 3);

  // Tomorrow's hour sends tomorrow's wave (the rotation moves).
  assert.equal(await built.companion.tick(IN_HOUR + 24 * 3_600_000), true);
  assert.equal(pushes.length, 6);
});

// M87b: the dashboard edits the pools, the member mutes his daily message, and the wave respects both.
test('owner templates replace the seed, placeholders fill from live data, and the copy rules hold', async () => {
  const { MOCK_CODE } = await import('../hub/mock.js');
  const register = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'مدير القوالب', country: 'sa', phone: '0558618851', email: 'companion.admin@gmail.com', password: 'secret123', persona: 'investor', bio: 'حساب لاختبار قوالب المستشار اليومي.' } });
  const verified = await built.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: register.json().pendingToken, code: MOCK_CODE } });
  const token = verified.json().token as string;
  const auth = { authorization: `Bearer ${token}` };

  const listed = await built.app.inject({ method: 'GET', url: '/api/admin/companion', headers: auth });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().edited, false);
  assert.ok(listed.json().templates.investor.length >= 3);
  assert.ok(Array.isArray(listed.json().placeholders));
  assert.ok(listed.json().preview.investor.title.length > 3);

  const pool = (title: string, body: string) => [{ title, body }];
  const banned = { investor: pool('عرض مجاني', 'هذه الرسالة تحمل كلمة ممنوعة في العنوان لذلك تُرفض.'), entrepreneur: pool('رسالة', 'نص صالح تمامًا لهذه الفئة بلا كلمات ممنوعة.'), neutral: pool('رسالة', 'نص صالح تمامًا لهذه الفئة بلا كلمات ممنوعة.') };
  assert.equal((await built.app.inject({ method: 'PUT', url: '/api/admin/companion', payload: banned, headers: auth })).statusCode, 400);

  const custom = {
    investor: pool('نظرة اليوم', 'مشروع «{project}» ينتظر نظرتك في بنك المشاريع. اسألني عنه الآن.'),
    entrepreneur: pool('خطوتك القادمة', 'سجّل مشروعك اليوم في شركاء النجاح وأرافقك خطوة بخطوة حتى العرض.'),
    neutral: pool('استكشف معي', 'افتح المحادثة اليوم وسأرشّح لك بداية تناسب اهتمامك في النادي.'),
  };
  const saved = await built.app.inject({ method: 'PUT', url: '/api/admin/companion', payload: custom, headers: auth });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().edited, true);

  const drafts = await built.companion.drafts(IN_HOUR);
  assert.equal(drafts.entrepreneur.body, custom.entrepreneur[0]?.body);
  assert.ok(!drafts.investor.body.includes('{project}'), 'the placeholder is filled (or the generic fallback used)');

  const reset = await built.app.inject({ method: 'DELETE', url: '/api/admin/companion', headers: auth });
  assert.equal(reset.json().edited, false);

  // The member's mute switch: on, the wave excludes him; off again, it does not.
  assert.equal((await built.app.inject({ method: 'GET', url: '/api/companion/me', headers: auth })).json().muted, false);
  assert.equal((await built.app.inject({ method: 'PUT', url: '/api/companion/me', payload: { muted: true }, headers: auth })).json().muted, true);
  assert.equal((await built.app.inject({ method: 'GET', url: '/api/companion/me', headers: auth })).json().muted, true);
  const me = verified.json().me.id as number;
  assert.equal(await built.companion.isMuted(me), true);

  const excludes: (Set<number> | undefined)[] = [];
  built.push.broadcastPersona = async (_persona, _message, exclude) => {
    excludes.push(exclude);
    return { sent: 1, failed: 0, dropped: 0 };
  };
  assert.equal(await built.companion.tick(IN_HOUR + 2 * 24 * 3_600_000), true);
  assert.equal(excludes.length, 3);
  assert.ok(excludes.every((exclude) => exclude?.has(me)), 'the muted member is excluded from every wave');

  assert.equal((await built.app.inject({ method: 'PUT', url: '/api/companion/me', payload: { muted: false }, headers: auth })).json().muted, false);
  assert.equal(await built.companion.isMuted(me), false);
});
