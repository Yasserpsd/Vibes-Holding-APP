import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Mail, Mailer } from '../mail/mailer.js';
import { MemoryKV } from '../store.js';
import { WhatsappClient, type WaTemplate } from './client.js';
import { RETRY_DELAYS_MS, WhatsappService } from './service.js';

// M251: Meta's frequency cap (131049) drops some management-message notices. They are sent again after 1 h, 6 h and
// 24 h; when the last try is refused too the account's e-mail gets the same words, and the dashboard sees every step.

const silentLog = { info() {}, warn() {}, error() {} };
const TEMPLATES: WaTemplate[] = [
  { name: 'club_admin_message', language: 'ar', status: 'APPROVED', components: [{ type: 'BODY', text: 'مرحبًا {{1}}، وصلتك رسالة جديدة من إدارة Investors Club.' }] },
  { name: 'club_admin_message', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello {{1}}, you have a new message from the Investors Club management.' }] },
];

class RecordingMailer implements Mailer {
  readonly configured = true;
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<boolean> {
    this.sent.push(mail);
    return true;
  }
}

function build() {
  const sent: { to: string; language: string; body: string[] }[] = [];
  const clock = { now: Date.parse('2026-11-18T15:37:00Z') };
  const mailer = new RecordingMailer();
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const address = new URL(String(url));
    if (address.pathname.endsWith('/message_templates')) return new Response(JSON.stringify({ data: TEMPLATES }), { status: 200 });
    const message = JSON.parse(String(init?.body)) as { to: string; template: { language: { code: string }; components?: { type: string; parameters: { text: string }[] }[] } };
    sent.push({ to: message.to, language: message.template.language.code, body: (message.template.components ?? []).find((part) => part.type === 'body')?.parameters.map((parameter) => parameter.text) ?? [] });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 });
  }) as typeof fetch;
  const service = new WhatsappService({
    kv: new MemoryKV(),
    log: silentLog,
    enabled: true,
    mailer,
    now: () => clock.now,
    client: new WhatsappClient({ token: 'x'.repeat(30), phoneId: '1260740487121111', wabaId: '1371070605091256', log: silentLog, fetchImpl }),
    emailOf: async (contactId) => (contactId === 7 ? 'majed@example.sa' : null),
  });
  return { service, sent, clock, mailer };
}

const status = (id: string, state: string, code?: number) => ({
  entry: [{ changes: [{ value: { statuses: [{ id, status: state, recipient_id: '966503844438', ...(code ? { errors: [{ code, title: 'This message was not delivered to maintain healthy ecosystem engagement.' }] } : {}) }] } }] }],
});
const HOUR = 3_600_000;

test('m251: a notice Meta held back (131049) is sent again after 1 h, 6 h and 24 h, then mailed', async () => {
  const { service, sent, clock, mailer } = build();
  const first = await service.sendNotice('admin_message', { phone: '0503844438', lang: 'ar', name: 'ماجد العمري', ref: 'post:p1:7' });
  assert.equal(first.channel, 'whatsapp');
  await service.ingestWebhook(status('wamid.1', 'failed', 131049));
  assert.deepEqual({ ...(await service.deliveryOf('admin_message', 'post:p1')), rows: undefined }, { delivered: 0, sent: 0, retrying: 1, failed: 0, rows: undefined });

  // Too early: nothing leaves before the first wait is over.
  clock.now += HOUR - 60_000;
  assert.deepEqual(await service.retryRefused(), { retried: 0, mailed: 0 });
  assert.equal(sent.length, 1);

  let expected = 1;
  for (const wait of RETRY_DELAYS_MS) {
    clock.now += wait + 60_000;
    assert.deepEqual(await service.retryRefused(), { retried: 1, mailed: 0 });
    expected += 1;
    assert.equal(sent.length, expected);
    // The same number, language and name as the first send.
    assert.deepEqual(sent[expected - 1], sent[0]);
    // A second pass before Meta answers never doubles the message.
    assert.deepEqual(await service.retryRefused(), { retried: 0, mailed: 0 });
    await service.ingestWebhook(status(`wamid.${expected}`, 'failed', 131049));
  }

  // Every try was refused: the e-mail carries the same words, once.
  assert.deepEqual(await service.retryRefused(), { retried: 0, mailed: 1 });
  assert.deepEqual(mailer.sent[0]?.to, ['majed@example.sa']);
  assert.match(mailer.sent[0]?.text ?? '', /وصلتك رسالة جديدة من إدارة Investors Club/);
  assert.deepEqual(await service.retryRefused(), { retried: 0, mailed: 0 });
  assert.equal(sent.length, 4);
  const end = await service.deliveryOf('admin_message', 'post:p1');
  assert.equal(end.failed, 1);
  assert.equal(end.rows[0]?.mailed, true);
  assert.equal(end.rows[0]?.contactId, 7);
});

test('m251: a retry that arrives ends the chain; other failures and delivered notices are left alone', async () => {
  const { service, sent, clock, mailer } = build();
  await service.sendNotice('admin_message', { phone: '0503844438', lang: 'en', name: 'Majed', ref: 'post:p2:7' });
  await service.sendNotice('admin_message', { phone: '0503844439', lang: 'ar', name: 'سالم الحربي', ref: 'post:p2:8' });
  await service.sendNotice('admin_message', { phone: '0503844440', lang: 'ar', name: 'فهد القحطاني', ref: 'post:p2:9' });
  await service.ingestWebhook(status('wamid.1', 'failed', 131049));
  await service.ingestWebhook(status('wamid.2', 'delivered'));
  await service.ingestWebhook(status('wamid.3', 'failed', 131026)); // not on WhatsApp: trying again cannot help

  clock.now += 2 * HOUR;
  assert.deepEqual(await service.retryRefused(), { retried: 1, mailed: 0 });
  assert.deepEqual(sent[3], { to: '966503844438', language: 'en', body: ['Majed'] });
  await service.ingestWebhook(status('wamid.4', 'delivered'));

  clock.now += 48 * HOUR;
  assert.deepEqual(await service.retryRefused(), { retried: 0, mailed: 0 });
  assert.equal(sent.length, 4);
  assert.equal(mailer.sent.length, 0);
  const view = await service.deliveryOf('admin_message', 'post:p2');
  assert.deepEqual([view.delivered, view.sent, view.retrying, view.failed], [2, 0, 0, 1]);
  assert.equal(view.rows[0]?.contactId, 9);
});

test('m251: every member of a chosen list has his own ref, so none is answered «already sent»', async () => {
  const { service, sent } = build();
  for (const [phone, id] of [['0503844438', 7], ['0503844439', 8], ['0503844440', 9]] as const) {
    const result = await service.sendNotice('admin_message', { phone, lang: 'ar', name: 'ماجد العمري', ref: `post:p3:${id}` });
    assert.equal(result.error, undefined);
  }
  assert.equal(sent.length, 3);
});
