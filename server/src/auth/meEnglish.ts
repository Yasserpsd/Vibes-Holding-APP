import { createHash } from 'node:crypto';

import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import type { Translator } from '../translate.js';
import type { Me, MeEnglish } from './service.js';

/**
 * M109e (owner, 2026-10-20: «مش عايز كلمة واحدة عربي لما اقلب انجليزي»): the English app shows the
 * member's OWN data in English too — the name transliterated, the job title, company, city and bio
 * translated. The hub keeps the registered Arabic (one identity source; the profile editor still
 * edits the original); this is a display-only block, translated once per profile change and cached.
 */

const ARABIC = /[؀-ۿ]/;

/** The member's profile needs its own prompt: names are TRANSLITERATED, never kept in Arabic script. */
export const ME_TRANSLATE_SYSTEM =
  'You turn an Arabic investors-club member profile into English. Transliterate personal and company names into their standard Latin spelling (e.g. «محمد عبدالله» → "Mohammed Abdullah"); translate job titles, specialties, cities and bios into natural English. Keep numbers, dates and URLs exactly as they are. Never add, drop or embellish information. Never write "free"; use "at no charge". Reply ONLY with JSON {"texts": string[]} of the same length and order as the input; empty strings stay empty.';

const cacheKey = (contactId: number): string => `translate:me:${contactId}`;

type Cached = { hash: string; en: MeEnglish };

function fieldsOf(me: Me): MeEnglish {
  return { name: me.name, jobTitle: me.jobTitle, company: me.company, city: me.city, bio: me.bio };
}

function hashOf(fields: MeEnglish): string {
  return createHash('sha256').update([fields.name, fields.jobTitle, fields.company, fields.city, fields.bio].join('\u0000')).digest('hex');
}

export class MeLocalizer {
  constructor(
    private readonly kv: KV,
    private readonly translator: Translator,
  ) {}

  /**
   * The English block for this account, or null when nothing can be translated right now
   * (the app then shows the registered data as it is). Cached until the profile changes.
   */
  async english(me: Me, lang: AppLang): Promise<MeEnglish | null> {
    if (lang !== 'en') return null;
    const fields = fieldsOf(me);
    const values = Object.values(fields);
    // A profile already free of Arabic needs no AI: it is its own English.
    if (!values.some((value) => ARABIC.test(value))) return fields;
    const hash = hashOf(fields);
    const cached = await this.kv.get<Cached>(cacheKey(me.id));
    if (cached && cached.hash === hash) return cached.en;
    const translated = await this.translator.translate(values);
    if (!translated) return null;
    const en: MeEnglish = {
      name: translated[0] || fields.name,
      jobTitle: translated[1] || fields.jobTitle,
      company: translated[2] || fields.company,
      city: translated[3] || fields.city,
      bio: translated[4] || fields.bio,
    };
    await this.kv.set(cacheKey(me.id), { hash, en } satisfies Cached);
    return en;
  }
}
