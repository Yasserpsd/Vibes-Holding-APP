import pg from 'pg';

/**
 * Small key/value store for server-driven content, cached feed snapshots and app sessions.
 * Postgres on Railway; in-memory fallback for local runs without DATABASE_URL.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * M118b: the serialized documents that contain `needle`, as text. The media sweep scans EVERY
   * stored document for /media/ paths, so a photo referenced anywhere (people, agenda, slots,
   * seeds, reviews…) is never treated as an orphan again.
   */
  textSearch(needle: string): Promise<string[]>;
  /** M129: every stored document, for the off-site backup. */
  dump(): Promise<Array<{ key: string; value: unknown; updatedAt: string }>>;
  close(): Promise<void>;
}

export class MemoryKV implements KV {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return this.map.has(key) ? (this.map.get(key) as T) : null;
  }

  async textSearch(needle: string): Promise<string[]> {
    const hits: string[] = [];
    for (const value of this.map.values()) {
      const text = JSON.stringify(value);
      if (text.includes(needle)) hits.push(text);
    }
    return hits;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async dump(): Promise<Array<{ key: string; value: unknown; updatedAt: string }>> {
    const now = new Date().toISOString();
    return [...this.map.entries()].map(([key, value]) => ({ key, value, updatedAt: now }));
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

  async textSearch(needle: string): Promise<string[]> {
    // Plain substring over the serialized jsonb; the needle is code-chosen, never user input.
    const escaped = needle.replace(/[%_\\]/g, (char) => `\\${char}`);
    const result = await this.pool.query<{ text: string }>("SELECT value::text AS text FROM kv WHERE value::text LIKE $1 ESCAPE '\\'", [`%${escaped}%`]);
    return result.rows.map((row) => row.text);
  }

  async dump(): Promise<Array<{ key: string; value: unknown; updatedAt: string }>> {
    const result = await this.pool.query<{ key: string; value: unknown; updated_at: Date }>(
      'SELECT key, value, updated_at FROM kv ORDER BY key',
    );
    return result.rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at.toISOString() }));
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
