import type { FastifyBaseLogger } from 'fastify';

import { HubError, hubCall, type HubClient } from '../hub/types.js';
import type { KV } from '../store.js';
import type { Post, PostsService } from './service.js';

/**
 * «عقل واحد»: a post or an event published from the dashboard is handed to the hub's `publish` op (docs/BRIDGE_V2.md
 * 1.3), so the websites' `[vai_feed]` and the assistant know it at the same moment as the app. The hub is never in the
 * post's way: a failure is logged, written on the post (`hubSync`) and tried again on the next edit; a removal that
 * failed waits in `admin:posts:hubPending` for the next edit of any post.
 */
export const HUB_PENDING_KEY = 'admin:posts:hubPending';
const WAIT_MS = 8_000;
const MAX_PENDING = 50;

type Deps = { hub: HubClient; posts: PostsService; kv: KV; log: FastifyBaseLogger; onChange?: () => void };

export class PostsHubSync {
  constructor(private readonly deps: Deps) {}

  /** After a create or an edit. Answers within a few seconds whatever the hub does. */
  async saved(post: Post, adminUuid: string): Promise<void> {
    const work = this.afterSave(post, adminUuid).catch((error: unknown) => this.deps.log.error({ err: error, post: post.id }, 'post hub sync crashed'));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, WAIT_MS).unref())]);
  }

  async removed(post: Post, adminUuid: string): Promise<void> {
    const work = this.afterRemove(post, adminUuid).catch((error: unknown) => this.deps.log.error({ err: error, post: post.id }, 'post hub sync crashed'));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, WAIT_MS).unref())]);
  }

  private async afterSave(post: Post, adminUuid: string): Promise<void> {
    const onHub = post.hubSync?.published === true;
    if (post.status === 'published') {
      const error = await this.call(adminUuid, {
        key: post.id,
        kind: post.kind ?? 'post',
        title: post.title,
        content: post.body,
        url: post.links[0]?.url ?? '',
        image: post.images[0] ?? post.video?.poster ?? '',
        ...(post.kind === 'event' && post.event ? { event: { date: post.event.date, place: post.event.place, online_url: post.event.onlineUrl ?? '' } } : {}),
      });
      await this.mark(post, error, error ? onHub : true);
    } else if (onHub || post.hubSync?.state === 'failed') {
      // Back to a draft: the websites stop showing it.
      const error = await this.call(adminUuid, { key: post.id, remove: true });
      await this.mark(post, error, error ? onHub : false);
    }
    await this.retryPending(adminUuid);
  }

  private async afterRemove(post: Post, adminUuid: string): Promise<void> {
    if (post.hubSync?.published || post.status === 'published') {
      const error = await this.call(adminUuid, { key: post.id, remove: true });
      // The post is gone, so the removal is remembered on its own and tried again on the next edit of any post.
      if (error && error !== 'hub_not_supported') await this.remember(post.id);
    }
    await this.retryPending(adminUuid, post.id);
  }

  /** null = done; otherwise the error code. */
  private async call(adminUuid: string, body: Record<string, unknown>): Promise<string | null> {
    try {
      await hubCall(this.deps.hub, 'publish', { uuid: adminUuid, ...body });
      // The hub's knowledge moved: `/api/feed` does not wait for its minute of cache.
      this.deps.onChange?.();
      return null;
    } catch (error) {
      const code = error instanceof HubError ? error.code : 'internal';
      // An older hub simply does not have the op yet: nothing to alarm anyone about.
      if (code === 'hub_not_supported') this.deps.log.info({ post: body.key }, 'the hub has no publish op yet (plugin older than 2.7.0)');
      else this.deps.log.warn({ post: body.key, code }, 'post not handed to the hub, next edit tries again');
      return code;
    }
  }

  private mark(post: Post, error: string | null, published: boolean): Promise<void> {
    return this.deps.posts.markHubSync(post.id, { state: error === null ? 'ok' : error === 'hub_not_supported' ? 'unsupported' : 'failed', at: new Date().toISOString(), error, published });
  }

  private async remember(key: string): Promise<void> {
    const keys = (await this.deps.kv.get<{ keys: string[] }>(HUB_PENDING_KEY))?.keys ?? [];
    if (!keys.includes(key)) await this.deps.kv.set(HUB_PENDING_KEY, { keys: [...keys, key].slice(-MAX_PENDING) });
  }

  private async retryPending(adminUuid: string, skip?: string): Promise<void> {
    const keys = (await this.deps.kv.get<{ keys: string[] }>(HUB_PENDING_KEY))?.keys ?? [];
    if (!keys.length) return;
    const left: string[] = [];
    for (const key of keys) {
      if (key === skip || (await this.call(adminUuid, { key, remove: true })) !== null) left.push(key);
    }
    if (left.length !== keys.length) await this.deps.kv.set(HUB_PENDING_KEY, { keys: left });
  }
}
