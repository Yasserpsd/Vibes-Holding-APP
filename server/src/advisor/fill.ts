import type { FastifyBaseLogger } from 'fastify';

import { normEmail, normPhone, phoneIntl, phoneLocal } from '../hub/phone.js';
import type { AppLang } from '../lang.js';
import type { FetchImpl } from '../news/rss.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 45_000;
const MAX_FIELDS = 40;

export const FILL_FIELD_TYPES = ['text', 'textarea', 'phone', 'email', 'number', 'date', 'time', 'select', 'multiselect'] as const;
export type FillFieldType = (typeof FILL_FIELD_TYPES)[number];

/** One form field as the app describes it: the model sees label + type (+ options), never the UI. */
export type FillField = {
  key: string;
  label: string;
  type: FillFieldType;
  options?: string[];
  required?: boolean;
  /** Extra guidance for the model («رقم الجوال بدون الصفر», «اسم الشركة كما في السجل»…). */
  hint?: string;
};

export type FillInput = {
  transcript: string;
  lang: AppLang;
  fields: FillField[];
  /** What the form already holds; kept unless the speaker says otherwise. */
  known?: Record<string, string>;
  /** The member's country (phone dial code); Saudi when unknown. */
  country?: string;
  /** Riyadh calendar date for relative dates («بكرة», «الخميس الجاي»). */
  today?: string;
};

export type FillResult = {
  /** Every field key → its value ('' when nothing was said about it). */
  values: Record<string, string>;
  /** Required fields still empty after the fill. */
  missing: string[];
  /** One short question (speaker's language) asking only for the missing fields; null when complete. */
  followUp: string | null;
};

type Deps = { apiKey: string; model: string; log: FastifyBaseLogger; fetchImpl?: FetchImpl };

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Arabic-Indic and Persian digits → ASCII (the member says «خمسة وخمسين» or types ٠٥…). */
export function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
  });
}

/** Loose Arabic/Latin comparison key for snapping spoken choices to the real options. */
function optionKey(value: string): string {
  return asciiDigits(value)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    // The definite article and its one-letter prefixes vanish from every word («قاعه اجتماعات» = «قاعة الاجتماعات»).
    .split(' ')
    .map((word) => word.replace(/^(?:ال|لل|وال|بال|فال|كال)/, ''))
    .filter(Boolean)
    .join(' ');
}

/** Spoken choice → one of the field's options (exact, normalised, then containment), or ''. */
export function snapOption(value: string, options: string[]): string {
  const raw = value.trim();
  if (!raw) return '';
  const exact = options.find((option) => option === raw);
  if (exact) return exact;
  const key = optionKey(raw);
  if (!key) return '';
  const normalised = options.find((option) => optionKey(option) === key);
  if (normalised) return normalised;
  const contained = options.filter((option) => {
    const optionK = optionKey(option);
    return optionK.length >= 2 && (optionK.includes(key) || key.includes(optionK));
  });
  return contained.length === 1 ? (contained[0] ?? '') : '';
}

function normalisePhone(value: string, country: string | undefined): string {
  const raw = asciiDigits(value).trim();
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 7) return '';
  const intl = raw.includes('+') || digits.startsWith('00') ? normPhone(raw) : phoneIntl(country ?? 'sa', raw) || normPhone(raw);
  if (!intl) return '';
  return intl.startsWith('966') ? phoneLocal(intl) : `+${intl}`;
}

function normaliseValue(field: FillField, value: string, country: string | undefined): string {
  const text = value.trim();
  if (!text) return '';
  switch (field.type) {
    case 'phone':
      return normalisePhone(text, country);
    case 'email':
      return normEmail(text);
    case 'number': {
      const n = asciiDigits(text).replace(/[^\d.-]+/g, '');
      return n && Number.isFinite(Number(n)) ? String(Number(n)) : '';
    }
    case 'date': {
      const d = asciiDigits(text).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      return d ? `${d[1]}-${(d[2] ?? '').padStart(2, '0')}-${(d[3] ?? '').padStart(2, '0')}` : '';
    }
    case 'time': {
      const t = asciiDigits(text).match(/(\d{1,2}):(\d{2})/);
      if (!t) return '';
      const h = Number(t[1]);
      return h >= 0 && h <= 23 && Number(t[2]) <= 59 ? `${String(h).padStart(2, '0')}:${t[2]}` : '';
    }
    case 'select':
      return snapOption(text, field.options ?? []);
    case 'multiselect': {
      const picked = text
        .split(/[،,;\n]+/)
        .map((part) => snapOption(part, field.options ?? []))
        .filter((part, index, all) => part && all.indexOf(part) === index);
      return picked.join('، ');
    }
    default:
      return text.length > 4000 ? text.slice(0, 4000) : text;
  }
}

