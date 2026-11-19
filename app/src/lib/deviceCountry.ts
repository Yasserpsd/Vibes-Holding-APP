/**
 * M256 (owner, 2026-11-19: «حاجات تسهل التسجيل أكتر»): the country a phone field opens on. Every form opened on
 * Saudi Arabia, so a member in Cairo or Dubai typed his number under +966 and was refused before he noticed the
 * picker. The device's TIME ZONE says where the phone is (the region setting does not: many Gulf phones are set
 * to «United States»). Pure JavaScript — no native module, so it is safe on every binary an update reaches.
 * A zone that is not listed, or a phone that does not tell, opens on Saudi Arabia as before.
 */
const ZONES: Record<string, string> = {
  'Asia/Riyadh': 'sa',
  'Asia/Dubai': 'ae',
  'Asia/Kuwait': 'kw',
  'Asia/Qatar': 'qa',
  'Asia/Bahrain': 'bh',
  'Asia/Muscat': 'om',
  'Africa/Cairo': 'eg',
  'Asia/Amman': 'jo',
  'Asia/Beirut': 'lb',
  'Asia/Baghdad': 'iq',
  'Asia/Damascus': 'sy',
  'Asia/Aden': 'ye',
  'Asia/Gaza': 'ps',
  'Asia/Hebron': 'ps',
  'Africa/Khartoum': 'sd',
  'Africa/Tripoli': 'ly',
  'Africa/Tunis': 'tn',
  'Africa/Algiers': 'dz',
  'Africa/Casablanca': 'ma',
  'Europe/Istanbul': 'tr',
  'Europe/London': 'gb',
  'Asia/Karachi': 'pk',
  'Asia/Kolkata': 'in',
  'Asia/Calcutta': 'in',
};

/** The main market: the form's country when the device says nothing, and the first guess for a number typed under another country. */
export const HOME_COUNTRY = 'sa';

let cached: string | null = null;

export function deviceCountry(): string {
  if (cached) return cached;
  let zone = '';
  try {
    zone = new Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    // An engine without Intl: the form opens on the home country.
  }
  cached = ZONES[zone] ?? HOME_COUNTRY;
  return cached;
}
