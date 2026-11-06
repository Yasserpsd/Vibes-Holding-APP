import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M206: Google and Apple sign-ups skip the register screen, so the invite code can come with the profile form.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });
let built: BuiltApp;
let app: BuiltApp['app'];

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function signUp(email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'عضو الدعوات', country: 'sa', phone, email, password: 'secret123', persona: 'neutral', bio: 'حساب اختبار للدعوات بإحالة متحققة.' },
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), mailer: new LogMailer() });
  app = built.app;
});

after(async () => {
  await app.close();
});

test('an account with no code gives it from the profile form, once', async () => {
  const inviter = await signUp('m206+member@gmail.com', '0558618001');
  const number = `I-${String(inviter.id).padStart(10, '0')}`;
  const member = await signUp('m206.nocode@gmail.com', '0558618002');
  const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/api/me', payload, headers: bearer(member.token) });

  const open = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(member.token) });
  assert.equal(open.json().me.inviteOpen, true);

  const wrong = await patch({ inviteCode: 'I-0009999999' });
  assert.equal(wrong.statusCode, 400, wrong.body);
  assert.equal(wrong.json().error.code, 'referral');

  const saved = await patch({ inviteCode: number });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().me.inviteOpen, false);

  const again = await patch({ inviteCode: number });
  assert.equal(again.statusCode, 409, again.body);
  assert.equal(again.json().error.code, 'invite_unavailable');
});
