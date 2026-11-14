import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import { appVersionRoutes, installAppVersionGate } from './appVersion.js';
import type { AuthService } from './auth/service.js';
import { loadConfig } from './config.js';
import { MemoryKV } from './store.js';

// M200 (owner, 2026-11-05): with the gate off no app version is ever answered 426 and the status never asks
// for an update, whatever floor the dashboard or the environment holds. M239: unset, the variable leaves the
// choice to the environment (on for the production app, off on the test server); '0' is still the off switch.
test('the forced-update gate can be switched off: old and unversioned bundles pass, the status never asks', async () => {
  assert.equal(loadConfig({ HUB_MODE: 'mock' }).APP_VERSION_GATE, undefined);
  assert.equal(loadConfig({ HUB_MODE: 'mock', APP_VERSION_GATE: '0' }).APP_VERSION_GATE, '0');

  const kv = new MemoryKV();
  await kv.set('app:minVersion', { minVersion: '9.9.9' });
  await kv.set('app:floorOverride', { minVersion: '9.9.9' });
  const options = { kv, enabled: false };
  const app = Fastify();
  installAppVersionGate(app, options);
  await app.register(appVersionRoutes, { ...options, auth: {} as AuthService });
  app.get('/api/ping', async () => ({ ok: true }));

  const old = await app.inject({ method: 'GET', url: '/api/ping', headers: { 'x-app-platform': 'ios', 'x-app-version': '1.0.0', 'x-app-binary': '1.0.0' } });
  assert.equal(old.statusCode, 200, old.body);
  const unversioned = await app.inject({ method: 'GET', url: '/api/ping', headers: { 'x-app-platform': 'ios' } });
  assert.equal(unversioned.statusCode, 200, unversioned.body);
  const status = await app.inject({ method: 'GET', url: '/api/app/status?version=1.0.0', headers: { 'x-app-platform': 'ios' } });
  assert.equal(status.json().updateRequired, false);
  await app.close();
});
