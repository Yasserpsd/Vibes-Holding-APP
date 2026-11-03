import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE } from './hub/mock.js';
import { LogMailer } from './mail/mailer.js';
import { MemoryKV } from './store.js';

// M193 (owner, 2026-11-03): the Success Partners pitch deck is an uploaded file, not a link.
const PUBLIC_URL = 'http://localhost:3000';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let built: BuiltApp;
let app: BuiltApp['app'];
let uploadsDir = '';
let token = '';
let adminToken = '';

const bearer = (value?: string) => (value ? { authorization: `Bearer ${value}` } : {});
const post = (url: string, payload: Record<string, unknown>, value?: string) => app.inject({ method: 'POST', url, payload, headers: bearer(value) });

const ANSWERS = {
  firstName: 'سالم',
  lastName: 'العتيبي',
  country: 'السعودية',
  city: 'الرياض',
  whatsapp: '+966500000001',
  email: 'salem@example.com',
  company: 'شركة تجربة',
  stage: 'بدأت بتحقيق دخل',
  sector: 'التجارة والتجزئة',
  summary: 'منصة تجارة متخصصة تبحث عن شركاء.',
  ownership: '1',
  nda: '1',
};

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', { name: 'سالم العتيبي', country: 'sa', phone, email, password: 'secret123', persona: 'entrepreneur', bio: 'حساب اختبار رفع ملف شركاء النجاح.' });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200, verified.body);
  return verified.json().token as string;
}

before(async () => {
  uploadsDir = await mkdtemp(join(tmpdir(), 'm193-uploads-'));
  const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', PUBLIC_URL, UPLOADS_DIR: uploadsDir, NOTIFY_EMAIL: 'admin@vcmem.com' });
  built = await buildApp({ config, kv: new MemoryKV(), mailer: new LogMailer() });
  app = built.app;
  token = await signUp('m193.member@gmail.com', '0558619301');
  adminToken = await signUp('m193.admin@gmail.com', '0558619302');
});

after(async () => {
  await app.close();
  await rm(uploadsDir, { recursive: true, force: true });
});

test('the form offers a file field instead of the link and the yes/no question', async () => {
  const form = (await app.inject({ method: 'GET', url: '/api/forms/success-partners' })).json().form as { fields: { key: string; type: string }[] };
  const keys = form.fields.map((field) => field.key);
  assert.ok(!keys.includes('deckLink') && !keys.includes('deck'));
  assert.equal(form.fields.find((field) => field.key === 'deckFile')?.type, 'file');
});

test('upload needs a session, a supported type and a sane size', async () => {
  assert.equal((await post('/api/forms/success-partners/upload', { filename: 'd.pdf', contentType: 'application/pdf', size: 100 })).statusCode, 401);
  assert.equal((await post('/api/forms/success-partners/upload', { filename: 'd.exe', contentType: 'application/x-msdownload', size: 100 }, token)).statusCode, 400);
  assert.equal((await post('/api/forms/success-partners/upload', { filename: 'd.pdf', contentType: 'application/pdf', size: 26 * 1024 * 1024 }, token)).statusCode, 400);
  assert.equal((await post('/api/forms/workshop/upload', { filename: 'd.pdf', contentType: 'application/pdf', size: 100 }, token)).statusCode, 404);
});

test('a deck is uploaded, attached to the submission and reachable by the management link only', async () => {
  const ticket = await post('/api/forms/success-partners/upload', { filename: 'deck.pdf', contentType: 'application/pdf', size: PDF.length }, token);
  assert.equal(ticket.statusCode, 201, ticket.body);
  const { url, upload } = ticket.json() as { url: string; upload: { method: string; url: string; headers: Record<string, string> } };
  assert.match(url, /^http:\/\/localhost:3000\/forms\/files\/forms\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);

  // A link that never received its bytes is refused.
  const early = await post('/api/forms/success-partners', { answers: { ...ANSWERS, deckFile: url } }, token);
  assert.equal(early.statusCode, 400, early.body);

  const put = await app.inject({ method: 'PUT', url: upload.url.slice(PUBLIC_URL.length), headers: upload.headers, payload: PDF });
  assert.equal(put.statusCode, 204, put.body);

  // Any other link is refused; ours goes through.
  assert.equal((await post('/api/forms/success-partners', { answers: { ...ANSWERS, deckFile: 'https://example.com/deck.pdf' } }, token)).statusCode, 400);
  const sent = await post('/api/forms/success-partners', { answers: { ...ANSWERS, deckFile: url } }, token);
  assert.equal(sent.statusCode, 201, sent.body);

  const listed = await app.inject({ method: 'GET', url: '/api/admin/forms', headers: bearer(adminToken) });
  const row = (listed.json().submissions as { answers: { key: string; value: string }[] }[])[0];
  assert.equal(row?.answers.find((answer) => answer.key === 'deckFile')?.value, url);

  const file = await app.inject({ method: 'GET', url: url.slice(PUBLIC_URL.length) });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.equal(file.headers['cache-control'], 'no-store');
  assert.deepEqual(file.rawPayload, PDF);
  // Never through the public media route.
  assert.equal((await app.inject({ method: 'GET', url: `/media/${url.split('/forms/files/')[1]}` })).statusCode, 404);
});

test('the form still goes through without any file', async () => {
  const sent = await post('/api/forms/success-partners', { answers: ANSWERS }, token);
  assert.equal(sent.statusCode, 201, sent.body);
});
