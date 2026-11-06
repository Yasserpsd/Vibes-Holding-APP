import assert from 'node:assert/strict';
import { test } from 'node:test';

import { profileMissingOf } from './auth/service.js';
import type { HubContact } from './hub/types.js';

// M147 «أكمل ملفك»: the sign-in gate's list — a social-born account lands with name + e-mail only;
// the interests count only when the hub reports them (2.21.3+), a company needs its name.

const base = {
  id: 1,
  name: 'سارة العتيبي',
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

test('m203: a Google-born account misses phone, الفئة and the job; the rest is asked later in the profile', () => {
  assert.deepEqual(profileMissingOf(base), ['phone', 'persona', 'jobTitle']);
  assert.deepEqual(profileMissingOf({ ...base, interests: '' }), ['phone', 'persona', 'jobTitle']);
});

test('m203: phone, persona and job complete a profile, whatever else is empty', () => {
  const full = { ...base, member_type: 'individual' as const, phone: '0551234567', persona: 'investor', bio: 'نبذة طويلة بما يكفي للتحقق.', job_title: 'مستثمرة', interests: 'العقار، التقنية' };
  assert.deepEqual(profileMissingOf(full), []);
  assert.deepEqual(profileMissingOf({ ...full, bio: 'قصيرة' }), []);
  assert.deepEqual(profileMissingOf({ ...full, member_type: 'company' }), []);
  assert.deepEqual(profileMissingOf({ ...full, persona: 'king' }), ['persona']);
});
