import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubContact, HubOp, HubResponse } from './hub/types.js';
import { InvitesService, normalizeInviteCode } from './invites/service.js';
import { LogMailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { MemoryKV } from './store.js';

// M32: «الدعوات» — the invite code travels with the hub registration, the hub resolves and stores
// it, and the dashboard carries the manual gift work.
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
let inviterToken = '';
let inviterId = 0;
let inviterCode = '';
let adminToken = '';
let inviteId = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, token?: string) =>
  app.inject({ method, url, ...(payload ? { payload } : {}), headers: bearer(token) });

let nextPhone = 8618830;
const register = (email: string, extra: Record<string, unknown> = {}) =>
  send('POST', '/api/auth/register', {
    name: 'عضو الدعوات',
    country: 'sa',
    phone: `055${(nextPhone += 1)}`,
    email,
    password: 'secret123',
    persona: 'neutral',
    bio: 'حساب اختبار للدعوات بإحالة متحققة.',
    ...extra,
  });

async function signUp(email: string, extra: Record<string, unknown> = {}): Promise<{ token: string; id: number }> {
  const registered = await register(email, extra);
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, id: verified.json().me.id as number };
}

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub, mailer });
  app = built.app;
  // «+member@» makes the mock account an active member on verification; he is a plain member, not an admin.
  const inviter = await signUp('m32+member@gmail.com', { persona: 'investor' });
  inviterToken = inviter.token;
  inviterId = inviter.id;
  hub.members.add(inviterId);
  await get('/api/me?fresh=1', inviterToken);
  inviterCode = `I-${String(inviterId).padStart(10, '0')}`;
  // A verified account without a membership: the dashboard admin of these tests, and an invalid inviter.
  adminToken = (await signUp('m32.admin@gmail.com')).token;
});

after(async () => {
  await app.close();
});

test('the code tolerates how members really type it', () => {
  assert.equal(normalizeInviteCode('I-0000000042'), 'I-0000000042');
  assert.equal(normalizeInviteCode(' i 0000000042 '), 'I-0000000042');
  assert.equal(normalizeInviteCode('42'), '42');
  assert.equal(normalizeInviteCode('I-٠٠٠٠٠٠٠٠٤٢'), 'I-0000000042');
  assert.equal(normalizeInviteCode('membership'), null);
  assert.equal(normalizeInviteCode('I-'), null);
  assert.equal(normalizeInviteCode('AB-12'), null);
});

test('a wrong code stops the registration with a clear word', async () => {
  const garbage = await register('m32.bad1@gmail.com', { inviteCode: 'كود مش صح' });
  assert.equal(garbage.statusCode, 400, garbage.body);
  assert.equal(garbage.json().error.code, 'invite_code');

  const unknown = await register('m32.bad2@gmail.com', { inviteCode: 'I-0009999999' });
  assert.equal(unknown.statusCode, 400, unknown.body);
  assert.equal(unknown.json().error.code, 'referral');

  // A verified account whose membership is not active cannot be the inviter.
  const adminMe = (await get('/api/me', adminToken)).json().me;
  const inactive = await register('m32.bad3@gmail.com', { inviteCode: adminMe.cardNumber });
  assert.equal(inactive.statusCode, 400, inactive.body);
  assert.equal(inactive.json().error.code, 'referral');
});

