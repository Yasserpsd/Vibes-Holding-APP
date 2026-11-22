import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { buildApp, type BuiltApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MOCK_CODE, MockHubClient } from '../hub/mock.js';
import { LogMailer } from '../mail/mailer.js';
import { MemoryKV } from '../store.js';
import { NULL, integer, oid, seq, set, tlv } from '../wallet/pkpass.js';

// M267 «أضف إلى المحفظة»: the signed .pkpass and the «Save to Google Wallet» link. Everything here is throw-away:
// a certificate chain and keys made inside this file — the club's real Pass Type ID key is never read by a test.

const SHA256_RSA = '1.2.840.113549.1.1.11';
const utc = (text: string) => tlv(0x17, Buffer.from(text, 'ascii'));
const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));

/** A minimal X.509 v3 certificate (RSA, SHA-256) for `subject`, signed by `issuerKey`. */
function certificate(subject: string, issuer: string, subjectKey: KeyObject, issuerKey: KeyObject, serial: number): Buffer {
  const tbs = seq(
    tlv(0xa0, integer(2)),
    integer(serial),
    seq(oid(SHA256_RSA), NULL),
    name(issuer),
    seq(utc('250101000000Z'), utc('491231235959Z')),
    name(subject),
    subjectKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = sign('sha256', tbs, issuerKey);
  return seq(tbs, seq(oid(SHA256_RSA), NULL), tlv(0x03, Buffer.from([0]), signature));
}

const root = generateKeyPairSync('rsa', { modulusLength: 2048 });
const leaf = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rootDer = certificate('Test WWDR', 'Test WWDR', root.publicKey, root.privateKey, 1);
const leafDer = certificate('Pass Type ID: pass.test.club', 'Test WWDR', leaf.publicKey, root.privateKey, 0x7f12345678);
const leafPem = leaf.privateKey.export({ type: 'pkcs8', format: 'pem' });

const google = generateKeyPairSync('rsa', { modulusLength: 2048 });
const googlePem = google.privateKey.export({ type: 'pkcs8', format: 'pem' });

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64');
const ISSUER = '3388000000099999999';
const SA_EMAIL = 'wallet-test@example-project.iam.gserviceaccount.com';

const baseEnv = { LOG_LEVEL: 'silent', HUB_MODE: 'mock', NEWS_REFRESH_MINUTES: '0', VIDEOS_REFRESH_MINUTES: '0', NOTIFY_EMAIL: 'admin@vcmem.com' };
const walletEnv = {
  WALLET_APPLE_CERT: b64(leafDer), // a DER file, as downloaded from Apple
  WALLET_APPLE_KEY: b64(leafPem), // a PEM file
  WALLET_APPLE_WWDR: b64(rootDer),
  WALLET_APPLE_PASS_TYPE_ID: 'pass.test.club',
  WALLET_APPLE_TEAM_ID: 'TESTTEAM01',
  WALLET_GOOGLE_ISSUER_ID: ISSUER,
  WALLET_GOOGLE_SA_EMAIL: SA_EMAIL,
  WALLET_GOOGLE_SA_KEY: b64(googlePem),
};

let plain: BuiltApp; // no wallet variables: both routes 404
let wallet: BuiltApp; // both configured
let plainToken = '';
let memberToken = '';
let memberCard = '';
let unpaidToken = '';

const bearer = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});

async function signUp(built: BuiltApp, email: string, phone: string): Promise<{ token: string; card: string }> {
  const registered = await built.app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'عضو المحفظة', country: 'sa', phone, email, password: 'secret123', persona: 'investor', bio: 'حساب اختبار بطاقة المحفظة.' } });
  assert.equal(registered.statusCode, 200, registered.body);
  const verified = await built.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { pendingToken: registered.json().pendingToken, code: MOCK_CODE } });
  assert.equal(verified.statusCode, 200, verified.body);
  return { token: verified.json().token as string, card: verified.json().me.cardNumber as string };
}

