import type { Classification, ClassifierMode, NewsLang, SourceTier, TopicKey } from './types.js';

/** What the classifier sees: the source's own title and snippet, never the full page. */
export type ClassifyInput = {
  id: string;
  title: string;
  snippet: string | null;
  source: string;
  tier: SourceTier;
  lang: NewsLang;
  hint: string | null;
};

export interface Classifier {
  readonly mode: ClassifierMode;
  classify(items: ClassifyInput[]): Promise<Classification[]>;
}

/** Items below this relevance are kept in the store but never shown. */
export const MIN_RELEVANCE = 30;

const ARABIC_PREFIX = '(?:ال|وال|بال|فال|كال|لل|و|ب|ل|ف|ك)?';

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Arabic terms must start a word (an optional article or particle may precede them), so «مطار»
 * does not match «أمطار»; suffixes stay allowed (plurals, pronouns). Latin terms use word boundaries.
 */
function pattern(terms: string[]): RegExp {
  const parts = terms.map((term) => (/[؀-ۿ]/.test(term) ? `(?<!\\p{L})${ARABIC_PREFIX}${escape(term)}` : `\\b${escape(term)}`));
  return new RegExp(parts.join('|'), 'iu');
}

const TOPIC_TERMS: Record<Exclude<TopicKey, 'sports'>, string[]> = {
  economy: ['اقتصاد', 'الناتج المحلي', 'تضخم', 'نمو اقتصادي', 'استثمار', 'مستثمر', 'ميزانية', 'صندوق الاستثمارات', 'رؤية 2030', 'تجارة', 'صادرات', 'واردات', 'غرفة تجارية', 'منشآت', 'قطاع خاص', 'شركات', 'economy', 'economic', 'gdp', 'inflation', 'invest', 'trade', 'budget'],
  markets: ['تداول', 'أسهم', 'سهم', 'سوق مالية', 'السوق المالية', 'مؤشر', 'تاسي', 'اكتتاب', 'طرح عام', 'صكوك', 'سندات', 'هيئة السوق', 'أرباح', 'توزيعات', 'سوق موازية', 'stock', 'shares', 'tadawul', 'tasi', 'ipo', 'index', 'sukuk', 'bond', 'dividend', 'listing', 'market'],
  finance: ['بنك', 'مصرف', 'تمويل', 'قرض', 'قروض', 'ساما', 'البنك المركزي', 'فائدة', 'تأمين', 'تقنية مالية', 'مدفوعات', 'محفظة رقمية', 'bank', 'loan', 'financ', 'sama', 'central bank', 'interest rate', 'insurance', 'fintech', 'payment'],
  realestate: ['عقار', 'إسكان', 'سكني', 'أراضي', 'مخطط', 'إيجار', 'مقاول', 'إنشاءات', 'تطوير عمراني', 'رهن عقاري', 'وحدات سكنية', 'real estate', 'housing', 'property', 'construction', 'developer', 'rent', 'mortgage'],
  startups: ['ريادة', 'رواد الأعمال', 'رائد أعمال', 'شركة ناشئة', 'شركات ناشئة', 'ناشئة', 'جولة تمويل', 'جولة استثمار', 'تمويل بذري', 'مسرعة', 'حاضنة', 'رأس المال الجريء', 'startup', 'venture', 'seed round', 'series a', 'series b', 'series c', 'accelerator', 'incubator', 'founder', 'entrepreneur'],
  tech: ['تقنية', 'تقني', 'ذكاء اصطناعي', 'الذكاء الاصطناعي', 'رقمي', 'رقمنة', 'تطبيق', 'منصة', 'سيبراني', 'بيانات', 'حوسبة', 'سحابية', 'روبوت', 'تكنولوجيا', 'شرائح', 'ai', 'artificial intelligence', 'tech', 'digital', 'software', 'cyber', 'cloud', 'data center', 'chip', 'semiconductor', 'robot'],
  energy: ['نفط', 'بترول', 'أرامكو', 'أوبك', 'طاقة', 'غاز', 'كهرباء', 'متجددة', 'شمسية', 'طاقة الرياح', 'هيدروجين', 'تعدين', 'معادن', 'منجم', 'ذهب', 'oil', 'petrol', 'aramco', 'opec', 'energy', 'gas', 'electric', 'renewable', 'solar', 'wind', 'hydrogen', 'mining', 'mineral', 'gold'],
  industry: ['صناعة', 'صناعي', 'مصنع', 'مصانع', 'لوجستي', 'شحن', 'موانئ', 'ميناء', 'سكك', 'قطار', 'طيران', 'سيارات', 'تصنيع', 'سلاسل الإمداد', 'industr', 'factory', 'manufactur', 'logistic', 'shipping', 'port', 'rail', 'aviation', 'automotive', 'supply chain'],
  retail: ['تجزئة', 'تجارة إلكترونية', 'متاجر', 'متجر', 'مبيعات', 'مستهلك', 'امتياز تجاري', 'فرنشايز', 'مطاعم', 'أغذية', 'منتجات', 'علامة تجارية', 'retail', 'e-commerce', 'ecommerce', 'store', 'consumer', 'franchise', 'restaurant', 'brand', 'sales'],
  tourism: ['سياحة', 'سياحي', 'ترفيه', 'فنادق', 'فندق', 'مطار', 'حج', 'عمرة', 'موسم', 'مهرجان', 'معرض', 'القدية', 'نيوم', 'البحر الأحمر', 'tourism', 'tourist', 'entertainment', 'hotel', 'airport', 'hajj', 'umrah', 'festival', 'expo', 'qiddiya', 'neom', 'red sea'],
};
const TOPIC_PATTERNS = Object.fromEntries(Object.entries(TOPIC_TERMS).map(([key, terms]) => [key, pattern(terms)])) as Record<Exclude<TopicKey, 'sports'>, RegExp>;

