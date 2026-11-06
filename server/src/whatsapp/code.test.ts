import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryKV } from '../store.js';
import { WhatsappClient } from './client.js';
import { sendSchema } from './routes.js';
import { WHATSAPP_LOG_KEY, WhatsappService } from './service.js';

// Owner (2026-11-06): the sign-up and password codes go on WhatsApp too. Meta needs the code in the body AND in the copy button.
const CODE = '73915048';

function build(status = 'APPROVED') {
  const sent: { template: { name: string; language: { code: string }; components: { type: string; sub_type?: string; index?: string; parameters: { text: string }[] }[] } }[] = [];
  const logs: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('message_templates')) {
      return new Response(JSON.stringify({ data: [{ name: 'club_login_code', language: 'ar', status, category: 'AUTHENTICATION', components: [{ type: 'BODY', text: '{{1}}' }] }] }), { status: 200 });
    }
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 });
  }) as typeof fetch;
  const log = { info: (...args: unknown[]) => logs.push(JSON.stringify(args)), warn: (...args: unknown[]) => logs.push(JSON.stringify(args)), error: (...args: unknown[]) => logs.push(JSON.stringify(args)) };
  const kv = new MemoryKV();
  const client = new WhatsappClient({ token: 'test-token-value-000000', phoneId: '111', wabaId: '222', fetchImpl });
  return { service: new WhatsappService({ kv, log: log as never, client, enabled: true }), sent, logs, kv };
}

test('the code travels in the body and the copy button, and is kept nowhere', async () => {
  const { service, sent, logs, kv } = build();
  const result = await service.sendCode({ phone: '0551234567', lang: 'ar', code: CODE });
  assert.equal(result.channel, 'whatsapp');
  const parts = sent[0]?.template.components ?? [];
  assert.equal(sent[0]?.template.name, 'club_login_code');
  assert.equal(parts[0]?.parameters[0]?.text, CODE);
  assert.deepEqual([parts[1]?.type, parts[1]?.sub_type, parts[1]?.index, parts[1]?.parameters[0]?.text], ['button', 'url', '0', CODE]);
  assert.equal(JSON.stringify(await kv.get(WHATSAPP_LOG_KEY)).includes(CODE), false);
  assert.equal(logs.join().includes(CODE), false);
});

test('a number gets three codes an hour', async () => {
  const { service, sent } = build();
  for (let i = 0; i < 3; i += 1) assert.equal((await service.sendCode({ phone: '0551234567', code: CODE })).channel, 'whatsapp');
  const fourth = await service.sendCode({ phone: '0551234567', code: CODE });
  assert.deepEqual([fourth.channel, fourth.error, sent.length], ['none', 'rate_limited', 3]);
  assert.equal((await service.sendCode({ phone: '0557654321', code: CODE })).channel, 'whatsapp');
});

test('an unapproved template sends nothing', async () => {
  const { service, sent } = build('PENDING');
  assert.deepEqual([(await service.sendCode({ phone: '0551234567', code: CODE })).error, sent.length], ['template_not_approved', 0]);
});

test('the hub body must carry digits', () => {
  assert.equal(sendSchema.safeParse({ kind: 'code', phone: '0551234567' }).success, false);
  assert.equal(sendSchema.safeParse({ kind: 'code', phone: '0551234567', code: 'abcd' }).success, false);
  assert.equal(sendSchema.safeParse({ kind: 'code', phone: '0551234567', code: CODE }).success, true);
});
