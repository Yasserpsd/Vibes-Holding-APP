import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countByCountry, countryOfPhone } from './dashboard/countries.js';

// M284 «خريطة الأعضاء»: the country comes from the phone's dialing code; only counts leave the server.
test('countryOfPhone matches the longest dialing code', () => {
  assert.equal(countryOfPhone('966512345678'), 'sa');
  assert.equal(countryOfPhone('+971 50 123 4567'), 'ae');
  assert.equal(countryOfPhone('0021620123456'), 'tn');
  assert.equal(countryOfPhone('213551234567'), 'dz');
  assert.equal(countryOfPhone('393331234567'), 'it');
  assert.equal(countryOfPhone('0512345678'), 'sa');
  assert.equal(countryOfPhone('201001234567'), 'eg');
  assert.equal(countryOfPhone(''), '');
});

test('countByCountry counts accounts and members, most first, no phones', () => {
  const answer = countByCountry([
    { phone: '21620123456', state: 'member' },
    { phone: '21620123457', state: 'registered' },
    { phone: '966512345678', state: 'member' },
    { phone: '', state: 'lead' },
  ]);
  assert.equal(answer.total, 4);
  assert.equal(answer.noPhone, 1);
  assert.deepEqual(answer.items.map((row) => [row.code, row.total, row.members]), [['tn', 2, 1], ['sa', 1, 1]]);
  assert.equal(answer.items[0]?.name, 'تونس');
  assert.ok(!JSON.stringify(answer).includes('20123456'));
});
