import { createHash } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { advisorRoutes } from './advisor/routes.js';
import { AdvisorService } from './advisor/service.js';
import { authRoutes } from './auth/routes.js';
import { AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import type { Config } from './config.js';
import { contentRoutes } from './content/routes.js';
import { hqRoutes } from './hq/routes.js';
import { HqService } from './hq/service.js';
import { LiveHubClient } from './hub/client.js';
import { MockHubClient } from './hub/mock.js';
import type { HubClient } from './hub/types.js';
import { LogMailer, parseRecipients, SmtpMailer, type Mailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { membershipRoutes } from './membership/routes.js';
import { MembershipService } from './membership/service.js';
import { KeywordClassifier, type Classifier } from './news/classify.js';
import { OpenAIClassifier } from './news/openai.js';
import { newsRoutes } from './news/routes.js';
import { NewsService } from './news/service.js';
import { LivePaymob, MOCK_HMAC_SECRET, MockPaymob, parseIntegrationIds, type PaymobGateway } from './payments/paymob.js';
import { paymentsRoutes } from './payments/routes.js';
import { PaymentsService } from './payments/service.js';
import { projectsRoutes } from './projectsBank/routes.js';
import { ProjectsService } from './projectsBank/service.js';
import type { KV } from './store.js';
import { OpenAIBlurbWriter, TemplateBlurbWriter, type BlurbWriter } from './videos/blurbs.js';
import { videosRoutes } from './videos/routes.js';
import { VideosService } from './videos/service.js';

export type AppDeps = {
  config: Config;
  kv: KV;
  hub?: HubClient;
  classifier?: Classifier;
  blurbs?: BlurbWriter;
  fetchImpl?: typeof fetch;
  mailer?: Mailer;
  gateway?: PaymobGateway;
};

/** Length plus a short hash: lets the owner compare the deployed key with the local one without exposing it. */
function keyFingerprint(key: string | undefined): string | null {
  if (!key) return null;
  return `${key.length}:${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
}

function errorStatus(error: unknown): number {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error ? (error as { statusCode?: unknown }).statusCode : undefined;
  return typeof statusCode === 'number' && statusCode >= 400 ? statusCode : 500;
}

export type BuiltApp = { app: FastifyInstance; projects: ProjectsService; news: NewsService; videos: VideosService; payments: PaymentsService; notifier: Notifier };

export async function buildApp({ config, kv, hub, classifier, blurbs, fetchImpl, mailer, gateway }: AppDeps): Promise<BuiltApp> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,
  });

  // API responses are never cached by CDNs or proxies (CLAUDE.md rule 8).
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  const projects = new ProjectsService({ kv, config, log: app.log });
  const hubClient: HubClient =
    hub ??
    (config.HUB_MODE === 'live' && config.HUB_SITE_KEY
      ? new LiveHubClient({ url: config.HUB_URL, siteKey: config.HUB_SITE_KEY, log: app.log })
      : new MockHubClient());
  const sessions = new SessionStore(kv, config.SESSION_DAYS);
  const auth = new AuthService({ hub: hubClient, sessions, config, log: app.log });
  // News: OpenAI labels the items when a key is set; otherwise keywords. Neither writes a word of news.
  const newsClassifier: Classifier =
    classifier ??
    (config.OPENAI_API_KEY
      ? new OpenAIClassifier({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, log: app.log })
      : new KeywordClassifier());
  const news = new NewsService({ kv, config, log: app.log, classifier: newsClassifier, fetchImpl });
  const advisor = new AdvisorService({ hub: hubClient, projects, news, kv, log: app.log });
  // Videos: the channel feed (or the Data API with a key); blurbs are marketing lines written once.
  const blurbWriter: BlurbWriter =
    blurbs ?? (config.OPENAI_API_KEY ? new OpenAIBlurbWriter({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, log: app.log }) : new TemplateBlurbWriter());
  const videos = new VideosService({ kv, config, log: app.log, blurbs: blurbWriter, fetchImpl });
  // Management notifications: the website's hosting mailbox (SMTP) or log-only when it is not configured.
  const mail: Mailer =
    mailer ??
    (config.SMTP_HOST
      ? new SmtpMailer({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE ? config.SMTP_SECURE === '1' : config.SMTP_PORT === 465,
          user: config.SMTP_USER,
          pass: config.SMTP_PASS,
          from: config.MAIL_FROM ?? config.SMTP_USER ?? 'no-reply@vcmem.com',
        })
      : new LogMailer(app.log));
  const notifier = new Notifier({ mailer: mail, recipients: parseRecipients(config.NOTIFY_EMAIL), log: app.log, appEnv: config.APP_ENV });
  const hq = new HqService({ kv, log: app.log, notifier });
  // Payments: Paymob intentions for real-world services; the mock gateway stands in until the test keys exist.
  const paymob: PaymobGateway =
    gateway ??
    (config.PAYMOB_MODE === 'live' && config.PAYMOB_SECRET_KEY && config.PAYMOB_PUBLIC_KEY
      ? new LivePaymob({
          baseUrl: config.PAYMOB_BASE_URL,
          secretKey: config.PAYMOB_SECRET_KEY,
          publicKey: config.PAYMOB_PUBLIC_KEY,
          integrationIds: parseIntegrationIds(config.PAYMOB_INTEGRATION_ID),
          log: app.log,
          fetchImpl,
        })
      : new MockPaymob(config.PUBLIC_URL));
  const payments = new PaymentsService({
    kv,
    log: app.log,
    gateway: paymob,
    notifier,
    hmacSecret: paymob.mode === 'live' && config.PAYMOB_HMAC_SECRET ? config.PAYMOB_HMAC_SECRET : MOCK_HMAC_SECRET,
    publicUrl: config.PUBLIC_URL,
  });
  const membership = new MembershipService({ kv, log: app.log, hub: hubClient, auth, notifier, appEnv: config.APP_ENV });
  const appScheme = config.APP_ENV === 'production' ? 'investorsclub' : 'investorsclub-preview';

  app.get('/health', async () => ({
    ok: true,
    env: config.APP_ENV,
    storage: config.DATABASE_URL ? 'postgres' : 'memory',
    time: new Date().toISOString(),
    projectsBank: {
      ...projects.status(),
      ...(config.APP_ENV === 'test' ? { keyFingerprint: keyFingerprint(config.PB_FEED_KEY) } : {}),
    },
    hub: {
      mode: hubClient.mode,
      host: new URL(config.HUB_URL).host,
      registrationOpen: auth.registrationOpen,
      adminOnly: auth.adminOnly,
      ...(config.APP_ENV === 'test' ? { keyFingerprint: keyFingerprint(config.HUB_SITE_KEY) } : {}),
    },
    news: news.status(),
    videos: videos.status(),
    mail: notifier.status(),
    payments: payments.status(),
    membership: membership.status(),
  }));

  await app.register(projectsRoutes, { service: projects });
  await app.register(contentRoutes, { kv, auth, notifier });
  await app.register(authRoutes, { service: auth, hubMode: config.HUB_MODE });
  await app.register(advisorRoutes, { service: advisor, auth });
  await app.register(newsRoutes, { service: news, auth });
  await app.register(videosRoutes, { service: videos });
  await app.register(hqRoutes, { service: hq, auth });
  await app.register(paymentsRoutes, { service: payments, auth, kv, appScheme });
  await app.register(membershipRoutes, { service: membership, auth, webhookAuth: config.REVENUECAT_WEBHOOK_AUTH });

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: { code: 'not_found', message: 'المسار غير موجود' } });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const status = errorStatus(error);
    if (status >= 500) request.log.error({ err: error }, 'Unhandled error');
    void reply.code(status).send({
      error: {
        code: status >= 500 ? 'internal' : 'bad_request',
        message: status >= 500 ? 'حدث خطأ غير متوقع' : error instanceof Error ? error.message : 'طلب غير صالح',
      },
    });
  });

  return { app, projects, news, videos, payments, notifier };
}
