import { mentionsSaudi } from './classify.js';
import type { NewsItem } from './types.js';

/**
 * M221 (owner, 2026-11-09: «في كمية أخبار عن المغرب والسودان، أنا عايز أخبار سعودية أو عالمية تمس السوق
 * السعودي أو أسعار أسهم»): where a story is about, read from the source's own headline — selection and
 * ranking only, never a word rewritten (rule 7).
 *
 * - `saudi`: the headline (or the opening lines) names Saudi Arabia, a Saudi city or a Saudi market name.
 * - `foreign`: the headline names another single country outside the Gulf and the big economies (Egypt,
 *   Sudan, Morocco, Iraq, Turkey…) with no Saudi name next to it — never shown, unless it is a world oil story.
 * - `gulf`: a Gulf neighbour. `global`: world markets (oil, gold, the Fed, Wall Street, crypto, the big economies).
 * - `neutral`: no place named — the usual headline of a Saudi outlet about home.
 */
export type Geo = 'saudi' | 'gulf' | 'global' | 'foreign' | 'neutral';

/** Ranking points on top of scoreOf: Saudi first by a wide margin, then world markets, then the Gulf. */
export const GEO_BOOST: Record<Geo, number> = { saudi: 30, global: 12, gulf: 5, neutral: 0, foreign: 0 };

const LEDE_CHARS = 220;

