import type { FastifyBaseLogger } from 'fastify';

export const GRAPH_VERSION = 'v24.0';

export type WaComponent = { type: string; format?: string; text?: string; buttons?: { type: string; url?: string; text?: string }[] };
export type WaTemplate = {
  id?: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  parameter_format?: string;
  components: WaComponent[];
};

/** A Graph API refusal. The message is Meta's own text and never carries the token. */
export class WhatsappError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'WhatsappError';
  }
}

export type WhatsappClientOptions = {
  token: string;
  phoneId: string;
  wabaId: string;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
  fetchImpl?: typeof fetch;
};

type GraphErrorBody = { error?: { message?: string; code?: number; error_data?: { details?: string } } };

/** Thin Graph API v24 client: template messages and the template list. Credentials from the environment only. */
export class WhatsappClient {
  constructor(private readonly options: WhatsappClientOptions) {}

  private async graph<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
        method,
        headers: { authorization: `Bearer ${this.options.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new WhatsappError(`network: ${error instanceof Error ? error.name : 'error'}`, 0, null);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const failure = (json as GraphErrorBody | null)?.error;
      const detail = failure?.error_data?.details ? ` (${failure.error_data.details})` : '';
      throw new WhatsappError(`${failure?.message ?? `http ${response.status}`}${detail}`.slice(0, 300), response.status, failure?.code ?? null);
    }
    return json as T;
  }

  /** Sends one approved template; `bodyParams` fill {{1}}, {{2}}… of the body in order. Returns Meta's message id. */
  async sendTemplate(input: { to: string; template: string; language: string; bodyParams: string[]; codeButton?: string }): Promise<string> {
    const answer = await this.graph<{ messages?: { id?: string }[] }>('POST', `${encodeURIComponent(this.options.phoneId)}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'template',
      template: {
        name: input.template,
        language: { code: input.language },
        ...(input.bodyParams.length
          ? {
              components: [
                { type: 'body', parameters: input.bodyParams.map((text) => ({ type: 'text', text })) },
                // An Authentication template's copy-code button takes the code as well.
                ...(input.codeButton ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: input.codeButton }] }] : []),
              ],
            }
          : {}),
      },
    });
    const id = answer.messages?.[0]?.id;
    if (!id) throw new WhatsappError('no message id in the answer', 200, null);
    return id;
  }

  /** The WABA's templates called `name` (every language) with their real components. */
  async listTemplates(name: string): Promise<WaTemplate[]> {
    const query = new URLSearchParams({ name, fields: 'id,name,language,status,category,parameter_format,components', limit: '50' });
    const answer = await this.graph<{ data?: WaTemplate[] }>('GET', `${encodeURIComponent(this.options.wabaId)}/message_templates?${query.toString()}`);
    return (answer.data ?? []).filter((template) => template.name === name);
  }

  /**
   * M204: registers one template (one language) on the WABA; Meta reviews it before it can be sent.
   * Meta wants a sample for every variable: `bodyExamples` in the order of {{1}}, {{2}}…, and the full sample
   * address of a URL button that ends in {{1}}.
   */
  async createTemplate(input: NewTemplate): Promise<{ id: string; status: string; category: string | null }> {
    const components: Record<string, unknown>[] = [
      { type: 'BODY', text: input.body, ...(input.bodyExamples.length ? { example: { body_text: [input.bodyExamples] } } : {}) },
    ];
    if (input.footer) components.push({ type: 'FOOTER', text: input.footer });
    if (input.urlButton) {
      const { text, url, example } = input.urlButton;
      components.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text, url, ...(example ? { example: [example] } : {}) }] });
    }
    const answer = await this.graph<{ id?: string; status?: string; category?: string }>('POST', `${encodeURIComponent(this.options.wabaId)}/message_templates`, {
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    });
    if (!answer.id) throw new WhatsappError('no template id in the answer', 200, null);
    return { id: answer.id, status: answer.status ?? 'PENDING', category: answer.category ?? null };
  }
}

export type NewTemplate = {
  name: string;
  language: string;
  category: 'UTILITY' | 'MARKETING';
  body: string;
  bodyExamples: string[];
  footer?: string;
  urlButton?: { text: string; url: string; example?: string };
};
