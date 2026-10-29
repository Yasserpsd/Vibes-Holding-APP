import { createPrivateKey, sign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

/**
 * M158: App Store installs through the App Store Connect API (Sales and Trends, daily SUMMARY report).
 * Configured only when the owner creates an API key under App Store Connect → Users and Access → Integrations
 * → App Store Connect API (role «Sales and Reports» is enough) and sets ASC_ISSUER_ID / ASC_KEY_ID /
 * ASC_PRIVATE_KEY (the .p8 contents) / ASC_VENDOR_NUMBER on Railway. Without them `configured` is false and
 * the dashboard keeps the device-based numbers.
 */
export type AppStoreConfig = { issuerId: string; keyId: string; privateKey: string; vendorNumber: string; appleId?: string };

const AUDIENCE = 'appstoreconnect-v1';
const BASE = 'https://api.appstoreconnect.apple.com/v1/salesReports';
/** Product type identifiers that mean a first-time app download (free, paid, universal, Mac). */
const INSTALL_TYPES = new Set(['1', '1F', '1T', 'F1', 'F1-B']);

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/** A 15-minute ES256 token, signed with the .p8 key (the JWT the App Store Connect API expects). */
export function appStoreToken(config: AppStoreConfig, now = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId, typ: 'JWT' }));
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ iss: config.issuerId, iat, exp: iat + 15 * 60, aud: AUDIENCE }));
  const key = createPrivateKey(config.privateKey.replace(/\\n/g, '\n'));
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Sums the first-download units of one daily SUMMARY sales report (gzipped TSV), optionally for one Apple ID. */
export function parseSalesReport(tsv: string, appleId?: string): number {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return 0;
  const header = lines[0]!.split('\t').map((cell) => cell.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const typeAt = col('product type identifier');
  const unitsAt = col('units');
  const idAt = col('apple identifier');
  if (typeAt < 0 || unitsAt < 0) return 0;
  let total = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    if (!INSTALL_TYPES.has((cells[typeAt] ?? '').trim())) continue;
    if (appleId && idAt >= 0 && (cells[idAt] ?? '').trim() !== appleId) continue;
    const units = Number((cells[unitsAt] ?? '').trim());
    if (Number.isFinite(units) && units > 0) total += units;
  }
  return total;
}

export class AppStoreClient {
  constructor(
    private readonly config: AppStoreConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** First-time downloads on one day (YYYY-MM-DD); `null` when Apple has no report for that day yet (404). */
  async installsOn(day: string): Promise<number | null> {
    const params = new URLSearchParams({
      'filter[frequency]': 'DAILY',
      'filter[reportDate]': day,
      'filter[reportSubType]': 'SUMMARY',
      'filter[reportType]': 'SALES',
      'filter[vendorNumber]': this.config.vendorNumber,
    });
    const response = await this.fetchImpl(`${BASE}?${params.toString()}`, {
      headers: { authorization: `Bearer ${appStoreToken(this.config)}`, accept: 'application/a-gzip' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`App Store Connect answered ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const text = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body).toString('utf8') : body.toString('utf8');
    return parseSalesReport(text, this.config.appleId);
  }
}
