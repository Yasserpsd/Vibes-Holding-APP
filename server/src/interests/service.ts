import { RequestError } from '../auth/guard.js';
import type { NewsService } from '../news/service.js';
import type { TopicKey } from '../news/types.js';
import type { KV } from '../store.js';
import { interestLabel, isInterestKey, MAX_INTERESTS, newsTopicsOf, type InterestKey } from './types.js';

/**
 * M107: the member's unified interests, stored once with the account (one kv document; the preview
 * circle is small and the push targeting needs the whole map anyway). Saving also writes the mapped
 * news prefs, so the existing feed ranking keeps working untouched.
 */
export const INTERESTS_KEY = 'interests:prefs';

export type InterestPrefs = { keys: InterestKey[]; other: string; updatedAt: string };

type Doc = { byContact: Record<string, InterestPrefs> };

/** Interests assumed from the persona until the member picks their own (mirrors the news defaults). */
const PERSONA_INTERESTS: Record<string, InterestKey[]> = {
  neutral: ['invest', 'startups'],
  entrepreneur: ['startups', 'tech', 'trade'],
  investor: ['invest', 'realestate', 'energy'],
};

type Deps = { kv: KV; news: NewsService };

export class InterestsService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<Doc> {
    return (await this.deps.kv.get<Doc>(INTERESTS_KEY)) ?? { byContact: {} };
  }

  private mutate<T>(change: (doc: Doc) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const doc = await this.load();
      const result = change(doc);
      await this.deps.kv.set(INTERESTS_KEY, doc);
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async mine(contactId: number): Promise<InterestPrefs | null> {
    return (await this.load()).byContact[String(contactId)] ?? null;
  }

  suggested(persona: string): InterestKey[] {
    return PERSONA_INTERESTS[persona] ?? [];
  }

  /** Saves 1–3 interests (plus the «أخرى» text) and mirrors them into the news prefs for the ranking. */
  async save(contactId: number, rawKeys: string[], rawOther: string | undefined): Promise<InterestPrefs> {
    const keys = [...new Set(rawKeys.filter(isInterestKey))];
    if (keys.length === 0) throw new RequestError('invalid', 'اختر اهتمامًا واحدًا على الأقل');
    if (keys.length > MAX_INTERESTS) throw new RequestError('invalid', `اختر ${MAX_INTERESTS} اهتمامات كحد أقصى`);
    const other = keys.includes('other') ? (rawOther ?? '').trim().slice(0, 120) : '';
    const prefs: InterestPrefs = { keys, other, updatedAt: new Date().toISOString() };
    await this.mutate((doc) => {
      doc.byContact[String(contactId)] = prefs;
    });
    await this.deps.news.savePrefs(contactId, newsTopicsOf(keys));
    return prefs;
  }

  /** The news topics this account's feed should boost: its interests when saved, else null (legacy prefs decide). */
  async newsTopicsFor(contactId: number): Promise<TopicKey[] | null> {
    const prefs = await this.mine(contactId);
    return prefs ? newsTopicsOf(prefs.keys) : null;
  }

  /** Contacts whose saved interests include this key — plus, when asked, those who saved nothing. */
  async contactsFor(key: InterestKey): Promise<{ picked: Set<number>; savedAny: Set<number> }> {
    const doc = await this.load();
    const picked = new Set<number>();
    const savedAny = new Set<number>();
    for (const [contactId, prefs] of Object.entries(doc.byContact)) {
      const id = Number(contactId);
      savedAny.add(id);
      if (prefs.keys.includes(key)) picked.add(id);
    }
    return { picked, savedAny };
  }

  /** M116 (owner's «الحتة التنظيمية»): the members screen shows every account's interests as labels. */
  async labelsFor(contactIds: number[]): Promise<Record<number, string[]>> {
    const doc = await this.load();
    const out: Record<number, string[]> = {};
    for (const id of contactIds) {
      const prefs = doc.byContact[String(id)];
      if (!prefs) continue;
      out[id] = prefs.keys.map((key) => (key === 'other' && prefs.other ? `أخرى: ${prefs.other}` : interestLabel(key)));
    }
    return out;
  }

  /** Dashboard report: how many members picked each interest, and every «أخرى» text for the monthly review. */
  async report(): Promise<{
    total: number;
    counts: { key: InterestKey; label: string; count: number }[];
    others: { contactId: number; text: string; updatedAt: string }[];
  }> {
    const doc = await this.load();
    const rows = Object.entries(doc.byContact);
    const tally = new Map<InterestKey, number>();
    const others: { contactId: number; text: string; updatedAt: string }[] = [];
    for (const [contactId, prefs] of rows) {
      for (const key of prefs.keys) tally.set(key, (tally.get(key) ?? 0) + 1);
      if (prefs.other) others.push({ contactId: Number(contactId), text: prefs.other, updatedAt: prefs.updatedAt });
    }
    others.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const counts = [...tally.entries()]
      .map(([key, count]) => ({ key, label: interestLabel(key), count }))
      .sort((a, b) => b.count - a.count);
    return { total: rows.length, counts, others };
  }
}
