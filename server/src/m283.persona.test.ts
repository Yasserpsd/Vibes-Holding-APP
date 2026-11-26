import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { MemoryKV } from './store.js';

// M283 (owner, 2026-11-26): members who picked «محايد» by mistake get their category changed from the dashboard,
// through their own open app session; nothing changes without `confirm: true`.
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0' });

/** The mock hub makes every verified account an admin; chosen ids become plain members. */
class PlainHub implements HubClient {
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

const hub = new PlainHub();
let built: BuiltApp;
let adminToken = '';
let member = { token: '', id: 0 };

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const send = (method: 'GET' | 'POST', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  built.app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

async function signUp(name: string, email: string, phone: string): Promise<{ token: string; id: number }> {
  const registered = await send('POST', '/api/auth/register', { name, country: 'sa', phone, email, password: 'secret123', persona: 'neutral' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub });
  adminToken = (await signUp('ماجد العتيبي', 'm283.admin@gmail.com', '0558428301')).token;
  member = await signUp('فهد الشمري', 'm283.member@gmail.com', '0558428302');
  hub.members.add(member.id);
  // A fresh sign-in, so the session reads the member as a plain member (the sign-up answer called him an admin).
  const signIn = await send('POST', '/api/auth/login', { login: 'm283.member@gmail.com', password: 'secret123' });
  assert.equal(signIn.statusCode, 200, signIn.body);
  member = { ...member, token: signIn.json().token as string };
});

after(async () => {
  await built.app.close();
});

test('M283: the dashboard changes a member category only with confirm, and only an admin may', async () => {
  const url = `/api/admin/accounts/${member.id}/persona`;
  assert.equal((await send('POST', url, { persona: 'investor' }, adminToken)).statusCode, 400);
  assert.equal((await send('POST', url, { persona: 'none', confirm: true }, adminToken)).statusCode, 400);
  assert.equal((await send('POST', url, { persona: 'investor', confirm: true }, member.token)).statusCode, 403);

  const changed = await send('POST', url, { persona: 'investor', confirm: true, requestId: 'm283-change-1' }, adminToken);
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().persona, 'investor');
  assert.equal((await send('GET', '/api/me', undefined, member.token)).json().me.persona, 'investor');

  // The member's own yearly self-change is untouched by the admin's change.
  assert.equal((await send('GET', '/api/me/persona/state', undefined, member.token)).json().daysLeft, 0);
});

test('M283: no open app session means a clear refusal, nothing changed', async () => {
  const gone = await signUp('خالد الدوسري', 'm283.gone@gmail.com', '0558428303');
  hub.members.add(gone.id);
  assert.equal((await send('POST', '/api/auth/logout', {}, gone.token)).statusCode, 200);
  const refused = await send('POST', `/api/admin/accounts/${gone.id}/persona`, { persona: 'entrepreneur', confirm: true }, adminToken);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, 'member_session_gone');
});
