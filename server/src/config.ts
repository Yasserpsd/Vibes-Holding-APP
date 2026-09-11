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
});

export type Config = z.infer<typeof envSchema>;

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
  return parsed.data;
}
