import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeKey, latinPrefix, newShortCode, normalizeShortCode } from './affiliate/shortCode.js';
import { AffiliateService, AFFILIATES_KEY, type AffiliateRecord } from './affiliate/service.js';
import { InvitesService } from './invites/service.js';
import { MockHubClient } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { MemoryKV } from './store.js';

// M202 (owner, 2026-11-06): very short representative codes («FAR2»), forgiving typing, old codes and links
// kept, the code on the «دعوة عضو» screen, and the code and link on WhatsApp.
const silent = { info() {}, warn() {}, error() {} } as never;

const record = (contactId: number, name: string, extra: Partial<AffiliateRecord> = {}): AffiliateRecord => ({
  contactId,
  name,
  email: `${contactId}@gmail.com`,
  phone: '0550001111',
  code: `I-${String(contactId).padStart(10, '0')}`,
  status: 'approved',
  entityType: 'individual',
  bankName: 'بنك',
  accountName: 'Account Holder',
  iban: 'SA4420000001234567891234',
  city: 'الرياض',
  address: 'حي العليا، شارع الأمير محمد بن عبدالعزيز',
  heardFrom: 'منصة إكس',
  heardFromNote: '',
  appliedAt: `2026-11-0${(contactId % 9) + 1}T10:00:00.000Z`,
  agreementSentAt: '2026-11-01T10:00:00.000Z',
  agreementAcceptedAt: '2026-11-01T10:00:00.000Z',
  decidedAt: '2026-11-01T10:00:00.000Z',
  decidedBy: 'الإدارة',
  adminNote: null,
  ...extra,
});

function service(records: AffiliateRecord[], whatsapp?: { sendAffiliateLink: (input: never) => Promise<{ channel: 'whatsapp' }> }) {
  const kv = new MemoryKV();
  const invites = new InvitesService({ kv, hub: new MockHubClient(), notifier: new Notifier({ mailer: new LogMailer(), recipients: [], log: silent, appEnv: 'test' }), log: silent });
  const seeded = kv.set(AFFILIATES_KEY, { affiliates: records });
  const affiliates = new AffiliateService({
    kv,
    invites,
    notifier: { affiliateDecided() {} } as never,
    log: silent,
    publicUrl: 'https://api.vibesholdingsa.com/',
    muted: () => new Set<number>(),
    ...(whatsapp ? { whatsapp: whatsapp as never } : {}),
  } as never);
  return { kv, invites, affiliates, seeded };
}

test('titles are dropped from the prefix', () => {
  assert.equal(latinPrefix('دكتور محمد الجهني'), 'MHM');
  assert.equal(latinPrefix('د. فارس العتيبي'), 'FAR');
  assert.equal(latinPrefix('Dr. Khaled Saud'), 'KHA');
  assert.equal(latinPrefix('الدكتورة ريم سالم'), 'RYM');
  // A title alone is still somebody's only word.
  assert.equal(latinPrefix('دكتور'), 'DKT');
});

test('a clash takes the next digit, then the family name, and never a look-alike of a taken code', () => {
  const name = 'فارس العتيبي';
  const eight = ['FAR2', 'FAR3', 'FAR4', 'FAR5', 'FAR6', 'FAR7', 'FAR8', 'FAR9'];
  assert.equal(newShortCode(name, eight), 'FAA2'); // first two letters + the family name's first («العتيبي» → A).
  assert.equal(newShortCode('Rina Salem', ['RLN2']), 'RIN3'); // RIN2 would read as RLN2.
  assert.equal(newShortCode('Omar Ali', ['0MA2']), 'OMA3');
  assert.match(newShortCode('سارة', []), /^[A-Z]{3}[2-9]$/);
  // A digit is never 0 or 1.
  for (const code of Array.from({ length: 30 }, (_, index) => newShortCode('Sara', Array.from({ length: index }, (__, n) => `SAR${n + 2}`)))) {
    assert.match(code, /^[A-Z]{3}[2-9]$/);
  }
});

