/**
 * Founders' free text can embed phones, e-mails, links and handles. Anything built from it for the AI brief or the
 * advisor's context goes through here first, so contact data never leaves through a side door (CLAUDE.md rule 4).
 */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_LIKE = /(?:https?:\/\/|www\.)[^\s<>()«»"']+/gi;
const DOMAIN = /(?<![\w@])[a-z0-9-]{2,}\.(?:com|net|org|sa|io|co|app|me|info|store|shop)(?:\.[a-z]{2})?(?:\/[^\s]*)?/gi;
const HANDLE = /(?<![\w.])@[\w.]{3,}/g;
const PHONE = /(?:\+|00)?[\d٠-٩][\d٠-٩\s\-()]{7,}[\d٠-٩]/g;
const CONTACT_LABEL = /(?:واتس\s?اب|واتساب|whats\s?app|جوال|هاتف|للتواصل|تواصل معنا|البريد الإلكتروني|الإيميل|ايميل|email|انستقرام|انستغرام|instagram|تويتر|twitter|سناب|snapchat|تيك توك|tiktok|لينكد ?إن|linkedin)\s*[:：\-–]?\s*(?=$|\n|[•|،,.])/gim;

const digits = (value: string): number => value.replace(/[^\d٠-٩]/g, '').length;

export function stripContacts(input: string): string {
  return input
    .replace(EMAIL, ' ')
    .replace(URL_LIKE, ' ')
    .replace(DOMAIN, ' ')
    .replace(HANDLE, ' ')
    // Nine digits or more is a phone number; amounts are written shorter or with separators.
    .replace(PHONE, (match) => (digits(match) >= 9 ? ' ' : match))
    .replace(CONTACT_LABEL, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when a text still looks like it carries a way to reach someone. */
export function hasContact(input: string): boolean {
  // `search` ignores the patterns' global state.
  return [EMAIL, URL_LIKE, DOMAIN, HANDLE].some((pattern) => input.search(pattern) >= 0) || (input.match(PHONE) ?? []).some((match) => digits(match) >= 9);
}

/**
 * The owner's rule for the Projects Bank inside the app (2026-09-21): a project shows what it IS, never what it asks
 * for. The funding sought, the investment amount, a valuation, the equity on offer and what an investor would earn are
 * cut out of the founder's text before anything is stored, shown, summarised or handed to the advisor.
 */
const ARABIC = /[ء-ي]/;
/**
 * Founders spell freely (أ إ آ for ا, ى for ي, tashkeel, tatweel). The patterns below are written for one spelling and run
 * on this copy; `map` leads from a position in it back to the original text.
 */
function normalise(text: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (/[ً-ْـ]/.test(char)) continue;
    out += char === 'أ' || char === 'إ' || char === 'آ' ? 'ا' : char === 'ى' ? 'ي' : char;
    map.push(index);
  }
  return { text: out, map };
}
/** The same spelling for the letters of a pattern, so the patterns can be written the way the words are usually spelled. */
const spell = (source: string): string => source.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');
const ar = (pattern: RegExp): RegExp => new RegExp(spell(pattern.source), pattern.flags);
// Inside one clause: anything but a clause or sentence end; a separator between two digits (150,000 · 3.5) belongs to a number.
const GAP_AR = '(?:[^،,.]|[,.](?=[\\d٠-٩]))';
const GAP_EN = '(?:[^,.;]|[,.](?=\\d))';
// An Arabic word starts here (JavaScript's \\b knows Latin letters only); «و» and «ف» may lead it.
const WORD_AR = '(?<![ء-ي])[وف]?';
const MONEY_AR =
  '(?:[\\d٠-٩][\\d٠-٩.,٬]*\\s*(?:الف|الاف|مليون|ملايين|مليار)?\\s*(?:ريال|دولار|درهم|دينار|جنيه|يورو|SAR|USD|\\$|﷼)' +
  '|[\\d٠-٩][\\d٠-٩.,٬]*\\s*(?:ألف|الف|آلاف|الاف|مليون|ملايين|مليار)' +
  '|(?:مليون|مليوني|ملايين|مليار|ألف|آلاف)\\s*(?:ريال|دولار))';
const ASK_LABEL_AR = ar(
  /(?:المبلغ|التمويل|الاستثمار|رأس\s*المال)\s+المطلوب|(?:حجم|قيم[ةه]|مبلغ)\s+(?:ال)?(?:استثمار|تمويل)(?!ات|ي)|جول[ةه]\s+(?:استثماري|تمويلي)|حاج[ةه]\s+تمويلي|فرص[ةه]\s+تمويل|الصفق[ةه]\s+الاستثماري|الخط[ةه]\s+الاستثماري|اتفاقي[ةه]\s+SAFE|تقييم\s+(?:الشرك[ةه]|المشروع)|(?:ال)?قيم[ةه]\s+(?:ال)?سوقي[ةه]\s+(?:ال)?تقديري|ما\s+قبل\s+الاستثمار/,
);
const SEEK_AR = new RegExp(
  spell(
    WORD_AR +
      '(?:نبحث\\s+عن|نسعى|تسعى|يسعى|نتطلع|تتطلع|يتطلع|نحتاج|يحتاج\\s+المشروع|يطلب|تطلب|نطلب|يتطلب|تتطلب|نطرح|تطرح|يطرح|نعرض|لجمع|جمع)\\s' +
      GAP_AR +
      '{0,90}?(?:مستثمر|تمويل|استثمار|جول[ةه]|شريك\\s+(?:ممول|مالي)|حص[ةه]\\s)',
  ),
);
const FUND_MONEY_AR = new RegExp(
  spell(
    '(?:تمويل(?!\\s+ذاتي)|استثمار(?!ات\\s+(?:في|ال))|جول[ةه]|رأس\\s*المال|رأس\\s*مال|حص[ةه]|تقييم|قيم[ةه]\\s+سوقي[ةه]|القيم[ةه]\\s+السوقي[ةه])' +
      GAP_AR +
      '{0,60}?' +
      MONEY_AR +
      '|' +
      MONEY_AR +
      GAP_AR +
      '{0,40}?(?:مقابل|كتمويل|كاستثمار|تمويل(?!\\s+ذاتي)|استثمار\\s)',
  ),
);
// A share of the company on offer. «مقابل نسبة من كل حجز» is a commission, a business model: it stays.
const EQUITY_AR = ar(
  /(?:حص[ةه]|حصص)\s[^،,.]{0,40}?[\d٠-٩]+\s*[%٪]|[\d٠-٩]+\s*[%٪]\s*من\s+(?:الشرك[ةه]|المشروع|أسهم|اسهم|الأسهم|الاسهم|ملكي[ةه]|الملكي[ةه]|رأس|راس)|مقابل\s+[\d٠-٩]+\s*[%٪]|مقابل\s+(?:حص[ةه]|نسب[ةه])\s+(?:شراك[ةه]|ملكي[ةه]|في\s+(?:الشرك[ةه]|المشروع|المصنع|العلام[ةه])|من\s+(?:الشرك[ةه]|المشروع|الملكي[ةه]|الأسهم|الاسهم|رأس|راس))/,
);
/** What an investor would earn: never shown, whatever the founder wrote (no promised returns). What a CLIENT earns from the product stays. */
const RETURNS_AR = ar(
  /فتر[ةه]\s+استرداد|عوائد\s+استثماري[ةه]\s+(?:مجزي|مرتفع|عالي)|عوائد\s+(?:مجزي|مرتفع|عالي)[^،,.]{0,30}(?:للمستثمر|للشركاء)|أرباح\s+للمستثمر|مخاطر\s+المستثمر|الجاذبي[ةه]\s+الاستثماري/,
);

const MONEY_EN =
  '(?:(?:SAR|USD|\\$|﷼)\\s?[\\d.,]+\\s?(?:k|m|mn|bn|million|thousand|billion)?\\b' +
  '|[\\d.,]+\\s?(?:k|m|mn|bn|million|thousand|billion)?\\s?(?:SAR|USD|riyals?|dollars?)\\b' +
  '|[\\d.,]+\\s?(?:million|billion|thousand)\\b)';
const ASK_LABEL_EN =
  /\b(?:funding|investment|amount|capital)\s+(?:required|needed|sought|need)\b|\b(?:required|needed)\s+(?:initial\s+)?(?:investment|funding|capital|amount)\b|\bfunding need\b|\binvestment (?:plan|opportunity|deal)\b|\bthe ask\b|\bpre-?(?:money|investment)\b|\bpost-?money\b|\bseed round\b|\bseries [a-d]\b|\bfunding round\b|\bvaluation\b/i;
// Upper case only: «safe» is an everyday word.
const SAFE_NOTE = /\bSAFE\b/;
const SEEK_EN = new RegExp(
  '\\b(?:seeking|looking for|in search of|we need|requires?)\\b' +
    GAP_EN +
    '{0,90}?\\b(?:(?<!self-)funding|investment|investors?|capital|equity|a stake)\\b' +
    // «raise» only with what is raised: «raising the level of quality» is not an ask.
    '|\\b(?:rais(?:e|ing)|to raise)\\s+(?:\\$|SAR|USD|[\\d.,]+|funds?\\b|funding\\b|capital\\b|investment\\b|an?\\s+(?:pre-)?(?:seed|funding|bridge|investment)\\s+round)',
  'i',
);
const FUND_MONEY_EN = new RegExp(
  '\\b(?:(?<!self-)funding|investment|capital|round|market value)\\b' +
    GAP_EN +
    '{0,60}?' +
    MONEY_EN +
    '|' +
    MONEY_EN +
    GAP_EN +
    '{0,40}?\\b(?:in funding|investment|in capital|for \\d{1,2}(?:\\.\\d+)?\\s?%)',
  'i',
);
const EQUITY_EN =
  /\b\d{1,2}(?:\.\d+)?\s?%\s+(?:equity|stake|of the company|ownership|share\b)|\b(?:equity|stake|share)\s+of\s+\d{1,2}(?:\.\d+)?\s?%|\bfor\s+\d{1,2}(?:\.\d+)?\s?%\s+of\b/i;
const RETURNS_EN =
  /\bpayback period\b|\b(?:high|higher|rewarding|attractive|outstanding|sustainable|guaranteed)\b[^,.]{0,25}\b(?:investment returns?|return on investment)\b|\bachieving returns\b|\breturns? (?:for|to) investors\b|\binvestor risks?\b|\battractive for investment\b/i;

type MoneyTalk = { kind: 'ask' | 'amount'; at: number };

/**
 * «ask»: the clause asks for money from `at` on, and the rest of its sentence says what for, so that goes too.
 * «amount»: only this clause goes.
 */
function moneyTalk(original: string): MoneyTalk | null {
  const arabic = ARABIC.test(original);
  const { text: clause, map } = arabic ? normalise(original) : { text: original, map: [] as number[] };
  const first = (patterns: RegExp[]): number => Math.min(...patterns.map((pattern) => clause.search(pattern)).map((index) => (index < 0 ? Infinity : index)));
  const ask = first(arabic ? [ASK_LABEL_AR, EQUITY_AR, SEEK_AR] : [ASK_LABEL_EN, SAFE_NOTE, EQUITY_EN, SEEK_EN]);
  const amount = first(arabic ? [FUND_MONEY_AR, RETURNS_AR] : [FUND_MONEY_EN, RETURNS_EN]);
  if (ask === Infinity) return amount === Infinity ? null : { kind: 'amount', at: 0 };
  // The money talk starts at whichever comes first: «رأس المال المطلوب 3 ملايين ريال مقابل 30%» begins at the capital, not at the share.
  const at = Math.min(ask, amount);
  return { kind: 'ask', at: arabic ? (map[at] ?? 0) : at };
}

/** A founder who writes without punctuation leaves one long clause: what stands before the ask is kept when it is a text of its own. */
const LEAD_MIN = 40;

export function stripFunding(input: string): string {
  const arabic = ARABIC.test(input);
  // Sentence ends, never the point inside a number; in the feed's Arabic text an ASCII «, » joins what were paragraphs on the site.
  const sentences = input.split(arabic ? /(?<=[!؟?\n])|(?<=\.)(?![\d٠-٩])|(?<=,)(?= )/ : /(?<=[!?\n])|(?<=\.)(?!\d)/);
  const kept = sentences.map((sentence) => {
    const clauses = sentence.split(arabic ? /(?<=[،؛])/ : /(?<=[,;])(?=\s)/);
    const out: string[] = [];
    let touched = false;
    for (const clause of clauses) {
      const talk = moneyTalk(clause);
      if (!talk) {
        out.push(clause);
        continue;
      }
      touched = true;
      if (talk.kind === 'amount') continue;
      // Words that only lead into the ask («… فإننا نبحث عن», «… and we are currently seeking») go with it.
      const lead = clause
        .slice(0, talk.at)
        .replace(/(?:[\s،؛,;]+(?:فأننا|فإننا|فاننا|فإنا|لذا|لذلك|ولذلك|حيث|كما|أننا|اننا|ونحن|نحن|حاليا|حاليًا|الآن|و|and|we|are|is|currently|now|also|therefore|so))*[\s،؛,;]*$/i, '');
      if (lead.trim().length >= LEAD_MIN) out.push(lead);
      break;
    }
    if (!touched) return sentence;
    const head = out.join('').replace(/[\s،؛,;]+$/, '');
    if (!head.trim()) return '';
    if (/[.!؟?]$/.test(head)) return head + (/\n\s*$/.test(sentence) ? '\n' : ' ');
    // The sentence keeps its own ending: a line break, the paragraph joint, or a full stop.
    const ending = /\n\s*$/.test(sentence) ? '.\n' : /,\s*$/.test(sentence) ? ',' : '.';
    return head + ending;
  });
  return kept
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[,،]\s*$/, '.')
    .trim();
}

/** True when a text still talks about money being sought, put in or promised back. */
export const mentionsFunding = (input: string): boolean => input.split(/(?<=[!؟?؛،;\n])|(?<=[.,])(?![\d٠-٩])/).some((clause) => moneyTalk(clause) !== null);
