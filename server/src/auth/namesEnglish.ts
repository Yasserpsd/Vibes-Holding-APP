import type { AppLang } from '../lang.js';
import { EnglishCache } from '../englishCache.js';
import type { KV } from '../store.js';
import type { Translator } from '../translate.js';

/**
 * Owner (2026-11-04, «حتى لو انا كاتب اسمي عربي لو قلبت انجليزي يترجم اوتوماتيك»): other people's
 * names in a member's lists (e.g. his referrals) are transliterated in the English app, the same way
 * his own name is (M109e). Display-only; each name is translated once and cached in kv.
 */

export const NAMES_TRANSLATE_SYSTEM =
  'You transliterate Arabic personal and company names into their standard Latin spelling (e.g. «محمد عبدالله» → "Mohammed Abdullah"). Never translate the meaning of a name, never add titles. Reply ONLY with JSON {"texts": string[]} of the same length and order as the input; empty strings stay empty.';

export class NameTransliterator {
  private readonly cache: EnglishCache;

  constructor(kv: KV, translator: Translator) {
    this.cache = new EnglishCache(kv, translator, 'name');
  }

  /** The names in the app's language: English → Latin spelling (cached), otherwise as registered. */
  names(list: string[], lang: AppLang): Promise<string[]> {
    return this.cache.texts(list, lang);
  }
}
