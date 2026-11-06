import type { WaTemplate } from './client.js';

export type WaKind = 'welcome' | 'receipt' | 'code' | 'affiliate_link' | 'membership' | 'event_ticket' | 'visit_update' | 'request_update' | 'invoice' | 'honorary' | 'honorary_ended';
export type WaLang = 'ar' | 'en';

/** The templates registered on the WABA (each exists in ar and en); `code` is the Authentication one. */
export const TEMPLATE_NAMES: Record<WaKind, string> = {
  welcome: 'club_welcome',
  receipt: 'club_receipt',
  code: 'club_login_code',
  affiliate_link: 'club_affiliate_link',
  // M204 (filed at Meta 2026-11-06, Utility, ar + en).
  membership: 'club_membership_active',
  event_ticket: 'club_event_ticket',
  visit_update: 'club_visit_update',
  request_update: 'club_request_update',
  invoice: 'club_invoice',
  // M205: «عضوية شرفية» given by the administration (Utility, ar + en; one variable: the first name).
  honorary: 'club_honorary_membership',
  // M205: the honorary membership was taken back (it belongs to partners in the Vibes Ventures companies only).
  honorary_ended: 'club_honorary_ended',
};
export const WA_KINDS = Object.keys(TEMPLATE_NAMES) as WaKind[];

export type TemplateVars = {
  code?: string | null;
  name?: string | null;
  amount?: number | null;
  /** The amount as the member reads it, currency included (club_invoice has no currency word of its own). */
  amountText?: string | null;
  service?: string | null;
  invoiceNo?: number | string | null;
  link?: string | null;
  /** A day as the member reads it: the membership's end, the event's day. */
  date?: string | null;
  event?: string | null;
  ticket?: string | null;
  status?: string | null;
  /** The full address behind a template's URL button; the button's variable is what follows the template's fixed part. */
  buttonLink?: string | null;
};

export type DeliveryPlan =
  | { use: 'whatsapp'; template: string; language: string; params: string[]; button?: string }
  | { use: 'fallback'; reason: 'whatsapp_disabled' | 'no_phone' | 'template_not_found' | 'template_not_approved' | 'template_mismatch' | 'template_lookup_failed' };

export function toLang(value: string | null | undefined): WaLang {
  return String(value ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';
}

/** Meta refuses empty parameters, newlines, tabs and long runs of spaces inside a parameter. */
export function cleanParam(value: string | number | null | undefined, fallback: string): string {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200);
  return text || fallback;
}

export function formatAmount(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '0';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** The values for {{1}}, {{2}}… in the order the templates define them (receipt: amount SAR, service, invoice number). */
export function buildBodyParams(kind: WaKind, vars: TemplateVars, lang: WaLang): string[] {
  if (kind === 'code') return [cleanParam(vars.code, '-')];
  if (kind === 'welcome' || kind === 'honorary' || kind === 'honorary_ended') return [cleanParam(vars.name, lang === 'en' ? 'Member' : 'عضونا')];
  if (kind === 'affiliate_link') return [cleanParam(vars.name, lang === 'en' ? 'Member' : 'عضونا'), cleanParam(vars.code, '-'), cleanParam(vars.link, '-')];
  const service = cleanParam(vars.service, lang === 'en' ? 'Service' : 'خدمة');
  // M204, in the order the templates were filed.
  if (kind === 'membership') return [cleanParam(vars.name, lang === 'en' ? 'Member' : 'عضونا'), cleanParam(vars.date, '-')];
  if (kind === 'event_ticket') return [cleanParam(vars.event, lang === 'en' ? 'the event' : 'الفعالية'), cleanParam(vars.date, '-'), cleanParam(vars.ticket, '-')];
  if (kind === 'visit_update') return [cleanParam(vars.status, '-')];
  if (kind === 'request_update') return [service, cleanParam(vars.status, '-')];
  if (kind === 'invoice') return [cleanParam(vars.invoiceNo, '-'), cleanParam(vars.amountText, formatAmount(vars.amount)), service];
  return [formatAmount(vars.amount), service, cleanParam(vars.invoiceNo, '-')];
}

/** «أحمد» from «أحمد بن سالم»; a placeholder name («عضو رقم 12») gives nothing, so the template's own fallback speaks. */
export function firstName(name: string | null | undefined): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return /\d/.test(String(name ?? '')) || first === 'عضو' || first === 'مستخدم' ? '' : first;
}

/** `150 ر.س` / `SAR 150`: club_invoice carries the currency inside its amount variable. */
export function amountText(amount: number, currency: string | null | undefined, lang: WaLang): string {
  const code = String(currency ?? 'SAR').toUpperCase() || 'SAR';
  if (lang === 'en') return `${code} ${formatAmount(amount)}`;
  return `${formatAmount(amount)} ${code === 'SAR' ? 'ر.س' : code}`;
}

