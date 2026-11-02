import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { AFFILIATE_CONFIG_KEY, AFFILIATES_KEY, AffiliateService, DEFAULT_AFFILIATE_CONFIG, type AffiliateRecord } from './affiliate/service.js';
import { MockHubClient } from './hub/mock.js';
import type { HubContact } from './hub/types.js';
import { InvitesService } from './invites/service.js';
import { LogMailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { MemoryKV } from './store.js';

// M186: «ممثلو نادي المستثمرين» v3 — the commission tier stamped at payment time, the performance
// cycle with its allowance, the renewal request when the counter runs out, and the dashboard renewal.
const log = Fastify({ logger: false }).log;
const DAY = 86_400_000;
const APPLY = {
  entityType: 'individual' as const,
  bankName: 'البنك الأهلي السعودي',
  accountName: 'Mumathil Al Nadi',
  iban: 'SA4420000001234567891234',
  city: 'الرياض',
  address: 'حي العليا، شارع العليا العام',
  heardFrom: 'منصة إكس',
  heardFromNote: '',
};

function rig() {
  const kv = new MemoryKV();
  const mailer = new LogMailer();
  const notifier = new Notifier({ mailer, recipients: ['admin@vcmem.com'], log, appEnv: 'test' });
  const invites = new InvitesService({ kv, hub: new MockHubClient(), notifier, log });
  const service = new AffiliateService({ kv, invites, notifier, log, publicUrl: '' });
  return { kv, mailer, invites, service };
}

const member = { contactId: 90, name: 'ممثل الدورات', email: 'rep90@gmail.com', phone: '0550009090', code: 'N-0000000090' };
const invitee = (id: number) => ({ id, name: `عضو ${id}`, phone: '055', email: `${id}@gmail.com` }) as unknown as HubContact;

async function approved(service: AffiliateService, at: Date) {
  await service.apply(member, APPLY, at);
  await service.acceptAgreement(member.contactId, at);
  await service.decide(member.contactId, 'approved', '', 'الإدارة', at);
}

test('the owner terms fill the intro and the agreement in both languages', () => {
  const ar = AffiliateService.fillTerms(DEFAULT_AFFILIATE_CONFIG.agreementText, DEFAULT_AFFILIATE_CONFIG, 'ar');
  assert.match(ar, /عمولة قدرها 250 ريال سعودي/);
  assert.match(ar, /عمولة قدرها 350 ريال سعودي/);
  assert.match(ar, /مبلغ 1,500 ريال سعودي بدل مواصلات ومصروفات نثرية/);
  assert.match(ar, /استقطاب 10 أعضاء دافعين خلال دورة أداء مدتها 30 يومًا/);
  assert.match(ar, /استقطاب 5 أعضاء دافعين/);
  assert.match(ar, /تُرحَّل العمولات المستحقة/);
  assert.ok(!/\{[a-zA-Z]+\}/.test(ar), 'no placeholder left');
  const en = AffiliateService.fillTerms(DEFAULT_AFFILIATE_CONFIG.introTextEn, DEFAULT_AFFILIATE_CONFIG, 'en');
  assert.match(en, /SAR 250 for every paying member, rising to SAR 350/);
  assert.match(en, /A SAR 1,500 transportation and incidental-expenses allowance/);
  assert.ok(!/\{[a-zA-Z]+\}/.test(en), 'no placeholder left');
});

test('texts saved under the old terms give way to the new defaults; the numbers stand', async () => {
  const { kv, service } = rig();
  await kv.set(AFFILIATE_CONFIG_KEY, { commission: 260, introText: 'نص قديم بلا بدل ولا عمولة مزدوجة' });
  const config = await service.config();
  assert.equal(config.commission, 260);
  assert.equal(config.introText, DEFAULT_AFFILIATE_CONFIG.introText);
  // A save from the dashboard marks the texts current, so the owner's own edits stick.
  await service.saveConfig({ introText: 'تعريف جديد من لوحة الإدارة بعمولة {commission}' });
  assert.equal((await service.config()).introText, 'تعريف جديد من لوحة الإدارة بعمولة {commission}');
});

test('tiers are stamped at payment time, the allowance lands once, the counter files its renewal', async () => {
  const { mailer, invites, service } = rig();
  const t0 = new Date();
  const at = (days: number) => new Date(t0.getTime() + days * DAY);
  await service.saveConfig({ cycleTarget: 2 });
  await approved(service, t0);
  for (const id of [91, 92, 93]) await invites.recordFromRegister(invitee(id), member.contactId, member.name, member.code);

  // Paid while the affiliate holds no membership → 250.
  await service.sync(member.contactId, t0, { active: false, endDate: null });
  await invites.onActivated(91, at(1));
  await service.sync(member.contactId, at(1), { active: false, endDate: null });

  // He buys the annual membership; the next paying referral earns 350 — stamped by the sweep.
  await service.sync(member.contactId, at(2), { active: true, endDate: at(365).toISOString() });
  await invites.onActivated(92, at(2.1));
  const before = mailer.sent.length;
  await service.sweep(at(3));
  // Two paying members inside the 30-day window met the target → the allowance and its royal mail.
  assert.equal(mailer.sent.length, before + 1);
  assert.match(mailer.sent.at(-1)?.subject ?? '', /بدل المواصلات/);
  assert.deepEqual((await service.find(member.contactId))?.earnings?.map((entry) => entry.amount), [250, 350]);
  let balance = await service.balance(member.contactId);
  assert.equal(balance.bonuses, 1500);
  assert.equal(balance.earned, 250 + 350 + 1500);
  assert.equal(balance.commission, 350);
  assert.equal(balance.member, true);

  // The membership lapses: what was earned stays; the next tier is 250 again; no second allowance.
  await service.sync(member.contactId, at(4), { active: false, endDate: null });
  balance = await service.balance(member.contactId);
  assert.equal(balance.earned, 2100);
  assert.equal(balance.commission, 250);

  // The counter runs out → renewal request to the team, once.
  const view = await service.cycleView(member.contactId, at(10));
  assert.equal(view?.daysLeft, 20);
  assert.equal(view?.state, 'running');
  await service.sweep(at(31));
  assert.match(mailer.sent.at(-1)?.subject ?? '', /طلب تجديد دورة ممثل نادي المستثمرين/);
  assert.deepEqual(mailer.sent.at(-1)?.to, ['admin@vcmem.com']);
  const sentAfterEnd = mailer.sent.length;
  await service.sweep(at(32));
  assert.equal(mailer.sent.length, sentAfterEnd);
  const ended = await service.cycleView(member.contactId, at(31));
  assert.equal(ended?.state, 'renewal');
  assert.equal(ended?.paid, 2);
  assert.ok((await service.find(member.contactId))?.renewalRequestedAt);

  // A payment between the cycles counts for the commission, not for either window.
  await invites.onActivated(93, at(32));
  // The dashboard renews with a new duration, target and allowance.
  const renewed = await service.renewCycle(member.contactId, { days: 60, target: 15, bonus: 3000 }, at(33));
  assert.equal(renewed?.renewalRequestedAt, null);
  assert.match(mailer.sent.at(-1)?.subject ?? '', /دورة أداء جديدة/);
  const next = await service.cycleView(member.contactId, at(33));
  assert.deepEqual(
    { n: next?.n, daysLeft: next?.daysLeft, target: next?.target, paid: next?.paid, bonus: next?.bonus, state: next?.state },
    { n: 2, daysLeft: 60, target: 15, paid: 0, bonus: 3000, state: 'running' },
  );
  await service.sync(member.contactId, at(33), { active: false, endDate: null });
  assert.equal((await service.balance(member.contactId)).earned, 2100 + 250);
});

test('an affiliate approved before M186 keeps 250 for the referrals already paid', async () => {
  const { kv, invites, service } = rig();
  const t0 = new Date();
  await approved(service, t0);
  await invites.recordFromRegister(invitee(95), member.contactId, member.name, member.code);
  await invites.onActivated(95, t0);
  // The stored record as M184 wrote it: no stamps, no cycle.
  const stored = (await kv.get<{ affiliates: AffiliateRecord[] }>(AFFILIATES_KEY))?.affiliates ?? [];
  for (const record of stored) {
    delete record.earnings;
    delete record.cycles;
  }
  await kv.set(AFFILIATES_KEY, { affiliates: stored });

  await service.sync(member.contactId, t0, { active: true, endDate: new Date(t0.getTime() + 300 * DAY).toISOString() });
  const record = await service.find(member.contactId);
  assert.deepEqual(record?.earnings?.map((entry) => entry.amount), [250]);
  assert.equal(record?.cycles?.length, 1);
  assert.equal((await service.balance(member.contactId)).earned, 250);
});