/** Money and business vocabulary: an item without any of these is small talk for this audience. */
const BUSINESS = pattern(['مليون', 'مليار', 'ريال', 'دولار', 'استثمار', 'مستثمر', 'أسهم', 'تداول', 'تمويل', 'اكتتاب', 'أرباح', 'إيرادات', 'صفقة', 'استحواذ', 'شراكة', 'اتفاقية', 'مذكرة تفاهم', 'عقد', 'عقود', 'مشروع', 'مشاريع', 'شركة', 'شركات', 'سوق', 'أسواق', 'اقتصاد', 'تجارة', 'صناعة', 'عقار', 'نفط', 'بنك', 'مصرف', 'ترخيص', 'تصدير', 'استيراد', 'منشآت', 'ريادة', 'ناشئة', 'مصنع', 'billion', 'million', 'invest', 'market', 'stock', 'compan', 'deal', 'econom', 'trade', 'bank', 'startup', 'ipo', 'revenue', 'profit', 'sector']);
/** Protocol, aid, weather and conflict items: shown only when they also carry business vocabulary. */
const NOISE = pattern(['اهتمامات الصحف', 'الصحف', 'ترقية', 'ترقيات', 'تعيين', 'تكليف', 'يجتمع', 'اجتمع', 'يبحث', 'سفير', 'سفارة', 'يختتم', 'اختتام', 'مركز الملك سلمان للإغاثة', 'يوزع', 'يوزّع', 'يضخ', 'يفتتح', 'افتتح', 'يرعى', 'يدشن', 'يدشّن', 'اتصالًا هاتفيًا', 'اتصالاً هاتفياً', 'اتصالا هاتفيا', 'يتلقى رسالة', 'يتلقى برقية', 'يبعث برقية', 'يهنئ', 'يعزي', 'تعزية', 'يستقبل', 'استقبل', 'يلتقي', 'التقى', 'يودع', 'يصل إلى', 'إغاثة', 'الإغاثة', 'سلة غذائية', 'سلال غذائية', 'كرتون', 'طقس', 'أمطار', 'الأرصاد', 'درجات الحرارة', 'قوات الاحتلال', 'استشهاد', 'إصابة', 'هجمات', 'مسيّرة', 'قصف', 'مقتل', 'حادث', 'وفاة', 'يدين', 'تدين', 'إدانة', 'مباراة', 'condol', 'congratulat', 'phone call', 'receives', 'weather', 'rain', 'killed', 'injur', 'attack', 'condemn']);
const SPORTS = pattern(['دوري', 'كرة القدم', 'لاعب', 'مدرب', 'مباراة', 'بطولة', 'كأس العالم', 'كأس آسيا', 'الهلال', 'النصر', 'أولمبي', 'منتخب', 'صفقة انتقال', 'football', 'soccer', 'league', 'player', 'coach', 'match', 'tournament', 'olympic', 'transfer']);
const MONEY = pattern(['استحواذ', 'رعاية', 'راعي', 'حقوق البث', 'صفقة', 'مليون', 'مليار', 'ريال', 'دولار', 'استثمار', 'عقد', 'إيرادات', 'تمويل', 'acquisition', 'sponsor', 'broadcast', 'rights', 'deal', 'million', 'billion', 'revenue', 'invest', 'contract']);

