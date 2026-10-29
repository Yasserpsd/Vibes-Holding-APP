import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { royalHtml } from '../src/mail/royal.js';
import { invoiceHtml } from '../src/payments/invoice.js';
import type { Payment } from '../src/payments/service.js';
import { changeMail, receiptMail } from '../src/requests/mail.js';
import { fromCard } from '../src/requests/model.js';

/**
 * M138: writes sample HTML of the member mails (the royal invoice, the no-fee card receipt and a status
 * notice) so the owner can look at them without sending anything. Usage:
 *   npx tsx scripts/preview-m138-mails.ts <outDir>
 */
const out = process.argv[2] ?? join(process.cwd(), 'tmp');
mkdirSync(out, { recursive: true });

const payment: Payment = {
  id: '7c0a3f2e-1111-4bbb-8ccc-0123456789ab',
  contactId: 42,
  name: 'سارة العتيبي',
  email: 'sara@example.com',
  phone: '+966500000000',
  serviceKey: 'pitch-deck',
  serviceTitle: 'تصميم Pitch Deck احترافي',
  answers: [{ key: 'project', label: 'اسم المشروع', value: 'منصة تمويل جماعي' }],
  amount: 1500,
  amountCents: 150000,
  currency: 'SAR',
  memberPrice: true,
  status: 'paid',
  provider: 'moyasar',
  discountCode: null,
  discountPercent: null,
  preDiscountSar: 2000,
  intentionId: 'inv_1',
  orderId: 'ord_1',
  clientSecret: '',
  checkoutUrl: '',
  transactionId: 'moy_ABC123',
  failureReason: null,
  invoiceNo: 10007,
  lang: 'ar',
  createdAt: '2026-10-29T18:00:00.000Z',
  updatedAt: '2026-10-29T18:05:00.000Z',
  paidAt: '2026-10-29T18:05:00.000Z',
  failedAt: null,
} as Payment;

writeFileSync(join(out, 'invoice-royal.html'), invoiceHtml(payment, 10007, 'ar', 'https://api-test.vibesholdingsa.com'));

const card = fromCard({
  id: 'd4e5f6a7-2222-4ccc-9ddd-0123456789ab',
  contactId: 42,
  cardNumber: 'I-0000000042',
  name: 'سارة العتيبي',
  phone: '+966500000000',
  email: 'sara@example.com',
  personaLabel: 'مستثمر',
  jobTitle: 'مديرة استثمار',
  city: 'الرياض',
  address: 'حي الياسمين، شارع الأمير محمد بن سلمان، فيلا 12',
  note: 'الاتصال قبل التوصيل',
  status: 'pending',
  createdAt: '2026-10-29T18:00:00.000Z',
  doneAt: null,
  doneBy: null,
  adminNote: null,
  lang: 'ar',
});
const receipt = receiptMail(card, 'سارة العتيبي', 'ar', 'https://api-test.vibesholdingsa.com/app');
writeFileSync(join(out, 'card-receipt.html'), royalHtml({ ...receipt.mail, sealUrl: 'https://api-test.vibesholdingsa.com/pay/invoice-stamp.png' }));

const changed = changeMail({ ...card, status: 'in_progress', note: 'الكارت في الطباعة، يصلك خلال يومين', updatedAt: '2026-10-30T09:00:00.000Z' }, 'سارة العتيبي', 'ar', 'https://api-test.vibesholdingsa.com/app');
writeFileSync(join(out, 'status-notice.html'), royalHtml({ ...changed.mail, sealUrl: 'https://api-test.vibesholdingsa.com/pay/invoice-stamp.png' }));

console.log(`written to ${out}: invoice-royal.html, card-receipt.html, status-notice.html`);
