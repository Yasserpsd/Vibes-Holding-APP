import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { AUDIT_KEY, type AuditEntry } from './dashboard/service.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubBody, HubClient, HubOp, HubResponse } from './hub/types.js';
import { LogMailer } from './mail/mailer.js';
import { PARTNER_PROJECTS_KEY, type PartnerLink } from './membership/partnerProjects.js';
import { SNAPSHOT_KEY } from './projectsBank/service.js';
import type { PublicProject } from './projectsBank/types.js';
import { DAY_MS } from './riyadh.js';
import { MemoryKV } from './store.js';

/** The mock hub, remembering what it was asked. */
class CountingHub implements HubClient {
  readonly mode = 'mock' as const;
  readonly calls: { op: HubOp; body: HubBody }[] = [];
  readonly inner = new MockHubClient({ seed: true });

  call(op: HubOp, body: HubBody): Promise<HubResponse> {
    this.calls.push({ op, body });
    return this.inner.call(op, body);
  }

  contact(id: number): { partnerAt?: number | null; role?: string } {
    const found = (this.inner as unknown as { contacts: Map<number, { partnerAt?: number | null; role?: string }> }).contacts.get(id);
    assert.ok(found);
    return found;
  }

  grants(): number {
    return this.calls.filter((entry) => entry.op === 'admin_grant' && entry.body.action === 'partner').length;
  }
}

function project(id: number): PublicProject {
  return {
    id, number: `P-${id}`, slug: `p-${id}`, title: `مشروع رقم ${id}`, titleEn: null, companyName: 'شركة الاختبار', companyNameEn: null,
    founderName: 'مؤسس المشروع', founderNameEn: null, excerpt: null, excerptEn: null, details: null, detailsEn: null, image: null, gallery: [],
    sector: null, stage: null, isGolden: false, featuredOrder: null, goldenPartnerUrl: null, hasPitchDeck: false, contactRule: null,
    viewsCount: 0, modifiedAt: '2026-01-01T00:00:00.000Z',
  };
}

const kv = new MemoryKV();
const hub = new CountingHub();
const mailer = new LogMailer();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let adminToken = '';
let caller = 0;

