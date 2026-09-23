import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { adminGuard, dashboardGuard, guard, optionalSession, parse } from '../auth/guard.js';
import { PERSONAS, type AuthService } from '../auth/service.js';
import { hubCall, type HubClient } from '../hub/types.js';
import { langOf, type AppLang } from '../lang.js';
import type { Translator } from '../translate.js';
import { MediaService } from '../media/service.js';
import type { PollsService } from '../polls/service.js';
import type { PushService } from '../push/service.js';
import type { SyncService } from '../sync/service.js';
import type { PostsHubSync } from './hubSync.js';
import { audienceOf, audienceSchema, canSee, InvalidVideoError, postInputSchema, postMediaUrls, type Post, type PostInput, type PostsService, type PostViewer } from './service.js';

export type PostsRoutesOptions = { service: PostsService; auth: AuthService; hub: HubClient; polls: PollsService; push: PushService; media: MediaService; hubSync: PostsHubSync; sync: SyncService; autoPush?: boolean; translator?: Translator };

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  before: z.string().max(40).optional(),
});
const idSchema = z.object({ id: z.string().uuid() });

const NOT_FOUND = { error: { code: 'not_found', message: 'المنشور غير موجود' } };

/** What the app sees: no author, no draft fields. `audience` is only its type — the viewer labels «لك خصيصًا» / «لفئتك». */
function publicPost(post: Post, lang: AppLang = 'ar') {
  const { id, links, images, youtubeId, pinned, publishedAt } = post;
  // M43: the English app reads the stored English (AI once, owner-editable); anything untranslated stays Arabic.
  const en = lang === 'en' ? (post.en ?? null) : null;
  const event = post.event ? { ...post.event, place: en?.place || post.event.place } : (post.event ?? null);
  return {
    id,
    title: en?.title || post.title,
    body: en?.body || post.body,
    links,
    images,
    youtubeId,
    video: post.video ?? null,
    pinned,
    publishedAt,
    kind: post.kind ?? 'post',
    event,
    audience: audienceOf(post).type,
  };
}

/** M29: the app's admin composer sends a plain targeted message (no media) and its notification in one act. */
const composeSchema = z.object({
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(6000),
  audience: audienceSchema,
});
const memberSearchSchema = z.object({ q: z.string().trim().min(2).max(120) });

const voteSchema = z.object({ optionId: z.string().trim().min(1).max(40) });

