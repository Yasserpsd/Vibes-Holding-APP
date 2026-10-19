import type { FastifyBaseLogger } from 'fastify';

import type { FetchImpl } from '../news/rss.js';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = 'gpt-4o-mini-transcribe';
const TIMEOUT_MS = 60_000;

type Deps = { apiKey: string; log: FastifyBaseLogger; fetchImpl?: FetchImpl };

/**
 * M104 «المستشار بالصوت»: the member records his question in the app; the server turns the clip
 * into text (OpenAI transcription, the same env key the news classifier uses) and the app sends
 * it as an ordinary advisor message. The audio is never stored and never logged.
 */
export class VoiceTranscriber {
  constructor(private readonly deps: Deps) {}

  async transcribe(audio: Buffer, mime: string, lang: 'ar' | 'en'): Promise<string> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const name = mime.includes('webm') ? 'clip.webm' : mime.includes('wav') ? 'clip.wav' : 'clip.m4a';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), name);
    form.append('model', MODEL);
    form.append('language', lang);
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      this.deps.log.warn({ status: response.status }, 'voice transcription failed');
      throw new Error(`transcription_failed:${response.status}`);
    }
    const data = (await response.json()) as { text?: unknown };
    return typeof data.text === 'string' ? data.text.trim() : '';
  }
}
