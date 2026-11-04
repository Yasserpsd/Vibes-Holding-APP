import { createHash } from 'node:crypto';

import type { AppLang } from './lang.js';
import type { KV } from './store.js';
import type { Translator } from './translate.js';

/**
 * Owner (2026-11-04, «مش عايز كلمة عربي لما اقلب انجليزي — حتى لو انا كاتب اسمي عربي يترجم اوتوماتيك»):
 * short display texts that have no English copy of their own (a member's referrals, workshop file
 * titles, request answers, invite texts) are put into English for the English app. Display-only: the
 * stored Arabic stays the original. Each text is translated once and cached in kv under `prefix`.
 */

const ARABIC = /[؀-ۿ]/;

export class EnglishCache {
  constructor(
    private readonly kv: KV,
    private readonly translator: Translator,
    private readonly prefix = 'text',
  ) {}

  private key(text: string): string {
    return `translate:${this.prefix}:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;
  }

  /** The texts in the app's language: English → translated (cached); otherwise, or on failure, as stored. */
  async texts(list: string[], lang: AppLang): Promise<string[]> {
    if (lang !== 'en') return list;
    const out = [...list];
    const missing: number[] = [];
    await Promise.all(
      list.map(async (text, index) => {
        if (!ARABIC.test(text)) return;
        const cached = await this.kv.get<string>(this.key(text));
        if (cached) out[index] = cached;
        else missing.push(index);
      }),
    );
    if (!missing.length) return out;
    const unique = [...new Set(missing.map((index) => list[index] ?? ''))];
    const translated = await this.translator.translate(unique).catch(() => null);
    if (!translated) return out;
    const done = new Map<string, string>();
    await Promise.all(
      unique.map(async (text, index) => {
        const english = (translated[index] ?? '').trim();
        if (!english || ARABIC.test(english)) return;
        done.set(text, english);
        await this.kv.set(this.key(text), english);
      }),
    );
    for (const index of missing) out[index] = done.get(list[index] ?? '') ?? out[index] ?? '';
    return out;
  }

  /** One text. */
  async text(value: string, lang: AppLang): Promise<string> {
    return (await this.texts([value], lang))[0] ?? value;
  }

  /** Rewrites the chosen string fields of each row (e.g. `title`), keeping everything else. */
  async rows<T extends object>(rows: T[], fields: (keyof T)[], lang: AppLang): Promise<T[]> {
    if (lang !== 'en' || !rows.length) return rows;
    const values: string[] = [];
    for (const row of rows) for (const field of fields) values.push(typeof row[field] === 'string' ? (row[field] as string) : '');
    const shown = await this.texts(values, lang).catch(() => values);
    let at = 0;
    return rows.map((row) => {
      const copy = { ...row };
      for (const field of fields) {
        const value = shown[at++];
        if (typeof row[field] === 'string' && value !== undefined) (copy as Record<keyof T, unknown>)[field] = value;
      }
      return copy;
    });
  }
}
