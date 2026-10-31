import assert from 'node:assert/strict';
import { test } from 'node:test';

import { forBundle, gateFieldsOf, LEGACY_GATE_FIELDS, PROFILE_FIELDS, profileMissingOf } from './auth/service.js';
import type { HubContact } from './hub/types.js';

// M168 (owner, 2026-10-31): the completion wall never names a field the calling bundle cannot draw.
// Older bundles (no `x-app-gate` header) saw «jobTitle missing», drew an empty card and were locked out.

const contact = {
  id: 428,
  name: 'يحيى أحمد يحيى العسيري',
  email: 'member@example.com',
  phone: '+966500000000',
  persona: 'entrepreneur',
  bio: 'رائد أعمال في قطاع التقنية منذ عشر سنوات',
  member_type: 'individual',
  job_title: '',
  company: '',
  has_account: 1,
} as unknown as HubContact;

test('m168: a bundle without the header is held only on the legacy fields', () => {
  const fields = gateFieldsOf(undefined);
  assert.deepEqual([...fields].sort(), [...LEGACY_GATE_FIELDS].sort());
  assert.deepEqual(profileMissingOf(contact), ['jobTitle']);
  const me = forBundle({ id: 428, profileMissing: profileMissingOf(contact) }, fields);
  assert.deepEqual(me.profileMissing, []);
});

test('m168: a bundle that names its fields is held on exactly those', () => {
  const fields = gateFieldsOf('name,memberType,phone,persona,bio,jobTitle,interests,company,contactEmail');
  assert.deepEqual([...fields].sort(), [...PROFILE_FIELDS].sort());
  assert.deepEqual(forBundle({ profileMissing: ['jobTitle', 'phone'] as ReturnType<typeof profileMissingOf> }, fields).profileMissing, ['jobTitle', 'phone']);
  const partial = gateFieldsOf('phone, persona ,bogus');
  assert.deepEqual(forBundle({ profileMissing: ['jobTitle', 'phone', 'name'] as ReturnType<typeof profileMissingOf> }, partial).profileMissing, ['phone']);
});

test('m168: a garbled or empty header falls back to the legacy set; a repeated header is joined', () => {
  assert.deepEqual([...gateFieldsOf('')].sort(), [...LEGACY_GATE_FIELDS].sort());
  assert.deepEqual([...gateFieldsOf('nothing,known')].sort(), [...LEGACY_GATE_FIELDS].sort());
  assert.deepEqual([...gateFieldsOf(['phone', 'jobTitle'])].sort(), ['jobTitle', 'phone']);
});

test('m168: an unchanged list keeps the same object (cache-friendly)', () => {
  const me = { profileMissing: ['phone'] as ReturnType<typeof profileMissingOf> };
  assert.equal(forBundle(me, gateFieldsOf(undefined)), me);
});
