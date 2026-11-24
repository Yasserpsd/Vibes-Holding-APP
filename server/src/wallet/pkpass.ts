import { createHash, createPrivateKey, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { crc32 } from 'node:zlib';

import sharp from 'sharp';

/**
 * M267 «أضف إلى المحفظة» (Apple): builds a signed `.pkpass` — a zip of pass.json, the artwork, a manifest of SHA-1
 * hashes and a detached PKCS#7 signature of that manifest made with the Pass Type ID certificate.
 * No package: the zip is written stored (no compression, which Wallet accepts) and the CMS structure is plain DER
 * built here, so the next build and the server image depend on nothing new.
 */

// ── DER ────────────────────────────────────────────────────────────────────────────────────────────────────

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** One DER element: tag, length, then the parts as its content. */
export function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}
export const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
export const set = (...parts: Buffer[]) => tlv(0x31, ...parts);
export const octets = (data: Buffer) => tlv(0x04, data);
export const NULL = Buffer.from([0x05, 0x00]);

/** A non-negative INTEGER from its big-endian bytes (a leading zero is added when the top bit is set). */
export function integer(bytes: Buffer | number): Buffer {
  let raw = typeof bytes === 'number' ? Buffer.from([bytes]) : bytes;
  while (raw.length > 1 && raw[0] === 0 && (raw[1] ?? 0) < 0x80) raw = raw.subarray(1);
  if ((raw[0] ?? 0) >= 0x80) raw = Buffer.concat([Buffer.from([0]), raw]);
  return tlv(0x02, raw);
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const bytes: number[] = [(parts[0] ?? 0) * 40 + (parts[1] ?? 0)];
  for (const part of parts.slice(2)) {
    const group: number[] = [part & 0x7f];
    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128)) group.unshift((rest & 0x7f) | 0x80);
    bytes.push(...group);
  }
  return tlv(0x06, Buffer.from(bytes));
}

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
} as const;

type Element = { tag: number; start: number; content: number; end: number };

function readElement(buf: Buffer, offset: number): Element {
  const tag = buf[offset] ?? 0;
  const first = buf[offset + 1] ?? 0;
  let length = first;
  let content = offset + 2;
  if (first & 0x80) {
    const count = first & 0x7f;
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + (buf[offset + 2 + index] ?? 0);
    content = offset + 2 + count;
  }
  return { tag, start: offset, content, end: content + length };
}

/** The issuer name and the serial number of a certificate, still as DER — a CMS signer is named by exactly these two. */
export function issuerAndSerial(certDer: Buffer): { issuer: Buffer; serial: Buffer } {
  const cert = readElement(certDer, 0);
  const tbs = readElement(certDer, cert.content);
  let cursor = tbs.content;
  let child = readElement(certDer, cursor);
  if (child.tag === 0xa0) {
    cursor = child.end;
    child = readElement(certDer, cursor);
  }
  const serial = certDer.subarray(child.start, child.end);
  const algorithm = readElement(certDer, child.end);
  const issuer = readElement(certDer, algorithm.end);
  return { issuer: certDer.subarray(issuer.start, issuer.end), serial };
}

