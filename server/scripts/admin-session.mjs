// Shared admin session for probe scripts (owner, 2026-10-25: sign in ONCE, reuse the token).
// The token lives in server/.env.admin.session.local (git-ignored via .env.*); a 401 refreshes it.
import { createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://vibes-holding-app-production.up.railway.app';
/** The production server (same hub account signs in on both). */
const API_PROD = 'https://club-api-prod-production.up.railway.app';
const ENV_FILE = new URL('../.env.admin.local', import.meta.url);
const tokenFile = (api) => new URL(api === API_PROD ? '../.env.admin.session.prod.local' : '../.env.admin.session.local', import.meta.url);

async function creds() {
  const text = await readFile(ENV_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim().replace(/^﻿/, ''));
    if (m) out[m[1]] = m[2].trim();
  }
  if (!out.ADMIN_LOGIN || !out.ADMIN_PASSWORD) throw new Error('ADMIN_LOGIN / ADMIN_PASSWORD missing in .env.admin.local');
  return out;
}

async function raw(path, options = {}, token, api = API) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(25000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function login(api = API) {
  const c = await creds();
  let { response, body } = await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: c.ADMIN_LOGIN, password: c.ADMIN_PASSWORD }) }, undefined, api);
  // M140: the account has an authenticator app — answer its step from ADMIN_TOTP_SECRET (the base32 key shown at enrolment).
  if (response.ok && body?.totp) {
    if (!c.ADMIN_TOTP_SECRET) throw new Error('the account asks for an authenticator code: add ADMIN_TOTP_SECRET to .env.admin.local');
    ({ response, body } = await raw('/api/auth/totp', { method: 'POST', body: JSON.stringify({ stepToken: body.stepToken, code: totpCode(c.ADMIN_TOTP_SECRET) }) }, undefined, api));
  }
  if (!response.ok || !body?.token) throw new Error(`login failed: ${response.status}`);
  await writeFile(tokenFile(api), `${body.token}\n`, 'utf8');
  return body.token;
}

