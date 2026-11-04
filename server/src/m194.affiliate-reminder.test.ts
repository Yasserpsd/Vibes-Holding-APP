import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { AffiliateService, REMINDER_HOUR } from './affiliate/service.js';
import { MemberPresence } from './advisor/presence.js';
import type { AuthService } from './auth/service.js';
import type { SessionRecord } from './auth/sessions.js';
import { MockHubClient } from './hub/mock.js';
import type { HubContact } from './hub/types.js';
import { InvitesService } from './invites/service.js';
import type { AppLang } from './lang.js';
import { LogMailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { MemoryKV } from './store.js';

// M194: the advisor's daily reminder to approved affiliates with no paying member yet, and the
// affiliate line in the advisor's live member block.
const log = Fastify({ logger: false }).log;
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
type Sent = { contactId: number; ar: { title: string; body: string; data?: Record<string, string> }; en: { title: string; body: string } };

function rig(muted = new Set<number>()) {
  const kv = new MemoryKV();
  const notifier = new Notifier({ mailer: new LogMailer(), recipients: ['admin@vcmem.com'], log, appEnv: 'test' });
  const invites = new InvitesService({ kv, hub: new MockHubClient(), notifier, log });
  const sent: Sent[] = [];
  const push = {
    sendTo: async (contactId: number, messageOf: (lang: AppLang) => { title: string; body: string; data?: Record<string, string> }) => {
      sent.push({ contactId, ar: messageOf('ar'), en: messageOf('en') });
      return { sent: 1 };
    },
  };
  const service = new AffiliateService({ kv, invites, notifier, log, publicUrl: '', push, muted: async () => muted });
  return { invites, service, sent };
}

const person = (contactId: number) => ({ contactId, name: 'سالم الحربي', email: `rep${contactId}@gmail.com`, phone: '0550009090', code: `N-00000000${contactId}` });
const invitee = (id: number) => ({ id, name: `عضو ${id}`, phone: '055', email: `${id}@gmail.com` }) as unknown as HubContact;

async function approve(service: AffiliateService, contactId: number) {
  await service.apply(person(contactId), APPLY);
  await service.acceptAgreement(contactId);
  await service.decide(contactId, 'approved', '', 'الإدارة');
}

/** A moment inside the given Riyadh hour (UTC+3). */
const riyadhAt = (hour: number, day = 10) => Date.UTC(2026, 10, day, hour - 3, 15);

test('the reminder reaches approved affiliates with no paying member, once a day, inside its hour', async () => {
  const { invites, service, sent } = rig();
  await approve(service, 71);
  await approve(service, 72);
  await service.apply(person(73), APPLY); // never approved → never reminded
  await invites.recordFromRegister(invitee(81), 72, 'سالم الحربي', person(72).code);
  await invites.onActivated(81, new Date());

  assert.equal(await service.remind(riyadhAt(REMINDER_HOUR - 1)), 0, 'outside the hour');
  assert.equal(await service.remind(riyadhAt(REMINDER_HOUR)), 1);
  assert.deepEqual(sent.map((entry) => entry.contactId), [71]);
  assert.match(sent[0]?.ar.body ?? '', /يا صديقي/);
  assert.match(sent[0]?.ar.body ?? '', /250 ريال سعودي/);
  assert.match(sent[0]?.en.body ?? '', /my friend/);
  assert.equal(sent[0]?.ar.data?.screen, '/affiliate');

  assert.equal(await service.remind(riyadhAt(REMINDER_HOUR) + 20 * 60_000), 0, 'same day again');
  assert.equal(await service.remind(riyadhAt(REMINDER_HOUR, 11)), 1, 'next day');
});

test('the dashboard switch and the advisor mute silence it; edited texts are used', async () => {
  const quiet = rig(new Set([71]));
  await approve(quiet.service, 71);
  assert.equal(await quiet.service.remind(riyadhAt(REMINDER_HOUR)), 0);

  const { service, sent } = rig();
  await approve(service, 71);
  await service.saveConfig({ reminderEnabled: false });
  assert.equal(await service.remind(riyadhAt(REMINDER_HOUR)), 0);
  await service.saveConfig({ reminderEnabled: true, reminderBody: 'شارك رابطك يا صديقي، العمولة {commission}' });
  assert.equal(await service.remind(riyadhAt(REMINDER_HOUR, 11)), 1);
  assert.equal(sent[0]?.ar.body, 'شارك رابطك يا صديقي، العمولة 250 ريال سعودي');
});

test('the advisor block carries the approved affiliate standing and the nudge', async () => {
  const { service } = rig();
  await approve(service, 71);
  const auth = { me: async () => ({ id: 71 }) } as unknown as AuthService;
  const presence = new MemberPresence({ auth, affiliate: service, log });
  const { block } = await presence.of({} as SessionRecord, null, 'مرحبا');
  assert.match(block, /ممثل معتمد في برنامج ممثلي نادي المستثمرين: 0 عضو دافع/);
  assert.match(block, /شجّعه بلطف على مشاركة رابطه/);

  const outsider = new MemberPresence({ auth: { me: async () => ({ id: 99 }) } as unknown as AuthService, affiliate: service, log });
  assert.equal((await outsider.of({} as SessionRecord, null, 'مرحبا')).block, '');
});
