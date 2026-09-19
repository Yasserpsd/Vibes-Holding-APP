import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { ensureAboutSeed } from './content/about.js';
import { ensureGoldenSeed } from './content/golden.js';
import { ensureHomeSeed } from './content/home.js';
import { ensureHqSeed } from './content/hq.js';
import { ensureMembershipSeed } from './content/membership.js';
import { ensureServicesSeed } from './content/services.js';
import { ensureVideosSeed } from './content/videos.js';
import { ensureNewsSourcesSeed } from './news/sources.js';
import { createKV } from './store.js';

loadDotEnv();
const config = loadConfig();
const kv = await createKV(config.DATABASE_URL);
const seeded = {
  golden: await ensureGoldenSeed(kv),
  membership: await ensureMembershipSeed(kv),
  home: await ensureHomeSeed(kv),
  services: await ensureServicesSeed(kv),
  about: await ensureAboutSeed(kv),
  hq: await ensureHqSeed(kv),
  videos: await ensureVideosSeed(kv),
  newsSources: await ensureNewsSourcesSeed(kv),
};
const { app, projects, news, videos, media } = await buildApp({ config, kv });

app.log.info({ storage: config.DATABASE_URL ? 'postgres' : 'memory', seeded, hub: config.HUB_MODE }, 'storage ready');
await projects.start();
await news.start();
await videos.start();
media.start();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  projects.stop();
  news.stop();
  videos.stop();
  media.stop();
  await app.close();
  await kv.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ env: config.APP_ENV }, 'server started');
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