const call = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, token?: string) => {
  caller += 1;
  return app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: `10.75.0.${(caller % 250) + 1}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
const post = (url: string, payload: Record<string, unknown>, token?: string) => call('POST', url, payload, token);
const partner = (id: number, projectId: number | null | undefined, extra: Record<string, unknown> = {}) =>
  post(`/api/admin/accounts/${id}/partner`, { on: true, ...(projectId === undefined ? {} : { projectId }), note: '', confirm: true, ...extra }, adminToken);
const revoke = (id: number) => post(`/api/admin/accounts/${id}/partner`, { on: false, note: '', confirm: true }, adminToken);
const link = (id: number, projectId: number, token = adminToken) => post(`/api/admin/accounts/${id}/partner-project`, { projectId, confirm: true }, token);
const sheet = async (id: number) => (await call('GET', `/api/admin/accounts/${id}`, undefined, adminToken)).json() as { account: { partner?: number }; partnerProject: Record<string, unknown> | null };
type Listing = { partners: { contactId: number; name: string; project: { id: number } | null }[]; projects: ({ id: number; holder: { contactId: number; name: string } | null } & Record<string, unknown>)[] };
const listing = async () => (await call('GET', '/api/admin/success-partners', undefined, adminToken)).json() as Listing;
const stored = async (): Promise<PartnerLink[]> => (await kv.get<{ links: PartnerLink[] }>(PARTNER_PROJECTS_KEY))?.links ?? [];
const holderOf = async (projectId: number) => (await stored()).filter((entry) => entry.project.id === projectId).map((entry) => entry.contactId);

let phone = 8327500;
async function signUp(email: string, name = 'سلطان العتيبي'): Promise<{ token: string; id: number }> {
  phone += 1;
  const registered = await post('/api/auth/register', { name, country: 'sa', phone: `055${phone}`, email, password: 'secret123', persona: 'entrepreneur', bio: 'حساب لاختبار ربط شريك النجاح بمشروع.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  const token = verified.json().token as string;
  const id = verified.json().me.id as number;
  // The mock makes every verified account an admin: a plain member is set back by hand.
  if (!email.includes('admin')) {
    hub.contact(id).role = 'member';
    await call('GET', '/api/me?fresh=1', undefined, token);
  }
  return { token, id };
}

before(async () => {
  await kv.set(SNAPSHOT_KEY, { projects: Array.from({ length: 12 }, (_, index) => project(index + 1)), fetchedAt: new Date().toISOString() });
  const built = await buildApp({ config, kv, hub, mailer });
  app = built.app;
  await built.projects.start();
  adminToken = (await signUp('m275.admin@gmail.com')).token;
});

after(async () => {
  await app.close();
});

test('no project, no Success Partners membership: refused before the hub hears of it', async () => {
  const member = await signUp('m275.none@gmail.com');
  const before = hub.grants();
  for (const projectId of [undefined, null]) {
    const refused = await partner(member.id, projectId);
    assert.equal(refused.statusCode, 400, refused.body);
    assert.match(refused.json().error.message, /بدون مشروع/);
  }
  assert.equal((await partner(member.id, 0)).statusCode, 400);
  const unknown = await partner(member.id, 999);
  assert.equal(unknown.statusCode, 400, unknown.body);
  assert.equal(unknown.json().error.code, 'project_unknown');
  assert.equal(hub.grants(), before, 'nothing reached the hub');
  assert.notEqual((await sheet(member.id)).account.partner, 1);
  assert.equal((await stored()).filter((entry) => entry.contactId === member.id).length, 0);
});

test('a grant links the project: the sheet, the audit log and the management mail name it', async () => {
  const member = await signUp('m275.grant@gmail.com', 'فهد الدوسري');
  const given = await partner(member.id, 1);
  assert.equal(given.statusCode, 200, given.body);
  // Name, number and public page only: nothing else of the project goes anywhere (rule 4).
  assert.deepEqual((await sheet(member.id)).partnerProject, { id: 1, number: 'P-1', title: 'مشروع رقم 1', url: null });
  const audit = ((await kv.get<{ entries: AuditEntry[] }>(AUDIT_KEY))?.entries ?? []).find((entry) => entry.contactId === member.id && entry.result === 'ok');
  assert.equal(audit?.params.project, 'مشروع رقم 1 (رقم المشروع: P-1)');
  await new Promise((resolve) => setImmediate(resolve));
  const mail = mailer.sent.find((entry) => entry.to.includes('admin@vcmem.com') && JSON.stringify(entry).includes('منح عضوية شركاء النجاح: فهد الدوسري'));
  assert.ok(mail, 'the management is mailed');
  assert.ok(JSON.stringify(mail).includes('المشروع المرتبط: مشروع رقم 1 (رقم المشروع: P-1)'));
  // The member's own app hears nothing of it.
  assert.ok(!(await call('GET', '/api/me?fresh=1', undefined, member.token)).body.includes('مشروع رقم 1'));
});

test('a project holds one partner only, and the refusal names who holds it', async () => {
  const first = await signUp('m275.first@gmail.com', 'ماجد القحطاني');
  const second = await signUp('m275.second@gmail.com');
  assert.equal((await partner(first.id, 2)).statusCode, 200);
  const before = hub.grants();
  const refused = await partner(second.id, 2);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, 'project_taken');
  assert.match(refused.json().error.message, /ماجد القحطاني/);
  assert.match(refused.json().error.message, new RegExp(`حساب رقم ${first.id}`));
  assert.equal(hub.grants(), before);
  assert.notEqual((await sheet(second.id)).account.partner, 1);
  assert.deepEqual(await holderOf(2), [first.id]);
});

test('two grants of the same project at the same moment: one gets it', async () => {
  const one = await signUp('m275.race1@gmail.com');
  const two = await signUp('m275.race2@gmail.com');
  const answers = await Promise.all([partner(one.id, 3), partner(two.id, 3)]);
  assert.deepEqual(answers.map((answer) => answer.statusCode).sort(), [200, 409]);
  assert.equal((await holderOf(3)).length, 1);
});

test('a grant the hub refuses takes no project', async () => {
  const member = await signUp('m275.hon@gmail.com');
  assert.equal((await post(`/api/admin/accounts/${member.id}/honorary`, { on: true, note: '', confirm: true }, adminToken)).statusCode, 200);
  const refused = await partner(member.id, 4);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, 'honorary');
  assert.deepEqual(await holderOf(4), []);
  // Nor does granting again move a running partner to another project.
  const running = await signUp('m275.again@gmail.com');
  assert.equal((await partner(running.id, 4)).statusCode, 200);
  const again = await partner(running.id, 5);
  assert.equal(again.statusCode, 409, again.body);
  assert.equal(again.json().error.code, 'partner');
  assert.deepEqual(await holderOf(4), [running.id]);
  assert.deepEqual(await holderOf(5), []);
});

test('a revoke, the end of the year and a deletion each free the project', async () => {
  const taken = await signUp('m275.revoked@gmail.com');
  const next = await signUp('m275.next@gmail.com');
  assert.equal((await partner(taken.id, 6)).statusCode, 200);
  assert.equal((await revoke(taken.id)).statusCode, 200);
  assert.deepEqual(await holderOf(6), []);
  assert.equal((await partner(next.id, 6)).statusCode, 200);

  // The year runs out with no job and no call to this server.
  const after = await signUp('m275.after@gmail.com');
  hub.contact(next.id).partnerAt = Date.now() - 361 * DAY_MS;
  assert.equal((await partner(after.id, 6)).statusCode, 200);
  assert.deepEqual(await holderOf(6), [after.id]);

  assert.equal((await post(`/api/admin/accounts/${after.id}/delete`, { note: 'طلب العضو', confirm: true }, adminToken)).statusCode, 200);
  assert.deepEqual(await holderOf(6), []);
});

test('a partner from before the rule is linked, and moved, without touching the membership', async () => {
  const old = await signUp('m275.old@gmail.com', 'تركي الشهري');
  hub.contact(old.id).partnerAt = Date.now();
  const before = (await listing()).partners.find((entry) => entry.contactId === old.id);
  assert.ok(before);
  assert.equal(before.project, null);

  const grants = hub.calls.filter((entry) => entry.op === 'admin_grant').length;
  assert.equal((await link(old.id, 7)).statusCode, 200);
  assert.equal((await sheet(old.id)).partnerProject?.id, 7);
  assert.equal((await link(old.id, 8)).statusCode, 200);
  assert.deepEqual(await holderOf(7), []);
  assert.deepEqual(await holderOf(8), [old.id]);
  assert.equal(hub.calls.filter((entry) => entry.op === 'admin_grant').length, grants);

  // Taken by another partner, unknown, or an account that is not a partner.
  const other = await signUp('m275.other@gmail.com');
  assert.equal((await partner(other.id, 9)).statusCode, 200);
  assert.equal((await link(old.id, 9)).json().error.code, 'project_taken');
  assert.equal((await link(old.id, 999)).json().error.code, 'project_unknown');
  assert.deepEqual(await holderOf(8), [old.id]);
  const plain = await signUp('m275.plain@gmail.com');
  assert.equal((await link(plain.id, 10)).json().error.code, 'not_partner');
  assert.deepEqual(await holderOf(10), []);
  assert.equal((await link(old.id, 10, plain.token)).statusCode, 403);
  assert.equal((await post(`/api/admin/accounts/${old.id}/partner-project`, { projectId: 10 }, adminToken)).statusCode, 400);
});

test('the list pairs every partner with his project and marks the taken projects, for an admin only', async () => {
  const member = await signUp('m275.list@gmail.com', 'نواف السبيعي');
  assert.equal((await partner(member.id, 11)).statusCode, 200);
  const { partners, projects } = await listing();
  assert.equal(partners.find((entry) => entry.contactId === member.id)?.project?.id, 11);
  const eleven = projects.find((entry) => entry.id === 11);
  assert.deepEqual(eleven?.holder, { contactId: member.id, name: 'نواف السبيعي' });
  assert.equal(projects.find((entry) => entry.id === 12)?.holder, null);
  assert.deepEqual(Object.keys(eleven ?? {}).sort(), ['holder', 'id', 'number', 'title', 'url']);

  assert.equal((await call('GET', '/api/admin/success-partners')).statusCode, 401);
  assert.equal((await call('GET', '/api/admin/success-partners', undefined, member.token)).statusCode, 403);
});
