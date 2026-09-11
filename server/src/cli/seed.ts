// Writes the server content seeds (golden portal, membership). Usage: npm run seed [-- --force]
import { loadConfig, loadDotEnv } from '../config.js';
import { ensureGoldenSeed } from '../content/golden.js';
import { ensureMembershipSeed } from '../content/membership.js';
import { createKV } from '../store.js';

loadDotEnv();
const config = loadConfig();
const force = process.argv.includes('--force');

if (!config.DATABASE_URL) {
  console.warn('DATABASE_URL is not set: seeding the in-memory store has no lasting effect.');
}

const kv = await createKV(config.DATABASE_URL);
const golden = await ensureGoldenSeed(kv, { force });
const membership = await ensureMembershipSeed(kv, { force });
console.log(golden ? 'Golden content written.' : 'Golden content already present (use --force to overwrite).');
console.log(membership ? 'Membership content written.' : 'Membership content already present (use --force to overwrite).');
await kv.close();
