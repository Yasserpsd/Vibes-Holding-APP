import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AdvisorService } from '../advisor/service.js';
import type { AuthService } from '../auth/service.js';
import type { DashboardService } from '../dashboard/service.js';
import type { ProjectsService } from '../projectsBank/service.js';
import type { PushService } from '../push/service.js';
import type { FeedService } from '../sync/feed.js';
import type { SyncService } from '../sync/service.js';
import { checkSignature, WINDOW_SECONDS } from './signature.js';

export type WebhookRoutesOptions = {
  hubSecret?: string;
  pbSecret?: string;
  auth: AuthService;
  advisor: AdvisorService;
  dashboard: DashboardService;
  projects: ProjectsService;
  push: PushService;
  feed: FeedService;
  sync: SyncService;
};

const eventSchema = z.object({ event: z.string().min(1).max(60), at: z.union([z.string(), z.number()]).optional(), data: z.record(z.string(), z.unknown()).default({}) });
const REFRESH_WAIT_MS = 2_500;

const header = (request: FastifyRequest, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = request.headers[name];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
};
const contactIdOf = (data: Record<string, unknown>): number | null => {
  const id = Number(data.contact_id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * Instant sync (docs/BRIDGE_V2.md 1.5 and 2): the hub and Projects Bank tell this server that something changed. The
 * bodies carry ids only, no personal data; the server drops its caches, moves the `/api/sync` versions and asks back
 * through the bridges when it needs the content. Signed (HMAC over the raw body with a timestamp window), else refused.
 */
export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (app, options) => {
  // The signature covers the body byte for byte, so this plugin keeps JSON bodies as text (its own scope only).
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_request, body, done) => done(null, body));
  // A signature is accepted once: the same signed request again changes nothing.
  const seen = new Map<string, number>();

  const accept = (request: FastifyRequest, reply: FastifyReply, secret: string | undefined, prefixes: string[]): { event: string; data: Record<string, unknown> } | 'duplicate' | null => {
    if (!secret) {
      void reply.code(503).send({ error: { code: 'not_configured', message: 'webhook secret is not set on this server' } });
      return null;
    }
    const rawBody = typeof request.body === 'string' ? request.body : '';
    const signature = header(request, ...prefixes.map((prefix) => `${prefix}-signature`));
    const verdict = checkSignature({ secret, timestamp: header(request, ...prefixes.map((prefix) => `${prefix}-timestamp`)), signature, rawBody });
    if (verdict !== 'ok') {
      request.log.warn({ verdict }, 'webhook refused');
      void reply.code(401).send({ error: { code: verdict === 'stale' ? 'stale' : 'bad_signature', message: 'signature check failed' } });
      return null;
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }
    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) {
      void reply.code(400).send({ error: { code: 'invalid', message: 'unexpected webhook body' } });
      return null;
    }
    const now = Date.now();
    for (const [key, expires] of seen) if (expires <= now) seen.delete(key);
    if (signature && seen.has(signature)) return 'duplicate';
    if (signature) seen.set(signature, now + 2 * WINDOW_SECONDS * 1000);
    return parsed.data;
  };

  app.post('/api/webhooks/hub', async (request, reply) => {
    const hook = accept(request, reply, options.hubSecret, ['x-vai']);
    if (!hook) return;
    if (hook === 'duplicate') return { ok: true, duplicate: true };
    const { event, data } = hook;
    const contactId = contactIdOf(data);
    switch (event) {
      case 'knowledge.changed':
        options.feed.bust();
        await options.sync.bump('feed');
        break;
      case 'member.changed':
        if (contactId) options.auth.forget(contactId);
        options.dashboard.bust('hub', 'pb');
        break;
      case 'message.staff':
        options.dashboard.bust('threads');
        // The member learns that a person answered. Sent in the background: a failure is logged, the webhook still answers.
        if (contactId) options.push.staffReplied(contactId);
        break;
      case 'message.assistant':
        options.dashboard.bust('threads');
        break;
      case 'payment.recorded':
        options.dashboard.bust('hub');
        break;
      case 'config.changed':
        options.advisor.resetSettings();
        await options.sync.bump('content');
        break;
      default:
        request.log.info({ event }, 'hub webhook event ignored');
        return { ok: true, ignored: true };
    }
    return { ok: true };
  });

  app.post('/api/webhooks/pb', async (request, reply) => {
    const hook = accept(request, reply, options.pbSecret, ['x-pb', 'x-vai']);
    if (!hook) return;
    if (hook === 'duplicate') return { ok: true, duplicate: true };
    options.dashboard.bust('pb');
    if (hook.event !== 'project.changed') {
      request.log.info({ event: hook.event }, 'Projects Bank webhook event ignored');
      return { ok: true, ignored: true };
    }
    // The snapshot is fetched again now; the answer does not wait for a slow feed (the sender gives up after 3 s).
    const refreshed = options.projects
      .refresh()
      .then(() => options.sync.bump('projects'))
      .catch((error: unknown) => request.log.warn({ err: error }, 'projects refresh after the webhook failed'));
    await Promise.race([refreshed, new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS).unref())]);
    return { ok: true };
  });
};
