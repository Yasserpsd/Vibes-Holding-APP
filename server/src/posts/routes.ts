import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { adminGuard, dashboardGuard, guard, optionalSession, parse } from '../auth/guard.js';
import { PERSONAS, type AuthService } from '../auth/service.js';
import { firstName } from '../companion/tips.js';
import { isActiveMember } from '../content/services.js';
import { hubCall, type HubClient } from '../hub/types.js';
import { langOf, type AppLang } from '../lang.js';
import { MediaService } from '../media/service.js';
import type { PollsService, PollView } from '../polls/service.js';
import type { PushService } from '../push/service.js';
import type { SyncService } from '../sync/service.js';
import type { WaDelivery } from '../whatsapp/service.js';
import { accountInAudience } from '../whatsapp/tell.js';
import type { PostsEnglish } from './english.js';
import type { PostsHubSync } from './hubSync.js';
import type { PostOpens } from './opens.js';
import { audienceFilter, audienceMemberIds, audienceOf, audienceSchema, canSee, fitsFilter, InvalidVideoError, pollClosed, postInputSchema, postMediaUrls, type AudienceFilter, type PaidState, type Post, type PostAudience, type PostInput, type PostsService, type PostViewer } from './service.js';

export type PostsRoutesOptions = { /** M243: who opened each message (the dashboard's read stats). */ opens?: PostOpens; service: PostsService; auth: AuthService; hub: HubClient; polls: PollsService; push: PushService; media: MediaService; hubSync: PostsHubSync; sync: SyncService; autoPush?: boolean; english?: PostsEnglish; /** M235: a message addressed to ONE member is also announced on his WhatsApp. */ tellMember?: (contactId: number, ref: string) => void; /** M236: a message for everyone (persona null) or one category is announced to every account that fits. */ tellAudience?: (uuid: string, persona: string | null, ref: string, /** M273: only whoever paid / did not pay. */ paid?: PaidState | null) => void; /** M251: the WhatsApp delivery of one message's notice, for the dashboard. */ delivery?: (postId: string) => Promise<WaDelivery>; /** M269: the reminder's WhatsApp half — starts in the background and says at once whether it started, is held for the night, or WhatsApp is off. */ remind?: (input: { uuid: string; persona: string | null; paid?: PaidState | null; members: number[]; done: ReadonlySet<number>; ref: string }) => 'started' | 'night' | 'off' };

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  before: z.string().max(40).optional(),
});
const idSchema = z.object({ id: z.string().uuid() });

/**
 * M232 (owner: «توصله بإسمه بحيث الناس تحس بالخصوصية»): a management message opens with the reader's own name. The
 * English app greets with the English name when the account has one.
 */
export function greeting(lang: AppLang, name: string | null | undefined, nameEn?: string | null): string {
  if (lang === 'en') {
    // M239 (owner, 2026-11-14): never an Arabic name in English text — no English form yet means a neutral greeting.
    const english = (nameEn || '').trim();
    const own = (name || '').trim();
    const shown = english && !/[؀-ۿ]/.test(english) ? english : /[؀-ۿ]/.test(own) ? '' : own;
    if (!english && !own) return '';
    return shown ? `Dear ${shown},` : 'Dear member,';
  }
  const shown = (name || '').trim();
  return shown ? `الأستاذ/ ${shown}،` : '';
}

const HONORARY_MEMBER = { error: { code: 'honorary', message: 'هذا العضو يحمل العضوية الشرفية، ولا تصله رسائل الإدارة ولا إشعاراتها' } };
const POPUP_NO_PUSH = { error: { code: 'popup', message: 'البوب أب يظهر داخل التطبيق عند فتحه، ولا يُرسل معه إشعار' } };

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
    links: en?.links ? links.map((link, index) => ({ ...link, label: en.links?.[index] || link.label })) : links,
    images,
    youtubeId,
    video: post.video ?? null,
    pinned,
    publishedAt,
    kind: post.kind ?? 'post',
    event,
    // M238: a chosen list reads in the app exactly like a message for one member («لك خصيصًا»).
    // M273: a message for whoever paid / did not pay reads in the app like one for a category («لفئتك»).
    audience: audienceOf(post).type === 'members' ? 'member' : audienceOf(post).type === 'paid' ? 'persona' : audienceOf(post).type,
  };
}

/** M180: the poll's option labels in the reader's language (ids and counts stay). */
function localPoll(post: Post, poll: PollView | null, lang: AppLang): PollView | null {
  const labels = lang === 'en' ? post.en?.options : undefined;
  return poll && labels ? { ...poll, options: poll.options.map((option, index) => ({ ...option, label: labels[index] || option.label })) } : poll;
}

