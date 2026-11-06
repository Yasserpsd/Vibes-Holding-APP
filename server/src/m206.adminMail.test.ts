import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adminRoyal } from './mail/adminMail.js';
import { royalHtml } from './mail/royal.js';

const STAMP = '2026-11-06 15:10 (الرياض)';

test('a payment mail reads as lead, rows and a state pill', () => {
  const mail = adminRoyal(
    'بدء دفع من التطبيق: اصنع ملتقاك — Mohamed Yasser',
    ['بدأ العضو عملية دفع لخدمة «اصنع ملتقاك». لم يكتمل الدفع بعد.', '', 'الاسم: Mohamed Yasser', 'الجوال: 0560454529', 'المبلغ: 27,000 ريال', 'رقم العملية: a6b5c6d3'],
    STAMP,
  );
  assert.equal(mail.title, 'بدء دفع من التطبيق');
  assert.equal(mail.subtitle, 'اصنع ملتقاك — Mohamed Yasser');
  assert.deepEqual(mail.status, { label: 'لم يكتمل بعد', tone: 'wait' });
  assert.equal(mail.lead?.length, 1);
  assert.deepEqual(mail.rows?.map((row) => row.label), ['الاسم', 'الجوال', 'المبلغ', 'رقم العملية', 'التاريخ']);
  assert.equal(mail.note, undefined);
});

test('the closing instruction becomes the note, even with a colon in it', () => {
  const mail = adminRoyal(
    'طلب طباعة كارت العضوية: أحمد',
    ['طلب العضو نسخة مطبوعة.', '', 'الاسم: أحمد', '', 'القائمة الكاملة في لوحة الإدارة: قسم «طلبات الكروت».'],
    STAMP,
  );
  assert.equal(mail.note, 'القائمة الكاملة في لوحة الإدارة: قسم «طلبات الكروت».');
  assert.deepEqual(mail.rows?.map((row) => row.label), ['الاسم', 'التاريخ']);
});

test('a mail with no blank lines keeps its first line as the lead', () => {
  const mail = adminRoyal('❌ محاولة دفع لم تكتمل: رابط (100 ريال)', ['محاولة دفع لم تنجح.', 'سبب البوابة: رفض البنك'], STAMP);
  assert.deepEqual(mail.lead, ['محاولة دفع لم تنجح.']);
  assert.equal(mail.rows?.[0]?.value, 'رفض البنك');
  assert.equal(mail.status?.tone, 'bad');
});

test('the shell escapes member text and right-aligns a Latin value', () => {
  const html = royalHtml(adminRoyal('دفع ناجح من التطبيق: خدمة', ['اكتمل الدفع.', '', 'الاسم: <b>x</b>', 'الجوال: 0560454529'], STAMP));
  assert.ok(!html.includes('<b>x</b>'));
  assert.match(html, /dir="ltr" style="[^"]*text-align:right;/);
  assert.match(html, /مكتمل/);
});
