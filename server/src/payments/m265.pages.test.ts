import assert from 'node:assert/strict';
import { test } from 'node:test';

import { returnPage } from './pages.js';
import type { PublicPayment } from './service.js';

// M265 (language review 2026-11-22): the page a customer lands on after the gateway was Arabic only, and it named
// the service in Arabic even when his app was in English.
const payment = {
  id: 'pay_m265',
  serviceKey: 'pitch-deck',
  serviceTitle: 'ملخص الجدوى',
  serviceTitleEn: 'Pitch Deck',
  lang: 'en',
  answers: [],
  amount: 1500,
  currency: 'SAR',
  memberPrice: false,
  status: 'paid',
  failureReason: null,
} as unknown as PublicPayment;

const ARABIC = /[؀-ۿ]/;

test('m265: the return page of an English payment carries no Arabic, whatever the status', () => {
  for (const status of ['paid', 'failed', 'created'] as const) {
    for (const gatewaySuccess of [true, false]) {
      const html = returnPage({ payment: { ...payment, status } as PublicPayment, verified: true, gatewaySuccess }, 'investorsclub');
      assert.doesNotMatch(html, ARABIC, `${status}/${gatewaySuccess}`);
      assert.match(html, /Pitch Deck/);
      assert.match(html, /<html lang="en" dir="ltr">/);
    }
  }
});

test('m265: an Arabic payment keeps its Arabic page; an English one without an English title falls back to the stored title', () => {
  const arabic = returnPage({ payment: { ...payment, lang: 'ar' } as PublicPayment, verified: true, gatewaySuccess: true }, 'investorsclub');
  assert.match(arabic, /ملخص الجدوى/);
  assert.match(arabic, /تم الدفع بنجاح/);
  assert.match(arabic, /<html lang="ar" dir="rtl">/);
  const untitled = returnPage({ payment: { ...payment, serviceTitleEn: null } as PublicPayment, verified: true, gatewaySuccess: true }, 'investorsclub');
  assert.match(untitled, /ملخص الجدوى/);
  assert.match(untitled, /Payment successful/);
});