test('the forgiving key folds case, spacing, marks, Arabic digits and look-alikes; a membership number is no alias', () => {
  const key = codeKey('FAR2');
  for (const typed of ['far2', ' far 2 ', 'FAR-2', 'FAR.2', 'FAR٢', 'FAR۲', '‎FAR2‏']) assert.equal(codeKey(typed), key, typed);
  assert.equal(codeKey('R1N2'), codeKey('RIN2'));
  assert.equal(codeKey('RlN2'), codeKey('RIN2'));
  assert.equal(codeKey('0MA2'), codeKey('OMA2'));
  assert.equal(codeKey('FAR-27'), codeKey('far27'));
  assert.equal(codeKey('FAR-027'), codeKey('far27'));
  assert.equal(codeKey('I-0000000042'), null);
  assert.equal(normalizeShortCode('I-0000000042'), null);
  assert.equal(codeKey(''), null);
});

test('deploying moves «FAR-24» to the history: the new code is set once, and every old form still finds him', async () => {
  const { affiliates, invites, seeded, kv } = service([
    record(1, 'فارس العتيبي', { shortCode: 'FAR-24' }),
    record(2, 'فارس الدوسري', { shortCode: 'FAR-67' }),
    record(3, 'دكتور محمد الجهني', { shortCode: 'DKT-75' }),
    record(4, 'رنا سالم'), // Never had an alias.
  ]);
  await seeded;
  const list = await affiliates.list();
  const faris = list.find((row) => row.contactId === 1);
  const second = list.find((row) => row.contactId === 2);
  assert.equal(faris?.shortCode, 'FAR2');
  assert.deepEqual(faris?.oldCodes, ['FAR-24']);
  assert.equal(second?.shortCode, 'FAR3');
  assert.equal(list.find((row) => row.contactId === 3)?.shortCode, 'MHM2');
  assert.equal(list.find((row) => row.contactId === 4)?.oldCodes, undefined);

  for (const form of ['FAR2', 'far2', 'FAR-24', 'far 24', 'far24', 'I-0000000001']) {
    assert.equal((await affiliates.findByCode(form))?.contactId, 1, form);
  }
  // The referral resolves to the membership number, old code or new: commissions cannot break.
  assert.equal(await invites.prepare('far-24'), 'I-0000000001');
  assert.equal(await invites.prepare('far2'), 'I-0000000001');
  assert.equal(await invites.prepare('I-0000000001'), 'I-0000000001');

  // Saved, and a second load changes nothing.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const stored = await kv.get<{ affiliates: AffiliateRecord[] }>(AFFILIATES_KEY);
  assert.equal(stored?.affiliates.find((row) => row.contactId === 1)?.shortCode, 'FAR2');
  assert.deepEqual((await affiliates.list()).find((row) => row.contactId === 1)?.oldCodes, ['FAR-24']);
});

test('a look-alike that could mean two people resolves to nobody', async () => {
  const { affiliates, seeded } = service([record(1, 'Rina A', { shortCode: 'RIN2', oldCodes: ['XXX-10'] }), record(2, 'Lara B', { shortCode: 'LAN2', oldCodes: ['YYY-10'] }), record(3, 'Iana C', { shortCode: 'IAN2', oldCodes: ['ZZZ-10'] })]);
  await seeded;
  assert.equal((await affiliates.findByShortCode('ian2'))?.contactId, 3);
  assert.equal((await affiliates.findByShortCode('lan2'))?.contactId, 2);
  assert.equal(await affiliates.findByShortCode('1AN2'), null);
});

