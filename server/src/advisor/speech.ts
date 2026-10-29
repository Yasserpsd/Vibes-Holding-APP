import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AppLang } from '../lang.js';
import type { FetchImpl } from '../news/rss.js';

const ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const MODEL = 'gpt-4o-mini-tts';
const VOICE = 'onyx';
const TIMEOUT_MS = 60_000;
/** ≈ 3 minutes of speech; the owner pays per character (M132 g: ≈ 3 halalas per ~30 s). */
export const SPEECH_MAX_CHARS = 2500;
const CACHE_MAX = 40;

// gpt-4o-mini-tts takes free-text delivery instructions: the advisor sounds like a calm Saudi business advisor.
const INSTRUCTIONS: Record<AppLang, string> = {
  ar: 'تحدث بالعربية الفصحى المبسطة بلكنة سعودية خفيفة، بصوت مستشار أعمال محترف هادئ وواثق، بسرعة معتدلة ونبرة ودودة. اقرأ الأرقام والنسب والعملات بوضوح.',
  en: 'Speak as a calm, confident, professional business advisor: moderate pace, warm tone, clear numbers and percentages.',
};

type Deps = { apiKey: string; log: FastifyBaseLogger; fetchImpl?: FetchImpl };

/**
 * M148 «المستشار يرد بالصوت»: the member taps the speaker on a reply and hears it. The reply's markdown
 * (tables, links, emphasis, emoji) is turned into plain sentences first, the clip is cut at a sentence
 * boundary, and the last clips stay in memory so a second tap on the same reply costs nothing.
 */
export function speakable(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    // Table rows: the separator row goes, the cells become one sentence each row.
    if (line.startsWith('|')) {
      if (/^\|?\s*:?-{2,}/.test(line)) continue;
      line = line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join('، ');
    }
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/^[-*•]\s+/, '')
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_`~]+/g, '')
      .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) out.push(line);
  }
  let joined = out.join('\n');
  if (joined.length > SPEECH_MAX_CHARS) {
    const head = joined.slice(0, SPEECH_MAX_CHARS);
    const cut = Math.max(head.lastIndexOf('.'), head.lastIndexOf('،'), head.lastIndexOf('\n'), head.lastIndexOf('؟'), head.lastIndexOf('!'));
    joined = (cut > SPEECH_MAX_CHARS / 2 ? head.slice(0, cut + 1) : head).trim();
  }
  return joined;
}

export class SpeechSynthesizer {
  private readonly cache = new Map<string, Buffer>();

  constructor(private readonly deps: Deps) {}

  /** MP3 bytes for the text, in the member's language. Throws `speech_failed:<status>` when OpenAI refuses. */
  async speak(text: string, lang: AppLang): Promise<Buffer> {
    const key = createHash('sha1').update(`${lang}\n${text}`).digest('hex');
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh the entry's position: Map iteration order is insertion order, so the oldest goes first.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions: INSTRUCTIONS[lang], response_format: 'mp3' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      this.deps.log.warn({ status: response.status }, 'speech synthesis failed');
      throw new Error(`speech_failed:${response.status}`);
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length < 100) throw new Error('speech_failed:empty');
    this.cache.set(key, audio);
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return audio;
  }
}
