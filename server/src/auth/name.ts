import type { FastifyBaseLogger } from 'fastify';

/**
 * M156 (owner, 2026-10-29: «لو كتبت اسم بطريقة غير صحيحة سوف يتم حظر حسابك… AI أوتوماتيك لو حس إن الاسم مش
 * طبيعي — أبو محمد، أبو جنا، الأسماء الوهمية — يخليه يكتب اسم واسم العائلة»): the member's display name must
 * read as a real first name + family name. A rule pass runs everywhere (sync, no network): at least two words
 * of letters, no digits or symbols, no keyboard mash, no kunya («أبو فلان») as the whole name, no placeholder
 * words. An optional OpenAI pass judges what the rules let through; it fails OPEN (a model outage never blocks
 * a registration). The same rule decides `profileMissing: 'name'` for accounts that already exist, so an
 * «أبو جنا» signed up through Apple meets the gate and fixes the name before the app opens.
 */
export type NameIssue = 'short' | 'oneWord' | 'symbols' | 'kunya' | 'mash' | 'placeholder';

const TASHKEEL = /[ً-ْـٰ]/g;
const KUNYA = new Set(['ابو', 'ابا', 'ابي', 'ام', 'بو', 'بوه', 'abu', 'abo', 'abou', 'aboo', 'um', 'umm', 'om', 'bu', 'bo']);
const PLACEHOLDER = new Set([
  'test', 'tester', 'testing', 'admin', 'user', 'guest', 'unknown', 'none', 'null', 'name', 'first', 'last', 'demo', 'sample', 'example', 'anonymous', 'anon', 'xxx', 'abc', 'asd', 'asdf', 'qwerty', 'aaa', 'zzz',
  'تست', 'تجربة', 'تجريبي', 'اختبار', 'اسم', 'مستخدم', 'مجهول', 'فلان', 'علان', 'زائر', 'ضيف', 'ادمن', 'مدير', 'شخص', 'احد', 'انا', 'الاسم', 'العائلة', 'بدون',
]);

/** Arabic letters folded for comparisons (hamza forms, taa marbuta, alef maqsura). */
function fold(word: string): string {
  return word.toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}

export function normalizeName(name: string): string {
  return name.replace(TASHKEEL, '').replace(/\s+/g, ' ').trim();
}

/** The rule verdict: null = looks like a real name. */
export function nameRuleIssue(input: string): NameIssue | null {
  const name = normalizeName(input);
  if (name.length < 5) return 'short';
  if (/[0-9٠-٩]/.test(name)) return 'symbols';
  const words = name.split(/[\s]+/).filter(Boolean);
  if (words.length < 2) return 'oneWord';
  for (const word of words) {
    // Letters of Arabic or Latin, with an apostrophe, dot or hyphen inside («Al-Otaibi», «D'Souza», «عبد.»).
    if (!/^[\p{Script=Arabic}\p{Script=Latin}][\p{Script=Arabic}\p{Script=Latin}'’.\-]*$/u.test(word)) return 'symbols';
    if (/(.)\1{3,}/u.test(word)) return 'mash';
    if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(word)) return 'mash';
    if (/[^aeiouyAEIOUY\p{Script=Arabic}'’.\-]{9,}/u.test(word)) return 'mash';
    if (PLACEHOLDER.has(fold(word.replace(/[.'’\-]/g, '')))) return 'placeholder';
  }
  const letters = words.filter((word) => word.replace(/[.'’\-]/g, '').length >= 2);
  if (letters.length < 2) return 'oneWord';
  // «أبو محمد» / «أم جنا» / «Abu Khalid» as the WHOLE name is a kunya, not a name. Three or more words («أبو بكر العتيبي») pass the rules.
  const [first = '', second = ''] = words;
  if (words.length === 2 && KUNYA.has(fold(first).replace(/^ال/, ''))) return 'kunya';
  if (words.length === 2 && fold(first) === fold(second)) return 'placeholder';
  return null;
}

export function nameIssueMessage(issue: NameIssue, lang: 'ar' | 'en' = 'ar'): string {
  if (lang === 'en') {
    const why: Record<NameIssue, string> = {
      short: 'The name is too short.',
      oneWord: 'Write your first name and your family name.',
      symbols: 'Letters only — no digits or symbols.',
      kunya: 'A kunya such as «Abu Mohammed» is not accepted.',
      mash: 'This does not read as a real name.',
      placeholder: 'This does not read as a real name.',
    };
    return `${why[issue]} Enter your real first name and family name as on your ID (for example: Mohammed Al-Otaibi). Accounts with fake names are blocked.`;
  }
  const why: Record<NameIssue, string> = {
    short: 'الاسم قصير جدًا.',
    oneWord: 'اكتب اسمك الأول واسم العائلة.',
    symbols: 'الاسم بالحروف فقط، بدون أرقام أو رموز.',
    kunya: 'الكنية مثل «أبو محمد» لا تُقبل كاسم.',
    mash: 'هذا لا يبدو اسمًا حقيقيًا.',
    placeholder: 'هذا لا يبدو اسمًا حقيقيًا.',
  };
  return `${why[issue]} اكتب اسمك الأول واسم العائلة الحقيقيين كما في الهوية (مثال: محمد العتيبي). الحسابات بأسماء غير حقيقية تُحظر.`;
}

export type NameVerdict = 'real' | 'fake' | 'unsure';

export type NameJudgeDeps = { apiKey: string; model: string; log: FastifyBaseLogger; fetchImpl?: typeof fetch };

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 6_000;
const SYSTEM = [
  'You check display names typed by people registering in a Saudi business club app (investors and entrepreneurs; Arabic and English names, GCC, Arab and international).',
  'Answer with ONE word: REAL when the text is plausibly a real person\'s first name plus family name (any language, any transliteration, compound names like Abdulrahman or عبد الله are fine, three or four parts are fine).',
  'FAKE when it is a kunya or nickname used as the whole name (Abu X, Um X, أبو فلان, أم فلان), a title or role, a company or brand, a place, a joke, a sentence, an insult, keyboard mash, repeated words, a placeholder (test, user, فلان) or clearly invented.',
  'UNSURE when you cannot tell. Be lenient with unusual but possible real names.',
].join(' ');

/** The optional AI pass. Never throws: any failure answers 'unsure'. */
export class NameJudge {
  constructor(private readonly deps: NameJudgeDeps) {}

  async judge(name: string): Promise<NameVerdict> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.deps.apiKey}` },
        body: JSON.stringify({
          model: this.deps.model,
          temperature: 0,
          max_tokens: 3,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Name: """${normalizeName(name).slice(0, 120)}"""` },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.deps.log.warn({ status: response.status }, 'name check failed; letting the name through');
        return 'unsure';
      }
      const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const answer = String(body.choices?.[0]?.message?.content ?? '').trim().toUpperCase();
      if (answer.startsWith('REAL')) return 'real';
      if (answer.startsWith('FAKE')) return 'fake';
      return 'unsure';
    } catch (error) {
      this.deps.log.warn({ err: error }, 'name check errored; letting the name through');
      return 'unsure';
    }
  }
}

/** Rules first, then the model when configured. Returns the message to show, or null when the name passes. */
export async function nameProblem(name: string, lang: 'ar' | 'en', judge?: NameJudge | null): Promise<string | null> {
  const issue = nameRuleIssue(name);
  if (issue) return nameIssueMessage(issue, lang);
  if (judge && (await judge.judge(name)) === 'fake') return nameIssueMessage('placeholder', lang);
  return null;
}
