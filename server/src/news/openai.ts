import type { FastifyBaseLogger } from 'fastify';

import { classifyByKeywords, type Classifier, type ClassifyInput } from './classify.js';
import type { FetchImpl } from './rss.js';
import { NEWS_TOPICS, TOPIC_KEYS, isTopicKey, type Classification } from './types.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const BATCH_SIZE = 20;
const TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = [
  'You label news headlines for a Saudi business club app used by investors and entrepreneurs.',
  'You never rewrite, translate or summarize anything; you only classify each item.',
  `Topic keys: ${NEWS_TOPICS.map((topic) => `${topic.key} = ${topic.label}`).join('; ')}.`,
  'For each item return: topics (0 to 3 keys that fit), decision (true only for an official Saudi decision: law, regulation, royal decree or order, cabinet decision, ministry or authority ruling, licence rule, fee, deadline or enforcement date), business_angle (sports: true only when the story is about money such as acquisitions, sponsorships, transfer fees, broadcast rights or club finances; other items: true when they concern business, economy, markets or investment), relevance (0 to 100: how useful the item is to Saudi investors and entrepreneurs; 0 unrelated, 100 essential).',
  'Return every id you were given exactly once.',
].join('\n');

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'news_labels',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              topics: { type: 'array', items: { type: 'string', enum: TOPIC_KEYS } },
              decision: { type: 'boolean' },
              business_angle: { type: 'boolean' },
              relevance: { type: 'integer' },
            },
            required: ['id', 'topics', 'decision', 'business_angle', 'relevance'],
            additionalProperties: false,
          },
        },
      },
      required: ['results'],
      additionalProperties: false,
    },
  },
};

type Deps = { apiKey: string; model: string; log: FastifyBaseLogger; fetchImpl?: FetchImpl };
type Result = { id: string; topics: unknown; decision: unknown; business_angle: unknown; relevance: unknown };

/** OpenAI labels the items in batches; any failure falls back to the keyword classifier for that batch. */
export class OpenAIClassifier implements Classifier {
  readonly mode = 'openai' as const;

  constructor(private readonly deps: Deps) {}

  async classify(items: ClassifyInput[]): Promise<Classification[]> {
    const out: Classification[] = [];
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = items.slice(start, start + BATCH_SIZE);
      let labels = new Map<string, Classification>();
      try {
        labels = await this.call(batch);
      } catch (error) {
        this.deps.log.warn({ err: error, batch: batch.length }, 'OpenAI classification failed, keywords used for this batch');
      }
      out.push(...batch.map((item) => labels.get(item.id) ?? classifyByKeywords(item)));
    }
    return out;
  }

  private async call(batch: ClassifyInput[]): Promise<Map<string, Classification>> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const payload = batch.map((item) => ({ id: item.id, source: item.source, section: item.hint, lang: item.lang, title: item.title, snippet: item.snippet }));
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.deps.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ items: payload }) },
        ],
        response_format: RESPONSE_FORMAT,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`OpenAI HTTP ${response.status}: ${detail}`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('OpenAI answer has no content');
    const parsed = JSON.parse(content) as { results?: Result[] };
    const labels = new Map<string, Classification>();
    for (const result of parsed.results ?? []) {
      if (typeof result?.id !== 'string') continue;
      const topics = Array.isArray(result.topics) ? result.topics.filter(isTopicKey).slice(0, 3) : [];
      const relevance = typeof result.relevance === 'number' ? Math.max(0, Math.min(100, Math.round(result.relevance))) : 0;
      labels.set(result.id, { topics, decision: result.decision === true, businessAngle: result.business_angle === true, relevance });
    }
    this.deps.log.info({ items: batch.length, labelled: labels.size, usage: body.usage }, 'news classified by OpenAI');
    return labels;
  }
}
