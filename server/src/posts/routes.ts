import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { MediaService } from '../media/service.js';
import type { PushService } from '../push/service.js';
import type { SyncService } from '../sync/service.js';
import type { PostsHubSync } from './hubSync.js';
import { InvalidVideoError, postInputSchema, postMediaUrls, type Post, type PostInput, type PostsService } from './service.js';

export type PostsRoutesOptions = { service: PostsService; auth: AuthService; push: PushService; media: MediaService; hubSync: PostsHubSync; sync: SyncService };

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  before: z.string().max(40).optional(),
});
const idSchema = z.object({ id: z.string().uuid() });

const NOT_FOUND = { error: { code: 'not_found', message: 'المنشور غير موجود' } };

/** What the app sees: no author, no draft fields. */
function publicPost(post: Post) {
  const { id, title, body, links, images, youtubeId, pinned, publishedAt } = post;
  return { id, title, body, links, images, youtubeId, video: post.video ?? null, pinned, publishedAt, kind: post.kind ?? 'post', event: post.event ?? null };
}

/** «رسائل الإدارة»: the public feed for the app's home and the dashboard's admin endpoints. */
export const postsRoutes: FastifyPluginAsync<PostsRoutesOptions> = async (app, { service, auth, push, media, hubSync, sync }) => {
  const requireAdmin = dashboardGuard(auth);

  /** Uploaded media must exist with the right kind; pasted image links pass as before. */
  const checkMedia = async (input: PostInput): Promise<void> => {
    for (const url of input.images) if (media.keyOf(url)) await media.check(url, 'image');
    if (!input.videoFile) return;
    await media.check(input.videoFile.url, 'video');
    if (input.videoFile.poster) await media.check(input.videoFile.poster, 'image');
  };

  /** Removes the uploaded files a changed or deleted post no longer uses, unless another post still does. */
  const dropUnused = async (before: Post, after: Post | null): Promise<void> => {
    const keys = (urls: string[]) => urls.map((url) => media.keyOf(url)).filter((key): key is string => key !== null);
    // What other posts use is matched by path alone, so a post saved under an older public domain still protects its files.
    const kept = new Set<string | null>((await service.listAll()).flatMap(postMediaUrls).map((url) => MediaService.keyInPath(url)));
    if (after) for (const key of keys(postMediaUrls(after))) kept.add(key);
    await media.discard(keys(postMediaUrls(before)).filter((key) => !kept.has(key)));
  };

  app.get(
    '/api/posts',
    guard(async (request, reply) => {
      const query = parse(listSchema, request.query, reply);
      if (!query) return;
      const { posts, more } = await service.listPublished(query.limit, query.before);
      return { posts: posts.map(publicPost), more };
    }),
  );

  app.get(
    '/api/posts/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const post = await service.get(params.id);
      if (!post || post.status !== 'published') return reply.code(404).send(NOT_FOUND);
      return { post: publicPost(post) };
    }),
  );

  app.get(
    '/api/admin/posts',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { posts: await service.listAll(), devices: (await push.summary()).total };
    }),
  );

  const save = (mode: 'create' | 'update') =>
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = mode === 'update' ? parse(idSchema, request.params, reply) : { id: '' };
      if (!params) return;
      const input = parse(postInputSchema, request.body, reply);
      if (!input) return;
      try {
        await checkMedia(input);
        const before = mode === 'update' ? await service.get(params.id) : null;
        // A copy: the stored post object is changed in place by the update.
        const previous = before ? { ...before, images: [...before.images] } : null;
        const post = mode === 'create' ? await service.create(input, admin.me.name ?? admin.me.email ?? null) : await service.update(params.id, input);
        if (!post) return await reply.code(404).send(NOT_FOUND);
        if (previous) await dropUnused(previous, post);
        // One brain: the websites' feed and the assistant hear it now, the app through /api/sync. A hub failure never
        // blocks the post: it is recorded on it (`hubSync`) and tried again on the next edit.
        await hubSync.saved(post, admin.session.uuid);
        await sync.bump('posts');
        return await reply.code(mode === 'create' ? 201 : 200).send({ post: (await service.get(post.id)) ?? post });
      } catch (error) {
        if (error instanceof InvalidVideoError) return reply.code(400).send({ error: { code: 'invalid', message: error.message } });
        throw error;
      }
    });

  app.post('/api/admin/posts', save('create'));
  app.put('/api/admin/posts/:id', save('update'));

  app.delete(
    '/api/admin/posts/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const post = await service.get(params.id);
      if (!post || !(await service.remove(params.id))) return reply.code(404).send(NOT_FOUND);
      await dropUnused(post, null);
      await hubSync.removed(post, admin.session.uuid);
      await sync.bump('posts');
      return { ok: true };
    }),
  );

  app.post(
    '/api/admin/posts/:id/notify',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const post = await service.get(params.id);
      if (!post) return reply.code(404).send(NOT_FOUND);
      if (post.status !== 'published') {
        return reply.code(409).send({ error: { code: 'not_published', message: 'انشر المنشور أولًا ثم أرسل الإشعار' } });
      }
      const text = post.body.replace(/\s+/g, ' ').trim();
      // No registered device means nobody would receive it: say so instead of reporting a sent notification.
      if ((await push.summary()).total === 0) {
        return reply.code(409).send({ error: { code: 'no_devices', message: 'لا توجد أجهزة مسجلة للإشعارات بعد، فلن يصل الإشعار إلى أحد' } });
      }
      const outcome = await push.broadcast({
        title: post.title,
        body: text.length > 140 ? `${text.slice(0, 139)}…` : text || 'رسالة جديدة من إدارة النادي',
        data: { type: 'post', postId: post.id, screen: `/posts/${post.id}` },
      });
      // Only a delivered notification counts: a broadcast where every ticket failed is not recorded.
      if (outcome.sent > 0) await service.markNotified(post.id);
      return { ok: outcome.sent > 0, ...outcome };
    }),
  );
};
