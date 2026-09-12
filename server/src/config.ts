import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['test', 'production']).default('test'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.string().min(1).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  // Public base URL of this server (Paymob callbacks and the payment pages). Railway injects RAILWAY_PUBLIC_DOMAIN.
  PUBLIC_URL: z.string().url().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().min(1).optional(),
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
  // Paymob KSA, real-world services only (CLAUDE.md rule 3). Secrets live in the environment only (rule 1).
  // Mock mode serves a local checkout page that fires the same HMAC-signed callback; never in production.
  PAYMOB_MODE: z.enum(['live', 'mock']).optional(),
  PAYMOB_BASE_URL: z.string().url().default('https://ksa.paymob.com'),
  PAYMOB_SECRET_KEY: z.string().min(20).optional(),
  PAYMOB_PUBLIC_KEY: z.string().min(10).optional(),
  PAYMOB_HMAC_SECRET: z.string().min(10).optional(),
  // Integration id(s) of the payment methods shown at checkout (comma separated).
  PAYMOB_INTEGRATION_ID: z.string().min(1).optional(),
  // Management notifications, the same idea as the website's notify_email list. Without SMTP_HOST mails are only logged.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.enum(['0', '1']).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  NOTIFY_EMAIL: z.string().min(3).optional(),
  // Store purchases: the RevenueCat webhook carries this Authorization header value verbatim.
  REVENUECAT_WEBHOOK_AUTH: z.string().min(10).optional(),
  // RevenueCat public SDK keys (they ship in the app) and, optionally, the REST secret key for /api/membership/sync.
  REVENUECAT_PUBLIC_KEY_ANDROID: z.string().min(10).optional(),
  REVENUECAT_PUBLIC_KEY_IOS: z.string().min(10).optional(),
  REVENUECAT_SECRET_KEY: z.string().min(20).optional(),
  REVENUECAT_ENTITLEMENT: z.string().min(1).default('membership'),
  STORE_MEMBERSHIP_PRODUCT: z.string().min(1).default('club_membership_annual'),
  // Store review needs the terms and privacy pages next to the subscription price.
  STORE_TERMS_URL: z.string().url().optional(),
  STORE_PRIVACY_URL: z.string().url().optional(),
  // Expo push service: optional access token when "enhanced push security" is on for the Expo project.
  EXPO_PUSH_ACCESS_TOKEN: z.string().min(10).optional(),
});

type Env = z.infer<typeof envSchema>;
export type HubMode = 'live' | 'mock';
export type PaymobMode = 'live' | 'mock';
export type Config = Omit<Env, 'HUB_MODE' | 'PAYMOB_MODE'> & { HUB_MODE: HubMode; PAYMOB_MODE: PaymobMode; PUBLIC_URL: string };

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
  const paymobConfigured = Boolean(env.PAYMOB_SECRET_KEY && env.PAYMOB_HMAC_SECRET && env.PAYMOB_PUBLIC_KEY && env.PAYMOB_INTEGRATION_ID);
  const paymobMode: PaymobMode = env.PAYMOB_MODE ?? (paymobConfigured ? 'live' : 'mock');
  if (paymobMode === 'live' && !paymobConfigured) {
    throw new Error('Invalid environment: PAYMOB_MODE=live requires PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_HMAC_SECRET and PAYMOB_INTEGRATION_ID');
  }
  if (paymobMode === 'mock' && env.APP_ENV === 'production') {
    throw new Error('Invalid environment: mock payments are not allowed in production');
  }
  const publicUrl = env.PUBLIC_URL ?? (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${env.PORT}`);
  return { ...env, HUB_MODE: hubMode, PAYMOB_MODE: paymobMode, PUBLIC_URL: publicUrl.replace(/\/+$/, '') };
}
