// Writes the server content seeds (golden, membership, home, services, about, HQ, videos). Usage: npm run seed [-- --force]
import { loadConfig, loadDotEnv } from '../config.js';
import { ensureAboutSeed } from '../content/about.js';
import { ensureGoldenSeed } from '../content/golden.js';
import { ensureGuideSeed } from '../content/guide.js';
import { ensureHomeSeed } from '../content/home.js';
import { ensureHqSeed } from '../content/hq.js';
import { ensureMembershipSeed } from '../content/membership.js';
import { ensureServicesSeed } from '../content/services.js';
import { ensureVideosSeed } from '../content/videos.js';
import { createKV } from '../store.js';

loadDotEnv();
const config = loadConfig();
const force = process.argv.includes('--force');

if (!config.DATABASE_URL) {
  console.warn('DATABASE_URL is not set: seeding the in-memory store has no lasting effect.');
}

const kv = await createKV(config.DATABASE_URL);
const results = {
  golden: await ensureGoldenSeed(kv, { force }),
  membership: await ensureMembershipSeed(kv, { force }),
  home: await ensureHomeSeed(kv, { force }),
  services: await ensureServicesSeed(kv, { force }),
  about: await ensureAboutSeed(kv, { force }),
  hq: await ensureHqSeed(kv, { force }),
  videos: await ensureVideosSeed(kv, { force }),
  guide: await ensureGuideSeed(kv, { force }),
};
for (const [name, written] of Object.entries(results)) {
  console.log(written ? `${name}: content written.` : `${name}: content already present (use --force to overwrite).`);
}
await kv.close();
