import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Mail, Mailer } from '../mail/mailer.js';
import { MemoryKV } from '../store.js';
import { WhatsappClient, type WaTemplate } from './client.js';
import { maskPhone, normalizePhone } from './phone.js';
import { fallbackMail, WhatsappService } from './service.js';
import { buildBodyParams, fitParams, pickTemplate, planDelivery } from './templates.js';

// M174: member messages on WhatsApp. The pure decisions (phone, template, fallback) and the service with a fake Graph API.

const silentLog = { info() {}, warn() {}, error() {} };

const template = (patch: Partial<WaTemplate> = {}): WaTemplate => ({
  name: 'club_receipt',
  language: 'ar',
  status: 'APPROVED',
  components: [{ type: 'BODY', text: 'تم استلام {{1}} ريال لخدمة {{2}}، فاتورة {{3}}' }],
  ...patch,
});

test('normalizePhone gives E.164 digits without plus', () => {
  assert.equal(normalizePhone('0503844438'), '966503844438');
  assert.equal(normalizePhone('503844438'), '966503844438');
  assert.equal(normalizePhone('+966 50 384 4438'), '966503844438');
  assert.equal(normalizePhone('00966503844438'), '966503844438');
  assert.equal(normalizePhone('+966 0503844438'), '966503844438');
  assert.equal(normalizePhone('٠٥٠٣٨٤٤٤٣٨'), '966503844438');
  assert.equal(normalizePhone('+971 50 123 4567'), '971501234567');
  assert.equal(normalizePhone('201001234567'), '201001234567');
});

test('normalizePhone refuses what cannot be dialed', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('0100123456'), null);
  assert.equal(normalizePhone('12345'), null);
  assert.equal(maskPhone('966503844438'), '***4438');
});

test('body parameters follow the template order and are sanitized', () => {
  assert.deepEqual(buildBodyParams('receipt', { amount: 250, service: 'استشارة\n  أعمال', invoiceNo: 10001 }, 'ar'), ['250', 'استشارة أعمال', '10001']);
  assert.deepEqual(buildBodyParams('receipt', { amount: 99.5, service: '', invoiceNo: null }, 'en'), ['99.50', 'Service', '-']);
  assert.deepEqual(buildBodyParams('welcome', {}, 'en'), ['Member']);
});