/** A decision needs an act (verb) and an instrument (noun) in the title, plus an authority in the title or snippet. */
const DECISION_VERB = pattern(['يوافق', 'توافق', 'وافق', 'وافقت', 'موافقة', 'يقر', 'تقر', 'أقر', 'أقرت', 'أقرّ', 'إقرار', 'يعتمد', 'تعتمد', 'اعتمد', 'اعتمدت', 'اعتماد', 'يصدر', 'تصدر', 'أصدر', 'أصدرت', 'إصدار', 'يعدل', 'تعدل', 'تعديل', 'تمديد', 'يمدد', 'تمدد', 'تحدّث', 'تحدث', 'تحديث', 'إلزام', 'يلزم', 'تلزم', 'يحظر', 'تحظر', 'حظر', 'إلغاء', 'يلغي', 'تلغي', 'فرض', 'يفرض', 'تفرض', 'بدء تطبيق', 'يبدأ تطبيق', 'يدخل حيز', 'تدخل حيز', 'سريان', 'إيقاف', 'تعليق', 'يمنح', 'تمنح', 'منح', 'يحدد', 'تحدد', 'تحديد', 'يقرر', 'تقرر', 'قرر', 'قررت', 'يطلق', 'تطلق', 'أطلق', 'أطلقت', 'إطلاق', 'يحسم', 'تحسم', 'يشترط', 'تشترط', 'approv', 'issue', 'amend', 'extend', 'enforce', 'impose', 'suspend', 'ban', 'mandat', 'licens', 'regulat', 'grant', 'launch', 'set']);
const DECISION_NOUN = pattern(['نظام', 'أنظمة', 'لائحة', 'لوائح', 'قرار', 'قرارات', 'مرسوم', 'أمر ملكي', 'أمر سام', 'تعميم', 'رسوم', 'ضريبة', 'ضرائب', 'ضوابط', 'اشتراطات', 'تعليمات', 'آلية', 'مهلة', 'مهل', 'ترخيص', 'تراخيص', 'تصريح', 'تصاريح', 'شرط', 'شروط', 'تصحيح أوضاع', 'إعفاء', 'غرامة', 'غرامات', 'عقوبات', 'حوافز', 'إجراءات', 'تنظيم', 'law', 'regulation', 'decree', 'decision', 'licen', 'fee', 'tax', 'deadline', 'rule', 'requirement', 'penalt', 'fine', 'incentive']);
const CABINET = pattern(['مجلس الوزراء يوافق', 'مجلس الوزراء وافق', 'وافق مجلس الوزراء', 'مجلس الوزراء يقر', 'أقر مجلس الوزراء', 'مجلس الوزراء يقرر', 'قرر مجلس الوزراء', 'قرارات مجلس الوزراء', 'cabinet approv']);
const AUTHORITY = pattern(['السعودية', 'سعودي', 'المملكة', 'هيئة', 'وزارة', 'وزير', 'البنك المركزي', 'ساما', 'مجلس', 'أمانة', 'الجهات المختصة', 'saudi', 'kingdom', 'ministry', 'authority', 'cabinet', 'sama', 'cma', 'zatca', 'misa', 'monsha']);
const SAUDI = pattern(['السعودية', 'سعودي', 'المملكة', 'الرياض', 'جدة', 'الدمام', 'saudi', 'kingdom', 'riyadh', 'jeddah', 'dammam']);
/** Another country's decision reported by a Saudi outlet is not a Saudi decision. */
const FOREIGN = pattern(['الإمارات', 'الكويت', 'قطر', 'البحرين', 'عُمان', 'سلطنة', 'مصر', 'الأردن', 'العراق', 'سوريا', 'لبنان', 'تركيا', 'إيران', 'أمريكا', 'أمريكي', 'الولايات المتحدة', 'أوروبا', 'أوروبي', 'بريطانيا', 'بريطاني', 'فرنسا', 'ألمانيا', 'الصين', 'الهند', 'اليابان', 'روسيا', 'الفيدرالي', 'uae', 'emirates', 'kuwait', 'qatar', 'bahrain', 'oman', 'egypt', 'jordan', 'iraq', 'turkey', 'iran', 'europe', 'u.s.', 'federal reserve', 'china', 'india', 'japan', 'russia']);

