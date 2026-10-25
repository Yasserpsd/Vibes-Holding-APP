/**
 * M107b: the Projects Bank photos reach the app THROUGH the server. The site's images kept failing
 * on devices (hotlink protection / referer checks — the cards fell back to the dark emblem wash,
 * owner: «المشاريع اللي بترشحها معتمة بدون صورة»), while the server fetches the same URLs fine.
 * The API rewrites every image URL to /img/pb/…, and this proxy fetches, caches and serves it.
 */

// M127: room for every project's cover (260+ today, ~50–100KB webp each ≈ 30MB) — with only 80
// slots most flips hit a cold proxy fetch, which is what made browsing feel heavy.
const CACHE_MAX = 400;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 6 * 1024 * 1024;

// The site serves its images to browsers; the proxy asks like one, from the site's own pages.
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  referer: 'https://vibesholding.com/',
  accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

type CachedImage = { buffer: Buffer; type: string; at: number };

export class PbImageProxy {
  private readonly cache = new Map<string, CachedImage>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * M127: fetches the given images ahead of the members' scrolling, one by one (gentle on the
   * site). An entry still fresh for half its TTL is skipped; failures are simply left cold.
   */
  async warm(urls: Iterable<string>): Promise<void> {
    for (const url of urls) {
      const hit = this.cache.get(url);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS / 2) continue;
      await this.get(url);
    }
  }

  /** The image bytes, from the cache or the site; null when the source cannot be fetched. */
  async get(url: string): Promise<CachedImage | null> {
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await this.fetchImpl(url, { headers: BROWSER_HEADERS, signal: controller.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!response.ok) return hit ?? null;
      const type = response.headers.get('content-type') ?? 'image/jpeg';
      if (!type.startsWith('image/')) return hit ?? null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return hit ?? null;
      const entry: CachedImage = { buffer, type, at: Date.now() };
      this.cache.set(url, entry);
      // The oldest entries leave first; the preview circle never needs more than this.
      while (this.cache.size > CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      return entry;
    } catch {
      return hit ?? null;
    }
  }
}