/** «رسائل الإدارة»: the member's inbox feed (M29) and the dashboard's admin endpoints. */
export const postsRoutes: FastifyPluginAsync<PostsRoutesOptions> = async (app, { service, auth, hub, polls, push, media, hubSync, sync, autoPush = true, translator }) => {
  const requireAdmin = dashboardGuard(auth, true); // M28: moderators publish posts
  const maybeSession = optionalSession(auth);

  /** Who is reading: a guest — or a member the hub cannot confirm right now — sees only what is for everyone (M29). */
  const viewerOf = async (request: FastifyRequest): Promise<PostViewer> => {
    const current = await maybeSession(request);
    return current?.me ? { contactId: current.me.id, persona: current.me.persona } : null;
  };

  /** M31: the post as the app reads it, with the poll block as THIS viewer may see it. */
  const viewerPost = async (post: Post, viewer: PostViewer, lang: AppLang = 'ar') => ({
    ...publicPost(post, lang),
    ...(post.kind === 'poll' ? { poll: await polls.view(post, viewer?.contactId ?? null) } : {}),
  });

  /** How many registered devices the post's audience holds right now. */
  const audienceDevices = async (post: Post): Promise<number> => {
    const audience = audienceOf(post);
    if (audience.type === 'all') return (await push.summary()).total;
    if (audience.type === 'persona') return (await push.tokensForPersona(audience.persona)).length;
    return (await push.tokensFor(audience.contactId)).length;
  };

  /** One notification to exactly the post's audience. Only a delivered one is recorded on the post. */
  const pushPost = async (post: Post) => {
    const text = post.body.replace(/\s+/g, ' ').trim();
    const message = {
      title: post.title,
      body: text.length > 140 ? `${text.slice(0, 139)}…` : text || 'رسالة جديدة من إدارة النادي',
      data: { type: 'post', postId: post.id, screen: `/posts/${post.id}` },
    };
    const audience = audienceOf(post);
    const outcome =
      audience.type === 'all' ? await push.broadcast(message) : audience.type === 'persona' ? await push.broadcastPersona(audience.persona, message) : await push.send(audience.contactId, message);
    if (outcome.sent > 0) await service.markNotified(post.id);
    return outcome;
  };

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
      const viewer = await viewerOf(request);
      const lang = langOf(request);
      const { posts, more } = await service.listPublished(query.limit, query.before, viewer);
      return { posts: await Promise.all(posts.map((post) => viewerPost(post, viewer, lang))), more };
    }),
  );

  app.get(
    '/api/posts/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const post = await service.get(params.id);
      const viewer = await viewerOf(request);
      // A targeted post answers the wrong viewer exactly like a missing one: its existence is private too.
      if (!post || post.status !== 'published' || !canSee(post, viewer)) return reply.code(404).send(NOT_FOUND);
      return { post: await viewerPost(post, viewer, langOf(request)) };
    }),
  );

  /** M31: one standing vote per member, changeable until the poll closes. Members only. */
  app.post(
    '/api/posts/:id/vote',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const input = parse(voteSchema, request.body, reply);
      if (!input) return;
      const viewer = await viewerOf(request);
      if (!viewer) return reply.code(401).send({ error: { code: 'unauthorized', message: 'سجّل الدخول أولًا للمشاركة في الاستفتاء' } });
      const post = await service.get(params.id);
      if (!post || post.status !== 'published' || !canSee(post, viewer)) return reply.code(404).send(NOT_FOUND);
      await polls.vote(post, viewer.contactId, input.optionId);
      return { poll: await polls.view(post, viewer.contactId) };
    }),
  );

  app.get(
    '/api/admin/posts',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      // M28/M29: a moderator publishes to everyone; the admin's targeted messages are not his to read.
      const all = await service.listAll();
      const listed = admin.level === 'admin' ? all : all.filter((post) => audienceOf(post).type === 'all');
      // M31: the dashboard reads every poll's live counts beside it.
      const posts = await Promise.all(
        listed.map(async (post) => (post.kind === 'poll' ? { ...post, pollResults: await polls.view(post, null, admin.level === 'admin') } : post)),
      );
      return { posts, devices: (await push.summary()).total };
    }),
  );

  /** M28/M29/M31: a moderator publishes plain posts to everyone; targeted messages and polls are the admin's alone. */
  const MODERATOR_TARGETED = { error: { code: 'forbidden', message: 'الرسائل الموجّهة لحسابات الأدمن فقط' } };
  const MODERATOR_POLL = { error: { code: 'forbidden', message: 'الاستفتاءات لحسابات الأدمن فقط' } };
  const isPoll = (value: Pick<Post, 'kind'> | PostInput | null): boolean => value?.kind === 'poll';

  const save = (mode: 'create' | 'update') =>
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = mode === 'update' ? parse(idSchema, request.params, reply) : { id: '' };
      if (!params) return;
      const input = parse(postInputSchema, request.body, reply);
      if (!input) return;
      try {
        const before = mode === 'update' ? await service.get(params.id) : null;
        if (mode === 'update' && !before) return await reply.code(404).send(NOT_FOUND);
        if (admin.level !== 'admin' && (input.audience.type !== 'all' || (before && audienceOf(before).type !== 'all'))) {
          return await reply.code(403).send(MODERATOR_TARGETED);
        }
        if (admin.level !== 'admin' && (isPoll(input) || isPoll(before))) return await reply.code(403).send(MODERATOR_POLL);
        await checkMedia(input);
        // A copy: the stored post object is changed in place by the update.
        const previous = before ? { ...before, images: [...before.images] } : null;
        const post = mode === 'create' ? await service.create(input, admin.me.name ?? admin.me.email ?? null) : await service.update(params.id, input);
        if (!post) return await reply.code(404).send(NOT_FOUND);
        if (previous) await dropUnused(previous, post);
        // One brain: the websites' feed and the assistant hear it now, the app through /api/sync. A hub failure never
        // blocks the post: it is recorded on it (`hubSync`) and tried again on the next edit.
        await hubSync.saved(post, admin.session.uuid);
        await sync.bump('posts');
        // M43: the English of the owner's words — his own wording from the editor wins for good;
        // otherwise AI writes it once and rewrites it only while the Arabic changes and he never edited it.
        const manual = input.english && (input.english.title.trim() !== '' || input.english.body.trim() !== '') ? input.english : null;
        if (manual && (manual.title !== (post.en?.title ?? '') || manual.body !== (post.en?.body ?? ''))) {
          await service.setEnglish(post.id, { title: manual.title, body: manual.body, place: post.en?.place ?? null }, false);
        } else if (translator && translator.mode !== 'off') {
          const place = post.event?.place ?? '';
          const arabicChanged = !previous || previous.title !== post.title || previous.body !== post.body || (previous.event?.place ?? '') !== place;
          if (post.en == null || (post.enAuto !== false && arabicChanged)) {
            const out = await translator.translate([post.title, post.body, place]);
            if (out) await service.setEnglish(post.id, { title: out[0] || post.title, body: out[1] || post.body, place: place ? out[2] || place : null }, true);
          }
        }
        // M42 (owner: «بمجرد ما انشر اي رسالة كل الناس يجيلها اشعار فورا»): the FIRST publish notifies
        // its audience by itself; edits never re-notify, and the manual button stays for reminders.
        if (autoPush && post.status === 'published' && previous?.status !== 'published' && !post.notifiedAt) {
          void pushPost(post).catch((error: unknown) => request.log.error({ err: error, post: post.id }, 'auto post notification failed'));
        }
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
      if (!post) return reply.code(404).send(NOT_FOUND);
      if (admin.level !== 'admin' && audienceOf(post).type !== 'all') return reply.code(403).send(MODERATOR_TARGETED);
      if (admin.level !== 'admin' && isPoll(post)) return reply.code(403).send(MODERATOR_POLL);
      if (!(await service.remove(params.id))) return reply.code(404).send(NOT_FOUND);
      await dropUnused(post, null);
      if (isPoll(post)) await polls.remove(post.id);
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
      if (admin.level !== 'admin' && audienceOf(post).type !== 'all') return reply.code(403).send(MODERATOR_TARGETED);
      if (admin.level !== 'admin' && isPoll(post)) return reply.code(403).send(MODERATOR_POLL);
      if (post.status !== 'published') {
        return reply.code(409).send({ error: { code: 'not_published', message: 'انشر المنشور أولًا ثم أرسل الإشعار' } });
      }
      // M29: the notification goes exactly where the message goes. No registered device in the
      // audience means nobody would receive it: say so instead of reporting a sent notification.
      if ((await audienceDevices(post)) === 0) {
        const audience = audienceOf(post);
        const who = audience.type === 'all' ? 'للإشعارات بعد' : audience.type === 'persona' ? 'لهذه الفئة بعد' : 'لهذا العضو بعد';
        return reply.code(409).send({ error: { code: 'no_devices', message: `لا توجد أجهزة مسجلة ${who}، فلن يصل الإشعار إلى أحد` } });
      }
      const outcome = await pushPost(post);
      return { ok: outcome.sent > 0, ...outcome };
    }),
  );

  const requireAppAdmin = adminGuard(auth);

  /**
   * M29: the composer inside the app (admins only, like every `/api/admin/app|hq` route — the app's
   * sign-in never goes through the dashboard's e-mailed code). Picking «عضو واحد» starts here.
   */
  app.get(
    '/api/admin/app/members',
    guard(async (request, reply) => {
      const admin = await requireAppAdmin(request, reply);
      if (!admin) return;
      const query = parse(memberSearchSchema, request.query, reply);
      if (!query) return;
      const result = await hubCall(hub, 'admin_accounts', { uuid: admin.session.uuid, q: query.q, state: 'all', page: 1, per_page: 8 });
      const personaLabel = (key: string) => PERSONAS.find((entry) => entry.key === key)?.label.split('—')[0]?.trim() ?? '';
      return { members: result.items.map((item) => ({ id: item.id, name: item.name, email: item.email, persona: item.persona, personaLabel: personaLabel(item.persona) })) };
    }),
  );

  /** Sends a plain message to its audience and pushes it in the same act; it lands in the inboxes at once. */
  app.post(
    '/api/admin/app/messages',
    guard(async (request, reply) => {
      const admin = await requireAppAdmin(request, reply);
      if (!admin) return;
      const input = parse(composeSchema, request.body, reply);
      if (!input) return;
      const post = await service.create(
        { title: input.title, body: input.body, links: [], images: [], video: null, videoFile: null, status: 'published', pinned: false, kind: 'post', event: null, audience: input.audience },
        admin.me.name ?? admin.me.email ?? null,
      );
      // A message for everyone reaches the websites and the assistant like any dashboard post; a targeted one never does.
      await hubSync.saved(post, admin.session.uuid);
      await sync.bump('posts');
      const devices = await audienceDevices(post);
      const outcome = devices > 0 ? await pushPost(post) : null;
      return reply.code(201).send({ post: (await service.get(post.id)) ?? post, devices, push: outcome });
    }),
  );
};
