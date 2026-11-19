import { HOME_COUNTRY } from '@/lib/deviceCountry';
import { cleanEmail, isEmail, nameIssue, phoneIssue, toAsciiDigits, type PhoneRules } from '@/lib/validation';

/**
 * M253 (owner, 2026-11-19: «أي خطأ يحصل يظهر زرار فوري يحل المشكلة»): what a field's «تصحيح» button would write.
 * Every function here answers with the corrected value, or null when there is no ONE right answer — the button
 * is then not shown and the sentence under the field says what to type. Nothing here is applied without the
 * member's tap, except the link tidying, which the server applies as well (server/src/profiles/links.ts).
 */

// ---------------------------------------------------------------------------------------------
// E-mail

/** The providers a member mistypes most; a domain that is one slip away from one of them is that provider. */
const PROVIDERS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com'];
/** The slips seen in real sign-ups, exact domain → the provider meant. */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmaul.com': 'gmail.com', 'gmqil.com': 'gmail.com', 'gemail.com': 'gmail.com',
  'gimail.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmaile.com': 'gmail.com', 'gmeil.com': 'gmail.com', 'gmail.net': 'gmail.com', 'googlemail.co': 'googlemail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'hotnail.com': 'hotmail.com', 'hotmaill.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.cm': 'hotmail.com', 'homail.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outllook.com': 'outlook.com', 'oulook.com': 'outlook.com',
  'outlook.co': 'outlook.com', 'outlook.cm': 'outlook.com', 'outook.com': 'outlook.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yaoo.com': 'yahoo.com', 'yahho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com', 'yahoo.cm': 'yahoo.com', 'yahoo.om': 'yahoo.com',
  'iclod.com': 'icloud.com', 'icould.com': 'icloud.com', 'iclould.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icloud.cm': 'icloud.com', 'icoud.com': 'icloud.com',
  'live.co': 'live.com', 'live.cm': 'live.com',
};
/** Endings that are no ending at all: a slip of «.com» on any domain. */
const COM_SLIPS = /\.(con|cmo|ocm|vom|xom|cpm|comm|coom|c0m|clm|cim|col|cok|com[.,;]+)$/;

/**
 * The address the member most likely meant, or null when the typed one needs no correction (or cannot be
 * corrected with certainty). Covers what `cleanEmail` leaves alone: a space or a comma inside, a doubled «@» or
 * dot, a missing «@» before a known provider, «gmail» without «.com», and the usual slips of the big providers.
 */
export function emailFix(value: string): string | null {
  const cleaned = cleanEmail(value);
  if (!cleaned) return null;
  let email = cleaned.replace(/\s+/g, '').replace(/[,،]/g, '.').replace(/@{2,}/g, '@').replace(/\.{2,}/g, '.').replace(/\.@/g, '@').replace(/@\./g, '@');
  // «name gmail.com» / «namegmail.com»: the «@» is the only thing missing.
  if (!email.includes('@')) {
    const provider = PROVIDERS.find((domain) => email.endsWith(domain) && email.length > domain.length);
    if (provider) email = `${email.slice(0, -provider.length).replace(/[._-]+$/, '')}@${provider}`;
  }
  const at = email.lastIndexOf('@');
  if (at > 0) {
    const local = email.slice(0, at);
    let domain = email.slice(at + 1).replace(COM_SLIPS, '.com');
    // «name@gmail»: the provider without its ending.
    const bare = PROVIDERS.find((provider) => provider.split('.')[0] === domain);
    if (bare) domain = bare;
    domain = DOMAIN_TYPOS[domain] ?? domain;
    email = `${local}@${domain}`;
  }
  return email !== cleaned && isEmail(email) ? email : null;
}

// ---------------------------------------------------------------------------------------------
// Name

/**
 * The name without what is not a name (digits, dots, underscores, signs, emoji, doubled spaces) — offered only
 * when what is left is a real first name + family name. A single word has no automatic correction.
 */
