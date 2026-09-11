import type { Config } from '../config.js';

const FEED_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Finds the list of projects inside the feed body, whatever envelope it uses. */
export function extractItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body)) {
    for (const key of ['projects', 'items', 'data', 'results', 'posts']) {
      const value = body[key];
      if (Array.isArray(value)) return value;
      if (isRecord(value) && Array.isArray(value.items)) return value.items;
    }
  }
  throw new Error('Unrecognized Projects Bank feed shape');
}

/** Fetches the raw feed body. The URL carries the key, so it is never logged. */
export async function fetchFeedBody(config: Config, path = ''): Promise<unknown> {
  if (!config.PB_FEED_KEY) throw new Error('PB_FEED_KEY is not set');
  const url = new URL(config.PB_FEED_URL + path);
  url.searchParams.set('key', config.PB_FEED_KEY);

  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'investors-club-server/0.1' },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Projects Bank feed responded with HTTP ${response.status}`);
  return response.json();
}

export async function fetchFeedItems(config: Config): Promise<unknown[]> {
  return extractItems(await fetchFeedBody(config));
}