test('a registration through the code is attributed by the hub, and the mail goes out on verification', async () => {
  const before = mailer.sent.length;
  const registered = await register('m32.invitee@gmail.com', { inviteCode: ` i-${String(inviterId).padStart(10, '0')} ` });
  assert.equal(registered.statusCode, 200, registered.body);

  // Recorded at registration, waiting for the e-mail code; no mail yet.
  const pendingList = await get('/api/admin/invites', adminToken);
  assert.equal(pendingList.statusCode, 200, pendingList.body);
  const pendingRow = (pendingList.json().invites as { id: string; inviterId: number; verifiedAt: string | null }[])[0];
  assert.ok(pendingRow);
  assert.equal(pendingRow.inviterId, inviterId);
  assert.equal(pendingRow.verifiedAt, null);
  assert.equal(mailer.sent.length, before);

  const verified = await send('POST', '/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);

  const list = await get('/api/admin/invites', adminToken);
  const row = (list.json().invites as { id: string; inviteeName: string; inviterId: number; inviterNumber: string; verifiedAt: string | null; gift: null }[])[0];
  assert.ok(row);
  inviteId = row.id;
  assert.equal(row.inviterId, inviterId);
  assert.equal(row.inviterNumber, inviterCode);
  assert.ok(row.verifiedAt);
  assert.equal(row.gift, null);

  assert.equal(mailer.sent.length, before + 1);
  const mail = mailer.sent.at(-1);
  assert.match(mail?.subject ?? '', /تسجيل جديد بدعوة عضو/);
  assert.match(mail?.text ?? '', new RegExp(inviterCode));
  assert.match(mail?.text ?? '', /الدعوات/);
});

test('the inviter sees his code, the share text and how far each nominee got', async () => {
  const mine = await get('/api/invites', inviterToken);
  assert.equal(mine.statusCode, 200, mine.body);
  assert.equal(mine.json().code, inviterCode);
  assert.equal(mine.json().eligible, true);
  assert.ok((mine.json().shareText as string).includes(inviterCode));
  const invited = mine.json().invited as { name: string; state: string }[];
  assert.equal(invited.length, 1);
  assert.equal(invited[0]?.state, 'verified');

  // An account without an active membership sees the screen locked (the app side).
  const locked = await get('/api/invites', adminToken);
  assert.equal(locked.json().eligible, false);

  assert.equal((await get('/api/invites')).statusCode, 401);
});

test('the administration records the delivered gift by hand', async () => {
  // The invitations list is the admins' alone.
  assert.equal((await get('/api/admin/invites', inviterToken)).statusCode, 403);

  const missingNote = await send('POST', `/api/admin/invites/${inviteId}/gift`, { note: '' }, adminToken);
  assert.equal(missingNote.statusCode, 400);

  const done = await send('POST', `/api/admin/invites/${inviteId}/gift`, { note: 'كود خصم 20% على خدمات النادي' }, adminToken);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().invite.gift.note, 'كود خصم 20% على خدمات النادي');
  assert.ok(done.json().invite.gift.doneAt);

  // The first delivery stays as written.
  const again = await send('POST', `/api/admin/invites/${inviteId}/gift`, { note: 'هدية أخرى' }, adminToken);
  assert.equal(again.json().invite.gift.note, 'كود خصم 20% على خدمات النادي');

  assert.equal((await send('POST', `/api/admin/invites/${crypto.randomUUID()}/gift`, { note: 'كتاب المؤسس' }, adminToken)).statusCode, 404);
});

test('the owner edits the gift and share wording from the dashboard', async () => {
  const saved = await send('POST', '/api/admin/invites/config', { shareText: 'انضم إلينا — كودك هو {code} يا صديقي.' }, adminToken);
  assert.equal(saved.statusCode, 200, saved.body);
  const mine = await get('/api/invites', inviterToken);
  assert.equal(mine.json().shareText, `انضم إلينا — كودك هو ${inviterCode} يا صديقي.`);
});

test('membership activation reaches the invitations list', async () => {
  const kv = new MemoryKV();
  const notifier = new Notifier({ mailer: new LogMailer(), recipients: [], log: built.app.log, appEnv: 'test' });
  const service = new InvitesService({ kv, hub, notifier, log: built.app.log });
  const contact = { id: 900, name: 'مدعو', phone: '0551112233', email: 'x@gmail.com' } as unknown as HubContact;
  await service.recordFromRegister(contact, inviterId, 'الداعي', 'I-42');
  await service.onActivated(900);
  const [row] = await service.list();
  assert.ok(row?.activatedAt);
  // Without a matching invitee both hooks stay silent.
  await service.onVerified({ id: 901, name: '', phone: '', email: '' } as unknown as HubContact);
  await service.onActivated(901);
  assert.equal((await service.list()).length, 1);
});