export function nameFix(value: string): string | null {
  const typed = value.replace(/\s+/g, ' ').trim();
  if (!typed || nameIssue(typed) === null) return null;
  const fixed = toAsciiDigits(typed)
    // Arabic punctuation, Arabic-Indic digits and the marks above the letters sit inside the Arabic block.
    .replace(/[،؛؟٪-٭۔]/g, ' ')
    .replace(/[^؀-ۿݐ-ݿA-Za-zÀ-ɏ'’\s-]/g, ' ')
    .replace(/(^|\s)['’-]+|['’-]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return fixed && fixed !== typed && nameIssue(fixed) === null ? fixed : null;
}

// ---------------------------------------------------------------------------------------------
// Phone

export type DialCountry = PhoneRules & { code: string; dial: string; name: string; nameEn?: string };

/**
 * A number typed with another country's dial code while the picker stayed on the first country (the commonest
 * sign-up slip outside Saudi Arabia): the country it belongs to and the local number, or null.
 */
export function phoneCountryFix<C extends DialCountry>(value: string, selected: string, countries: C[]): { country: C; phone: string } | null {
  const digits = toAsciiDigits(value).replace(/\D+/g, '').replace(/^0+/, '');
  if (digits.length < 8) return null;
  const matches = countries
    .filter((land) => land.code !== selected && land.dial && digits.startsWith(land.dial))
    .map((land) => ({ country: land, phone: digits.slice(land.dial.length).replace(/^0+/, '') }))
    .filter((match) => phoneIssue(match.phone, match.country) === null)
    // The longest dial code is the most exact claim on the number.
    .sort((a, b) => b.country.dial.length - a.country.dial.length);
  const best = matches[0];
  if (!best) {
    // M256: no dial code in front — a complete number of the home country, typed while the picker stood elsewhere
    // (the picker now opens on the country the phone is in, and a Saudi member can be abroad).
    const home = selected === HOME_COUNTRY ? undefined : countries.find((land) => land.code === HOME_COUNTRY);
    return home && phoneIssue(digits, home) === null ? { country: home, phone: digits } : null;
  }
  // Two countries share a dial code (1, 7): no one right answer.
  return matches.filter((match) => match.country.dial === best.country.dial).length === 1 ? best : null;
}

// ---------------------------------------------------------------------------------------------
// Links (one per line, «label | address»). The same tidying as server/src/profiles/links.ts — keep the two in step.

export type TypedLink = { label: string; url: string };

const NETWORKS: { names: RegExp; host: RegExp; base: string }[] = [
  { names: /insta|[اإ]نستا|[اإ]نستق|[اإ]نستغ/i, host: /instagram\.com/i, base: 'instagram.com/' },
  { names: /linked|لينكد|لنكد/i, host: /linkedin\.com/i, base: 'linkedin.com/in/' },
  { names: /tiktok|tik tok|تيك ?توك/i, host: /tiktok\.com/i, base: 'tiktok.com/@' },
  { names: /snap|سناب/i, host: /snapchat\.com/i, base: 'snapchat.com/add/' },
  { names: /youtube|يوتيوب/i, host: /youtube\.com|youtu\.be/i, base: 'youtube.com/@' },
  { names: /facebook|فيس ?بوك/i, host: /facebook\.com|fb\.com/i, base: 'facebook.com/' },
  { names: /telegram|تيليجرام|تليجرام|تلجرام|تيليغرام|تليغرام/i, host: /t\.me|telegram\.me/i, base: 't.me/' },
  { names: /twitter|تويتر|^(x|[اإ]كس)$/i, host: /twitter\.com|(^|[./])x\.com/i, base: 'x.com/' },
];
const INVISIBLE = /[​-‏‪-‮⁠-⁩؜﻿­]/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HANDLE = /^@?([A-Za-z0-9._-]{2,60})$/;
// Judged by shape, not with `URL`: Hermes does not implement its parts.
const WEB_LINK = /^https?:\/\/([a-z0-9-]+\.)+[a-z0-9-]{2,}(:\d+)?([/?#]\S*)?$/i;

export function tidyLink(link: TypedLink): TypedLink {
  let label = link.label.replace(INVISIBLE, '').trim();
  let url = link.url.replace(INVISIBLE, '').trim();
  if (!label) {
    const split = url.match(/^([^\s:/|@]{1,40})\s*[:：]\s*(?!\/\/)(\S.*)$/);
    if (split) {
      label = (split[1] ?? '').trim();
      url = (split[2] ?? '').trim();
    }
  }
  url = url.replace(/\s+/g, '');
  const network = NETWORKS.find((item) => item.names.test(label));
  const handle = url.match(HANDLE);
  if (network && handle && !network.host.test(url)) url = `${network.base}${handle[1] ?? ''}`;
  if (url && !HAS_SCHEME.test(url)) url = `https://${url}`;
  return { label, url };
}

export const isWebLink = (url: string): boolean => WEB_LINK.test(url);

/** The lines of a links box as links, each put right where it can be. */
export function linksFromText(text: string): TypedLink[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      return tidyLink(parts.length > 1 ? { label: parts[0] ?? '', url: parts.slice(1).join('|') } : { label: '', url: parts[0] ?? '' });
    })
    .filter((link) => link.url);
}

export const linksToText = (links: TypedLink[]): string => links.map((link) => (link.label ? `${link.label} | ${link.url}` : link.url)).join('\n');

/** The 1-based numbers of the lines that are still not a link after tidying. */
export function badLinkLines(text: string): number[] {
  return linksFromText(text).flatMap((link, index) => (isWebLink(link.url) ? [] : [index + 1]));
}

/** The links box with every line that is not a link removed (the «حذف السطر غير الصحيح» button). */
export const withoutBadLinks = (text: string): string => linksToText(linksFromText(text).filter((link) => isWebLink(link.url)));

// ---------------------------------------------------------------------------------------------
// Lists typed one item per line

export const linesOf = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter(Boolean);

/** The 1-based numbers of the lines outside the length a list accepts. */
export function badLines(text: string, min: number, max: number): number[] {
  return linesOf(text).flatMap((line, index) => (line.length < min || line.length > max ? [index + 1] : []));
}

/**
 * The list made to fit without losing a word: a line longer than the limit is split at a space into lines within
 * it, and a line too short to be an item (a stray dash or number) is dropped.
 */
export function fitLines(text: string, min: number, max: number): string {
  const fitted: string[] = [];
  for (const line of linesOf(text)) {
    let rest = line;
    while (rest.length > max) {
      const cut = rest.slice(0, max);
      const space = cut.lastIndexOf(' ');
      const head = (space > max * 0.5 ? cut.slice(0, space) : cut).trim();
      fitted.push(head);
      rest = rest.slice(head.length).trim();
    }
    if (rest.length >= min) fitted.push(rest);
  }
  return fitted.join('\n');
}

/** The first `most` lines (the «الإبقاء على أول N أسطر» button says so before it cuts). */
export const firstLines = (text: string, most: number): string => linesOf(text).slice(0, most).join('\n');