function describe(field: FillField): string {
  const parts = [`- ${field.key}: "${field.label}" (${field.type}${field.required ? ', required' : ''})`];
  if (field.options?.length) parts.push(`options: ${field.options.map((option) => JSON.stringify(option)).join(' | ')}`);
  if (field.hint) parts.push(`hint: ${field.hint}`);
  return parts.join(' — ');
}

function systemPrompt(input: FillInput): string {
  return [
    'You turn one spoken message into form values for a Saudi business club app. The transcript may be Arabic (any dialect) or English.',
    'Rules: fill a field ONLY with what the speaker actually said about it; never guess, never invent, never copy an example. Unknown → "".',
    'Keep the speaker\'s own words for text fields (clean spelling, no commentary). Write every number, phone and date with ASCII digits.',
    'phone → the digits as spoken (keep + or a country code if said). email → spelled-out addresses joined ("at" → @, "dot" → .).',
    `date → YYYY-MM-DD (today is ${input.today ?? new Date().toISOString().slice(0, 10)}, Riyadh); time → HH:MM 24h. number → digits only.`,
    'select → exactly one of the listed options, copied verbatim; multiselect → the matching options separated by "، ". Nothing matches → "".',
    'Known values already in the form are given; keep them unless the speaker changes them (then return the new value).',
    `followUp: if any REQUIRED field is still "", ONE short friendly question in ${input.lang === 'en' ? 'English' : 'Arabic (Saudi white dialect)'} asking only for those fields; otherwise "".`,
  ].join('\n');
}

function userPrompt(input: FillInput): string {
  const known = Object.entries(input.known ?? {}).filter(([, v]) => v.trim());
  return [
    'Fields:',
    ...input.fields.map(describe),
    known.length ? `\nKnown values:\n${known.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n')}` : '',
    `\nTranscript:\n"""${input.transcript.trim()}"""`,
  ]
    .filter(Boolean)
    .join('\n');
}

function responseFormat(fields: FillField[]) {
  const properties: Record<string, { type: 'string' }> = {};
  for (const field of fields) properties[field.key] = { type: 'string' };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'form_fill',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          values: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
          followUp: { type: 'string' },
        },
        required: ['values', 'followUp'],
        additionalProperties: false,
      },
    },
  };
}

function fallbackFollowUp(lang: AppLang, missing: FillField[]): string {
  const labels = missing.map((field) => field.label).join(lang === 'en' ? ', ' : '، ');
  return lang === 'en' ? `I still need: ${labels}. Say it once more, please.` : `باقي لي: ${labels}. قلها مرة ثانية تكفى.`;
}

/**
 * M142 «املأ بصوتك»: the member speaks once, the app sends the transcript plus a description
 * of the form's fields, and the model returns the values. Everything typed-sensitive (phones,
 * e-mails, dates, choices) is normalised HERE so a wrong model answer cannot reach the form;
 * the member still reviews and submits himself. Transcripts are never stored or logged.
 */
export class FormFiller {
  constructor(private readonly deps: Deps) {}

  async fill(input: FillInput): Promise<FillResult> {
    const fields = input.fields.slice(0, MAX_FIELDS);
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.deps.apiKey}` },
      body: JSON.stringify({
        model: this.deps.model,
        temperature: 0,
        response_format: responseFormat(fields),
        messages: [
          { role: 'system', content: systemPrompt(input) },
          { role: 'user', content: userPrompt({ ...input, fields }) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      this.deps.log.warn({ status: response.status }, 'form fill failed');
      throw new Error(`fill_failed:${response.status}`);
    }
    const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    let parsed: { values?: Record<string, unknown>; followUp?: unknown } = {};
    try {
      parsed = typeof content === 'string' ? (JSON.parse(content) as typeof parsed) : {};
    } catch {
      throw new Error('fill_failed:parse');
    }
    const values: Record<string, string> = {};
    for (const field of fields) {
      const spoken = parsed.values?.[field.key];
      const fresh = typeof spoken === 'string' ? normaliseValue(field, spoken, input.country) : '';
      values[field.key] = fresh || (input.known?.[field.key] ?? '').trim();
    }
    const missing = fields.filter((field) => field.required && !values[field.key]);
    const modelQuestion = typeof parsed.followUp === 'string' ? parsed.followUp.trim().slice(0, 300) : '';
    return {
      values,
      missing: missing.map((field) => field.key),
      followUp: missing.length ? modelQuestion || fallbackFollowUp(input.lang, missing) : null,
    };
  }
}