/** Hamza seats, final ya, diacritics and tatweel differ between outlets: «الأردن» and «الاردن» are one word. */
function norm(text: string): string {
  return text
    .replace(/[ً-ْـ]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي');
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole Arabic words only, so «مصر» never matches «مصرف» and «مالي» stays out of the list altogether. A
 * conjunction and a preposition may precede the word; the article is optional or required («القاهرة» the
 * city, not «قوة قاهرة»).
 */
function words(stems: string[], article: 'optional' | 'required' = 'optional'): string {
  return `(?<!\\p{L})(?:و|ف)?(?:ب|ل|ك)?(?:ال|ل)${article === 'optional' ? '?' : ''}(?:${stems.map((stem) => escape(norm(stem))).join('|')})(?!\\p{L})`;
}

/** A country with its adjective forms: «مصر», «مصري», «المصرية», «المصريين». */
function country(name: string, stem = name): string[] {
  return [name, `${stem}ي`, `${stem}ية`, `${stem}يين`, `${stem}يون`];
}

function either(...parts: string[]): RegExp {
  return new RegExp(parts.join('|'), 'iu');
}

const latin = (terms: string): string => `\\b(?:${terms})\\b`;

// «سعود» carries السعودية، سعودي، السعوديون; «المملكة» alone is Saudi Arabia in Arabic outlets, but not «المملكة المتحدة».
const SAUDI_STRONG_AR = [
  '(?<!\\p{L})(?:و|ف)?(?:ب|ل|ك)?(?:ال|ل)?سعود',
  '(?<!\\p{L})(?:و|ف)?(?:ب|ل|ك)?(?:ال|ل)مملكة(?!\\p{L})(?!\\s+(?:المتحدة|المغربية|الاردنية))',
  words(['أرامكو', 'سابك', 'تاسي', 'ساما', 'نيوم', 'صندوق الاستثمارات العامة', 'رؤية 2030']),
];
const SAUDI_STRONG = either(...SAUDI_STRONG_AR);
// City names count in the headline only: a snippet often opens with the outlet's dateline.
const SAUDI_TITLE = either(
  ...SAUDI_STRONG_AR,
  words(['رياض', 'دمام', 'ظهران', 'جبيل', 'قصيم', 'أحساء', 'طائف', 'درعية', 'قدية', 'مدينة المنورة', 'راجحي'], 'required'),
  words(['جدة', 'مكة', 'ينبع', 'تبوك', 'حائل', 'جازان', 'نجران']),
);

const FOREIGN = either(
  words([
    ...country('مصر'), ...country('سودان'), ...country('مغرب'), ...country('تونس'), ...country('جزائر'), ...country('ليبيا', 'ليب'),
    ...country('موريتانيا', 'موريتان'), ...country('أردن'), ...country('لبنان'), ...country('سوريا', 'سور'), ...country('عراق'),
    ...country('يمن'), ...country('فلسطين'), ...country('صومال'), 'جيبوتي', 'جزر القمر', 'غزة', 'كردستان',
    'تركيا', 'تركية', ...country('إيران'), ...country('باكستان'), ...country('بنغلاديش'), ...country('أفغانستان', 'أفغان'),
    ...country('إثيوبيا', 'إثيوب'), 'إريتريا', ...country('كينيا', 'كين'), ...country('تنزانيا', 'تنزان'), ...country('نيجيريا', 'نيجير'),
    ...country('غابون'), 'غانا', ...country('سنغال'), 'جنوب أفريقيا', 'جنوب إفريقيا', 'أوغندا', 'تشاد', 'نيجر', 'كونغو', 'أنغولا',
    'زامبيا', 'زيمبابوي', 'موزمبيق', 'كاميرون', 'ساحل العاج', 'كوت ديفوار', 'رواندا', 'سريلانكا', 'نيبال',
    'فنزويلا', ...country('أرجنتين'), 'كولومبيا', 'تشيلي', ...country('مكسيك'), ...country('برازيل'),
    'خرطوم', 'رباط', 'دار البيضاء', 'مراكش', 'طرابلس', 'بغداد', 'أربيل', 'دمشق', 'بيروت', 'صنعاء', 'عدن', 'أنقرة', 'إسطنبول', 'طهران', 'إسلام آباد', 'نيروبي', 'أديس أبابا',
  ]),
  words(['قاهرة', 'إسكندرية'], 'required'),
  latin(
    'egypt(?:ian)?|sudan(?:ese)?|morocc(?:o|an)|tunisian?|algerian?|libyan?|mauritania|jordan(?:ian)?|leban(?:on|ese)|syrian?|iraqi?|yemeni?|palestin(?:e|ian)|gaza|somalia|djibouti|' +
      'turkey|t[uü]rkiye|turkish|iran(?:ian)?|pakistani?|bangladeshi?|afghanistan|ethiopian?|eritrea|kenyan?|tanzanian?|nigerian?|gabon(?:ese)?|ghana(?:ian)?|senegal|south african?|uganda|' +
      'congo|angola|zambia|zimbabwe|mozambique|cameroon|ivory coast|rwanda|sri lanka|nepal|venezuela|argentin(?:a|e)|colombia|chile|mexic(?:o|an)|brazil(?:ian)?|' +
      'cairo|khartoum|rabat|casablanca|baghdad|damascus|beirut|ankara|istanbul|tehran|nairobi',
  ),
);

/** A world oil story is club news whoever the producer is (Iraq's output, Hormuz, an OPEC member's quota). */
const OIL_WORLD = either(words(['نفط', 'أوبك', 'برنت', 'هرمز']), latin('oil|opec|brent|crude|hormuz'));

const GULF = either(
  words(['خليج', 'شارقة', 'دوحة', 'منامة'], 'required'),
  words(['خليجي', 'خليجية', ...country('إمارات'), 'دبي', 'أبوظبي', 'أبو ظبي', ...country('قطر'), ...country('كويت'), ...country('بحرين'), 'سلطنة عمان', 'مسقط', 'مجلس التعاون']),
  latin('gulf|gcc|uae|emirat\\w*|dubai|abu dhabi|qatar\\w*|doha|kuwait\\w*|bahrain\\w*|oman\\w*|muscat'),
);

const GLOBAL = either(
  words([
    'نفط', 'برنت', 'أوبك', 'خام', 'ذهب', 'فضة', 'بيتكوين', 'بتكوين', 'إيثريوم', 'عملات المشفرة', 'عملات الرقمية', 'عملات مشفرة', 'عملات رقمية', 'دولار', 'فيدرالي', 'وول ستريت', 'ناسداك', 'داو جونز',
    'عالمي', 'عالمية', 'عالم', 'أمريكا', 'أميركا', 'أمريكي', 'أميركي', 'أمريكية', 'أميركية', 'ولايات المتحدة', 'صين', 'صيني', 'صينية', 'أوروبا', 'أوروبي', 'أوروبية', 'يابان', 'ياباني',
    'ترمب', 'ترامب', 'رسوم الجمركية', 'بنك الدولي', 'صندوق النقد الدولي', 'هرمز',
  ]),
  latin(
    'fed|federal reserve|wall street|opec|brent|crude|oil|gold|silver|bitcoin|btc|crypto\\w*|ethereum|stablecoins?|dollar|nasdaq|s&p|dow|treasur\\w*|global|world|china|chinese|u\\.s\\.|america\\w*|europe\\w*|ecb|japan\\w*|tariffs?|trump|hormuz',
  ),
);

type Placed = Pick<NewsItem, 'title' | 'snippet' | 'lang' | 'tier'>;

export function geoOf(item: Placed): Geo {
  const title = norm(item.title);
  const lede = norm((item.snippet ?? '').slice(0, LEDE_CHARS));
  const english = item.lang === 'en';
  if (SAUDI_TITLE.test(title) || (english && mentionsSaudi(item.title, null, item.tier))) return 'saudi';
  if (FOREIGN.test(title)) return OIL_WORLD.test(title) ? 'global' : 'foreign';
  if (SAUDI_STRONG.test(lede) || (english && mentionsSaudi('', item.snippet, item.tier))) return 'saudi';
  if (GULF.test(title)) return 'gulf';
  if (GLOBAL.test(title)) return 'global';
  // A Saudi outlet's plain headline is about home even when its first lines name a guest country; a foreign
  // outlet's plain headline whose first lines are another country's is that country's local story.
  if (item.tier === 'global' && FOREIGN.test(lede) && !GLOBAL.test(lede)) return 'foreign';
  return 'neutral';
}

const cache = new WeakMap<object, Geo>();

/** geoOf, computed once per stored item (the title and snippet of an item never change). */
export function geoFor(item: NewsItem): Geo {
  let geo = cache.get(item);
  if (!geo) {
    geo = geoOf(item);
    cache.set(item, geo);
  }
  return geo;
}
