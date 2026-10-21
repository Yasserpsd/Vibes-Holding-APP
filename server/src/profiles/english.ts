import { createHash } from 'node:crypto';

import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import type { Translator } from '../translate.js';
import { publicPersonFull, type Profile, type PublicPerson, type PublicPersonFull } from './service.js';

/**
 * M118c (owner: «سيرة ومسيرة كل حاجة ظاهرة عربي في نسخة انجليزي — ميبقاش في كلمة واحدة عربي»):
 * the English app reads the spotlight people fully in English — names transliterated, titles,
 * stories, milestones and links translated. The dashboard keeps editing the Arabic original;
 * this is display-only, translated once per profile change and cached in kv (M109e pattern).
 */

const ARABIC = /[؀-ۿ]/;

export const PEOPLE_TRANSLATE_SYSTEM =
  'You turn an Arabic investors-club member spotlight into English. Transliterate personal and company names into their standard Latin spelling; translate job titles, specialties, cities, biographies, career milestones, achievements and link labels into natural English. Keep numbers, dates, URLs, e-mail addresses and phone numbers exactly as they are. Never add, drop or embellish information. Never write "free"; use "at no charge". Reply ONLY with JSON {"texts": string[]} of the same length and order as the input; empty strings stay empty.';

const personKey = (id: string): string => `translate:person:${id}`;
const INTRO_KEY = 'translate:people:intro';

type CachedPerson = { hash: string; en: PublicPersonFull };
type CachedIntro = { hash: string; en: string };

function hashOf(values: string[]): string {
  return createHash('sha256').update(values.join('\u0000')).digest('hex');
}

/** The translatable fields flattened in a fixed order, so one translator call covers a person. */
function flatten(full: PublicPersonFull): string[] {
  return [
    full.name,
    full.title,
    full.company,
    full.specialty,
    full.city,
    full.bio,
    full.seeking,
    ...full.milestones,
    ...full.achievements,
    ...full.benefit,
    ...full.links.map((link) => link.label),
  ];
}

function rebuild(full: PublicPersonFull, texts: string[]): PublicPersonFull {
  let cursor = 0;
  const next = (fallback: string): string => texts[cursor++] || fallback;
  return {
    ...full,
    name: next(full.name),
    title: next(full.title),
    company: next(full.company),
    specialty: next(full.specialty),
    city: next(full.city),
    bio: next(full.bio),
    seeking: next(full.seeking),
    milestones: full.milestones.map((line) => next(line)),
    achievements: full.achievements.map((line) => next(line)),
    benefit: full.benefit.map((line) => next(line)),
    links: full.links.map((link) => ({ ...link, label: next(link.label) })),
  };
}

export class PersonLocalizer {
  constructor(
    private readonly kv: KV,
    private readonly translator: Translator,
  ) {}

  /** The person in the app's language; any translation trouble falls back to the Arabic original. */
  async person(profile: Profile, lang: AppLang): Promise<PublicPersonFull> {
    const full = publicPersonFull(profile);
    if (lang !== 'en') return full;
    const source = flatten(full);
    if (!source.some((value) => ARABIC.test(value))) return full;
    const hash = hashOf(source);
    const cached = await this.kv.get<CachedPerson>(personKey(profile.id));
    if (cached && cached.hash === hash) return { ...cached.en, photo: full.photo };
    const translated = await this.translator.translate(source);
    if (!translated) return full;
    const en = rebuild(full, translated);
    await this.kv.set(personKey(profile.id), { hash, en } satisfies CachedPerson);
    return en;
  }

  /** The list teaser (name, title, company) in the app's language; one cache with the full person. */
  async list(profiles: Profile[], lang: AppLang): Promise<PublicPerson[]> {
    return Promise.all(
      profiles.map(async (profile) => {
        const { id, name, title, company, photo } = await this.person(profile, lang);
        return { id, name, title, company, photo };
      }),
    );
  }

  /** The owner's intro sentence over the people list. */
  async intro(text: string, lang: AppLang): Promise<string> {
    if (lang !== 'en' || !ARABIC.test(text)) return text;
    const hash = hashOf([text]);
    const cached = await this.kv.get<CachedIntro>(INTRO_KEY);
    if (cached && cached.hash === hash) return cached.en;
    const translated = await this.translator.translate([text]);
    if (!translated?.[0]) return text;
    await this.kv.set(INTRO_KEY, { hash, en: translated[0] } satisfies CachedIntro);
    return translated[0];
  }
}
