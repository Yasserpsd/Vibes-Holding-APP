import { createRequire } from 'node:module';

import type { FastifyRequest } from 'fastify';

import { COUNTRIES } from '../hub/phone.js';
import { sourceOf, type AppLang } from '../lang.js';

/**
 * M264 «الجلسات المسجلة» (owner, 2026-11-22: «يظهر IP ومكان كل شخص فاتح الحساب»): what a request says about the
 * device behind a session. It is kept beside the session and shown to the account's owner only.
 */
export type SessionPlatform = 'ios' | 'android' | 'web';
export type SessionDevice = { ip: string; platform: SessionPlatform; appVersion?: string };

const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/;
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

function header(request: FastifyRequest, name: string): string {
  const raw = request.headers[name];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
}

/** `::ffff:1.2.3.4` is the IPv4 address 1.2.3.4; anything that is not an address at all is dropped. */
export function cleanIp(ip: string): string {
  const text = ip.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  return IP_SHAPE.test(text) ? text : '';
}

/**
 * The address is `request.ip`: the server runs with `trustProxy: true` (app.ts), so behind Railway's edge it is the
 * member's own address, not the proxy's. The platform is the app's `x-app-platform` (a browser — the dashboard — is
 * `web`); the version is the installed binary's (`x-app-binary`), else the bundle's (`x-app-version`).
 */
export function deviceOf(request: FastifyRequest): SessionDevice {
  const source = sourceOf(request);
  const version = [header(request, 'x-app-binary'), header(request, 'x-app-version')].find((value) => VERSION.test(value) && value !== '0.0.0');
  return {
    ip: cleanIp(request.ip),
    platform: source === 'app-ios' ? 'ios' : source === 'app-android' ? 'android' : 'web',
    ...(version ? { appVersion: version } : {}),
  };
}

type Lookup = (ip: string) => { country?: string } | null;
let table: Lookup | null | undefined;

/**
 * The bundled IP-to-country table (`geoip-country`: MaxMind GeoLite2 country data inside the package, read from disk —
 * no address ever leaves the server). It loads at the first lookup; if it cannot load, every place is unknown.
 */
function lookup(): Lookup | null {
  if (table !== undefined) return table;
  try {
    table = (createRequire(import.meta.url)('geoip-country') as { lookup: Lookup }).lookup;
  } catch {
    table = null;
  }
  return table;
}

/** The ISO country of an address (`SA`), or null for a private, unknown or unreadable one. */
export function countryOf(ip: string): string | null {
  const address = cleanIp(ip);
  if (!address) return null;
  try {
    const code = lookup()?.(address)?.country;
    return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

const regionNames: Partial<Record<AppLang, Intl.DisplayNames>> = {};

/** The country's name as the club writes it (the sign-up list), else the standard name of that region. */
export function countryName(code: string, lang: AppLang): string {
  const own = COUNTRIES.find((country) => country.code === code.toLowerCase());
  if (own) return lang === 'en' ? own.nameEn : own.name;
  try {
    regionNames[lang] ??= new Intl.DisplayNames([lang], { type: 'region' });
    return regionNames[lang].of(code) ?? code;
  } catch {
    return code;
  }
}

/** Country only: the offline table has no city a member in the Gulf could rely on (mobile networks sit in one city). */
export function placeOf(ip: string, lang: AppLang): { country: string | null; place: string | null } {
  const country = countryOf(ip);
  return { country, place: country ? countryName(country, lang) : null };
}