test('fitParams drops extra variables but refuses a template that needs more or unsupported parts', () => {
  assert.deepEqual(fitParams(template({ components: [{ type: 'BODY', text: 'أهلاً {{1}}' }] }), ['a', 'b', 'c']), ['a']);
  assert.deepEqual(fitParams(template({ components: [{ type: 'BODY', text: 'أهلاً بك' }] }), ['a']), []);
  assert.equal(fitParams(template({ components: [{ type: 'BODY', text: '{{1}} {{2}} {{3}} {{4}}' }] }), ['a', 'b', 'c']), null);
  assert.equal(fitParams(template({ parameter_format: 'NAMED' }), ['a', 'b', 'c']), null);
  assert.equal(fitParams(template({ components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: '{{1}}' }] }), ['a']), null);
  const withButton = template({ components: [{ type: 'BODY', text: '{{1}}' }, { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://x.sa/{{1}}' }] }] });
  assert.equal(fitParams(withButton, ['a']), null);
});

test('pickTemplate matches the language and prefers an approved one', () => {
  const list = [template({ language: 'en', status: 'PENDING' }), template({ language: 'en_US', status: 'APPROVED' }), template({ language: 'ar' })];
  assert.equal(pickTemplate(list, 'en')?.language, 'en_US');
  assert.equal(pickTemplate(list, 'ar')?.language, 'ar');
  assert.equal(pickTemplate([], 'ar'), null);
});

test('M202: the affiliate link template takes the name, the code and the link', () => {
  assert.deepEqual(buildBodyParams('affiliate_link', { name: 'فارس العتيبي', code: 'FAR2', link: 'https://api.vibesholdingsa.com/r/far2' }, 'ar'), ['فارس العتيبي', 'FAR2', 'https://api.vibesholdingsa.com/r/far2']);
  assert.match(fallbackMail('affiliate_link', 'ar', { code: 'FAR2', link: 'https://api.vibesholdingsa.com/r/far2' })?.text ?? "", /FAR2/);
});

test('planDelivery: WhatsApp only when enabled, phone present and the template approved and fitting', () => {
  const base = { enabled: true, phone: '966503844438', kind: 'receipt' as const, lang: 'ar' as const, vars: { amount: 10, service: 's', invoiceNo: 1 }, template: template() };
  assert.deepEqual(planDelivery(base), { use: 'whatsapp', template: 'club_receipt', language: 'ar', params: ['10', 's', '1'] });
  assert.deepEqual(planDelivery({ ...base, enabled: false }), { use: 'fallback', reason: 'whatsapp_disabled' });
  assert.deepEqual(planDelivery({ ...base, phone: null }), { use: 'fallback', reason: 'no_phone' });
  assert.deepEqual(planDelivery({ ...base, template: null }), { use: 'fallback', reason: 'template_not_found' });
  assert.deepEqual(planDelivery({ ...base, template: undefined }), { use: 'fallback', reason: 'template_lookup_failed' });
  assert.deepEqual(planDelivery({ ...base, template: template({ status: 'PENDING' }) }), { use: 'fallback', reason: 'template_not_approved' });
  assert.deepEqual(planDelivery({ ...base, template: template({ components: [{ type: 'BODY', text: '{{1}}{{2}}{{3}}{{4}}' }] }) }), { use: 'fallback', reason: 'template_mismatch' });
});

type Call = { url: string; method: string; body: unknown; auth: string | null };

function fakeGraph(options: { templates?: WaTemplate[]; sendStatus?: number } = {}): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('authorization') });
    if (String(url).includes('/message_templates')) return new Response(JSON.stringify({ data: options.templates ?? [] }), { status: 200 });
    if ((options.sendStatus ?? 200) !== 200) return new Response(JSON.stringify({ error: { message: 'Recipient not allowed', code: 131030 } }), { status: options.sendStatus });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.ABC' }] }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

class RecordingMailer implements Mailer {
  readonly configured = true;
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<boolean> {
    this.sent.push(mail);
    return true;
  }
}

function build(graph: ReturnType<typeof fakeGraph> | null, mailer = new RecordingMailer()): { service: WhatsappService; kv: MemoryKV; mailer: RecordingMailer } {
  const kv = new MemoryKV();
  const client = graph ? new WhatsappClient({ token: 'EAAB-test-token-not-real-0000', phoneId: '111', wabaId: '222', fetchImpl: graph.fetchImpl }) : null;
  return { service: new WhatsappService({ kv, log: silentLog, client, enabled: true, mailer }), kv, mailer };
}

test('sendReceipt posts the approved template to Graph v24 and logs it', async () => {
  const graph = fakeGraph({ templates: [template()] });
  const { service } = build(graph);
  const result = await service.sendReceipt({ phone: '0503844438', lang: 'ar', amount: 250, service: 'استشارة', invoiceNo: 10001, ref: 'payment:p1' });
  assert.deepEqual(result, { channel: 'whatsapp', messageId: 'wamid.ABC' });
  const send = graph.calls.find((call) => call.method === 'POST');
  assert.ok(send);
  assert.equal(send.url, 'https://graph.facebook.com/v24.0/111/messages');
  assert.equal(send.auth, 'Bearer EAAB-test-token-not-real-0000');
  assert.deepEqual(send.body, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '966503844438',
    type: 'template',
    template: { name: 'club_receipt', language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '250' }, { type: 'text', text: 'استشارة' }, { type: 'text', text: '10001' }] }] },
  });
  // The same ref again sends nothing new.
  const again = await service.sendReceipt({ phone: '0503844438', lang: 'ar', amount: 250, service: 'استشارة', invoiceNo: 10001, ref: 'payment:p1' });
  assert.equal(again.error, 'already_sent');
  assert.equal(graph.calls.filter((call) => call.method === 'POST').length, 1);
});