/**
 * Applied to every classifier's answer: the fixed decisions section never carries sports, protocol,
 * condolences, condemnations or another country's decisions, whatever the model said.
 */
export function decisionGuard(item: ClassifyInput, topics: TopicKey[]): boolean {
  if (topics.includes('sports') || SPORTS.test(item.title)) return false;
  if (NOISE.test(item.title) && !BUSINESS.test(item.title)) return false;
  const text = `${item.title} ${item.snippet ?? ''}`;
  const saudi = SAUDI.test(text);
  return saudi || (item.tier !== 'global' && !FOREIGN.test(text));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Keyword labelling: used when no OPENAI_API_KEY is set and as the fallback when the API fails.
 * Precision is modest; the fixed decisions section is the place where this matters most.
 */
export class KeywordClassifier implements Classifier {
  readonly mode = 'keywords' as const;

  async classify(items: ClassifyInput[]): Promise<Classification[]> {
    return items.map((item) => classifyByKeywords(item));
  }
}

export function classifyByKeywords(item: ClassifyInput): Classification {
  const text = `${item.title} ${item.snippet ?? ''}`;
  const topics = (Object.keys(TOPIC_PATTERNS) as Exclude<TopicKey, 'sports'>[]).filter((key) => TOPIC_PATTERNS[key].test(text));
  const sports = SPORTS.test(item.title);
  const money = MONEY.test(text);
  if (sports) {
    return { topics: money ? ['sports', ...topics.slice(0, 2)] : ['sports'], decision: false, businessAngle: money, relevance: money ? 45 : 10 };
  }
  const business = BUSINESS.test(text);
  // Protocol, aid and conflict headlines stay hidden even when the snippet mentions money.
  const noise = NOISE.test(item.title) && !BUSINESS.test(item.title);
  const saudi = SAUDI.test(text);
  // Official and Saudi outlets report Saudi decisions without naming the country; global ones must.
  const saudiSignal = saudi || (item.tier !== 'global' && !FOREIGN.test(text));
  const decision =
    !noise && saudiSignal && AUTHORITY.test(text) && (CABINET.test(text) || (DECISION_VERB.test(item.title) && DECISION_NOUN.test(item.title)));
  const businessAngle = !noise && (topics.length > 0 || business || decision);
  let relevance = noise ? 10 : 15 + (business ? 20 : 0) + Math.min(3, topics.length) * 10;
  if (decision) relevance = Math.max(relevance, 75);
  if (saudi && businessAngle) relevance += 10;
  return { topics: topics.slice(0, 3), decision, businessAngle, relevance: clamp(relevance) };
}
