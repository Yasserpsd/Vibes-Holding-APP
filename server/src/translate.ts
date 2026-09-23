import type { FastifyBaseLogger } from 'fastify';

/**
 * M43 (owner, 2026-09-23: «عايزك تستخدم AI يترجم كل حاجه مرة واحدة وانا لو لقيت مشكلة ابقي اعدلها»):
 * one-time AI English for the owner's OWN words — posts and agenda events — written once at save and
 * editable from the dashboard (`enAuto: false` once he touches it). Never used for news (rule 7).
 */
export type Translator = {
  readonly mode: 'openai' | 'off';
  /** English for each Arabic text, same length and order; `null` = the call failed (keep whatever exists). */
  translate(texts: string[]): Promise<string[] | null>;
};

export class OffTranslator implements Translator {
  readonly mode = 'off' as const;
  async translate(): Promise<null> {
    return null;
  }
}

type Deps = { apiKey: string; model?: string; log: FastifyBaseLogger; fetchImpl?: typeof fetch };

export class OpenAITranslator implements Translator {
  readonly mode = 'openai' as const;

  constructor(private readonly deps: Deps) {}

  async translate(texts: string[]): Promise<string[] | null> {
    const clean = texts.map((text) => (typeof text === 'string' ? text : ''));
    if (clean.every((text) => !text.trim())) return clean;
    try {
      const call = this.deps.fetchImpl ?? fetch;
      const response = await call('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.deps.model ?? 'gpt-4.1-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You translate an Arabic investors-club app\'s own content into natural, polished English. Keep names, numbers, dates, times, currencies and URLs exactly as they are. Never add, drop or embellish information. Never write "free"; use "at no charge". Reply ONLY with JSON {"texts": string[]} of the same length and order as the input; empty strings stay empty.',
            },
            { role: 'user', content: JSON.stringify({ texts: clean }) },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`openai answered ${response.status}`);
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as { texts?: unknown };
      const out = parsed.texts;
      if (!Array.isArray(out) || out.length !== clean.length || out.some((text) => typeof text !== 'string')) {
        throw new Error('unexpected translation shape');
      }
      return out as string[];
    } catch (error) {
      this.deps.log.warn({ err: error }, 'content translation failed; the Arabic stays until the next edit');
      return null;
    }
  }
}