test('the dashboard sets a code: shape and clashes checked, the old one kept, and the link is short and lower case', async () => {
  const { affiliates, seeded } = service([record(1, 'وسيم أحمد', { shortCode: 'WSY2', oldCodes: ['WSY-25'] }), record(2, 'رنا سالم', { shortCode: 'RNA2', oldCodes: ['RNA-23'] })]);
  await seeded;
  await assert.rejects(affiliates.setShortCode(1, 'WA'), /3 إلى 5/);
  await assert.rejects(affiliates.setShortCode(1, 'WAS1'), /3 إلى 5/);
  await assert.rejects(affiliates.setShortCode(1, 'rna2'), /مستخدم/);
  await assert.rejects(affiliates.setShortCode(1, 'RNA-23'), /3 إلى 5/);
  const changed = await affiliates.setShortCode(1, 'was2');
  assert.equal(changed?.shortCode, 'WAS2');
  assert.deepEqual(changed?.oldCodes, ['WSY-25', 'WSY2']);
  assert.equal((await affiliates.findByCode('WSY2'))?.contactId, 1);
  assert.equal(await affiliates.setShortCode(99, 'NEW2'), null);
  assert.equal(affiliates.referralLink('WAS2'), 'https://api.vibesholdingsa.com/r/was2');
  // Back to an earlier one: it is his, so it is allowed and leaves the history.
  assert.deepEqual((await affiliates.setShortCode(1, 'WSY2'))?.oldCodes, ['WSY-25', 'WAS2']);
});

test('the e-mail route carries the same code and link, approved affiliates only', async () => {
  const mailed: { email: string; code: string; link: string }[] = [];
  const { affiliates, seeded, kv } = service([record(1, 'فارس العتيبي', { shortCode: 'FAR2', oldCodes: ['FAR-24'] }), record(2, 'رنا سالم', { shortCode: 'RNA2', oldCodes: ['RNA-23'], status: 'pending' })]);
  await seeded;
  (affiliates as unknown as { deps: { notifier: unknown } }).deps.notifier = { affiliateLink: (who: { email: string }, code: string, link: string) => mailed.push({ email: who.email, code, link }) };
  assert.deepEqual(await affiliates.sendLinks(1, 'email'), [{ contactId: 1, name: 'فارس العتيبي', code: 'FAR2', channel: 'email', error: null }]);
  assert.deepEqual(mailed, [{ email: '1@gmail.com', code: 'FAR2', link: 'https://api.vibesholdingsa.com/r/far2' }]);
  assert.equal((await affiliates.sendLinks(2, 'email')).length, 0);
  await kv.set(AFFILIATES_KEY, { affiliates: [record(3, 'سارة علي', { shortCode: 'SAR2', oldCodes: ['SAR-10'], email: '' })] });
  assert.equal((await affiliates.sendLinks(3, 'email'))[0]?.error, 'no_email');
});

test('WhatsApp: every approved affiliate gets the short code and link, one ref per code; a new approval sends too', async () => {
  const sent: { phone: string; name: string; code: string; link: string; ref: string }[] = [];
  const whatsapp = { sendAffiliateLink: async (input: never) => (sent.push(input), { channel: 'whatsapp' as const }) };
  const { affiliates, seeded } = service(
    [record(1, 'فارس العتيبي', { shortCode: 'FAR2', oldCodes: ['FAR-24'] }), record(2, 'رنا سالم', { shortCode: 'RNA2', oldCodes: ['RNA-23'], status: 'pending' })],
    whatsapp,
  );
  await seeded;
  const results = await affiliates.sendLinks();
  assert.deepEqual(results, [{ contactId: 1, name: 'فارس العتيبي', code: 'FAR2', channel: 'whatsapp', error: null }]);
  assert.equal(sent[0]?.link, 'https://api.vibesholdingsa.com/r/far2');
  assert.equal(sent[0]?.ref, 'affiliate-link:1:FAR2');
  assert.equal((await affiliates.sendLinks(2)).length, 0); // Not approved: nothing goes out.

  await affiliates.decide(2, 'approved', '', 'الإدارة');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sent.at(-1)?.code, 'RNA2');
});
