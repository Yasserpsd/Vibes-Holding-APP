import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { ensureGoldenSeed } from './content/golden.js';
import { createKV } from './store.js';

loadDotEnv();
const config = loadConfig();
const kv = await createKV(config.DATABASE_URL);
const seeded = await ensureGoldenSeed(kv);
const { app, projects } = await buildApp({ config, kv });

app.log.info({ storage: config.DATABASE_URL ? 'postgres' : 'memory', seeded }, 'storage ready');
await projects.start();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  projects.stop();
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
