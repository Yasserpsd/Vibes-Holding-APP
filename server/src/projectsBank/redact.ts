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
