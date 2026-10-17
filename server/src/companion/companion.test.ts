import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MockHubClient } from '../hub/mock.js';
import { LogMailer } from '../mail/mailer.js';
import { MemoryKV } from '../store.js';

/** M87: the advisor's daily persona push — template drafts over live data, one wave a day, inside the send hour. */

const config = loadConfig({ LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' });

let built: BuiltApp;
const pushes: { persona: string; title: string; body: string; data: Record<string, unknown> }[] = [];

// 2026-10-18 08:30 UTC = 11:30 Riyadh — inside the send hour.
const IN_HOUR = Date.parse('2026-10-18T08:30:00Z');
const OUT_OF_HOUR = Date.parse('2026-10-18T18:30:00Z');

before(async () => {
  built = await buildApp({ config, kv: new MemoryKV(), hub: new MockHubClient(), mailer: new LogMailer() });
  built.push.broadcastPersona = async (persona, message) => {
    pushes.push({ persona, title: message.title, body: message.body, data: message.data ?? {} });
    return { sent: 1, failed: 0, dropped: 0 };
  };
});

after(async () => {
  await built.app.close();
});

test('drafts speak to each persona from live data and never use banned wording', async () => {
  const drafts = await built.companion.drafts(IN_HOUR);
  for (const draft of Object.values(drafts)) {
    assert.ok(draft.title.length > 3 && draft.body.length > 20);
    assert.ok(!/مجان/u.test(`${draft.title} ${draft.body}`), 'بدون رسوم، أبدًا «مجاني»');
  }
  // The three personas get three DIFFERENT messages.
  assert.equal(new Set(Object.values(drafts).map((draft) => draft.body)).size, 3);
});

test('the daily wave fires once inside the send hour, taps open the advisor, and the next day fires again', async () => {
  assert.equal(await built.companion.tick(OUT_OF_HOUR), false, 'outside the hour nothing goes out');
  assert.equal(await built.companion.tick(IN_HOUR), true);
  assert.equal(pushes.length, 3);
  assert.deepEqual(new Set(pushes.map((entry) => entry.persona)), new Set(['investor', 'entrepreneur', 'neutral']));
  assert.ok(pushes.every((entry) => entry.data.screen === '/advisor'));

  // The same day never double-sends, whatever the tick cadence.
  assert.equal(await built.companion.tick(IN_HOUR + 20 * 60_000), false);
  assert.equal(pushes.length, 3);

  // Tomorrow's hour sends tomorrow's wave (the rotation moves).
  assert.equal(await built.companion.tick(IN_HOUR + 24 * 3_600_000), true);
  assert.equal(pushes.length, 6);
});
