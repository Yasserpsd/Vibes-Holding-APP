/**
 * Server content in two languages (M27 stage 3). Every block (home, membership, services, golden, hq, about, videos)
 * is stored once, in Arabic, the way it always was. The English version is the same block read through a
 * translation: an object of the same shape carrying English text at the same paths, and the owner's edits on top.
 * Only Arabic texts are wording: a URL, an id, a phone number, a time or a number is the same in both languages and
 * is never edited from the dashboard.
 */

/** A second-language copy of a block: the same shape, every field optional. Lists of objects align by `key`, `code` or `id`; other lists by position. */
export type Translation<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends (infer U)[]
    ? Translation<U>[]
    : T extends object
      ? { [K in keyof T]?: Translation<T[K]> }
      : T;

export type WordingEntry = { path: string; value: string };

const ARABIC = /[؀-ۿ]/u;
const NAME_KEYS = ['key', 'code', 'id'] as const;

export const isArabic = (value: string): boolean => ARABIC.test(value);
/** Wording is an Arabic text; a link stays a link even when its file name is Arabic (the about page's logos). */
const isWording = (value: string): boolean => isArabic(value) && !/^https?:\/\//iu.test(value.trim());
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const join = (prefix: string, name: string): string => (prefix ? `${prefix}.${name}` : name);

/** How a list item is named in a path: its own key when it has one, otherwise its position. */
function nameOf(item: unknown, index: number): string {
  if (isRecord(item)) {
    for (const name of NAME_KEYS) {
      const value = item[name];
      if (typeof value === 'string' && value && !value.includes('.')) return value;
    }
  }
  return String(index);
}

/** The value at a dotted path: list items are found by their name (see `nameOf`), so a translation follows the same paths as its base. */
export function at(source: unknown, path: string): unknown {
  let current = source;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) current = current.find((entry, index) => nameOf(entry, index) === segment);
    else if (isRecord(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

function walk(node: unknown, prefix: string, visit: (path: string, value: string) => void): void {
  if (typeof node === 'string') {
    if (isWording(node)) visit(prefix, node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, join(prefix, nameOf(item, index)), visit));
    return;
  }
  if (isRecord(node)) for (const [key, value] of Object.entries(node)) walk(value, join(prefix, key), visit);
}

/** Every Arabic text of a block with its path: the fields the dashboard edits. */
export function wordingOf(block: unknown): WordingEntry[] {
  const out: WordingEntry[] = [];
  walk(block, '', (path, value) => out.push({ path, value }));
  return out;
}

function rewrite(node: unknown, prefix: string, replace: (path: string, value: string) => string): unknown {
  if (typeof node === 'string') return isWording(node) ? replace(prefix, node) : node;
  if (Array.isArray(node)) return node.map((item, index) => rewrite(item, join(prefix, nameOf(item, index)), replace));
  if (isRecord(node)) return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, rewrite(value, join(prefix, key), replace)]));
  return node;
}

/**
 * The block as one language reads it: the base's structure, each Arabic text replaced by the translation's text at
 * the same path (when there is one), then by the edit at that path (when there is one). Arabic reads the base with
 * its own edits (`translation` = null). A missing translation leaves the Arabic text: never an empty field.
 */
export function localize<T>(base: T, translation: Translation<NoInfer<T>> | null, edits: Record<string, string>): T {
  return rewrite(base, '', (path, value) => {
    const edited = edits[path];
    if (typeof edited === 'string' && edited) return edited;
    const translated = translation ? at(translation, path) : undefined;
    return typeof translated === 'string' && translated ? translated : value;
  }) as T;
}

/** The paths of `base` that `translation` does not cover (the test keeps this empty for every English seed). */
export function untranslated(base: unknown, translation: unknown): string[] {
  return wordingOf(base)
    .filter((entry) => typeof at(translation, entry.path) !== 'string')
    .map((entry) => entry.path);
}
