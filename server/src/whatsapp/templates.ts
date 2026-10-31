import type { WaTemplate } from './client.js';

export type WaKind = 'welcome' | 'receipt';
export type WaLang = 'ar' | 'en';

/** The Utility templates registered on the WABA (each exists in ar and en). */
export const TEMPLATE_NAMES: Record<WaKind, string> = { welcome: 'club_welcome', receipt: 'club_receipt' };

export type TemplateVars = { name?: string | null; amount?: number | null; service?: string | null; invoiceNo?: number | string | null };

export type DeliveryPlan =
  | { use: 'whatsapp'; template: string; language: string; params: string[] }
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
  if (kind === 'welcome') return [cleanParam(vars.name, lang === 'en' ? 'Member' : 'عضونا')];
  return [formatAmount(vars.amount), cleanParam(vars.service, lang === 'en' ? 'Service' : 'خدمة'), cleanParam(vars.invoiceNo, '-')];
}

/** The template of that language: an exact code first, then a regional one (en_US for en), APPROVED before the rest. */
export function pickTemplate(templates: WaTemplate[], lang: WaLang): WaTemplate | null {
  const matches = templates.filter((template) => template.language === lang || template.language.startsWith(`${lang}_`));
  const rank = (template: WaTemplate): number => (template.status === 'APPROVED' ? 0 : 2) + (template.language === lang ? 0 : 1);
  return [...matches].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

function highestIndex(text: string | undefined): number {
  let highest = 0;
  for (const match of (text ?? '').matchAll(PLACEHOLDER)) highest = Math.max(highest, Number(match[1]));
  return highest;
}

/**
 * Maps our values onto the template's real body: the body may use fewer variables than we hold (extra ones are dropped),
 * never more. A variable in the header or in a URL button, or named variables, are not filled by this sender.
 */
export function fitParams(template: WaTemplate, params: string[]): string[] | null {
  if (template.parameter_format && template.parameter_format.toUpperCase() === 'NAMED') return null;
  let needed = 0;
  for (const component of template.components) {
    const type = component.type.toUpperCase();
    if (type === 'BODY') needed = highestIndex(component.text);
    else if (type === 'HEADER' && (component.format ?? 'TEXT').toUpperCase() !== 'TEXT') return null;
    else if (type === 'HEADER' && highestIndex(component.text) > 0) return null;
    else if (type === 'BUTTONS' && (component.buttons ?? []).some((button) => highestIndex(button.url) > 0)) return null;
  }
  if (needed > params.length) return null;
  return params.slice(0, needed);
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
  const params = fitParams(input.template, buildBodyParams(input.kind, input.vars, input.lang));
  if (!params) return { use: 'fallback', reason: 'template_mismatch' };
  return { use: 'whatsapp', template: input.template.name, language: input.template.language, params };
}
