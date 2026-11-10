/**
 * Owner, 2026-11-10 (Snap's Sign-up signal rated Poor: 0% phone, 0% e-mail matched): the member's e-mail
 * and mobile go to AppsFlyer, which HASHES them on the device (SHA-256) before anything leaves the phone,
 * so Snap/TikTok/Meta can match the sign-up to the ad. Sent through the same consent gate as the member
 * id (iOS: only after «Allow» on the tracking prompt). Pure on purpose: no native SDK here.
 */
export type AdsUserPii = {
  email: string | null;
  phone: { countryCode: string; phoneNumber: string } | null;
};

// Longest first, so «971» wins over «97» style overlaps. Members register from any country; the rest of
// the world falls back to «no phone» rather than a wrong split (the e-mail still goes).
const DIALS = [
  '966', '971', '965', '974', '973', '968', '967', '962', '961', '964', '963', '970', '212', '213', '216', '218',
  '249', '20', '90', '44', '33', '49', '91', '92', '1',
].sort((a, b) => b.length - a.length);

/** The address a member really reads: Apple «Hide My Email» relays are skipped unless a real one was given. */
export function piiEmail(email: string | undefined, contactEmail: string | undefined): string | null {
  const real = (contactEmail ?? '').trim().toLowerCase();
  if (real.includes('@')) return real;
  const main = (email ?? '').trim().toLowerCase();
  if (!main.includes('@') || main.endsWith('@privaterelay.appleid.com')) return null;
  return main;
}

/** «0512345678», «966512345678», «+966 51…» or «00966…» → { countryCode: '966', phoneNumber: '512345678' }. */
export function piiPhone(phone: string | undefined): AdsUserPii['phone'] {
  let digits = (phone ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // A Saudi local mobile (05XXXXXXXX), the form the server shows Saudi numbers in.
  if (/^05\d{8}$/.test(digits)) return { countryCode: '966', phoneNumber: digits.slice(1) };
  const dial = DIALS.find((code) => digits.startsWith(code));
  if (!dial) return null;
  const national = digits.slice(dial.length).replace(/^0+/, '');
  if (national.length < 6 || dial.length + national.length > 15) return null;
  return { countryCode: dial, phoneNumber: national };
}

export function piiFromMe(me: { email?: string; phone?: string; contactEmail?: string }): AdsUserPii {
  return { email: piiEmail(me.email, me.contactEmail), phone: piiPhone(me.phone) };
}
