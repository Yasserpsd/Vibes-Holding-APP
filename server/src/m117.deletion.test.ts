import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M117 «حذف الحساب على ثلاث خطوات»: password → mailed code → the confirm word; nothing deletes on
// the spot — a 30-day scheduled request with a countdown and a way back.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

let built: BuiltApp;
let app: BuiltApp['app'];
let token = '';
let legacyToken = '';
let confirmWord = '';

const bearer = (value?: string) => (value ? { authorization: `Bearer ${value}` } : {});
const get = (url: string, value?: string) => app.inject({ method: 'GET', url, headers: bearer(value) });
const send = (method: 'POST' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, value?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(value) });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await send('POST', '/api/auth/register', { name: 'حساب حذف', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب اختبار حذف الحساب.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), mailer: new LogMailer() });
  app = built.app;
  token = await signUp('m117.member@gmail.com', '0558619971');
  legacyToken = await signUp('m117.legacy@gmail.com', '0558619972');
});

after(async () => {
  await app.close();
});

test('step 1 refuses a wrong password; the right one mails a code and hands the confirm word', async () => {
  const wrong = await send('POST', '/api/me/delete/start', { password: 'not-the-one', reason: 'اختبار' }, token);
  assert.equal(wrong.statusCode, 403);
  assert.equal(wrong.json().error.code, 'bad_password');
  const started = await send('POST', '/api/me/delete/start', { password: 'secret123', reason: 'اختبار' }, token);
  assert.equal(started.statusCode, 200, started.body);
  confirmWord = started.json().word as string;
  assert.ok(confirmWord.length >= 3, 'the random confirm word is handed to the app');
  assert.equal(started.json().days, 30);
});

test('step 3 refuses the wrong word, accepts the right one, and schedules 30 days ahead', async () => {
  const badWord = await send('POST', '/api/me/delete/confirm', { code: MOCK_CODE, word: 'كلمة غلط' }, token);
  assert.equal(badWord.statusCode, 400);
  assert.equal(badWord.json().error.code, 'delete_bad_word');
  // The pending request survives a wrong word: the member retypes without asking for a new code.
  const confirmed = await send('POST', '/api/me/delete/confirm', { code: MOCK_CODE, word: confirmWord }, token);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().daysLeft, 30);

  const state = await get('/api/me/delete/state', token);
  assert.equal(state.json().scheduled.daysLeft, 30);
  // The account still works through the whole grace window.
  assert.equal((await get('/api/me', token)).statusCode, 200);
  // A second start while scheduled is refused.
  assert.equal((await send('POST', '/api/me/delete/start', { password: 'secret123' }, token)).statusCode, 409);
});

test('«تراجع عن الحذف» clears the schedule', async () => {
  const cancelled = await send('POST', '/api/me/delete/cancel', {}, token);
  assert.equal(cancelled.json().cancelled, true);
  assert.equal((await get('/api/me/delete/state', token)).json().scheduled, null);
});

test('the legacy DELETE /api/me now schedules instead of deleting on the spot', async () => {
  const wrong = await send('DELETE', '/api/me', { password: 'nope', reason: 'قديم' }, legacyToken);
  assert.equal(wrong.statusCode, 403);
  const answer = await send('DELETE', '/api/me', { password: 'secret123', reason: 'قديم' }, legacyToken);
  assert.equal(answer.statusCode, 200, answer.body);
  assert.equal(answer.json().daysLeft, 30);
  // The account lives on — the session still answers.
  assert.equal((await get('/api/me', legacyToken)).statusCode, 200);
  assert.equal((await get('/api/me/delete/state', legacyToken)).json().scheduled.daysLeft, 30);
});