before(async () => {
  const build = (env: Record<string, string>) => buildApp({ config: loadConfig({ ...baseEnv, ...env }), kv: new MemoryKV(), hub: new MockHubClient(), mailer: new LogMailer() });
  plain = await build({});
  wallet = await build(walletEnv);
  plainToken = (await signUp(plain, 'wallet.plain+member@gmail.com', '0558619901')).token;
  const member = await signUp(wallet, 'wallet.member+member@gmail.com', '0558619902');
  memberToken = member.token;
  memberCard = member.card;
  // «+member@» makes the mock account an active member; a plain address stays unactivated.
  unpaidToken = (await signUp(wallet, 'wallet.unpaid@gmail.com', '0558619903')).token;
});

after(async () => {
  await plain.app.close();
  await wallet.app.close();
});

/** The entries of a zip written by the server (stored, no compression). */
function readZip(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50, 'end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let cursor = buf.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    assert.equal(buf.readUInt32LE(cursor), 0x02014b50);
    const size = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const local = buf.readUInt32LE(cursor + 42);
    const entryName = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries.set(entryName, buf.subarray(dataStart, dataStart + size));
    cursor += 46 + nameLength;
  }
  return entries;
}

test('without wallet variables the app config hides both buttons and both routes answer 404', async () => {
  const config = (await plain.app.inject({ method: 'GET', url: '/api/auth/config' })).json();
  assert.equal(config.walletApple, false);
  assert.equal(config.walletGoogle, false);
  for (const url of ['/api/me/wallet/apple', '/api/me/wallet/apple/link', '/api/me/wallet/google', `/api/wallet/apple/1.${'a'.repeat(32)}.pkpass`]) {
    const response = await plain.app.inject({ method: 'GET', url, headers: bearer(plainToken) });
    assert.equal(response.statusCode, 404, url);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('with the credentials the config offers both buttons', async () => {
  const config = (await wallet.app.inject({ method: 'GET', url: '/api/auth/config' })).json();
  assert.equal(config.walletApple, true);
  assert.equal(config.walletGoogle, true);
});

test('the wallet routes need a session and an active membership', async () => {
  for (const url of ['/api/me/wallet/apple', '/api/me/wallet/apple/link', '/api/me/wallet/google']) {
    assert.equal((await wallet.app.inject({ method: 'GET', url })).statusCode, 401, url);
    const refused = await wallet.app.inject({ method: 'GET', url, headers: bearer(unpaidToken) });
    assert.equal(refused.statusCode, 403, url);
    assert.equal(refused.json().error.code, 'membership_required');
  }
});

test('the Apple pass: a stored zip with the member, the shared membership number as QR, a manifest and a signature that verifies', async () => {
  const response = await wallet.app.inject({ method: 'GET', url: '/api/me/wallet/apple', headers: bearer(memberToken) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/vnd.apple.pkpass');
  assert.equal(response.headers['cache-control'], 'no-store');
  const files = readZip(response.rawPayload);
  for (const required of ['pass.json', 'icon.png', 'icon@2x.png', 'logo.png', 'manifest.json', 'signature', 'ar.lproj/pass.strings', 'en.lproj/pass.strings']) assert.ok(files.has(required), required);

  const pass = JSON.parse(files.get('pass.json')!.toString('utf8'));
  assert.equal(pass.passTypeIdentifier, 'pass.test.club');
  assert.equal(pass.teamIdentifier, 'TESTTEAM01');
  assert.equal(pass.serialNumber, memberCard);
  assert.equal(pass.barcodes[0].format, 'PKBarcodeFormatQR');
  assert.equal(pass.barcodes[0].message, memberCard, 'the QR carries the same membership number the card shows');
  assert.equal(pass.generic.primaryFields[0].value, 'عضو المحفظة');
  assert.equal(pass.generic.secondaryFields[0].value, memberCard);
  assert.match(files.get('ar.lproj/pass.strings')!.toString('utf8'), /"MEMBERSHIP NO\." = "رقم العضوية";/);

  // The manifest lists the SHA-1 of every other file.
  const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as Record<string, string>;
  for (const [file, data] of files) {
    if (file === 'manifest.json' || file === 'signature') continue;
    assert.equal(manifest[file], createHash('sha1').update(data).digest('hex'), file);
  }
  assert.equal(Object.keys(manifest).length, files.size - 2);

  // The signature: OpenSSL (when this machine has it) verifies the detached CMS over the manifest (signature and digest; the throw-away chain is not a trusted CA, so the chain itself is not judged) and finds both certificates.
  const probe = spawnSync('openssl', ['version']);
  if (probe.status !== 0) return;
  const dir = mkdtempSync(join(tmpdir(), 'pkpass-'));
  try {
    writeFileSync(join(dir, 'manifest.json'), files.get('manifest.json')!);
    writeFileSync(join(dir, 'signature'), files.get('signature')!);
    writeFileSync(join(dir, 'root.pem'), `-----BEGIN CERTIFICATE-----\n${rootDer.toString('base64')}\n-----END CERTIFICATE-----\n`);
    const checked = spawnSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(dir, 'signature'), '-content', join(dir, 'manifest.json'), '-noverify', '-out', join(dir, 'out.bin')]);
    assert.equal(checked.status, 0, `${checked.stderr.toString()} ${checked.stdout.toString()}`);
    const info = spawnSync('openssl', ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', join(dir, 'signature')]).stdout.toString();
    assert.match(info, /sha256/);
    assert.match(info, /Pass Type ID: pass\.test\.club/);
    assert.match(info, /Test WWDR/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the app opens a short-lived address that serves the same pass without a session; a new link replaces the old one', async () => {
  const first = (await wallet.app.inject({ method: 'GET', url: '/api/me/wallet/apple/link', headers: bearer(memberToken) })).json().url as string;
  assert.match(first, /\/api\/wallet\/apple\/\d+\.[A-Za-z0-9_-]+\.pkpass$/);
  const path = new URL(first).pathname;
  const opened = await wallet.app.inject({ method: 'GET', url: path });
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.headers['content-type'], 'application/vnd.apple.pkpass');
  assert.equal(opened.headers['cache-control'], 'no-store');
  assert.ok(readZip(opened.rawPayload).has('pass.json'));

  // A wrong secret and a wrong member are the same 404.
  const flipped = path.replace(/\.([A-Za-z0-9_-]{4})/, (_all, head: string) => `.${head === 'AAAA' ? 'BBBB' : 'AAAA'}`);
  assert.equal((await wallet.app.inject({ method: 'GET', url: flipped })).statusCode, 404);
  assert.equal((await wallet.app.inject({ method: 'GET', url: path.replace(/\/\d+\./, '/999999.') })).statusCode, 404);

  const second = (await wallet.app.inject({ method: 'GET', url: '/api/me/wallet/apple/link', headers: bearer(memberToken) })).json().url as string;
  assert.notEqual(second, first);
  assert.equal((await wallet.app.inject({ method: 'GET', url: path })).statusCode, 404, 'the first link died with the second');
  assert.equal((await wallet.app.inject({ method: 'GET', url: new URL(second).pathname })).statusCode, 200);
});

test('the Google link is a signed «Save to Google Wallet» JWT carrying a Generic pass with the same QR value', async () => {
  const response = await wallet.app.inject({ method: 'GET', url: '/api/me/wallet/google', headers: bearer(memberToken) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const url = response.json().url as string;
  assert.ok(url.startsWith('https://pay.google.com/gp/v/save/'));
  const jwt = url.slice('https://pay.google.com/gp/v/save/'.length);
  const [header, body, signature] = jwt.split('.') as [string, string, string];
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.ok(verify('sha256', Buffer.from(`${header}.${body}`), google.publicKey, Buffer.from(signature, 'base64url')), 'RS256 signature');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(claims.iss, SA_EMAIL);
  assert.equal(claims.aud, 'google');
  assert.equal(claims.typ, 'savetowallet');
  const object = claims.payload.genericObjects[0];
  assert.ok(object.id.startsWith(`${ISSUER}.`));
  assert.equal(object.classId, claims.payload.genericClasses[0].id);
  assert.equal(object.barcode.value, memberCard);
  assert.equal(object.header.defaultValue.value, 'عضو المحفظة');
  assert.match(object.logo.sourceUri.uri, /\/wallet\/emblem\.png$/);
  assert.ok(url.length < 4000, 'a link short enough for a browser');
});

test('the emblem Google fetches for the pass logo is public', async () => {
  const response = await wallet.app.inject({ method: 'GET', url: '/wallet/emblem.png' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
});