/** RFC 6238, the same arithmetic as server/src/auth/totp.ts (30-second steps, 6 digits, SHA-1). */
function totpCode(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

async function savedToken(api = API) {
  try { return (await readFile(tokenFile(api), 'utf8')).trim() || null; } catch { return null; }
}

/** GET/POST against a live server (TEST by default, pass API_PROD for prod) with the cached admin session; re-logs in once on a 401. */
export async function adminCall(path, options = {}, api = API) {
  let token = (await savedToken(api)) ?? (await login(api));
  let { response, body } = await raw(path, options, token, api);
  if (response.status === 401) {
    token = await login(api);
    ({ response, body } = await raw(path, options, token, api));
  }
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body?.error ?? '')}`);
  return body;
}

export { API, API_PROD };

// ---- Dashboard session (M18 e-mail code). `adminCall` against /api/admin/* needs a session that
// started with the mailed code: run `node server/scripts/admin-session.mjs dashboard [prod]` (the
// code goes to the admin mailbox), then `node server/scripts/admin-session.mjs dashboard [prod] <code>`.
const challengeFile = (api) => new URL(api === API_PROD ? '../.env.admin.challenge.prod.local' : '../.env.admin.challenge.local', import.meta.url);

/** Step 1 (no code): asks the dashboard for the code and keeps the challenge. Step 2 (code): verifies it and caches the dashboard token. */
export async function dashboardLogin(api = API, code = null, authCode = null) {
  if (!code) {
    const c = await creds();
    const { response, body } = await raw('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ login: c.ADMIN_LOGIN, password: c.ADMIN_PASSWORD }) }, undefined, api);
    if (!response.ok) throw new Error(`dashboard login failed: ${response.status} ${JSON.stringify(body?.error ?? '')}`);
    if (body?.token) {
      await writeFile(tokenFile(api), `${body.token}` + '\n', 'utf8');
      return { done: true };
    }
    if (!body?.otp || !body.challengeToken) throw new Error(`unexpected dashboard login answer: ${JSON.stringify(Object.keys(body ?? {}))}`);
    await writeFile(challengeFile(api), `${body.challengeToken}` + '\n', 'utf8');
    return { done: false, email: body.email, seconds: body.seconds };
  }
  // Step 2: the mailed code; the account's authenticator (M140) answers from ADMIN_TOTP_SECRET when the
  // file has it, else from `authCode` (the owner reads his app) — or the step is kept for `dashboard prod totp <code>`.
  if (code === 'totp') return finishTotp(api, authCode);
  if (code === 'enrol') return finishEnrol(api, authCode);
  const challengeToken = (await readFile(challengeFile(api), 'utf8')).trim();
  const { response, body } = await raw('/api/admin/auth/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code: String(code) }) }, undefined, api);
  if (response.ok && body?.totp) {
    await writeFile(stepFile(api), `${body.stepToken}` + '\n', 'utf8');
    const c = await creds();
    if (c.ADMIN_TOTP_SECRET) return finishTotp(api, totpCode(c.ADMIN_TOTP_SECRET));
    if (authCode) return finishTotp(api, authCode);
    return { done: false, totp: true, seconds: body.seconds };
  }
  if (response.ok && body?.totpSetup) {
    // The account has no authenticator on THIS server yet: enrolment is the owner's. Keep the secret (git-ignored env file,
    // never printed), show the QR in his own terminal, and finish with `dashboard enrol <first code>`.
    await writeFile(setupFile(api), `${body.setupToken}` + '\n', 'utf8');
    const envText = await readFile(ENV_FILE, 'utf8');
    await writeFile(ENV_FILE, `${envText.replace(/\r?\n?ADMIN_TOTP_SECRET=.*/g, '').trimEnd()}\nADMIN_TOTP_SECRET=${body.secret}\n`, 'utf8');
    const { default: QRCode } = await import('qrcode');
    console.log(await QRCode.toString(body.uri, { type: 'terminal', small: true }));
    return { done: false, enrol: true, seconds: body.seconds };
  }
  if (!response.ok || !body?.token) throw new Error(`dashboard verify failed: ${response.status} ${JSON.stringify(body?.error ?? Object.keys(body ?? {}))}`);
  await writeFile(tokenFile(api), `${body.token}` + '\n', 'utf8');
  return { done: true };
}

const stepFile = (api) => new URL(api === API_PROD ? '../.env.admin.step.prod.local' : '../.env.admin.step.local', import.meta.url);

const setupFile = (api) => new URL(api === API_PROD ? '../.env.admin.setup.prod.local' : '../.env.admin.setup.local', import.meta.url);

/** Completes the enrolment with the first authenticator code; the one-time backup codes print in the owner's terminal only. */
async function finishEnrol(api, authCode) {
  if (!authCode) throw new Error('rerun with `dashboard test enrol <6-digit code from your authenticator>`');
  const setupToken = (await readFile(setupFile(api), 'utf8')).trim();
  const { response, body } = await raw('/api/admin/auth/totp/enroll', { method: 'POST', body: JSON.stringify({ setupToken, code: String(authCode) }) }, undefined, api);
  if (!response.ok || !body?.token) throw new Error(`enrolment failed: ${response.status} ${JSON.stringify(body?.error ?? Object.keys(body ?? {}))}`);
  await writeFile(tokenFile(api), `${body.token}` + '\n', 'utf8');
  console.log('BACKUP CODES (shown once, keep them):', (body.backupCodes ?? []).join('  '));
  return { done: true };
}

async function finishTotp(api, authCode) {
  if (!authCode) throw new Error('the dashboard asks for the authenticator code: rerun with `dashboard prod totp <code>`');
  const stepToken = (await readFile(stepFile(api), 'utf8')).trim();
  const { response, body } = await raw('/api/admin/auth/totp/verify', { method: 'POST', body: JSON.stringify({ stepToken, code: String(authCode) }) }, undefined, api);
  if (!response.ok || !body?.token) throw new Error(`authenticator step failed: ${response.status} ${JSON.stringify(body?.error ?? '')}`);
  await writeFile(tokenFile(api), `${body.token}` + '\n', 'utf8');
  return { done: true };
}

if ((process.argv[1] ?? "").endsWith("admin-session.mjs") && process.argv[2] === "dashboard") {
  const args = process.argv.slice(3);
  const api = args[0] === 'prod' ? API_PROD : API;
  if (args[0] === 'prod' || args[0] === 'test') args.shift();
  const code = args[0] && (args[0] === 'totp' || args[0] === 'enrol' || /^[0-9]+$/.test(args[0])) ? args[0] : null;
  const authCode = args[1] && /^[0-9]+$/.test(args[1]) ? args[1] : null;
  const result = await dashboardLogin(api, code, authCode);
  console.log(result.done ? `dashboard session cached for ${api}` : result.enrol ? `scan the QR above with your authenticator app, then run: node scripts/admin-session.mjs dashboard enrol <code from the app> (within ${result.seconds}s)` : result.totp ? `mailed code accepted; the authenticator code is next (${result.seconds}s): dashboard prod totp <code>` : `code mailed to ${result.email} (valid ${result.seconds}s); rerun with the code`);
}

// One-process sign-in for the owner's terminal: `node scripts/admin-session.mjs dashboard-ask [prod]` mails the code, asks for it
// on the same screen, then (when the account has no authenticator on that server yet) shows the QR and asks for its first code.
if ((process.argv[1] ?? '').endsWith('admin-session.mjs') && process.argv[2] === 'dashboard-ask') {
  const { createInterface } = await import('node:readline/promises');
  const api = process.argv[3] === 'prod' ? API_PROD : API;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const first = await dashboardLogin(api);
  if (first.done) console.log(`dashboard session cached for ${api}`);
  else {
    console.log(`code mailed to ${first.email} (valid ${first.seconds}s)`);
    const mailed = (await rl.question('Mailed code: ')).trim();
    const second = await dashboardLogin(api, mailed);
    if (second.done) console.log(`dashboard session cached for ${api}`);
    else if (second.enrol) {
      const app = (await rl.question('Authenticator code (6 digits from the app, after scanning the QR): ')).trim();
      await dashboardLogin(api, 'enrol', app);
      console.log(`dashboard session cached for ${api}`);
    } else if (second.totp) {
      const app = (await rl.question('Authenticator code: ')).trim();
      await dashboardLogin(api, 'totp', app);
      console.log(`dashboard session cached for ${api}`);
    }
  }
  rl.close();
}
