import { createHash } from 'node:crypto';

/**
 * M189 (owner: «عايز ارفع الملفات بجودة 4K علي التطبيق»): uploaded videos live in a Bunny Stream
 * library, which transcodes them to adaptive HLS up to 2160p. The dashboard's browser sends the
 * file straight to Bunny over TUS with a signed, expiring ticket (the API key never leaves this
 * server); the app plays `/media/stream/<id>/playlist.m3u8`, which redirects to the CDN, signed
 * per directory when the pull zone has token authentication on.
 */

const API = 'https://video.bunnycdn.com';
const TUS_ENDPOINT = `${API}/tusupload`;
const GUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const TICKET_SECONDS = 24 * 60 * 60;
const PLAYBACK_SECONDS = 6 * 60 * 60;
const TIMEOUT_MS = 15_000;

/** Bunny's video states: 0 created, 1 uploaded, 2 processing, 3 transcoding, 4 finished, 5 error, 6 upload failed, 7–8 JIT. */
const FAILED = new Set([5, 6]);

export type StreamFile = 'playlist.m3u8' | 'thumbnail.jpg';
export type StreamTicket = { method: 'TUS'; url: string; headers: Record<string, string> };
export type StreamVideo = { status: number; resolutions: string[] };
export type StreamState = 'missing' | 'waiting' | 'failed' | 'ready';

export type BunnyStreamOptions = {
  libraryId: string;
  apiKey: string;
  /** The library's pull zone host, e.g. `vz-1234abcd-567.b-cdn.net`. */
  cdnHost: string;
  /** The pull zone's token authentication key; unset = playback links are not signed. */
  tokenKey?: string;
  fetch?: typeof fetch;
};

export function isStreamId(id: string): boolean {
  return GUID.test(id);
}

/** Bunny's own scheme: base64url(sha256(key + path + expires + params)), the token in the path so HLS segments inherit it. */
export function signDirectory(host: string, tokenKey: string, id: string, file: StreamFile, expires: number): string {
  const directory = `/${id}/`;
  const parameters = `token_path=${directory}`;
  const token = createHash('sha256')
    .update(tokenKey + directory + String(expires) + parameters)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `https://${host}/bcdn_token=${token}&token_path=${encodeURIComponent(directory)}&expires=${expires}${directory}${file}`;
}

export class BunnyStream {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: BunnyStreamOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetch(`${API}/library/${encodeURIComponent(this.options.libraryId)}${path}`, {
      method,
      headers: { AccessKey: this.options.apiKey, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  /** An empty video in the library; its id is what the TUS ticket and the post carry. */
  async create(title: string): Promise<string> {
    const response = await this.call('POST', '/videos', { title: title.slice(0, 200) || 'video' });
    const data = (await response.json().catch(() => null)) as { guid?: unknown } | null;
    if (!response.ok || typeof data?.guid !== 'string' || !isStreamId(data.guid)) throw new Error(`bunny: create video answered ${response.status}`);
    return data.guid;
  }

  /** What the browser needs to send the file itself: Bunny checks sha256(library + key + expires + video). */
  ticket(id: string, now = Date.now()): StreamTicket {
    const expires = String(Math.floor(now / 1000) + TICKET_SECONDS);
    const { libraryId, apiKey } = this.options;
    const signature = createHash('sha256').update(libraryId + apiKey + expires + id).digest('hex');
    return { method: 'TUS', url: TUS_ENDPOINT, headers: { AuthorizationSignature: signature, AuthorizationExpire: expires, VideoId: id, LibraryId: libraryId } };
  }

  async video(id: string): Promise<StreamVideo | null> {
    const response = await this.call('GET', `/videos/${id}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`bunny: get video answered ${response.status}`);
    const data = (await response.json()) as { status?: unknown; availableResolutions?: unknown };
    const resolutions = typeof data.availableResolutions === 'string' ? data.availableResolutions.split(',').filter(Boolean) : [];
    return { status: Number(data.status ?? 0), resolutions };
  }

  /** Playable once Bunny finished, or as soon as its first resolution is out (4K takes a while; lower ones come first). */
  async state(id: string): Promise<StreamState> {
    const video = await this.video(id);
    if (!video) return 'missing';
    if (FAILED.has(video.status)) return 'failed';
    return video.status === 4 || video.resolutions.length > 0 ? 'ready' : 'waiting';
  }

  async remove(id: string): Promise<void> {
    const response = await this.call('DELETE', `/videos/${id}`);
    if (!response.ok && response.status !== 404) throw new Error(`bunny: delete video answered ${response.status}`);
  }

  playbackUrl(id: string, file: StreamFile, now = Date.now()): string {
    const { cdnHost, tokenKey } = this.options;
    if (!tokenKey) return `https://${cdnHost}/${id}/${file}`;
    return signDirectory(cdnHost, tokenKey, id, file, Math.floor(now / 1000) + PLAYBACK_SECONDS);
  }

  status(): Record<string, unknown> {
    return { library: this.options.libraryId, cdn: this.options.cdnHost, signed: Boolean(this.options.tokenKey) };
  }
}
