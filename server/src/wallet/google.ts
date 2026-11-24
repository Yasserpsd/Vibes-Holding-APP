import { createPrivateKey, sign } from 'node:crypto';

import { decodeEnvFile, type PassMember } from './pkpass.js';

/** M271: the face of the pass per membership; Google picks a readable text colour by itself. */
const GOOGLE_COLORS: Record<PassMember['kind'], string> = { annual: '#0B0A08', partner: '#0D2E86', honorary: '#FBF8F0' };

/**
 * M267 «أضف إلى المحفظة» (Google): the «Save to Google Wallet» link is a JWT, signed with the service account's key,
 * that carries the pass itself (a Generic class and a Generic object). Google reads it at
 * https://pay.google.com/gp/v/save/<jwt> — nothing is called from this server, nothing is stored at Google until the
 * member taps the link.
 */

export type GoogleWalletCredentials = { issuerId: string; email: string; privateKeyPem: string };

/** The key as the environment holds it: base64 of the PEM, or base64 of the downloaded service-account JSON file. */
export function googleCredentialsOf(env: { WALLET_GOOGLE_ISSUER_ID?: string; WALLET_GOOGLE_SA_EMAIL?: string; WALLET_GOOGLE_SA_KEY?: string }): GoogleWalletCredentials | null {
  if (!env.WALLET_GOOGLE_ISSUER_ID || !env.WALLET_GOOGLE_SA_KEY) return null;
  const text = decodeEnvFile(env.WALLET_GOOGLE_SA_KEY).toString('utf8').trim();
  let privateKeyPem = text;
  let email = env.WALLET_GOOGLE_SA_EMAIL ?? '';
  if (text.startsWith('{')) {
    try {
      const file = JSON.parse(text) as { private_key?: string; client_email?: string };
      privateKeyPem = file.private_key ?? '';
      email = email || file.client_email || '';
    } catch {
      return null;
    }
  }
  if (!email || !privateKeyPem.includes('PRIVATE KEY')) return null;
  return { issuerId: env.WALLET_GOOGLE_ISSUER_ID, email, privateKeyPem };
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** The class is shared by every member's pass; its id carries the issuer. */
export function googleClassId(issuerId: string): string {
  return `${issuerId}.investors_club_membership`;
}

export function googleObjectId(issuerId: string, cardNumber: string, kind: PassMember['kind'] = 'annual'): string {
  // Object ids allow letters, digits, dots, dashes and underscores only; the membership number already fits.
  // M271: Google keeps a saved object as it first saw it, so each other kind of membership is its own object (the
  // annual one keeps the id the saved passes already have).
  return `${issuerId}.member_${cardNumber.replace(/[^A-Za-z0-9_-]/g, '_')}${kind === 'annual' ? '' : `_${kind}`}`;
}

export type GoogleLang = 'ar' | 'en';

export function googleClaims(credentials: GoogleWalletCredentials, member: PassMember, emblemUrl: string, lang: GoogleLang, now: Date, partnerBannerUrl?: string): Record<string, unknown> {
  const text = (value: string) => ({ defaultValue: { language: lang, value } });
  const labels = lang === 'ar' ? { number: 'رقم العضوية', valid: 'سارية حتى', honorary: 'عضوية شرفية', category: 'الفئة', member: 'عضو', type: 'العضوية' } : { number: 'Membership no.', valid: 'Valid until', honorary: 'Honorary membership', category: 'Category', member: 'Member', type: 'Membership' };
  const partnerName = lang === 'ar' ? 'عضوية شركاء النجاح' : 'Success Partners Membership';
  const openName = member.kind === 'honorary' ? labels.honorary : lang === 'ar' ? 'عضوية سارية' : 'Active membership';
  const modules: Array<{ id: string; header: string; body: string }> = [
    { id: 'number', header: labels.number, body: member.cardNumber },
    member.endDate ? { id: 'valid', header: labels.valid, body: member.endDate } : { id: 'valid', header: labels.type, body: openName },
  ];
  const category = lang === 'ar' ? member.categoryAr : member.categoryEn;
  if (category) modules.push({ id: 'category', header: labels.category, body: category });
  const object = {
    id: googleObjectId(credentials.issuerId, member.cardNumber, member.kind),
    classId: googleClassId(credentials.issuerId),
    state: 'ACTIVE',
    cardTitle: text('Investors Club'),
    header: text(member.name),
    subheader: text(member.kind === 'partner' ? partnerName : member.kind === 'honorary' ? labels.honorary : labels.member),
    hexBackgroundColor: GOOGLE_COLORS[member.kind],
    // M271: the Success Partners logo across the pass, beside the club's emblem at its top.
    ...(member.kind === 'partner' && partnerBannerUrl ? { heroImage: { sourceUri: { uri: partnerBannerUrl }, contentDescription: text(partnerName) } } : {}),
    logo: { sourceUri: { uri: emblemUrl }, contentDescription: text('Investors Club') },
    barcode: { type: 'QR_CODE', value: member.cardNumber, alternateText: member.cardNumber },
    textModulesData: modules,
    ...(member.endDate ? { validTimeInterval: { end: { date: `${member.endDate}T23:59:59Z` } } } : {}),
  };
  return {
    iss: credentials.email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(now.getTime() / 1000),
    origins: [],
    payload: { genericClasses: [{ id: googleClassId(credentials.issuerId) }], genericObjects: [object] },
  };
}

/** The signed link for one member. */
export function googleSaveUrl(credentials: GoogleWalletCredentials, member: PassMember, emblemUrl: string, lang: GoogleLang, now = new Date(), partnerBannerUrl?: string): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(googleClaims(credentials, member, emblemUrl, lang, now, partnerBannerUrl)));
  const signature = sign('sha256', Buffer.from(`${header}.${body}`), createPrivateKey(credentials.privateKeyPem)).toString('base64url');
  return `https://pay.google.com/gp/v/save/${header}.${body}.${signature}`;
}
