import type { FastifyBaseLogger } from 'fastify';

import { HubError, type HubBody, type HubClient, type HubOp, type HubResponse } from './types.js';

type LiveHubOptions = { url: string; siteKey: string; log: FastifyBaseLogger; timeoutMs?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Calls the hub as a tenant site. Errors keep the plugin's code and Arabic message. */
export class LiveHubClient implements HubClient {
  readonly mode = 'live' as const;
  private readonly base: string;

  constructor(private readonly options: LiveHubOptions) {
    this.base = options.url.replace(/\/+$/, '');
  }

  async call(op: HubOp, body: HubBody): Promise<HubResponse> {
    const url = `${this.base}/wp-json/vibes-ai/v1/hub/${op}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          accept: 'application/json',
          'x-vai-site-key': this.options.siteKey,
          'user-agent': 'InvestorsClubServer/0.1',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      this.options.log.warn({ op, err: error }, 'hub unreachable');
      throw new HubError('hub_unreachable', 'تعذّر الاتصال بالنادي الآن، حاول بعد قليل', 502);
    }

    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: handled below.
    }

    if (response.ok && isRecord(json) && json.ok === true) return json as HubResponse;

    // WP_Error → { code, message, data: { status } }
    if (isRecord(json) && typeof json.code === 'string') {
      const data = isRecord(json.data) ? json.data : {};
      const status = typeof data.status === 'number' && data.status >= 400 ? data.status : response.status >= 400 ? response.status : 400;
      const message = typeof json.message === 'string' && json.message ? json.message : 'تعذّر تنفيذ الطلب';
      if (json.code === 'unauthorized' || json.code === 'rest_forbidden') {
        this.options.log.error({ op, status }, 'hub rejected the site key');
        throw new HubError('hub_config', 'إعداد الربط بالنادي غير صحيح، أبلغ الإدارة', 502);
      }
      if (json.code === 'not_found' && status === 404) {
        throw new HubError('hub_not_supported', 'هذه الخدمة غير متاحة حاليًا', 501);
      }
      throw new HubError(json.code, message, status);
    }

    // { ok: false, error, text } (proxy-style answers)
    if (isRecord(json) && json.ok === false) {
      const code = typeof json.error === 'string' ? json.error : 'hub_error';
      const message = typeof json.text === 'string' && json.text ? json.text : 'تعذّر تنفيذ الطلب';
      throw new HubError(code, message, response.status >= 400 ? response.status : 400);
    }

    this.options.log.error({ op, status: response.status, body: text.slice(0, 300) }, 'unexpected hub answer');
    throw new HubError('hub_error', 'استجابة غير متوقعة من النادي', 502);
  }
}
