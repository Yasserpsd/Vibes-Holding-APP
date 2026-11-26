/**
 * The dashboard's English mode. The source stays written in Arabic; English is a display layer:
 * every Arabic string a host element shows is looked up in `i18n/en.json` (see `jsx/jsx-runtime.ts`), so no
 * component carries translation calls and nothing sent to the server changes. The choice lives in this browser
 * and a switch reloads the page, which lets `lang` be a plain constant.
 *
 * A new Arabic string needs an entry in `i18n/en.json`: `node scripts/i18n-extract.mjs` lists the ones without.
 * Text that must stay as written (the app's own Arabic wording, shown for editing) sits under `lang="ar"`.
 */
import en from './i18n/en.json';

export type Lang = 'ar' | 'en';

const STORAGE_KEY = 'admin.lang';

function stored(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export const lang: Lang = stored();
export const isEn = lang === 'en';

/** Saves the choice for every later visit on this browser, then reloads into it. */
export function setLang(next: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage is blocked: the switch cannot be remembered, so it does nothing rather than flip for one page.
    return;
  }
  window.location.reload();
}

const ARABIC = /[؀-ۿ]/;
const ARABIC_ALL = /[؀-ۿ]/g;
const HOLE = /\{(\d+)\}/g;
const dict = en as Record<string, string>;

interface Pattern {
  test: RegExp;
  out: string;
  /** Enough fixed wording to be trusted when a hole holds Arabic (a name); a weak one such as «من {0}» is not. */
  strong: boolean;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keys with numbered holes come from template literals: `${count} عضو` is the key "{0} عضو". */
const patterns: Pattern[] = Object.keys(dict)
  .filter((key) => /\{\d+\}/.test(key))
  .map((key) => {
    const fixed = key.replace(HOLE, '');
    return {
      test: new RegExp(`^${key.split(/\{\d+\}/).map(escape).join('([\\s\\S]*?)')}$`),
      out: dict[key] ?? key,
      strong: (fixed.match(ARABIC_ALL)?.length ?? 0) >= 5 || fixed.includes('«'),
      weight: fixed.length,
    };
  })
  .filter((pattern) => ARABIC.test(pattern.test.source))
  .sort((a, b) => b.weight - a.weight);

/**
 * M282: English the server translated for texts the dictionary lacks (names, members' answers, poll texts), kept in
 * this browser so a page renders them in English at once on the next visit. Filled by `englishSweep.ts`.
 */
const LEARNED_KEY = 'admin.english.learned';
const LEARNED_MAX = 4000;
const learned = new Map<string, string>();
try {
  const saved = isEn ? (JSON.parse(localStorage.getItem(LEARNED_KEY) ?? '[]') as [string, string][]) : [];
  for (const [ar, english] of saved) if (typeof ar === 'string' && typeof english === 'string') learned.set(ar, english);
} catch {
  // Blocked or broken storage: the sweep asks the server again.
}

/** M282: remembers server translations (core Arabic → English) for tx() and later visits. */
export function learn(pairs: [string, string][]): void {
  for (const [ar, english] of pairs) {
    learned.delete(ar);
    learned.set(ar, english);
  }
  while (learned.size > LEARNED_MAX) learned.delete(learned.keys().next().value as string);
  cache.clear();
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify([...learned]));
  } catch {
    // Full or blocked storage: this visit still has them in memory.
  }
}

/** M282: the server's English for a core text, if this browser learned it. */
export function learnedFor(core: string): string | undefined {
  return learned.get(core);
}

const SEPARATORS = /(\s+·\s+|،\s+|\s+—\s+|\n+)/;
const cache = new Map<string, string>();

function fromPattern(core: string): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.test.exec(core);
    if (!match) continue;
    const holes = match.slice(1).map((hole) => tx(hole));
    if (!pattern.strong && holes.some((hole) => ARABIC.test(hole))) continue;
    return pattern.out.replace(HOLE, (_, index: string) => holes[Number(index)] ?? '');
  }
  return undefined;
}

function translate(core: string): string | undefined {
  const exact = dict[core];
  if (exact !== undefined) return exact;
  const known = learned.get(core);
  if (known !== undefined) return known;
  const matched = fromPattern(core);
  if (matched !== undefined) return matched;
  // A line joined from parts («نُشر: … · صور: 3»): each part on its own.
  const parts = core.split(SEPARATORS);
  if (parts.length < 3) return undefined;
  let changed = false;
  const out = parts.map((part, index) => {
    if (index % 2 === 1) return part.replace('،', ',');
    const piece = /^(\s*)([\s\S]*?)(\s*)$/.exec(part);
    const inner = piece?.[2] ?? part;
    const done = inner && ARABIC.test(inner) ? dict[inner] ?? fromPattern(inner) : undefined;
    if (done === undefined) return part;
    changed = true;
    return `${piece?.[1] ?? ''}${done}${piece?.[3] ?? ''}`;
  });
  return changed ? out.join('') : undefined;
}

/** The English for an Arabic string in English mode; anything unknown (a member's name, a message) returns as it came. */
export function tx(text: string): string {
  if (!isEn || !ARABIC.test(text)) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const core = match?.[2] ?? text;
  const done = translate(core);
  const out = done === undefined ? text : `${match?.[1] ?? ''}${done}${match?.[3] ?? ''}`;
  if (cache.size < 5000) cache.set(text, out);
  return out;
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = isEn ? 'ltr' : 'rtl';
  if (isEn) {
    document.title = tx(document.title);
    // The browser's own dialogs take a plain string, outside what the JSX layer sees.
    const { alert, confirm, prompt } = window;
    window.alert = (message?: unknown) => alert.call(window, typeof message === 'string' ? tx(message) : message);
    window.confirm = (message?: string) => confirm.call(window, message === undefined ? message : tx(message));
    window.prompt = (message?: string, value?: string) => prompt.call(window, message === undefined ? message : tx(message), value);
  }
}
