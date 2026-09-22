import { requireOptionalNativeModule } from 'expo';

import { loadLargeSetting, loadSetting, saveLargeSetting, saveSetting } from '@/lib/deviceStore';

import ar from './strings/ar.json';
import en from './strings/en.json';

/**
 * The app's wording in two languages (M27). Every text a member reads sits behind a key in
 * `strings/ar.json` (the reference) and `strings/en.json`; the owner's wording edits from the
 * dashboard arrive as overrides of single keys (M24) and win over the bundled text.
 *
 * `t()` reads module state, so call it while rendering (or in a handler), never at module scope:
 * the language and the saved overrides are loaded by `initI18n()` before the first screen draws.
 * A language change restarts the app (the layout direction is native), so the language never
 * changes under a mounted screen.
 */
export type Lang = 'ar' | 'en';
export type StringKey = keyof typeof ar;
type Params = Record<string, string | number>;

// `en` must carry every key of `ar`: a missing one fails the typecheck here.
const ENGLISH: Record<StringKey, string> = en;
const BUNDLED: Record<Lang, Record<string, string>> = { ar, en: ENGLISH };

const LANG_KEY = 'investorsclub.lang';
const STRINGS_KEY = 'investorsclub.strings';

/**
 * Binaries of these runtimes were built with expo-localization `forcesRTL`, and whether a release
 * build of them lets JavaScript turn the layout left-to-right is not proven yet (a local debug build
 * of the same native code does, and keeps it across cold starts: checked on 2026-09-22). Until the
 * owner has tried it on his phone, members on these binaries are not offered English: only an
 * admin sees the language row there (see `languageChoiceOffered`).
 */
const UNPROVEN_RUNTIMES = ['1.0.0'];

let lang: Lang = 'ar';
let overrides: Record<string, string> = {};
let overridesVersion = '';

export function getLang(): Lang {
  return lang;
}

function runtimeVersion(): string | null {
  if (!requireOptionalNativeModule('ExpoUpdates')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-updates') as typeof import('expo-updates')).runtimeVersion ?? null;
  } catch {
    return null;
  }
}

/** Whether this binary is known to show the English, left-to-right version properly. */
export function englishAvailable(): boolean {
  return !UNPROVEN_RUNTIMES.includes(runtimeVersion() ?? '');
}

/** Who sees the language row in «حسابي»: everyone on a proven binary, the club's admins on the others. */
export function languageChoiceOffered(isAdmin: boolean): boolean {
  return englishAvailable() || isAdmin;
}

function deviceLang(): Lang {
  if (!requireOptionalNativeModule('ExpoLocalization')) return 'ar';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const locales = (require('expo-localization') as typeof import('expo-localization')).getLocales();
    return locales[0]?.languageCode === 'ar' ? 'ar' : 'en';
  } catch {
    return 'ar';
  }
}

function isLang(value: unknown): value is Lang {
  return value === 'ar' || value === 'en';
}

function placeholders(text: string): string[] {
  return text.match(/\{[a-zA-Z]+\}/g) ?? [];
}

/** An override that lost a `{placeholder}` of the bundled text would print a sentence with a hole: it is ignored. */
function keepsPlaceholders(bundled: string, override: string): boolean {
  return placeholders(bundled).every((name) => override.includes(name));
}

export function t(key: StringKey, params?: Params): string {
  const bundled = BUNDLED[lang][key] ?? BUNDLED.ar[key] ?? key;
  const override = overrides[key];
  const text = override && keepsPlaceholders(bundled, override) ? override : bundled;
  if (!params) return text;
  return text.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** The text of a key that may not exist (a server error code): `null` when there is none. */
export function tOptional(key: string, params?: Params): string | null {
  return key in BUNDLED.ar ? t(key as StringKey, params) : null;
}

/** A sentence the hub wrote (Arabic only): shown as it is in Arabic, replaced by the app's own text in English. */
export function hubText(text: string | null | undefined, key: StringKey, params?: Params): string {
  return lang === 'ar' && text ? text : t(key, params);
}

type SavedStrings = { version: string; strings: Record<string, string> };

function readSaved(raw: string | null): SavedStrings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedStrings>;
    if (typeof parsed.version !== 'string' || typeof parsed.strings !== 'object' || parsed.strings === null) return null;
    const strings: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.strings)) if (typeof value === 'string' && value.trim()) strings[key] = value;
    return { version: parsed.version, strings };
  } catch {
    return null;
  }
}

/**
 * Loads the language and the wording overrides saved at the last start. Runs behind the splash screen.
 * A choice made in «حسابي» always wins. Without one, a binary proven for English follows the device
 * language once and keeps it (expo-localization is then never loaded again: creating its native module
 * can re-apply the direction the binary was configured with); the other binaries stay Arabic.
 */
export async function initI18n(): Promise<void> {
  const saved = await loadSetting(LANG_KEY);
  if (isLang(saved)) lang = saved;
  else if (englishAvailable()) {
    lang = deviceLang();
    await saveSetting(LANG_KEY, lang);
  } else lang = 'ar';
  const cached = readSaved(await loadLargeSetting(`${STRINGS_KEY}.${lang}`));
  if (cached) {
    overrides = cached.strings;
    overridesVersion = cached.version;
  }
}

export function stringsVersion(): string {
  return overridesVersion;
}

/** Fresh overrides from the server: used by every screen drawn from now on, and saved for the next start. */
export async function applyOverrides(version: string, strings: Record<string, string>): Promise<void> {
  const next = readSaved(JSON.stringify({ version, strings }));
  if (!next) return;
  overrides = next.strings;
  overridesVersion = next.version;
  await saveLargeSetting(`${STRINGS_KEY}.${lang}`, JSON.stringify(next));
}

/** Saves the member's choice. The caller restarts the app (see `switchLanguage` in direction.ts). */
export async function saveLang(next: Lang): Promise<void> {
  await saveSetting(LANG_KEY, next);
}
