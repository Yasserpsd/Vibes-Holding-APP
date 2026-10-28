import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FormFiller, asciiDigits, snapOption, type FillField } from './advisor/fill.js';

// M142 «املأ بصوتك»: the model's answer is only a suggestion — phones, e-mails, dates, numbers and
// choices are normalised on the server, known values survive silence, and a missing required
// field always comes back with a follow-up question.

const log = { warn() {}, info() {}, error() {}, debug() {} } as unknown as ConstructorParameters<typeof FormFiller>[0]['log'];

function completion(values: Record<string, string>, followUp = '') {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ values, followUp }) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const FIELDS: FillField[] = [
  { key: 'name', label: 'الاسم', type: 'text', required: true },
  { key: 'phone', label: 'الجوال', type: 'phone', required: true },
  { key: 'email', label: 'البريد', type: 'email' },
  { key: 'space', label: 'المكان', type: 'select', options: ['مكتب خاص', 'قاعة الاجتماعات'], required: true },
  { key: 'hours', label: 'الساعات', type: 'number' },
  { key: 'date', label: 'التاريخ', type: 'date' },
  { key: 'time', label: 'الوقت', type: 'time' },
  { key: 'interests', label: 'الاهتمامات', type: 'multiselect', options: ['العقار', 'التقنية', 'الصناعة'] },
  { key: 'note', label: 'ملاحظة', type: 'textarea' },
];

test('m142: spoken values are normalised, known values survive, nothing is invented', async () => {
  let sentBody: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (_input, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return completion({
      name: 'أحمد السالم',
      phone: '٠٥٥ ٨٣١ ٨٧٧٧',
      email: 'Ahmed.Salem@Example.COM',
      space: 'قاعه اجتماعات',
      hours: '٢',
      date: '2026-11-3',
      time: '9:30',
      interests: 'التقنيه، العقار، شيء آخر',
      note: '',
    });
  };
  const filler = new FormFiller({ apiKey: 'sk-test', model: 'gpt-test', log, fetchImpl });
  const result = await filler.fill({
    transcript: 'أنا أحمد السالم…',
    lang: 'ar',
    fields: FIELDS,
    known: { note: 'موجودة من قبل', name: 'اسم قديم' },
    country: 'sa',
    today: '2026-10-28',
  });
  assert.equal(result.values.name, 'أحمد السالم'); // the spoken value replaces the known one
  assert.equal(result.values.phone, '0558318777'); // Arabic digits → Saudi local form
  assert.equal(result.values.email, 'ahmed.salem@example.com');
  assert.equal(result.values.space, 'قاعة الاجتماعات'); // snapped to the real option
  assert.equal(result.values.hours, '2');
  assert.equal(result.values.date, '2026-11-03');
  assert.equal(result.values.time, '09:30');
  assert.equal(result.values.interests, 'التقنية، العقار'); // unknown choice dropped
  assert.equal(result.values.note, 'موجودة من قبل'); // silence keeps the known value
  assert.deepEqual(result.missing, []);
  assert.equal(result.followUp, null);
  // The request carries the schema the model must follow and never a stored transcript elsewhere.
  const format = sentBody.response_format as { json_schema: { schema: { properties: { values: { required: string[] } } } } };
  assert.deepEqual(format.json_schema.schema.properties.values.required, FIELDS.map((field) => field.key));
  assert.equal(sentBody.temperature, 0);
});

test('m142: missing required fields come back with a follow-up question', async () => {
  const fetchImpl: typeof fetch = async () => completion({ name: 'سارة', phone: '12', email: 'not-an-email', space: 'مطعم', hours: '', date: '', time: '', interests: '', note: '' });
  const filler = new FormFiller({ apiKey: 'sk-test', model: 'gpt-test', log, fetchImpl });
  const result = await filler.fill({ transcript: 'أنا سارة', lang: 'ar', fields: FIELDS });
  assert.equal(result.values.name, 'سارة');
  assert.equal(result.values.phone, ''); // too short to be a phone
  assert.equal(result.values.email, '');
  assert.equal(result.values.space, ''); // no option matches
  assert.deepEqual(result.missing, ['phone', 'space']);
  assert.match(result.followUp ?? '', /الجوال/);
  assert.match(result.followUp ?? '', /المكان/);

  const en = await new FormFiller({ apiKey: 'sk-test', model: 'gpt-test', log, fetchImpl }).fill({ transcript: 'I am Sara', lang: 'en', fields: FIELDS });
  assert.match(en.followUp ?? '', /I still need/);
});

test('m142: the model question wins when it exists; an API failure throws', async () => {
  const fetchImpl: typeof fetch = async () => completion({ name: '', phone: '+20 100 123 4567', email: '', space: 'مكتب خاص', hours: '', date: '', time: '', interests: '', note: '' }, 'وش اسمك الكريم؟');
  const result = await new FormFiller({ apiKey: 'sk-test', model: 'gpt-test', log, fetchImpl }).fill({ transcript: '…', lang: 'ar', fields: FIELDS, country: 'sa' });
  assert.equal(result.values.phone, '+201001234567'); // a number spoken with its own country code keeps it
  assert.deepEqual(result.missing, ['name']);
  assert.equal(result.followUp, 'وش اسمك الكريم؟');

  const failing: typeof fetch = async () => new Response('nope', { status: 500 });
  await assert.rejects(new FormFiller({ apiKey: 'sk-test', model: 'gpt-test', log, fetchImpl: failing }).fill({ transcript: 'x', lang: 'ar', fields: FIELDS }), /fill_failed:500/);
});

test('m142: helpers', () => {
  assert.equal(asciiDigits('٠٥٠ ١٢٣ ۴۵'), '050 123 45');
  assert.equal(snapOption('الرياض', ['مدينة الرياض', 'جدة']), 'مدينة الرياض');
  assert.equal(snapOption('جده', ['مدينة الرياض', 'جدة']), 'جدة');
  assert.equal(snapOption('الدمام', ['مدينة الرياض', 'جدة']), '');
  assert.equal(snapOption('Tech', ['Technology', 'Real estate']), 'Technology');
});
