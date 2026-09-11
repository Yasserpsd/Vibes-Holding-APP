/** Shapes of the news engine (CLAUDE.md rule 7: items are real, fetched pages; AI only labels them). */

export type SourceTier = 'official' | 'saudi' | 'global';
export type NewsLang = 'ar' | 'en';

export const TIER_LABELS: Record<SourceTier, string> = {
  official: 'مصدر رسمي',
  saudi: 'إعلام سعودي',
  global: 'إعلام عالمي',
};

/** A polled feed. Stored as server-driven content so the dashboard can edit the list later. */
export type NewsSource = {
  id: string;
  /** Display name of the outlet, in Arabic when the outlet has one. */
  name: string;
  /** RSS or Atom URL. Bing News RSS search URLs are accepted: their links resolve to the original article. */
  url: string;
  tier: SourceTier;
  lang: NewsLang;
  enabled: boolean;
  /** What the feed covers, given to the classifier as context. */
  hint: string | null;
};

export type NewsSourcesContent = { sources: NewsSource[]; updatedAt: string };

export const NEWS_TOPICS = [
  { key: 'economy', label: 'الاقتصاد والأعمال' },
  { key: 'markets', label: 'الأسواق والأسهم' },
  { key: 'finance', label: 'البنوك والتمويل' },
  { key: 'realestate', label: 'العقار والإنشاءات' },
  { key: 'startups', label: 'ريادة الأعمال والشركات الناشئة' },
  { key: 'tech', label: 'التقنية والذكاء الاصطناعي' },
  { key: 'energy', label: 'الطاقة والتعدين' },
  { key: 'industry', label: 'الصناعة واللوجستيات' },
  { key: 'retail', label: 'التجزئة والتجارة الإلكترونية' },
  { key: 'tourism', label: 'السياحة والترفيه' },
  { key: 'sports', label: 'الرياضة (الجانب الاستثماري)' },
] as const;

export type TopicKey = (typeof NEWS_TOPICS)[number]['key'];
export const TOPIC_KEYS = NEWS_TOPICS.map((topic) => topic.key) as TopicKey[];
export const TOPIC_LABELS = Object.fromEntries(NEWS_TOPICS.map((topic) => [topic.key, topic.label])) as Record<TopicKey, string>;

export function isTopicKey(value: unknown): value is TopicKey {
  return typeof value === 'string' && (TOPIC_KEYS as string[]).includes(value);
}

/** What the classifier adds to an item. */
export type Classification = {
  topics: TopicKey[];
  /** An official Saudi decision, law, regulation, licence or ruling («قرارات وأنظمة المملكة»). */
  decision: boolean;
  /** Sports items are kept only with a money angle; other items: relevant to business at all. */
  businessAngle: boolean;
  /** 0–100: how useful the item is to Saudi investors and entrepreneurs. */
  relevance: number;
};

export type ClassifierMode = 'openai' | 'keywords';

/** One stored item. Title, snippet, URL, image and time all come from the source, never from AI. */
export type NewsItem = Classification & {
  id: string;
  sourceId: string;
  sourceName: string;
  tier: SourceTier;
  lang: NewsLang;
  title: string;
  snippet: string | null;
  url: string;
  image: string | null;
  publishedAt: string;
  /** When the server fetched the article page successfully. */
  verifiedAt: string;
  classifiedBy: ClassifierMode;
  /** Hidden by the rules (sports without a money angle, off-topic) — kept so the run does not refetch it. */
  hidden: boolean;
  /** Another item tells the same story from a better-ranked source. */
  duplicateOf: string | null;
};

export type NewsSnapshot = { version: 1; items: NewsItem[]; updatedAt: string };

export type PublicNewsItem = {
  id: string;
  title: string;
  snippet: string | null;
  url: string;
  image: string | null;
  publishedAt: string;
  source: { id: string; name: string; tier: SourceTier; tierLabel: string };
  topics: { key: TopicKey; label: string }[];
  decision: boolean;
  lang: NewsLang;
};

export type NewsPage = {
  items: PublicNewsItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  updatedAt: string | null;
  /** Whether the ranking used the member's interests. */
  personalized: boolean;
};

export type NewsPrefs = { topics: TopicKey[]; updatedAt: string };

export type SourceStatus = {
  id: string;
  name: string;
  ok: boolean;
  /** Entries in the feed at the last poll. */
  count: number;
  /** Items from this source currently stored (verified pages). */
  stored: number;
  /** Article pages that could not be fetched at the last poll (never shown). */
  failed: number;
  error: string | null;
  at: string | null;
};

export type NewsStatus = {
  count: number;
  visible: number;
  decisions: number;
  updatedAt: string | null;
  lastError: string | null;
  running: boolean;
  classifier: ClassifierMode;
  sources: SourceStatus[];
};
