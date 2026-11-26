import { COUNTRIES, normPhone } from '../hub/phone.js';

/** M284 «خريطة الأعضاء»: one row per country, counted from the dialing code of each account's phone. */
export type CountryCount = { code: string; name: string; nameEn: string; flag: string; dial: string; total: number; members: number };
export type CountriesAnswer = { items: CountryCount[]; noPhone: number; unknown: number; total: number };

// Longest dial code first, so 971 wins over 97 and 1 is tried last. Shared codes (1 = US/Canada,
// 7 = Russia/Kazakhstan) go to the first country of the list, which is the bigger one.
const BY_DIAL = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** The ISO code of the country a stored phone belongs to, '' when it has no digits, '?' when no dial code matches. */
export function countryOfPhone(phone: string): string {
  const digits = normPhone(phone ?? '');
  if (!digits) return '';
  return BY_DIAL.find((country) => digits.startsWith(country.dial))?.code ?? '?';
}

/** Counts only — never a phone number — sorted by the number of accounts, most first. */
export function countByCountry(accounts: readonly { phone: string; state?: string }[]): CountriesAnswer {
  const counts = new Map<string, { total: number; members: number }>();
  let noPhone = 0;
  let unknown = 0;
  for (const account of accounts) {
    const code = countryOfPhone(account.phone);
    if (code === '') noPhone += 1;
    else if (code === '?') unknown += 1;
    else {
      const row = counts.get(code) ?? { total: 0, members: 0 };
      row.total += 1;
      if (account.state === 'member') row.members += 1;
      counts.set(code, row);
    }
  }
  const items = [...counts.entries()]
    .map(([code, row]) => {
      const country = COUNTRIES.find((item) => item.code === code)!;
      return { code, name: country.name, nameEn: country.nameEn, flag: country.flag, dial: country.dial, ...row };
    })
    .sort((a, b) => b.total - a.total || a.nameEn.localeCompare(b.nameEn));
  return { items, noPhone, unknown, total: accounts.length };
}