/** The template of that language: an exact code first, then a regional one (en_US for en), APPROVED before the rest. */
export function pickTemplate(templates: WaTemplate[], lang: WaLang): WaTemplate | null {
  const matches = templates.filter((template) => template.language === lang || template.language.startsWith(`${lang}_`));
  const rank = (template: WaTemplate): number => (template.status === 'APPROVED' ? 0 : 2) + (template.language === lang ? 0 : 1);
  return [...matches].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;
const PLACEHOLDER_ONCE = /\{\{\s*\d+\s*\}\}/;

function highestIndex(text: string | undefined): number {
  let highest = 0;
  for (const match of (text ?? '').matchAll(PLACEHOLDER)) highest = Math.max(highest, Number(match[1]));
  return highest;
}

/**
 * Maps our values onto the template's real body: the body may use fewer variables than we hold (extra ones are dropped),
 * never more. A variable in the header or in a URL button, or named variables, are not filled by this sender.
 */
export function fitParams(template: WaTemplate, params: string[], options: { urlButton?: boolean } = {}): string[] | null {
  if (template.parameter_format && template.parameter_format.toUpperCase() === 'NAMED') return null;
  let needed = 0;
  for (const component of template.components) {
    const type = component.type.toUpperCase();
    if (type === 'BODY') needed = highestIndex(component.text);
    else if (type === 'HEADER' && (component.format ?? 'TEXT').toUpperCase() !== 'TEXT') return null;
    else if (type === 'HEADER' && highestIndex(component.text) > 0) return null;
    else if (type === 'BUTTONS' && !options.urlButton && (component.buttons ?? []).some((button) => highestIndex(button.url) > 0)) return null;
  }
  if (needed > params.length) return null;
  return params.slice(0, needed);
}

/**
 * M204 (club_invoice): the value of a template's one URL-button variable. The template fixes the address up to `{{1}}`
 * (`https://api.vibesholdingsa.com/pay/invoice/{{1}}`), so `link` must begin with that part: the TEST server's own links
 * do not, and then the template is not used at all rather than sending a member to a page that does not exist.
 * undefined = the template has no such button; null = it has one and `link` does not fit it.
 */
export function urlButtonValue(template: WaTemplate, link: string | null | undefined): string | null | undefined {
  const urls = template.components.filter((component) => component.type.toUpperCase() === 'BUTTONS').flatMap((component) => (component.buttons ?? []).map((button) => button.url ?? ''));
  const withVariable = urls.filter((url) => highestIndex(url) > 0);
  if (!withVariable.length) return undefined;
  const pattern = withVariable[0] ?? '';
  // The sender fills the first button only, and one variable only.
  if (withVariable.length > 1 || urls[0] !== pattern || highestIndex(pattern) > 1) return null;
  const fixed = pattern.slice(0, pattern.search(PLACEHOLDER_ONCE));
  const value = String(link ?? '');
  if (!value.startsWith(fixed) || pattern.replace(PLACEHOLDER_ONCE, '') !== fixed) return null;
  const rest = value.slice(fixed.length).trim();
  return rest && !/\s/.test(rest) ? rest : null;
}

/** The pure decision behind every send: WhatsApp when it can be done properly, otherwise the e-mail fallback with the reason. */
export function planDelivery(input: {
  enabled: boolean;
  phone: string | null;
  kind: WaKind;
  lang: WaLang;
  vars: TemplateVars;
  /** undefined = the lookup itself failed; null = no template of that language exists. */
  template: WaTemplate | null | undefined;
}): DeliveryPlan {
  if (!input.enabled) return { use: 'fallback', reason: 'whatsapp_disabled' };
  if (!input.phone) return { use: 'fallback', reason: 'no_phone' };
  if (input.template === undefined) return { use: 'fallback', reason: 'template_lookup_failed' };
  if (input.template === null) return { use: 'fallback', reason: 'template_not_found' };
  if (input.template.status !== 'APPROVED') return { use: 'fallback', reason: 'template_not_approved' };
  const button = urlButtonValue(input.template, input.vars.buttonLink);
  if (button === null) return { use: 'fallback', reason: 'template_mismatch' };
  const params = fitParams(input.template, buildBodyParams(input.kind, input.vars, input.lang), { urlButton: button !== undefined });
  if (!params) return { use: 'fallback', reason: 'template_mismatch' };
  return { use: 'whatsapp', template: input.template.name, language: input.template.language, params, ...(button ? { button } : {}) };
}
