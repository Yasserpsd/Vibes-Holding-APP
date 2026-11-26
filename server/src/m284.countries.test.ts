import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { countByCountry, countryOfPhone } from './dashboard/countries.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

// M284 «خريطة الأعضاء»: the country comes from the phone's dialing code; only counts leave the server.
test('countryOfPhone matches the longest dialing code', () => {
  assert.equal(countryOfPhone('966512345678'), 'sa');
  assert.equal(countryOfPhone('+971 50 123 4567'), 'ae');
  assert.equal(countryOfPhone('0021620123456'), 'tn');
  assert.equal(countryOfPhone('213551234567'), 'dz');
  assert.equal(countryOfPhone('393331234567'), 'it');
  assert.equal(countryOfPhone('0512345678'), 'sa');
  assert.equal(countryOfPhone('201001234567'), 'eg');
  assert.equal(countryOfPhone(''), '');
});

test('countByCountry counts accounts and members, most first, no phones', () => {
  const answer = countByCountry([
    { phone: '21620123456', state: 'member' },
    { phone: '21620123457', state: 'registered' },
    { phone: '966512345678', state: 'member' },
    { phone: '', state: 'lead' },
  ]);
  assert.equal(answer.total, 4);
  assert.equal(answer.noPhone, 1);
  assert.deepEqual(answer.items.map((row) => [row.code, row.total, row.members]), [['tn', 2, 1], ['sa', 1, 1]]);
  assert.equal(answer.items[0]?.name, 'تونس');
  assert.ok(!JSON.stringify(answer).includes('20123456'));
});

// M284b: one country's accounts for the dashboard («ادوس علي الدولة اشوف كل المسجلين فيها»).
test('GET /api/admin/countries/:code lists that country only, admins only', async () => {
  const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });
  const built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient() });
  try {
    const signUp = async (name: string, email: string, country: string, phone: string) => {
      const registered = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { name, country, phone, email, password: 'secret123', persona: 'neutral' } });
      assert.equal(registered.statusCode, 200, registered.body);
      const verified = await built.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
      assert.equal(verified.statusCode, 200, verified.body);
      return verified.json().token as string;
    };
    const token = await signUp('ماجد العتيبي', 'm284.admin@gmail.com', 'sa', '0558428401');
    await signUp('سامي الطرابلسي', 'm284.tn@gmail.com', 'tn', '20123456');
    const get = (url: string, auth = true) => built.app.inject({ method: 'GET', url, headers: auth ? { authorization: `Bearer ${token}` } : {} });

    const tn = await get('/api/admin/countries/tn');
    assert.equal(tn.statusCode, 200, tn.body);
    assert.deepEqual(tn.json().items.map((row: { name: string }) => row.name), ['سامي الطرابلسي']);
    const sa = await get('/api/admin/countries/SA');
    assert.ok(sa.json().items.every((row: { name: string }) => row.name !== 'سامي الطرابلسي'));
    assert.equal((await get('/api/admin/countries/tun')).statusCode, 400);
    assert.equal((await get('/api/admin/countries/tn', false)).statusCode, 401);
  } finally {
    await built.app.close();
  }
});
