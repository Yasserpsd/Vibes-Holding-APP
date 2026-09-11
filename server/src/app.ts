import { createHash } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { contentRoutes } from './content/routes.js';
import { projectsRoutes } from './projectsBank/routes.js';
import { ProjectsService } from './projectsBank/service.js';
import type { KV } from './store.js';

export type AppDeps = { config: Config; kv: KV };

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

export async function buildApp({ config, kv }: AppDeps): Promise<{ app: FastifyInstance; projects: ProjectsService }> {
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

  app.get('/health', async () => ({
    ok: true,
    env: config.APP_ENV,
    time: new Date().toISOString(),
    projectsBank: {
      ...projects.status(),
      ...(config.APP_ENV === 'test' ? { keyFingerprint: keyFingerprint(config.PB_FEED_KEY) } : {}),
    },
  }));

  await app.register(projectsRoutes, { service: projects });
  await app.register(contentRoutes, { kv });

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

  return { app, projects };
}
