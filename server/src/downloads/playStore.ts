import { createPrivateKey, sign } from 'node:crypto';

/**
 * M158: Google Play installs. The Play Developer Reporting API exposes quality metrics only (crashes, ANRs,
 * slow starts) — install statistics live in the Play Console's Cloud Storage exports, readable by the same
 * service account: Play Console → Download reports → Statistics → «Copy Cloud Storage URI» gives the bucket
 * (`pubsite_prod_rev_…`). The owner grants the service account «View app information and download bulk
 * reports» under Users and permissions and sets PLAY_REPORTING_SERVICE_ACCOUNT (the key JSON),
 * PLAY_STATS_BUCKET and PLAY_PACKAGE_NAME on Railway. Without them `configured` is false.
 */
export type PlayStoreConfig = { serviceAccountJson: string; bucket: string; packageName: string };
type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';
const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

export function parseServiceAccount(json: string): ServiceAccount {
  const parsed = JSON.parse(json) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) throw new Error('PLAY_REPORTING_SERVICE_ACCOUNT lacks client_email or private_key');
  return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri };
}

/** The RS256 assertion a service account trades for an access token at Google's token endpoint. */
export function playAssertion(account: ServiceAccount, now = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const iat = Math.floor(now / 1000);
  const aud = account.token_uri ?? 'https://oauth2.googleapis.com/token';
  const payload = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }));
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), createPrivateKey(account.private_key.replace(/\\n/g, '\n')));
  return `${header}.${payload}.${b64url(signature)}`;
}

export type PlayDay = { day: string; installs: number; total: number | null };

/** The monthly `installs_<package>_YYYYMM_overview.csv` export (UTF-16LE) as one row per day. */
export function parseInstallsCsv(csv: string): PlayDay[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(',').map((cell) => cell.trim().toLowerCase());
  const dayAt = header.indexOf('date');
  const dailyAt = header.indexOf('daily user installs');
  const totalAt = header.indexOf('total user installs');
  if (dayAt < 0 || dailyAt < 0) return [];
  const rows: PlayDay[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const day = (cells[dayAt] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const installs = Number((cells[dailyAt] ?? '').trim());
    const total = totalAt >= 0 ? Number((cells[totalAt] ?? '').trim()) : NaN;
    rows.push({ day, installs: Number.isFinite(installs) ? installs : 0, total: Number.isFinite(total) ? total : null });
  }
  return rows;
}

export class PlayStoreClient {
  private readonly account: ServiceAccount;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: PlayStoreConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.account = parseServiceAccount(config.serviceAccountJson);
  }

  private async accessToken(now = Date.now()): Promise<string> {
    if (this.token && this.token.expiresAt > now + 60_000) return this.token.value;
    const response = await this.fetchImpl(this.account.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: playAssertion(this.account, now) }).toString(),
    });
    if (!response.ok) throw new Error(`Google token endpoint answered ${response.status}`);
    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('Google token endpoint returned no access_token');
    this.token = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  /** The overview export of one month (YYYYMM); `null` when the Play Console has not written it yet (404). */
  async month(yyyymm: string): Promise<PlayDay[] | null> {
    const object = encodeURIComponent(`stats/installs/installs_${this.config.packageName}_${yyyymm}_overview.csv`);
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.config.bucket)}/o/${object}?alt=media`;
    const response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${await this.accessToken()}` } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cloud Storage answered ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const utf16 = bytes.length > 1 && bytes[0] === 0xff && bytes[1] === 0xfe;
    return parseInstallsCsv(utf16 ? bytes.toString('utf16le') : bytes.toString('utf8'));
  }
}
