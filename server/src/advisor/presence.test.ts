import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FastifyBaseLogger } from 'fastify';

import type { AuthService } from '../auth/service.js';
import type { SessionRecord } from '../auth/sessions.js';
import type { ProjectAccessService } from '../projectsBank/access.js';
import type { RequestsService } from '../requests/service.js';
import { DECK_RE, MemberPresence, PRESENCE_HEADER, fetchDeck } from './presence.js';

const log = { warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
const session = { uuid: 'u-1' } as SessionRecord;
const me = { id: 7, name: 'عضو تجريبي' };

const authOf = (found: boolean): AuthService => ({ me: async () => (found ? me : Promise.reject(new Error('session_expired'))) }) as unknown as AuthService;

const timelineRow = (kind: string, title: string) => ({ kind, title, status: 'pending', createdAt: '2026-11-01T10:00:00.000Z' });
const requestsOf = (rows: unknown[]): RequestsService => ({ timeline: async () => rows }) as unknown as RequestsService;
const accessOf = (answer: unknown): ProjectAccessService =>
  ({ access: async () => answer, wallet: async () => answer }) as unknown as ProjectAccessService;

test('presence: a guest gets no block', async () => {
  const presence = new MemberPresence({ auth: authOf(false), log });
  const result = await presence.of(session, null, 'مرحبا');
  assert.equal(result.block, '');
  assert.equal(result.deckUrl, null);
});

test('presence: the member block carries his latest operations', async () => {
  const presence = new MemberPresence({
    auth: authOf(true),
    requests: requestsOf([timelineRow('hq', 'زيارة المقر'), timelineRow('workshop', 'ورشة التقييم')]),
    log,
  });
  const result = await presence.of(session, null, 'كمل');
  assert.ok(result.block.startsWith(PRESENCE_HEADER));
  assert.match(result.block, /حجز في مقر النادي: «زيارة المقر» — قيد المراجعة \(2026-11-01\)/);
  assert.match(result.block, /التسجيل في ورشة/);
});

test('presence: a project he can unlock explains the deduction with his balance', async () => {
  const presence = new MemberPresence({
    auth: authOf(true),
    access: accessOf({ state: 'can_unlock', isMember: true, balance: { credits: 2500, granted: 5, used: 2, left: 3 }, contact: null, message: null }),
    log,
  });
  const result = await presence.of(session, { type: 'project', id: 12 }, 'ايش رايك فيه؟');
  assert.match(result.block, /لم يفتح هذا المشروع بعد \(رصيده: المتبقي 3 من 5\)/);
  assert.match(result.block, /يخصم من رصيده فور الضغط/);
  assert.equal(result.deckUrl, null);
});

test('presence: an unlocked project hands the deck only when he asks for it', async () => {
  const unlocked = { state: 'unlocked', isMember: true, balance: { credits: 2500, granted: 5, used: 2, left: 3 }, contact: { whatsapp: '9665', email: 'f@x.co', website: '', pitchUrl: 'https://pb.example/deck.pdf' }, message: null };
  const presence = new MemberPresence({ auth: authOf(true), access: accessOf(unlocked), log });
  const plain = await presence.of(session, { type: 'project', id: 12 }, 'لخص لي المشروع');
  assert.match(plain.block, /فتح هذا المشروع بالفعل/);
  assert.equal(plain.deckUrl, null);
  const asking = await presence.of(session, { type: 'project', id: 12 }, 'حلل لي العرض التقديمي');
  assert.equal(asking.deckUrl, 'https://pb.example/deck.pdf');
  assert.equal(asking.deckName, 'pitch-deck-12.pdf');
});

test('presence: the projects screen carries his wallet, and a failing source costs its line only', async () => {
  const wallet = { isMember: true, balance: { credits: 2500, granted: 5, used: 1, left: 4 }, unlockedCount: 1 };
  const presence = new MemberPresence({
    auth: authOf(true),
    requests: { timeline: async () => Promise.reject(new Error('down')) } as unknown as RequestsService,
    access: accessOf(wallet),
    log,
  });
  const result = await presence.of(session, { type: 'screen', id: 'projects' }, 'كم رصيدي؟');
  assert.match(result.block, /رصيده في بنك المشاريع: المتبقي 4 من 5/);
  assert.match(result.block, /مشروعًا/);
});

test('deck regex: deck words match, plain analysis does not', () => {
  assert.ok(DECK_RE.test('حلل لي الـ Pitch Deck'));
  assert.ok(DECK_RE.test('ايش رايك في العرض التقديمي؟'));
  assert.ok(!DECK_RE.test('حلل لي المشروع ده'));
});

test('fetchDeck: accepts a real PDF and refuses anything else', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-', 'latin1'), Buffer.from('1.7 fake body')]);
  const fetchPdf = (async () => new Response(pdf, { status: 200 })) as typeof fetch;
  const got = await fetchDeck('https://pb.example/deck.pdf', 'deck.pdf', fetchPdf, log);
  assert.equal(got?.name, 'deck.pdf');
  assert.equal(Buffer.from(got!.base64, 'base64').subarray(0, 5).toString('latin1'), '%PDF-');
  const fetchHtml = (async () => new Response('<html>no</html>', { status: 200 })) as typeof fetch;
  assert.equal(await fetchDeck('https://pb.example/deck.pdf', 'deck.pdf', fetchHtml, log), null);
  const fetch404 = (async () => new Response('x', { status: 404 })) as typeof fetch;
  assert.equal(await fetchDeck('https://pb.example/deck.pdf', 'deck.pdf', fetch404, log), null);
});
