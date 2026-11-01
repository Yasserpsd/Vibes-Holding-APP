import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Translator } from '../translate.js';
import type { Post, PostEnglish, PostsService } from './service.js';

/**
 * M180 (owner: «مينفعش الاقي كلمة واحدة عربي لما احوله انجليزي»): every admin message reads fully in English —
 * title, body, place, link labels and poll options — whichever way it was written (dashboard, the in-app composer,
 * or a post stored before M43). One AI call per change of the Arabic; the owner's own English title/body
 * (`enAuto: false`) stays and only the rest is filled. A failed call waits for the next pass.
 */

const FIRST_RUN_MS = 20_000;
const INTERVAL_MS = 60 * 60_000;

function sourceOf(post: Post): string[] {
  const options = post.kind === 'poll' ? (post.poll?.options ?? []).map((option) => option.label) : [];
  return [post.title, post.body, post.event?.place ?? '', ...post.links.map((link) => link.label), ...options];
}

const hashOf = (values: string[]): string => createHash('sha256').update(values.join('\u0000')).digest('hex');

/** True while the stored English does not cover the post's current Arabic. */
export function needsEnglish(post: Post): boolean {
  return !post.en || post.en.hash !== hashOf(sourceOf(post));
}

type Deps = { service: PostsService; translator: Translator; log: FastifyBaseLogger };

export class PostsEnglish {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: Deps) {}

  /** Writes the post's English when it is missing or stale; the owner's own title/body are kept. */
  async ensure(id: string): Promise<void> {
    if (this.deps.translator.mode === 'off') return;
    const post = await this.deps.service.get(id);
    if (!post || !needsEnglish(post)) return;
    const source = sourceOf(post);
    const manual = post.enAuto === false && post.en ? post.en : null;
    const out = await this.deps.translator.translate(manual ? source.map((text, index) => (index < 2 ? '' : text)) : source);
    if (!out) return;
    const pick = (index: number, fallback: string): string => out[index] || fallback;
    const linkCount = post.links.length;
    const en: PostEnglish = {
      title: manual ? manual.title : pick(0, post.title),
      body: manual ? manual.body : pick(1, post.body),
      place: post.event?.place ? pick(2, post.event.place) : null,
      links: post.links.map((link, index) => pick(3 + index, link.label)),
      options: post.kind === 'poll' ? (post.poll?.options ?? []).map((option, index) => pick(3 + linkCount + index, option.label)) : [],
      hash: hashOf(source),
    };
    await this.deps.service.setEnglish(post.id, en, !manual);
  }

  /** One pass over every post: catches failed calls and posts written before this existed. */
  run(): Promise<void> {
    if (!this.running) {
      this.running = (async () => {
        for (const post of await this.deps.service.listAll()) {
          if (needsEnglish(post)) await this.ensure(post.id);
        }
      })()
        .catch((error: unknown) => this.deps.log.warn({ err: error }, 'posts English pass failed'))
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  start(): void {
    if (this.deps.translator.mode === 'off' || this.timer) return;
    setTimeout(() => void this.run(), FIRST_RUN_MS).unref();
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
