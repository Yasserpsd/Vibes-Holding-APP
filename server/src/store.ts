import pg from 'pg';

/**
 * Small key/value store for server-driven content, cached feed snapshots and app sessions.
 * Postgres on Railway; in-memory fallback for local runs without DATABASE_URL.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryKV implements KV {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return this.map.has(key) ? (this.map.get(key) as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async close(): Promise<void> {
    this.map.clear();
  }
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

export class PgKV implements KV {
  private constructor(private readonly pool: pg.Pool) {}

  static async connect(connectionString: string): Promise<PgKV> {
    const pool = new pg.Pool({
      connectionString,
      max: 5,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
    await pool.query(MIGRATION);
    return new PgKV(pool);
  }

  async get<T>(key: string): Promise<T | null> {
    const result = await this.pool.query<{ value: T }>('SELECT value FROM kv WHERE key = $1', [key]);
    return result.rows[0]?.value ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }

  async delete(key: string): Promise<void> {
    await this.pool.query('DELETE FROM kv WHERE key = $1', [key]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Railway's private network and local databases speak plain TCP; public proxies need TLS.
function needsSsl(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.railway.internal'));
  } catch {
    return false;
  }
}

export async function createKV(databaseUrl: string | undefined): Promise<KV> {
  return databaseUrl ? PgKV.connect(databaseUrl) : new MemoryKV();
}
