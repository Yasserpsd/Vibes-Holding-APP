import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryKV } from '../store.js';
import { WhatsappClient, type WaTemplate } from './client.js';
import { WhatsappService } from './service.js';
import { firstName, TEMPLATE_NAMES, urlButtonValue } from './templates.js';

// M204: the five member messages that moved to WhatsApp, each in Arabic AND English, as they were filed at Meta.

const silentLog = { info() {}, warn() {}, error() {} };

const BODIES: Record<string, { ar: string; en: string }> = {
  club_membership_active: { ar: 'مرحبًا {{1}}، تم تفعيل عضويتك وهي سارية حتى {{2}}.', en: 'Hello {{1}}, your membership is now active and valid until {{2}}.' },
  club_event_ticket: { ar: 'تم تأكيد حجزك في {{1}} بتاريخ {{2}}. رقم التذكرة: {{3}}.', en: 'Your booking for {{1}} on {{2}} is confirmed. Ticket number: {{3}}.' },
  club_visit_update: { ar: 'تم تحديث طلب زيارتك. الحالة الآن: {{1}}.', en: 'Your request to visit was updated. Current status: {{1}}.' },
  club_request_update: { ar: 'تحديث على طلب خدمتك ({{1}}): الحالة الآن {{2}}.', en: 'Update on your service request ({{1}}): the status is now {{2}}.' },
  club_invoice: { ar: 'صدرت فاتورتك رقم {{1}} بمبلغ {{2}} عن {{3}}.', en: 'Your invoice {{1}} for {{2}} ({{3}}) is ready.' },
  club_receipt: { ar: 'تم استلام {{1}} ريال لخدمة {{2}}، فاتورة {{3}}', en: 'We received {{1}} SAR for {{2}}, invoice {{3}}' },
};

function templatesOf(name: string): WaTemplate[] {
  const body = BODIES[name];
  if (!body) return [];
  return (['ar', 'en'] as const).map((language) => ({
    name,
    language,
    status: 'APPROVED',
    components: [
      { type: 'BODY', text: body[language] },
      ...(name === 'club_invoice' ? [{ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'عرض الفاتورة', url: 'https://api.vibesholdingsa.com/pay/invoice/{{1}}' }] }] : []),
    ],
  }));
}

type Sent = { to: string; template: string; language: string; body: string[]; button: string | null };

function build(mailOff: string[] = []) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const address = new URL(String(url));
    if (address.pathname.endsWith('/message_templates')) {
      return new Response(JSON.stringify({ data: templatesOf(address.searchParams.get('name') ?? '') }), { status: 200 });
    }
    const message = JSON.parse(String(init?.body)) as { to: string; template: { name: string; language: { code: string }; components?: { type: string; parameters: { text: string }[] }[] } };
    const parts = message.template.components ?? [];
    sent.push({
      to: message.to,
      template: message.template.name,
      language: message.template.language.code,
      body: parts.find((part) => part.type === 'body')?.parameters.map((parameter) => parameter.text) ?? [],
      button: parts.find((part) => part.type === 'button')?.parameters[0]?.text ?? null,
    });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 });
  }) as typeof fetch;
  const service = new WhatsappService({
    kv: new MemoryKV(),
    log: silentLog,
    enabled: true,
    client: new WhatsappClient({ token: 'x'.repeat(30), phoneId: '1260740487121111', wabaId: '1371070605091256', log: silentLog, fetchImpl }),
    mailOff: new Set(mailOff),
  });
  return { service, sent };
}

const failed = (id: string) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status: 'failed', recipient_id: '966503844438', errors: [{ code: 131026, title: 'Message undeliverable' }] }] } }] }] });
const delivered = (id: string) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status: 'delivered', recipient_id: '966503844438' }] } }] }] });