test('templates are cached between sends', async () => {
  const graph = fakeGraph({ templates: [template()] });
  const { service } = build(graph);
  await service.sendReceipt({ phone: '0503844438', lang: 'ar', amount: 1, service: 's', invoiceNo: 1 });
  await service.sendReceipt({ phone: '0503844438', lang: 'ar', amount: 2, service: 's', invoiceNo: 2 });
  assert.equal(graph.calls.filter((call) => call.url.includes('/message_templates')).length, 1);
});

test('fallback: pending template, missing phone, disabled or Meta error all go to e-mail and never throw', async () => {
  const pending = build(fakeGraph({ templates: [template({ status: 'PENDING' })] }));
  assert.deepEqual(await pending.service.sendReceipt({ phone: '0503844438', lang: 'ar', amount: 5, service: 's', invoiceNo: 7, email: 'a@b.sa' }), { channel: 'email', error: 'template_not_approved' });
  assert.match(pending.mailer.sent[0]?.subject ?? '', /7/);

  const noPhone = build(fakeGraph({ templates: [template()] }));
  assert.deepEqual(await noPhone.service.sendWelcome({ phone: '', lang: 'en', email: 'a@b.sa' }), { channel: 'email', error: 'no_phone' });
  assert.equal(noPhone.mailer.sent[0]?.subject, 'Welcome to Investors Club');

  const off = build(null);
  assert.deepEqual(await off.service.sendWelcome({ phone: '0503844438' }), { channel: 'none', error: 'whatsapp_disabled' });

  const refused = build(fakeGraph({ templates: [template()], sendStatus: 400 }));
  const failed = await refused.service.sendReceipt({ phone: '0503844438', lang: 'ar', amount: 5, service: 's', invoiceNo: 7, email: 'a@b.sa' });
  assert.equal(failed.channel, 'email');
  assert.match(failed.error ?? '', /^meta_error: Recipient not allowed/);
  assert.equal((await refused.service.recent())[0]?.status, 'failed');
});

test('a Graph outage on the template lookup falls back instead of throwing', async () => {
  const kv = new MemoryKV();
  const client = new WhatsappClient({ token: 'EAAB-test-token-not-real-0000', phoneId: '1', wabaId: '2', fetchImpl: (async () => { throw new Error('down'); }) as typeof fetch });
  const service = new WhatsappService({ kv, log: silentLog, client, enabled: true });
  assert.deepEqual(await service.sendWelcome({ phone: '0503844438' }), { channel: 'none', error: 'template_lookup_failed' });
});

test('webhook statuses only move forward and failures keep Meta\'s reason; inbound text is kept short', async () => {
  const graph = fakeGraph({ templates: [template({ name: 'club_welcome', components: [{ type: 'BODY', text: 'أهلاً {{1}}' }] })] });
  const { service } = build(graph);
  await service.sendWelcome({ phone: '0503844438', name: 'سالم' });
  const status = (value: string, errors?: unknown) => ({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.ABC', status: value, recipient_id: '966503844438', ...(errors ? { errors } : {}) }] } }] }] });
  await service.ingestWebhook(status('delivered'));
  await service.ingestWebhook(status('sent'));
  assert.equal((await service.recent())[0]?.status, 'delivered');
  await service.ingestWebhook(status('failed', [{ code: 131026, title: 'Message undeliverable' }]));
  const record = (await service.recent())[0];
  assert.equal(record?.status, 'failed');
  assert.equal(record?.error, '131026 Message undeliverable');
  const counts = await service.ingestWebhook({ entry: [{ changes: [{ value: { messages: [{ from: '966503844438', type: 'text', text: { body: 'شكراً' } }] } }] }] });
  assert.deepEqual(counts, { statuses: 0, inbound: 1 });
  assert.equal((await service.recent())[0]?.kind, 'inbound');
  assert.deepEqual(await service.ingestWebhook('garbage'), { statuses: 0, inbound: 0 });
});