/** M29: the app's admin composer sends a plain targeted message (no media) and its notification in one act. */
const composeSchema = z.object({
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(6000),
  audience: audienceSchema,
});
const reachSchema = z.object({ audience: audienceSchema });
const memberSearchSchema = z.object({ q: z.string().trim().min(2).max(120) });

const voteSchema = z.object({ optionId: z.string().trim().min(1).max(40) });

/** «رسائل الإدارة»: the member's inbox feed (M29) and the dashboard's admin endpoints. */
export const postsRoutes: FastifyPluginAsync<PostsRoutesOptions> = async (app, { opens, service, auth, hub, polls, push, media, hubSync, sync, autoPush = true, english, tellMember, tellAudience, delivery, remind }) => {
  const requireAdmin = dashboardGuard(auth, true); // M28: moderators publish posts
  const maybeSession = optionalSession(auth);

  /** Who is reading: a guest — or a member the hub cannot confirm right now — sees only what is for everyone (M29). */
  const viewerOf = async (request: FastifyRequest): Promise<PostViewer> => viewerFrom(await maybeSession(request));
  const viewerFrom = (current: Awaited<ReturnType<typeof maybeSession>>): PostViewer => {
    if (!current?.me) return null;
    const me = current.me;
    return { contactId: me.id, persona: me.persona, honorary: me.membership.kind === 'honorary', paid: isActiveMember(me), name: firstName(me.name), nameEn: firstName(me.en?.name) };
  };

  /** M31: the post as the app reads it, with the poll block as THIS viewer may see it. */
  const viewerPost = async (post: Post, viewer: PostViewer, lang: AppLang = 'ar') => ({
    ...personal(publicPost(post, lang), viewer, lang),
    ...(post.kind === 'poll' ? { poll: localPoll(post, await polls.view(post, viewer?.contactId ?? null), lang) } : {}),
  });

  /** M232: a plain management message («رسالة الإدارة») reads as written to this member: his name opens it. */
  const personal = <T extends { kind: string; body: string }>(shown: T, viewer: PostViewer, lang: AppLang): T => {
    const hello = shown.kind === 'post' && viewer ? greeting(lang, viewer.name, viewer.nameEn) : '';
    return hello ? { ...shown, body: shown.body ? `${hello}\n\n${shown.body}` : hello } : shown;
  };

  /** M232 + M238: the refusal when a named member (the one, or any of a chosen list) is honorary; null when none is. */
  const honoraryIn = async (audience: PostAudience) => {
    if (audience.type === 'member') return (await auth.honoraryOf(audience.contactId)) ? HONORARY_MEMBER : null;
    if (audience.type !== 'members') return null;
    const held: string[] = [];
    for (const member of audience.members) if (await auth.honoraryOf(member.contactId)) held.push(member.name || `#${member.contactId}`);
    return held.length ? { error: { code: 'honorary', message: `أزل من القائمة أصحاب العضوية الشرفية، فلا تصلهم رسائل الإدارة ولا إشعاراتها: ${held.join('، ')}` } } : null;
  };

  /** How many registered devices the post's audience holds right now (M232: honorary members' devices never count). */
  const audienceDevices = async (post: Pick<Post, 'audience'>, uuid: string, fresh = false): Promise<number> => {
    const audience = audienceOf(post);
    if (audience.type === 'all') return push.reachable();
    // M273: a category, a payment state, or both — as each device's account stood at its last registration.
    const filter = audienceFilter(audience);
    const fitting = await paidAccounts(uuid, filter, fresh);
    if (fitting) return (await push.tokensForAccounts(fitting)).length;
    if (filter) return (await push.tokensForSegment(filter.persona, filter.paid ? filter.paid === 'paid' : null)).length;
    let devices = 0;
    for (const contactId of audienceMemberIds(audience)) devices += (await push.tokensFor(contactId)).length;
    return devices;
  };

  /** M235 + M236: WhatsApp says a message arrived (its words stay in the app): to the one member it is addressed to, or to every account of its audience. */
  const announce = (post: Post, uuid: string) => {
    const audience = audienceOf(post);
    // M238: every member of a chosen list hears it like the one member of a personal message.
    const named = audienceMemberIds(audience);
    // M251: each member has his own ref — one shared ref let the first send answer «already sent» for the rest of the list.
    if (named.length) for (const contactId of named) tellMember?.(contactId, `post:${post.id}:${contactId}`);
    else tellAudience?.(uuid, audienceFilter(audience)?.persona ?? null, `post:${post.id}`, audienceFilter(audience)?.paid ?? null);
  };

  /**
   * M269: the name of every account, by id, for the WhatsApp status list. The names are the hub's (rule 2) and are
   * kept five minutes; a hub that cannot answer leaves the list with account numbers, as before.
   */
  type AccountRow = { id: number; name: string; persona: unknown; state: unknown; honorary: unknown };
  let accountsCache: { at: number; rows: AccountRow[] } | null = null;
  /** M273: every account of the hub's registry (kept five minutes); `complete` is false when the hub stopped answering midway. */
  const accountRows = async (uuid: string, fresh = false): Promise<{ rows: AccountRow[]; complete: boolean }> => {
    if (!fresh && accountsCache && Date.now() - accountsCache.at < 5 * 60_000) return { rows: accountsCache.rows, complete: true };
    const rows: AccountRow[] = [];
    try {
      for (let page = 1; page <= 50; page += 1) {
        const slice = await hubCall(hub, 'admin_accounts', { uuid, q: '', state: 'all', page, per_page: 100 });
        for (const account of slice.items) rows.push({ id: account.id, name: String(account.name ?? '').trim(), persona: account.persona, state: account.state, honorary: account.honorary });
        if (slice.items.length === 0 || page * slice.per_page >= slice.total) break;
      }
      accountsCache = { at: Date.now(), rows };
      return { rows, complete: true };
    } catch {
      // The list still opens: rows without a name show the account number.
      return { rows, complete: false };
    }
  };
  /**
   * M273: the accounts a payment filter names, by the hub's registry (rule 2). A device only knows the membership as it
   * stood at its last launch, so a member who paid an hour ago must not hear «لم يدفع» from it. Null when the audience
   * has no payment filter, or the hub cannot answer now — the devices' own note decides then.
   */
  const paidAccounts = async (uuid: string, filter: AudienceFilter | null, fresh = false): Promise<Set<number> | null> => {
    if (!filter?.paid) return null;
    const { rows, complete } = await accountRows(uuid, fresh);
    return complete ? new Set(rows.filter((row) => accountInAudience(row, filter.persona, filter.paid)).map((row) => row.id)) : null;
  };
  const accountNames = async (uuid: string): Promise<Map<number, string>> => {
    const names = new Map<number, string>();
    for (const row of (await accountRows(uuid)).rows) if (row.name) names.set(row.id, row.name);
    return names;
  };

  /** M269: who needs no reminder — whoever opened the message; for a poll that still takes votes, whoever voted. */
  const doneWith = async (post: Post): Promise<Set<number>> => {
    if (post.kind === 'poll' && post.poll && !pollClosed(post.poll)) return new Set(await polls.voters(post.id));
    return new Set((opens ? await opens.list(post.id) : []).map((open) => open.contactId));
  };

  /** One notification to exactly the post's audience. Only a delivered one is recorded on the post. */
  const pushPost = async (post: Post, uuid: string, reminder: { done: ReadonlySet<number>; titled: boolean } | null = null) => {
    // M180: an English app hears the message in English (the stored English; the Arabic only until it exists).
    const messageIn = (lang: AppLang, name: string | null, nameEn: string | null) => {
      const en = lang === 'en' ? post.en : null;
      const text = (en?.body || post.body).replace(/\s+/g, ' ').trim();
      const fallback = lang === 'en' ? 'A new message from the club management' : 'رسالة جديدة من إدارة النادي';
      // M232: the notification of a management message carries the member's name too.
      const hello = (post.kind ?? 'post') === 'post' ? greeting(lang, name, nameEn) : '';
      const line = text.length > 140 ? `${text.slice(0, 139)}…` : text || fallback;
      const title = en?.title || post.title;
      return {
        // M269: a reminder says it is one.
        title: reminder?.titled ? (lang === 'en' ? `Reminder: ${title}` : `تذكير: ${title}`) : title,
        body: hello ? `${hello} ${line}` : line,
        data: { type: 'post', postId: post.id, screen: `/posts/${post.id}` },
      };
    };
    const audience = audienceOf(post);
    const named = audienceMemberIds(audience);
    const filter = audienceFilter(audience);
    // M273: a payment filter is judged by the hub's registry as it is this minute, not by the device's older note.
    const fitting = await paidAccounts(uuid, filter, true);
    // M232: every device hears its own wording; honorary members' devices are left out by the push service itself.
    const outcome = await push.broadcastPersonal((device) => {
      if (filter && (fitting ? !fitting.has(device.contactId) : !fitsFilter(filter, { persona: device.persona, paid: device.member }))) return null;
      if (named.length && !named.includes(device.contactId)) return null;
      // M269: a reminder leaves alone whoever already opened the message (a poll: already voted).
      if (reminder?.done.has(device.contactId)) return null;
      return messageIn(device.lang === 'en' ? 'en' : 'ar', device.name, device.nameEn);
    });
    if (outcome.sent > 0) await service.markNotified(post.id);
    return outcome;
  };

  /** Uploaded media must exist with the right kind; pasted image links pass as before. */
  const checkMedia = async (input: PostInput): Promise<void> => {
    for (const url of input.images) if (media.keyOf(url)) await media.check(url, 'image');
    if (!input.videoFile) return;
    await media.check(input.videoFile.url, 'video');
    if (input.videoFile.poster) await media.check(input.videoFile.poster, 'image');
    // M189: a Bunny video without an uploaded poster shows Bunny's own thumbnail.
    else input.videoFile.poster = media.posterFor(input.videoFile.url);
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

  /** M232: the popups waiting for this viewer — the app opens the newest one it has not shown yet, once. */
  app.get(
    '/api/popups',
    guard(async (request, reply) => {
      const viewer = await viewerOf(request);
      const lang = langOf(request);
      void reply.header('cache-control', 'no-store');
      const popups = (await service.listPopups(viewer)).slice(0, 5).map((post) => {
        const shown = publicPost(post, lang);
        return { id: shown.id, title: shown.title, body: shown.body, image: shown.images[0] ?? null, link: shown.links[0] ?? null, publishedAt: shown.publishedAt, until: post.popup?.until ?? null };
      });
      return { popups };
    }),
  );

  app.get(
    '/api/posts/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const post = await service.get(params.id);
      const current = await maybeSession(request);
      const viewer = viewerFrom(current);
      // A targeted post answers the wrong viewer exactly like a missing one: its existence is private too.
      if (!post || post.status !== 'published' || !canSee(post, viewer)) return reply.code(404).send(NOT_FOUND);
      // M243: the member opened the message — recorded for the dashboard, never awaited by the reader.
      if (current?.me) void opens?.record(post.id, { contactId: current.me.id, name: current.me.name ?? '', persona: current.me.persona ?? '' });
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
      return { poll: localPoll(post, await polls.view(post, viewer.contactId), langOf(request)) };
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
      // M243: how many members opened each message; the names wait behind /api/admin/posts/:id/opens.
      const opened = opens ? await opens.counts(posts.map((post) => post.id)) : {};
      return { posts: posts.map((post) => ({ ...post, opened: opened[post.id] ?? 0 })), devices: (await push.summary()).total };
    }),
  );

  /** M243: the members who opened one message, latest first. Names are the admin's only, like the poll voters. */
  app.get(
    '/api/admin/posts/:id/opens',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      if (admin.level !== 'admin') return reply.code(403).send({ error: { code: 'admins_only', message: 'أسماء من فتحوا الرسالة متاحة للمدير فقط' } });
      const post = await service.get(params.id);
      if (!post) return reply.code(404).send(NOT_FOUND);
      // M251: next to who opened it, where its WhatsApp notice stands (delivered, waiting, being tried again, refused).
      const whatsapp = delivery ? await delivery(post.id) : null;
      // M269 (owner: «يظهر اسم الشخص اعرف مين وصله علي واتس اب»): every row carries the account's name, the delivered ones too.
      const names = whatsapp && whatsapp.rows.length + whatsapp.reached.length > 0 ? await accountNames(admin.session.uuid) : new Map<number, string>();
      const named = <T extends { contactId: number | null }>(row: T) => ({ ...row, name: (row.contactId !== null && names.get(row.contactId)) || null });
      return { opens: opens ? await opens.list(post.id) : [], whatsapp: whatsapp ? { ...whatsapp, rows: whatsapp.rows.map(named), reached: whatsapp.reached.map(named) } : null };
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
        // M232: an honorary member is kept apart from the management's messages — say so instead of sending into nothing.
        const honorary = await honoraryIn(input.audience);
        if (honorary) return await reply.code(409).send(honorary);
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
        // M180: links, place and poll options always follow by AI, even under his own title/body.
        const manual = input.english && (input.english.title.trim() !== '' || input.english.body.trim() !== '') ? input.english : null;
        if (manual && (manual.title !== (post.en?.title ?? '') || manual.body !== (post.en?.body ?? ''))) {
          await service.setEnglish(post.id, { title: manual.title, body: manual.body, place: post.en?.place ?? null, links: post.en?.links, options: post.en?.options }, false);
        }
        await english?.ensure(post.id);
        // M42 (owner: «بمجرد ما انشر اي رسالة كل الناس يجيلها اشعار فورا»): the FIRST publish notifies
        // its audience by itself; edits never re-notify, and the manual button stays for reminders.
        // M232: a popup opens inside the app by itself and sends no notification.
        if (post.kind !== 'popup' && post.status === 'published' && previous?.status !== 'published') announce(post, admin.session.uuid);
        if (autoPush && post.kind !== 'popup' && post.status === 'published' && previous?.status !== 'published' && !post.notifiedAt) {
          void pushPost((await service.get(post.id)) ?? post, admin.session.uuid).catch((error: unknown) => request.log.error({ err: error, post: post.id }, 'auto post notification failed'));
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
      await opens?.forget(post.id);
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
      if (post.kind === 'popup') return reply.code(409).send(POPUP_NO_PUSH);
      if (post.status !== 'published') {
        return reply.code(409).send({ error: { code: 'not_published', message: 'انشر المنشور أولًا ثم أرسل الإشعار' } });
      }
      // M269 (owner, 2026-11-23): the button is a reminder — the app's notification AND a WhatsApp notice, only to
      // whoever did not open the message yet (a poll still open: did not vote yet). WhatsApp runs in the background.
      const done = await doneWith(post);
      const audience = audienceOf(post);
      const devices = await audienceDevices(post, admin.session.uuid, true);
      const whatsapp = remind ? remind({ uuid: admin.session.uuid, persona: audienceFilter(audience)?.persona ?? null, paid: audienceFilter(audience)?.paid ?? null, members: audienceMemberIds(audience), done, ref: `post:${post.id}` }) : 'off';
      // M29: the notification goes exactly where the message goes. No registered device in the
      // audience means nobody would receive it: say so instead of reporting a sent notification.
      if (devices === 0 && whatsapp !== 'started') {
        const who = audience.type === 'all' ? 'للإشعارات بعد' : audienceFilter(audience) ? 'لهذه الفئة بعد' : audience.type === 'members' ? 'لهؤلاء الأعضاء بعد' : 'لهذا العضو بعد';
        return reply.code(409).send({ error: { code: 'no_devices', message: `لا توجد أجهزة مسجلة ${who}، فلن يصل الإشعار إلى أحد` } });
      }
      const outcome = devices > 0 ? await pushPost(post, admin.session.uuid, { done, titled: Boolean(post.notifiedAt) }) : { sent: 0, failed: 0, dropped: 0 };
      return { ok: outcome.sent > 0 || whatsapp === 'started', ...outcome, whatsapp, opened: done.size };
    }),
  );

  /**
   * M273: before sending, the dashboard shows whom an audience reaches — how many accounts read it in the app (the hub's
   * registry, rule 2; null when the hub cannot answer now) and how many registered devices hear its notification.
   */
  app.post(
    '/api/admin/posts/reach',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(reachSchema, request.body, reply);
      if (!input) return;
      const audience = input.audience;
      if (admin.level !== 'admin' && audience.type !== 'all') return reply.code(403).send(MODERATOR_TARGETED);
      const devices = await audienceDevices({ audience }, admin.session.uuid);
      if (audience.type === 'member' || audience.type === 'members') return { members: audienceMemberIds(audience).length, devices };
      const filter = audienceFilter(audience);
      const { rows, complete } = await accountRows(admin.session.uuid);
      return { members: complete ? rows.filter((row) => accountInAudience(row, filter?.persona ?? null, filter?.paid ?? null)).length : null, devices };
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
      const honorary = await honoraryIn(input.audience);
      if (honorary) return reply.code(409).send(honorary);
      const post = await service.create(
        { title: input.title, body: input.body, links: [], images: [], video: null, videoFile: null, status: 'published', pinned: false, kind: 'post', event: null, audience: input.audience },
        admin.me.name ?? admin.me.email ?? null,
      );
      // A message for everyone reaches the websites and the assistant like any dashboard post; a targeted one never does.
      await hubSync.saved(post, admin.session.uuid);
      // M180: the in-app composer gets its English before the push, like a dashboard post.
      await english?.ensure(post.id);
      await sync.bump('posts');
      announce(post, admin.session.uuid);
      const devices = await audienceDevices(post, admin.session.uuid, true);
      const outcome = devices > 0 ? await pushPost((await service.get(post.id)) ?? post, admin.session.uuid) : null;
      return reply.code(201).send({ post: (await service.get(post.id)) ?? post, devices, push: outcome });
    }),
  );
};
