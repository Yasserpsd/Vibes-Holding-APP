import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import { MemoryKV } from './store.js';

// M151 «المستشار يقرأ ملفك»: a PDF goes with the message to the hub (data URL + name), never stays on this
// server, and comes back on the thread as `file {url, name, size}` with the «📎 name» line the hub stores.

const kv = new MemoryKV();
const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock' });
let app: Awaited<ReturnType<typeof buildApp>>['app'];

const post = async (url: string, payload: Record<string, unknown>, token?: string) =>
  app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = async (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function signUp(email: string, phone: string): Promise<string> {
  const registered = await post('/api/auth/register', {
    name: 'سالم التجريبي',
    country: 'sa',
    phone,
    email,
    password: 'secret123',
    persona: 'entrepreneur',
    bio: 'رائد أعمال يبحث عن شريك في مشروع تقني.',
  });
  assert.equal(registered.statusCode, 200);
  const verified = await post('/api/auth/verify', { pendingToken: registered.json().pendingToken, code: MOCK_CODE });
  assert.equal(verified.statusCode, 200);
  return verified.json().token as string;
}

/** The smallest PDF that still starts with the magic bytes and has a body (the route checks both). */
const PDF = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n${'%'.repeat(120)}\n`, 'latin1');

before(async () => {
  const built = await buildApp({ config, kv, hub: new MockHubClient({ replyDelayMs: 20 }) });
  app = built.app;
  await app.ready();
});

after(async () => {
  await app.close();
});

test('m151: the file route needs a session and a real PDF', async () => {
  assert.equal((await post('/api/advisor/file', { file: PDF.toString('base64'), name: 'x.pdf' })).statusCode, 401);
  const token = await signUp('fahd+file@gmail.com', '0558318790');
  const notPdf = await post('/api/advisor/file', { file: Buffer.from('hello world, this is not a pdf at all '.repeat(5)).toString('base64'), name: 'notes.pdf' }, token);
  assert.equal(notPdf.statusCode, 400);
  assert.equal(notPdf.json().error.code, 'bad_file');
  const tooBig = await post('/api/advisor/file', { file: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]).toString('base64'), name: 'big.pdf' }, token);
  assert.equal(tooBig.statusCode, 413);
  const garbage = await post('/api/advisor/file', { file: '%%%not-base64%%%'.repeat(10), name: 'x.pdf' }, token);
  assert.equal(garbage.statusCode, 400);
});

test('m151: a PDF with no line reaches the hub and shows on the thread as a file bubble', async () => {
  const token = await signUp('noura+file@gmail.com', '0558318791');
  const sent = await post('/api/advisor/file', { file: PDF.toString('base64'), name: 'دراسة الجدوى: مشروع/2026.pdf', text: '', context: { type: 'portal', id: 'entrepreneur' } }, token);
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.headers['cache-control'], 'no-store');
  const body = sent.json();
  assert.ok(typeof body.messageId === 'number');
  assert.equal(body.waiting, true);
  assert.equal(body.gate, null);

  const history = (await get('/api/advisor/history', token)).json();
  const mine = history.messages.find((message: { id: number }) => message.id === body.messageId);
  assert.ok(mine, 'the file message is on the thread');
  assert.equal(mine.role, 'user');
  // The name is cleaned of path characters; the hub stored «📎 name» as the line.
  assert.equal(mine.file.name, 'دراسة الجدوى مشروع 2026.pdf');
  assert.equal(mine.text, `📎 ${mine.file.name}`);
  assert.match(mine.file.url, /^https:\/\/.+\/wp-content\/uploads\/vai-file-[a-z0-9]+\.pdf$/);
  assert.equal(mine.file.size, PDF.length);
  // A text message carries no file.
  const plain = (await post('/api/advisor/message', { text: 'وبعدين؟' }, token)).json();
  const again = (await get('/api/advisor/history', token)).json();
  assert.equal(again.messages.find((message: { id: number }) => message.id === plain.messageId).file, null);
});

test('m151: a line may travel with the file and is kept as written', async () => {
  const token = await signUp('salem+file@gmail.com', '0558318792');
  const sent = await post('/api/advisor/file', { file: PDF.toString('base64'), name: 'deck', text: 'وين المشكلة في الأرقام؟' }, token);
  assert.equal(sent.statusCode, 200, sent.body);
  const history = (await get('/api/advisor/history', token)).json();
  const mine = history.messages.find((message: { id: number }) => message.id === sent.json().messageId);
  assert.equal(mine.text, 'وين المشكلة في الأرقام؟');
  assert.equal(mine.file.name, 'deck.pdf');
});
