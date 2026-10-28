import assert from 'node:assert/strict';
import { test } from 'node:test';

import { profileMissingOf } from './auth/service.js';
import type { HubContact } from './hub/types.js';

// M147 «أكمل ملفك»: the sign-in gate's list — a social-born account lands with name + e-mail only;
// the interests count only when the hub reports them (2.21.3+), a company needs its name.

const base = {
  id: 1,
  name: 'سارة',
  email: 's@example.test',
  phone: '',
  persona: '',
  bio: '',
  job_title: '',
  company: '',
  member_type: '' as const,
  city: '',
  website: '',
  social: '',
  avatar: '',
  verified: 1,
  is_admin: 0,
  role: '',
} as unknown as HubContact;

test('m147: a Google-born account misses phone, الفئة and bio; interests only when the hub reports them', () => {
  assert.deepEqual(profileMissingOf(base), ['phone', 'persona', 'bio']);
  assert.deepEqual(profileMissingOf({ ...base, interests: '' }), ['phone', 'persona', 'bio', 'interests']);
  assert.deepEqual(profileMissingOf({ ...base, interests: 'العقار' }), ['phone', 'persona', 'bio']);
});

test('m147: complete profiles pass; a company without its name does not', () => {
  const full = { ...base, phone: '0551234567', persona: 'investor', bio: 'نبذة طويلة بما يكفي للتحقق.', interests: 'العقار، التقنية' };
  assert.deepEqual(profileMissingOf(full), []);
  assert.deepEqual(profileMissingOf({ ...full, bio: 'قصيرة' }), ['bio']);
  assert.deepEqual(profileMissingOf({ ...full, member_type: 'company' }), ['company']);
  assert.deepEqual(profileMissingOf({ ...full, member_type: 'company', company: 'شركة النور' }), []);
  assert.deepEqual(profileMissingOf({ ...full, persona: 'king' }), ['persona']);
});