for (const lang of ['ar', 'en'] as const) {
  test(`m204 (${lang}): every kind leaves on its own template, in the member's language, with its variables in the filed order`, async () => {
    const { service, sent } = build();
    const phone = '0503844438';
    assert.equal((await service.sendMembership({ phone, lang, name: 'Saleh Alghamdi', until: '6 November 2027', ref: 'm' })).channel, 'whatsapp');
    assert.equal((await service.sendEventTicket({ phone, lang, event: 'Investors Night', date: 'Sunday 20 September 2026 at 19:00', ticket: '3F9A1C2B', ref: 't' })).channel, 'whatsapp');
    assert.equal((await service.sendVisitUpdate({ phone, lang, status: lang === 'en' ? 'Confirmed' : 'تم التأكيد', ref: 'v' })).channel, 'whatsapp');
    assert.equal((await service.sendRequestUpdate({ phone, lang, service: 'Feasibility study', status: lang === 'en' ? 'In progress' : 'جارٍ التنفيذ', ref: 'r' })).channel, 'whatsapp');
    const link = 'https://api.vibesholdingsa.com/pay/invoice/3d0c7d0e-5a51-4f0e-9d0a-6f1f2f3f4f5f';
    assert.equal((await service.sendInvoice({ phone, lang, invoiceNo: 10042, amount: 150, currency: 'SAR', service: 'Feasibility study', link, ref: 'i' })).channel, 'whatsapp');

    assert.deepEqual(sent.map((message) => message.template), [TEMPLATE_NAMES.membership, TEMPLATE_NAMES.event_ticket, TEMPLATE_NAMES.visit_update, TEMPLATE_NAMES.request_update, TEMPLATE_NAMES.invoice]);
    assert.ok(sent.every((message) => message.language === lang && message.to === '966503844438'));
    assert.deepEqual(sent[0]?.body, ['Saleh', '6 November 2027']);
    assert.deepEqual(sent[1]?.body, ['Investors Night', 'Sunday 20 September 2026 at 19:00', '3F9A1C2B']);
    assert.deepEqual(sent[2]?.body, [lang === 'en' ? 'Confirmed' : 'تم التأكيد']);
    assert.deepEqual(sent[3]?.body, ['Feasibility study', lang === 'en' ? 'In progress' : 'جارٍ التنفيذ']);
    assert.deepEqual(sent[4]?.body, ['10042', lang === 'en' ? 'SAR 150' : '150 ر.س', 'Feasibility study']);
    // The button carries the payment id only: Meta's template holds the rest of the address.
    assert.equal(sent[4]?.button, '3d0c7d0e-5a51-4f0e-9d0a-6f1f2f3f4f5f');
    assert.ok(sent.slice(0, 4).every((message) => message.button === null));
  });
}

test('m204: the invoice template is not used for a link its fixed address does not cover (the TEST server)', async () => {
  const { service, sent } = build();
  const out = await service.sendInvoice({ phone: '0503844438', lang: 'ar', invoiceNo: 10042, amount: 150, service: 'خدمة', link: 'https://api-test.vibesholdingsa.com/pay/invoice/3d0c7d0e-5a51-4f0e-9d0a-6f1f2f3f4f5f' });
  assert.equal(out.channel, 'none');
  assert.equal(out.error, 'template_mismatch');
  assert.equal(sent.length, 0);
  const invoice = templatesOf('club_invoice')[0] as WaTemplate;
  assert.equal(urlButtonValue(invoice, 'https://api.vibesholdingsa.com/pay/invoice/'), null);
  assert.equal(urlButtonValue(templatesOf('club_receipt')[0] as WaTemplate, 'anything'), undefined);
});

test('m204: a placeholder name is never sent as a first name', () => {
  assert.equal(firstName('أحمد بن سالم'), 'أحمد');
  assert.equal(firstName('عضو رقم 12'), '');
  assert.equal(firstName(''), '');
});

test('m204: with no kind switched off the e-mail goes out next to the WhatsApp message', async () => {
  const { service } = build();
  let mails = 0;
  service.orMail('membership', await service.sendMembership({ phone: '0503844438', lang: 'ar', name: 'صالح', until: '6 نوفمبر 2027' }), () => (mails += 1));
  assert.equal(mails, 1);
});

test('m204: a switched-off kind holds its e-mail and sends it by itself only when Meta reports the message failed', async () => {
  const { service } = build(['membership']);
  let mails = 0;
  const first = await service.sendMembership({ phone: '0503844438', lang: 'ar', name: 'صالح', until: '6 نوفمبر 2027' });
  service.orMail('membership', first, () => (mails += 1));
  assert.equal(mails, 0);
  await service.ingestWebhook(failed(first.messageId ?? ''));
  assert.equal(mails, 1);
  await service.ingestWebhook(failed(first.messageId ?? ''));
  assert.equal(mails, 1);

  const second = await service.sendMembership({ phone: '0503844438', lang: 'en', name: 'Saleh', until: '6 November 2027' });
  service.orMail('membership', second, () => (mails += 1));
  await service.ingestWebhook(delivered(second.messageId ?? ''));
  await service.ingestWebhook(failed(second.messageId ?? ''));
  assert.equal(mails, 1);

  // WhatsApp did not take it at all: the e-mail goes at once, switched off or not.
  service.orMail('membership', { channel: 'none', error: 'no_phone' }, () => (mails += 1));
  assert.equal(mails, 2);
  // Another kind is still on both channels.
  service.orMail('visit_update', await service.sendVisitUpdate({ phone: '0503844438', lang: 'ar', status: 'تم التأكيد' }), () => (mails += 1));
  assert.equal(mails, 3);
});
