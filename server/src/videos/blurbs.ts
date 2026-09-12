import type { FastifyBaseLogger } from 'fastify';

import type { FetchImpl } from '../news/rss.js';

/**
 * One short friendly Arabic line per video. Marketing copy (not news): written once, stored,
 * and editable from the dashboard later. Without an OpenAI key a template line is used.
 */
export type BlurbInput = { id: string; title: string; description: string };

export interface BlurbWriter {
  readonly mode: 'openai' | 'template';
  write(items: BlurbInput[]): Promise<Map<string, string>>;
}

const MAX_BLURB = 180;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const BATCH_SIZE = 20;
const TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = [
  'You write one short, warm Arabic teaser line for each YouTube video of نادي المستثمرين (a Saudi business club of investors and entrepreneurs).',
  'Rules: Modern Standard Arabic, friendly and inviting, one or two sentences, at most 140 characters, no emojis, no hashtags, no exclamation marks.',
  'Describe what the viewer will see or learn; never invent facts that are not in the title or description.',
  'Never promise returns or profits. Never mention prices or membership prices.',
  'Vocabulary: write «بدون رسوم» never «مجاني»; write «رصيد» never «كريديت»; write «الشراكات» never «الصفقات».',
  'Write numeric ranges with words (من … إلى …), never with a hyphen between two numbers.',
  'Return every id you were given exactly once.',
].join('\n');

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'video_blurbs',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, blurb: { type: 'string' } },
            required: ['id', 'blurb'],
            additionalProperties: false,
          },
        },
      },
      required: ['results'],
      additionalProperties: false,
    },
  },
};

const BANNED = /مجان|كريديت|الصفقات|\d\s*-\s*\d/;

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_BLURB);
}

/** A template line built from the title (or the description's first sentence when it is Arabic and informative). */
export function templateBlurb(item: BlurbInput): string {
  const firstSentence = item.description.split(/\n|(?<=[.!؟?])\s/)[0]?.trim() ?? '';
  if (firstSentence.length >= 25 && firstSentence.length <= 140 && /[؀-ۿ]/.test(firstSentence) && !/https?:\/\//.test(firstSentence) && !BANNED.test(firstSentence)) {
    return tidy(firstSentence);
  }
  return tidy(`في هذا الفيديو من نادي المستثمرين: ${item.title}`);
}

export class TemplateBlurbWriter implements BlurbWriter {
  readonly mode = 'template' as const;

  async write(items: BlurbInput[]): Promise<Map<string, string>> {
    return new Map(items.map((item) => [item.id, templateBlurb(item)]));
  }
}

type Deps = { apiKey: string; model: string; log: FastifyBaseLogger; fetchImpl?: FetchImpl };

/** OpenAI writes the lines in batches; any failure (or a line breaking the wording rules) falls back to the template for that video. */
export class OpenAIBlurbWriter implements BlurbWriter {
  readonly mode = 'openai' as const;

  constructor(private readonly deps: Deps) {}

  async write(items: BlurbInput[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = items.slice(start, start + BATCH_SIZE);
      let lines = new Map<string, string>();
      try {
        lines = await this.call(batch);
      } catch (error) {
        this.deps.log.warn({ err: error, batch: batch.length }, 'OpenAI blurbs failed, template used for this batch');
      }
      for (const item of batch) {
        const line = lines.get(item.id);
        out.set(item.id, line && !BANNED.test(line) ? line : templateBlurb(item));
      }
    }
    return out;
  }

  private async call(batch: BlurbInput[]): Promise<Map<string, string>> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const payload = batch.map((item) => ({ id: item.id, title: item.title, description: item.description.slice(0, 400) }));
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.deps.model,
        temperature: 0.6,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ videos: payload }) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content) as { results?: { id?: unknown; blurb?: unknown }[] };
    const lines = new Map<string, string>();
    for (const result of parsed.results ?? []) {
      if (typeof result.id !== 'string' || typeof result.blurb !== 'string') continue;
      const line = tidy(result.blurb);
      if (line.length >= 10) lines.set(result.id, line);
    }
    return lines;
  }
}