function utcTime(date: Date): Buffer {
  const two = (value: number) => String(value).padStart(2, '0');
  const text = `${two(date.getUTCFullYear() % 100)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(text, 'ascii'));
}

/** A detached CMS SignedData (SHA-256, RSA) over `content`, carrying the signer's certificate and the intermediates. */
export function signDetached(content: Buffer, key: KeyObject, signerDer: Buffer, intermediatesDer: Buffer[], now = new Date()): Buffer {
  const sha256 = seq(oid(OID.sha256), NULL);
  const attribute = (type: string, value: Buffer) => seq(oid(type), set(value));
  // A SET OF is stored in the order of its encodings (DER); the signature covers it tagged as a SET, the file carries it as [0].
  const attributes = [
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.signingTime, utcTime(now)),
    attribute(OID.messageDigest, octets(createHash('sha256').update(content).digest())),
  ].sort(Buffer.compare);
  const signature = sign('sha256', set(...attributes), key);
  const { issuer, serial } = issuerAndSerial(signerDer);
  const signerInfo = seq(
    integer(1),
    seq(issuer, serial),
    sha256,
    tlv(0xa0, ...attributes),
    seq(oid(OID.rsaEncryption), NULL),
    octets(signature),
  );
  const signedData = seq(
    integer(1),
    set(sha256),
    seq(oid(OID.data)),
    tlv(0xa0, signerDer, ...intermediatesDer),
    set(signerInfo),
  );
  return seq(oid(OID.signedData), tlv(0xa0, signedData));
}

// ── zip ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ZipEntry = { name: string; data: Buffer };

/** A stored (uncompressed) zip with UTF-8 names and a fixed timestamp, so the same pass always has the same bytes. */
export function zipStored(entries: ZipEntry[]): Buffer {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ── the pass ───────────────────────────────────────────────────────────────────────────────────────────────

export type AppleWalletCredentials = {
  passTypeId: string;
  teamId: string;
  /** The Pass Type ID certificate, the matching private key and Apple's WWDR intermediate, as read from the environment. */
  certificate: Buffer;
  key: Buffer;
  intermediate: Buffer;
};

/** What the pass prints: taken from the member's account by the route, so the pass can never say more than the card does. */
export type PassMember = {
  name: string;
  /** The membership number — also the QR value, the same code the club uses for the member everywhere. */
  cardNumber: string;
  /** M271: which membership the pass is for — it decides the colour, as on the in-app card. */
  kind: 'annual' | 'partner' | 'honorary';
  /** `YYYY-MM-DD`, or null for a membership with no expiry (the honorary one). */
  endDate: string | null;
  /** The category's first word in Arabic, English, or '' when the account has none. */
  categoryAr: string;
  categoryEn: string;
};

/** The environment holds each file as base64; a PEM text or a DER file are both read. */
export function decodeEnvFile(value: string): Buffer {
  return Buffer.from(value.trim(), 'base64');
}

export function appleCredentialsOf(env: { WALLET_APPLE_CERT?: string; WALLET_APPLE_KEY?: string; WALLET_APPLE_WWDR?: string; WALLET_APPLE_PASS_TYPE_ID: string; WALLET_APPLE_TEAM_ID: string }): AppleWalletCredentials | null {
  if (!env.WALLET_APPLE_CERT || !env.WALLET_APPLE_KEY || !env.WALLET_APPLE_WWDR) return null;
  return {
    passTypeId: env.WALLET_APPLE_PASS_TYPE_ID,
    teamId: env.WALLET_APPLE_TEAM_ID,
    certificate: decodeEnvFile(env.WALLET_APPLE_CERT),
    key: decodeEnvFile(env.WALLET_APPLE_KEY),
    intermediate: decodeEnvFile(env.WALLET_APPLE_WWDR),
  };
}

/** The face, text and label colours per membership — the same three cards as app/src/components/membershipLook.ts. */
export const PASS_COLORS: Record<PassMember['kind'], { background: string; foreground: string; label: string }> = {
  annual: { background: 'rgb(11, 10, 8)', foreground: 'rgb(242, 206, 116)', label: 'rgb(217, 168, 60)' },
  partner: { background: 'rgb(13, 46, 134)', foreground: 'rgb(255, 255, 255)', label: 'rgb(255, 154, 60)' },
  honorary: { background: 'rgb(251, 248, 240)', foreground: 'rgb(74, 54, 10)', label: 'rgb(138, 101, 16)' },
};

/** The fields' labels are keys; each language's pass.strings gives the reading. */
const STRINGS = {
  ar: {
    MEMBER: 'العضو',
    'MEMBERSHIP NO.': 'رقم العضوية',
    'VALID UNTIL': 'سارية حتى',
    MEMBERSHIP: 'العضوية',
    'Honorary membership': 'عضوية شرفية',
    'Success Partners': 'شركاء النجاح',
    'Active membership': 'عضوية سارية',
    CATEGORY: 'الفئة',
    'Investors Club membership card': 'بطاقة عضوية Investors Club',
  },
  en: {
    MEMBER: 'MEMBER',
    'MEMBERSHIP NO.': 'MEMBERSHIP NO.',
    'VALID UNTIL': 'VALID UNTIL',
    MEMBERSHIP: 'MEMBERSHIP',
    'Honorary membership': 'Honorary membership',
    'Success Partners': 'Success Partners',
    'Active membership': 'Active membership',
    CATEGORY: 'CATEGORY',
    'Investors Club membership card': 'Investors Club membership card',
  },
} as const;

function stringsFile(entries: Record<string, string>): Buffer {
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return Buffer.from(`${Object.entries(entries).map(([key, value]) => `"${escape(key)}" = "${escape(value)}";`).join('\n')}\n`, 'utf8');
}

let artwork: Promise<Array<{ name: string; data: Buffer }>> | null = null;

/** The club's emblem at the sizes Wallet wants (the app's own artwork, resized once and kept). */
function artworkFiles(readEmblem: () => Buffer): Promise<Array<{ name: string; data: Buffer }>> {
  artwork ??= (async () => {
    const emblem = readEmblem();
    const sized = async (name: string, size: number) => ({ name, data: await sharp(emblem).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() });
    return Promise.all([
      sized('icon.png', 29),
      sized('icon@2x.png', 58),
      sized('icon@3x.png', 87),
      sized('logo.png', 50),
      sized('logo@2x.png', 100),
      sized('logo@3x.png', 150),
    ]);
  })();
  artwork.catch(() => {
    artwork = null;
  });
  return artwork;
}

/**
 * M271: the Success Partners logo as a generic pass's thumbnail (Wallet takes 2:3 to 3:2): the approved logo, whole and
 * in its own colours, on a white tile. Drawn once per process.
 */
let partnerArtwork: Promise<Array<{ name: string; data: Buffer }>> | null = null;
function partnerThumbnails(readPartnerLogo: () => Buffer): Promise<Array<{ name: string; data: Buffer }>> {
  partnerArtwork ??= (async () => {
    const logo = readPartnerLogo();
    const tile = async (name: string, scale: number) => {
      const inner = await sharp(logo).resize({ width: 84 * scale }).png().toBuffer();
      const data = await sharp({ create: { width: 90 * scale, height: 60 * scale, channels: 4, background: '#ffffff' } }).composite([{ input: inner, gravity: 'centre' }]).png().toBuffer();
      return { name, data };
    };
    return Promise.all([tile('thumbnail.png', 1), tile('thumbnail@2x.png', 2), tile('thumbnail@3x.png', 3)]);
  })();
  partnerArtwork.catch(() => {
    partnerArtwork = null;
  });
  return partnerArtwork;
}

/** pass.json: a generic pass in the colour of the in-app card, with the membership number as a QR code. */
export function passJson(credentials: Pick<AppleWalletCredentials, 'passTypeId' | 'teamId'>, member: PassMember): Record<string, unknown> {
  const secondary: Array<Record<string, unknown>> = [{ key: 'number', label: 'MEMBERSHIP NO.', value: member.cardNumber }];
  secondary.push(
    member.endDate
      ? { key: 'valid', label: 'VALID UNTIL', value: `${member.endDate}T00:00:00Z`, dateStyle: 'PKDateStyleMedium', ignoresTimeZone: true }
      : { key: 'valid', label: 'MEMBERSHIP', value: member.kind === 'honorary' ? 'Honorary membership' : 'Active membership' },
  );
  const auxiliary = [
    ...(member.kind === 'partner' ? [{ key: 'type', label: 'MEMBERSHIP', value: 'Success Partners' }] : []),
    ...(member.categoryEn ? [{ key: 'category', label: 'CATEGORY', value: member.categoryEn }] : []),
  ];
  const colors = PASS_COLORS[member.kind];
  return {
    formatVersion: 1,
    passTypeIdentifier: credentials.passTypeId,
    teamIdentifier: credentials.teamId,
    serialNumber: member.cardNumber,
    organizationName: 'Investors Club',
    description: 'Investors Club membership card',
    logoText: 'Investors Club',
    backgroundColor: colors.background,
    foregroundColor: colors.foreground,
    labelColor: colors.label,
    ...(member.endDate ? { expirationDate: `${member.endDate}T23:59:59Z` } : {}),
    barcodes: [{ format: 'PKBarcodeFormatQR', message: member.cardNumber, messageEncoding: 'iso-8859-1', altText: member.cardNumber }],
    generic: {
      primaryFields: [{ key: 'member', label: 'MEMBER', value: member.name }],
      secondaryFields: secondary,
      auxiliaryFields: auxiliary,
    },
  };
}

export async function buildPkpass(credentials: AppleWalletCredentials, member: PassMember, readEmblem: () => Buffer, readPartnerLogo: () => Buffer, now = new Date()): Promise<Buffer> {
  const arabic: Record<string, string> = { ...STRINGS.ar };
  const english: Record<string, string> = { ...STRINGS.en };
  if (member.categoryEn) {
    arabic[member.categoryEn] = member.categoryAr || member.categoryEn;
    english[member.categoryEn] = member.categoryEn;
  }
  const files: ZipEntry[] = [
    { name: 'pass.json', data: Buffer.from(JSON.stringify(passJson(credentials, member)), 'utf8') },
    ...(await artworkFiles(readEmblem)),
    ...(member.kind === 'partner' ? await partnerThumbnails(readPartnerLogo) : []),
    { name: 'ar.lproj/pass.strings', data: stringsFile(arabic) },
    { name: 'en.lproj/pass.strings', data: stringsFile(english) },
  ];
  const manifest = Buffer.from(JSON.stringify(Object.fromEntries(files.map((file) => [file.name, createHash('sha1').update(file.data).digest('hex')]))), 'utf8');
  const certificate = new X509Certificate(credentials.certificate).raw;
  const intermediate = new X509Certificate(credentials.intermediate).raw;
  const signature = signDetached(manifest, createPrivateKey(credentials.key), certificate, [intermediate], now);
  return zipStored([...files, { name: 'manifest.json', data: manifest }, { name: 'signature', data: signature }]);
}
