import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['test', 'production']).default('test'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.string().min(1).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  PB_FEED_URL: z.string().min(1).default('https://vibesholding.com/wp-json/pb/v1/projects'),
  PB_FEED_KEY: z.string().min(1).optional(),
  PB_REFRESH_MINUTES: z.coerce.number().positive().default(10),
  // vcmem.com hub (Vibes AI Assistant plugin). The server is registered there as a tenant site.
  HUB_MODE: z.enum(['live', 'mock']).optional(),
  HUB_URL: z.string().url().default('https://vcmem.com'),
  HUB_SITE_KEY: z.string().min(20).optional(),
  // In the test environment registrations on the live hub stay closed unless the owner opens them.
  HUB_ALLOW_TEST_REGISTRATION: z.enum(['0', '1']).default('0'),
  SESSION_DAYS: z.coerce.number().int().positive().default(180),
  // News engine: 0 disables polling (tests); items older than NEWS_MAX_AGE_DAYS are dropped.
  NEWS_REFRESH_MINUTES: z.coerce.number().nonnegative().default(20),
  NEWS_MAX_AGE_DAYS: z.coerce.number().positive().default(10),
  // Cap on freshly fetched items per run: bounds page fetches and AI calls.
  NEWS_MAX_NEW_PER_RUN: z.coerce.number().int().positive().default(200),
  // Optional. Without a key the keyword classifier labels the news (classification only, never writing).
  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  // Video library: the club channel (handle or channel id). The Data API key (optional) lists the full catalogue;
  // without it the public feed lists the latest uploads. 0 disables polling (tests).
  YOUTUBE_CHANNEL: z.string().min(2).default('@investorscl'),
  YOUTUBE_API_KEY: z.string().min(20).optional(),
  VIDEOS_REFRESH_MINUTES: z.coerce.number().nonnegative().default(60),
});

type Env = z.infer<typeof envSchema>;
export type HubMode = 'live' | 'mock';
export type Config = Omit<Env, 'HUB_MODE'> & { HUB_MODE: HubMode };

/** Loads server/.env when present. Real environments (Railway) use variables only. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: nothing to load.
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // Empty strings (for example a copied .env.example) count as unset.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment: ${issues.join('; ')}`);
  }
  const env = parsed.data;
  // Without a site key the hub cannot be called, so local runs fall back to the mock hub.
  const hubMode: HubMode = env.HUB_MODE ?? (env.HUB_SITE_KEY ? 'live' : 'mock');
  if (hubMode === 'live' && !env.HUB_SITE_KEY) {
    throw new Error('Invalid environment: HUB_MODE=live requires HUB_SITE_KEY');
  }
  if (hubMode === 'mock' && env.APP_ENV === 'production') {
    throw new Error('Invalid environment: the mock hub is not allowed in production');
  }
  return { ...env, HUB_MODE: hubMode };
}
