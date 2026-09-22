import { createHash } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { advisorRoutes } from './advisor/routes.js';
import { AdvisorService } from './advisor/service.js';
import { authRoutes } from './auth/routes.js';
import { AdminOtpStore } from './auth/adminOtp.js';
import { AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import type { Config } from './config.js';
import { appStringsRoutes } from './appStrings/routes.js';
import { cardRoutes } from './card/routes.js';
import { CardService } from './card/service.js';
import { invitesRoutes } from './invites/routes.js';
import { InvitesService } from './invites/service.js';
import { contentRoutes } from './content/routes.js';
import { dashboardRoutes } from './dashboard/routes.js';
import { DashboardService } from './dashboard/service.js';
import { hqRoutes } from './hq/routes.js';
import { HqService } from './hq/service.js';
import { LiveHubClient } from './hub/client.js';
import { MOCK_CODE, MockHubClient } from './hub/mock.js';
import type { HubClient } from './hub/types.js';
import { LogMailer, parseRecipients, SmtpMailer, type Mailer } from './mail/mailer.js';
import { Notifier } from './mail/notify.js';
import { membershipRoutes } from './membership/routes.js';
import { MembershipService } from './membership/service.js';
import { KeywordClassifier, type Classifier } from './news/classify.js';
import { OpenAIClassifier } from './news/openai.js';
import { newsRoutes } from './news/routes.js';
import { NewsService } from './news/service.js';
import { LivePaymob, MOCK_HMAC_SECRET, MockPaymob, parseIntegrationIds, paymobKeyMode, paymobKeyShape, type PaymobGateway } from './payments/paymob.js';
import { paymentsRoutes } from './payments/routes.js';
import { PaymentsService } from './payments/service.js';
import { ProjectAccessService } from './projectsBank/access.js';
import { BriefService } from './projectsBank/brief.js';
import { LivePbBridge, MockPbBridge, OffPbBridge, type PbBridge } from './projectsBank/bridge.js';
import { projectsRoutes } from './projectsBank/routes.js';
import { ProjectsService } from './projectsBank/service.js';
import { mediaRoutes } from './media/routes.js';
import { S3MediaStore } from './media/s3.js';
import { MediaService } from './media/service.js';
import { DiskMediaStore, type MediaStore } from './media/store.js';
import { PollsService } from './polls/service.js';
import { PostsHubSync } from './posts/hubSync.js';
import { postsRoutes } from './posts/routes.js';
import { PostsService, postMediaUrls } from './posts/service.js';
import { pushRoutes } from './push/routes.js';
import { PushService } from './push/service.js';
import type { KV } from './store.js';
import { FeedService } from './sync/feed.js';
import { syncRoutes } from './sync/routes.js';
import { SyncService, type SyncKey } from './sync/service.js';
import { OpenAIBlurbWriter, TemplateBlurbWriter, type BlurbWriter } from './videos/blurbs.js';
import { videosRoutes } from './videos/routes.js';
import { VideosService } from './videos/service.js';
import { webhookRoutes } from './webhooks/routes.js';

export type AppDeps = {
  config: Config;
  kv: KV;
  hub?: HubClient;
  pb?: PbBridge;
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

/** `https://host/` and `https://host` are the same origin for the allow-list. */
function trimOrigin(value: string): string {
  let origin = value.trim();
  while (origin.endsWith('/')) origin = origin.slice(0, -1);
  return origin;
}

export type BuiltApp = { app: FastifyInstance; projects: ProjectsService; news: NewsService; videos: VideosService; payments: PaymentsService; notifier: Notifier; membership: MembershipService; push: PushService; media: MediaService; sync: SyncService; dashboard: DashboardService; feed: FeedService };

const MEGABYTE = 1024 * 1024;

export async function buildApp({ config, kv, hub, pb, classifier, blurbs, fetchImpl, mailer, gateway }: AppDeps): Promise<BuiltApp> {
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

  // The web dashboard lives on its own origin and signs in with Bearer tokens (no cookies): answer only listed origins.
  const adminOrigins = new Set((config.ADMIN_ORIGINS ?? '').split(',').map(trimOrigin).filter(Boolean));
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !request.url.startsWith('/api/')) return;
    reply.header('vary', 'origin');
    if (!adminOrigins.has(origin)) return;
    reply.header('access-control-allow-origin', origin);
    if (request.method !== 'OPTIONS') return;
    await reply
      .header('access-control-allow-methods', 'GET, POST, PUT, DELETE')
      .header('access-control-allow-headers', 'authorization, content-type')
      .header('access-control-max-age', '600')
      .code(204)
      .send();
  });

  // «عقل واحد»: whatever changes anywhere moves a version the app polls (/api/sync).
  const sync = new SyncService(kv);
  // Fire and forget: a version that kv could not save is logged, never an unhandled rejection.
  const moved = (...keys: SyncKey[]): void => void sync.bump(...keys).catch((error: unknown) => app.log.error({ err: error, keys }, 'sync version not saved'));
  const projects = new ProjectsService({ kv, config, log: app.log, onChange: () => moved('projects') });
  // The server's own mock hub comes with a demo club, so the dashboard can be checked locally.
  const hubClient: HubClient =
    hub ??
    (config.HUB_MODE === 'live' && config.HUB_SITE_KEY
      ? new LiveHubClient({ url: config.HUB_URL, siteKey: config.HUB_SITE_KEY, log: app.log })
      : new MockHubClient({ seed: true }));
  // Projects Bank bridge (balance, unlock, grant): live with its key, the mock beside the mock hub, else off.
  const pbBridge: PbBridge =
    pb ??
    (config.PB_BRIDGE_KEY
      ? new LivePbBridge({ url: config.PB_BRIDGE_URL, key: config.PB_BRIDGE_KEY, log: app.log, fetchImpl })
      : config.HUB_MODE === 'mock'
        ? new MockPbBridge({ projects, demo: !hub })
        : new OffPbBridge());
  const sessions = new SessionStore(kv, config.SESSION_DAYS);
  // News: OpenAI labels the items when a key is set; otherwise keywords. Neither writes a word of news.
  const newsClassifier: Classifier =
    classifier ??
    (config.OPENAI_API_KEY
      ? new OpenAIClassifier({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, log: app.log })
      : new KeywordClassifier());
  const news = new NewsService({ kv, config, log: app.log, classifier: newsClassifier, fetchImpl, onChange: () => moved('news') });
  // Videos: the channel feed (or the Data API with a key); blurbs are marketing lines written once.
  const blurbWriter: BlurbWriter =
    blurbs ?? (config.OPENAI_API_KEY ? new OpenAIBlurbWriter({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, log: app.log }) : new TemplateBlurbWriter());
  const videos = new VideosService({ kv, config, log: app.log, blurbs: blurbWriter, fetchImpl });
  // «رسائل الإدارة»: admin posts and events from the dashboard, shown first on the app's home (M9).
  const posts = new PostsService(kv);
  const polls = new PollsService(kv);
  const advisor = new AdvisorService({ hub: hubClient, projects, news, kv, log: app.log, posts, videos });
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
  // Dashboard sign-in code (M18). On the mock hub without SMTP the code is the mock's public test code.
  const otp = new AdminOtpStore(kv, config.ADMIN_OTP_SECONDS, hubClient.mode === 'mock' && !mail.configured ? MOCK_CODE : null);
  const notifier = new Notifier({ mailer: mail, recipients: parseRecipients(config.NOTIFY_EMAIL), log: app.log, appEnv: config.APP_ENV });
  // «الدعوات» (M32): the hub stores who invited whom at registration; this list carries the manual gift work.
  const invites = new InvitesService({ kv, hub: hubClient, notifier, log: app.log });
  const auth = new AuthService({ hub: hubClient, sessions, config, log: app.log, otp, mailer: mail, invites });
  // Member push notifications (Expo push service); tokens come from the app after login.
  const push = new PushService({ kv, log: app.log, fetchImpl, accessToken: config.EXPO_PUSH_ACCESS_TOKEN });
  const hq = new HqService({ kv, log: app.log, notifier, push });
  const card = new CardService({ kv, notifier });
  // Uploaded images and video of the posts (M15): a bucket when its values are set, else a local folder.
  let mediaStore: MediaStore;
  if (config.S3_BUCKET && config.S3_ENDPOINT && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY) {
    const bucket = new S3MediaStore({
      bucket: config.S3_BUCKET,
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE === '1',
      log: app.log,
    });
    // The dashboard's browsers send files straight to the bucket; not awaited, a failure shows in /health.
    // Only the deployed service writes the rules: a local server pointed at the same bucket must not replace them.
    void bucket.allowOrigins(config.RAILWAY_PUBLIC_DOMAIN ? [...adminOrigins] : []);
    mediaStore = bucket;
  } else {
    mediaStore = new DiskMediaStore(config.UPLOADS_DIR, config.PUBLIC_URL);
  }
  const mediaOrigins = [config.PUBLIC_URL, ...(config.RAILWAY_PUBLIC_DOMAIN ? [`https://${config.RAILWAY_PUBLIC_DOMAIN}`] : [])].map((url) => new URL(url).origin);
  const media: MediaService = new MediaService({
    store: mediaStore,
    origins: [...new Set(mediaOrigins)],
    maxImageBytes: config.UPLOAD_MAX_IMAGE_MB * MEGABYTE,
    maxVideoBytes: config.UPLOAD_MAX_VIDEO_MB * MEGABYTE,
    enabled: mediaStore.durable || config.APP_ENV !== 'production',
    referenced: async () => new Set((await posts.listAll()).flatMap(postMediaUrls).map((url) => MediaService.keyInPath(url)).filter((key): key is string => key !== null)),
    sweepEnabled: config.UPLOADS_SWEEP === '1' && Boolean(config.DATABASE_URL),
    log: app.log,
  });
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
          exposeGatewayErrors: config.APP_ENV !== 'production',
          fetchImpl,
        })
      : new MockPaymob(config.PUBLIC_URL));
  const payments = new PaymentsService({
    kv,
    log: app.log,
    gateway: paymob,
    notifier,
    push,
    hmacSecret: paymob.mode === 'live' && config.PAYMOB_HMAC_SECRET ? config.PAYMOB_HMAC_SECRET : MOCK_HMAC_SECRET,
    publicUrl: config.PUBLIC_URL,
  });
  const membership = new MembershipService({
    kv,
    log: app.log,
    invites,
    hub: hubClient,
    auth,
    notifier,
    push,
    appEnv: config.APP_ENV,
    fetchImpl,
    store: {
      productId: config.STORE_MEMBERSHIP_PRODUCT,
      entitlement: config.REVENUECAT_ENTITLEMENT,
      androidKey: config.REVENUECAT_PUBLIC_KEY_ANDROID,
      iosKey: config.REVENUECAT_PUBLIC_KEY_IOS,
      secretKey: config.REVENUECAT_SECRET_KEY,
      termsUrl: config.STORE_TERMS_URL,
      privacyUrl: config.STORE_PRIVACY_URL,
    },
  });
  const appScheme = config.APP_ENV === 'production' ? 'investorsclub' : 'investorsclub-preview';
  // Bridge v2 (docs/BRIDGE_V2.md 4): the dashboard over the hub's admin ops, the members' Projects Bank «رصيد»,
  // the project brief, the websites' feed and the hub hand-over of published posts.
  const dashboard = new DashboardService({ hub: hubClient, pb: pbBridge, kv, auth, payments, membership, push, log: app.log });
  const access = new ProjectAccessService({ pb: pbBridge, projects, auth, log: app.log, onUnlock: () => dashboard.bust('pb') });
  const brief = new BriefService({ kv, log: app.log, apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, fetchImpl });
  const feed = new FeedService({ hub: hubClient, log: app.log });
  const postsHub = new PostsHubSync({
    hub: hubClient,
    posts,
    kv,
    log: app.log,
    onChange: () => {
      feed.bust();
      moved('feed');
    },
  });

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
      adminOtp: auth.adminOtpStatus,
      ...(config.APP_ENV === 'test' ? { keyFingerprint: keyFingerprint(config.HUB_SITE_KEY) } : {}),
    },
    news: news.status(),
    videos: videos.status(),
    mail: notifier.status(),
    payments: {
      ...payments.status(),
      ...(config.APP_ENV === 'test' ? { keys: paymobKeyMode(config.PAYMOB_SECRET_KEY), secret: paymobKeyShape(config.PAYMOB_SECRET_KEY), public: paymobKeyShape(config.PAYMOB_PUBLIC_KEY), hmacLength: config.PAYMOB_HMAC_SECRET?.length ?? 0, baseUrl: config.PAYMOB_BASE_URL, integrations: parseIntegrationIds(config.PAYMOB_INTEGRATION_ID) } : {}),
    },
    membership: membership.status(),
    push: push.status(),
    uploads: media.status(),
    // Versions of the hub and Projects Bank bridges as last checked (the check runs in the background).
    bridge: { ...dashboard.bridgeKnown(), pbMode: pbBridge.mode, brief: brief.mode, hubWebhook: Boolean(config.HUB_WEBHOOK_SECRET) },
  }));

  await app.register(projectsRoutes, { service: projects, auth, access, brief });
  await app.register(contentRoutes, { kv, auth, notifier, sync });
  await app.register(appStringsRoutes, { kv, auth, sync });
  await app.register(authRoutes, { service: auth, hubMode: config.HUB_MODE });
  await app.register(advisorRoutes, { service: advisor, auth });
  await app.register(newsRoutes, { service: news, auth });
  await app.register(videosRoutes, { service: videos });
  await app.register(hqRoutes, { service: hq, auth });
  await app.register(cardRoutes, { service: card, auth });
  await app.register(invitesRoutes, { service: invites, auth });
  await app.register(paymentsRoutes, { service: payments, auth, kv, appScheme });
  await app.register(membershipRoutes, { service: membership, auth, webhookAuth: config.REVENUECAT_WEBHOOK_AUTH });
  await app.register(pushRoutes, { service: push, auth });
  await app.register(mediaRoutes, { service: media, auth });
  await app.register(postsRoutes, { service: posts, auth, hub: hubClient, polls, push, media, hubSync: postsHub, sync });
  await app.register(dashboardRoutes, { service: dashboard, auth });
  await app.register(syncRoutes, { service: sync, feed });
  await app.register(webhookRoutes, { hubSecret: config.HUB_WEBHOOK_SECRET, pbSecret: config.PB_BRIDGE_KEY, auth, advisor, dashboard, projects, push, feed, sync });

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

  return { app, projects, news, videos, payments, notifier, membership, push, media, sync, dashboard, feed };
}
