import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FastifyBaseLogger } from 'fastify';

import { MemoryKV } from '../store.js';
import { PaymentsService, type Payment } from './service.js';

// Owner (2026-11-05): «وانا فاتح انجليزي لازم يكون الفاتورة بالكامل انجليزي» — the stored Arabic stays, the document does not show it.
const ARABIC = /[؀-ۿ]/;
const words: Record<string, string> = { 'تصميم Pitch Deck': 'Pitch Deck design', 'نورة الدوسري': 'Noura Aldosari', 'اسم المشروع': 'Project name', 'منصة تعليمية': 'Learning platform' };

async function pageFor(lang: 'ar' | 'en', english = true): Promise<string | null> {
  const kv = new MemoryKV();
  const payment = {
    id: 'p1', serviceKey: 'pitch', serviceTitle: 'تصميم Pitch Deck', name: 'نورة الدوسري', phone: '0551234567', email: 'n@example.test',
    answers: [{ key: 'project', label: 'اسم المشروع', value: 'منصة تعليمية' }],
    amount: 500, currency: 'SAR', memberPrice: false, status: 'paid', provider: 'moyasar', invoiceNo: 10001, lang,
    paidAt: '2026-11-05T10:00:00.000Z', createdAt: '2026-11-05T10:00:00.000Z',
  } as unknown as Payment;
  await kv.set('payments:orders', { payments: [payment] });
  const service = new PaymentsService({
    kv, log: {} as FastifyBaseLogger, gateway: {} as never, notifier: {} as never, push: {} as never, hmacSecret: 'test-hmac-value', publicUrl: 'https://example.test',
    ...(english ? { english: { texts: async (list: string[]) => list.map((text) => words[text] ?? text) } } : {}),
  });
  return service.invoicePage('p1');
}

test('an English invoice page carries no Arabic from the stored payment', async () => {
  const html = (await pageFor('en')) ?? '';
  assert.ok(html.includes('Pitch Deck design') && html.includes('Noura Aldosari') && html.includes('Project name: Learning platform'));
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  assert.equal(ARABIC.test(body), false, body.match(/.{0,40}[؀-ۿ]+.{0,40}/)?.[0]);
});

test('an Arabic invoice keeps the stored Arabic', async () => {
  const html = (await pageFor('ar')) ?? '';
  assert.ok(html.includes('تصميم Pitch Deck') && html.includes('نورة الدوسري'));
});

test('no translator: the invoice still renders', async () => {
  assert.ok(((await pageFor('en', false)) ?? '').includes('تصميم Pitch Deck'));
});
