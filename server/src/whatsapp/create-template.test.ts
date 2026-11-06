import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryKV } from '../store.js';
import { WhatsappClient, type WaTemplate } from './client.js';
import { templateSchema } from './routes.js';
import { WhatsappService } from './service.js';

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

type Call = { url: string; method: string; body: Record<string, unknown> | null };

function build(options: { existing?: WaTemplate[]; refuse?: boolean } = {}): { service: WhatsappService; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    if (method === 'GET') return new Response(JSON.stringify({ data: options.existing ?? [] }), { status: 200 });
    if (options.refuse) return new Response(JSON.stringify({ error: { message: 'Invalid parameter', code: 100, error_data: { details: 'body text is not allowed' } } }), { status: 400 });
    return new Response(JSON.stringify({ id: '9001', status: 'PENDING', category: 'UTILITY' }), { status: 200 });
  }) as typeof fetch;
  const client = new WhatsappClient({ token: 'EAAB-test-token-not-real-0000', phoneId: '111', wabaId: '222', fetchImpl });
  return { service: new WhatsappService({ kv: new MemoryKV(), log: silentLog, client, enabled: true }), calls };
}

const invoice = {
  name: 'club_invoice',
  language: 'ar',
  category: 'UTILITY' as const,
  body: 'فاتورتك رقم {{1}} بمبلغ {{2}} ريال عن {{3}} جاهزة.',
  bodyExamples: ['10001', '500', 'حجز قاعة الاجتماعات'],
  urlButton: { text: 'عرض الفاتورة', url: 'https://api.vibesholdingsa.com/pay/invoice/{{1}}', example: 'https://api.vibesholdingsa.com/pay/invoice/abc123' },
};

test('M204: a new template is filed on the WABA with a sample for every variable and the button address', async () => {
  const { service, calls } = build();
  const result = await service.createTemplate(invoice);
  assert.deepEqual(result, { name: 'club_invoice', language: 'ar', created: true, status: 'PENDING', category: 'UTILITY' });
  const post = calls.find((call) => call.method === 'POST');
  assert.ok(post?.url.endsWith('/v24.0/222/message_templates'));
  assert.equal(post?.body?.name, 'club_invoice');
  assert.equal(post?.body?.category, 'UTILITY');
  assert.deepEqual(post?.body?.components, [
    { type: 'BODY', text: invoice.body, example: { body_text: [invoice.bodyExamples] } },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'عرض الفاتورة', url: invoice.urlButton.url, example: [invoice.urlButton.example] }] },
  ]);
});

test('M204: a name and language Meta already holds is not filed twice; a refusal is reported, never thrown', async () => {
  const held = build({ existing: [{ name: 'club_invoice', language: 'ar', status: 'APPROVED', category: 'UTILITY', components: [] }] });
  const again = await held.service.createTemplate(invoice);
  assert.equal(again.created, false);
  assert.equal(again.error, 'already_exists');
  assert.equal(held.calls.some((call) => call.method === 'POST'), false);

  const refused = await build({ refuse: true }).service.createTemplate(invoice);
  assert.equal(refused.created, false);
  assert.match(refused.error ?? '', /Invalid parameter \(body text is not allowed\)/);
});

test('M204: the admin body wants club_ names, one sample per variable and an explicit confirm', () => {
  assert.equal(templateSchema.safeParse({ ...invoice, confirm: true }).success, true);
  assert.equal(templateSchema.safeParse(invoice).success, false);
  assert.equal(templateSchema.safeParse({ ...invoice, name: 'other_invoice', confirm: true }).success, false);
  assert.equal(templateSchema.safeParse({ ...invoice, bodyExamples: ['10001'], confirm: true }).success, false);
  assert.equal(templateSchema.safeParse({ ...invoice, urlButton: { text: 'عرض', url: invoice.urlButton.url }, confirm: true }).success, false);
});
