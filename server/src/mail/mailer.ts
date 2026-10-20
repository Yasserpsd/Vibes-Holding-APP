import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';

import { hubCall, type HubClient } from '../hub/types.js';

export type Mail = { to: string[]; subject: string; text: string; html?: string };

export interface Mailer {
  /** False when mails are only logged. */
  readonly configured: boolean;
  send(mail: Mail): Promise<boolean>;
}

/** Logs mails instead of sending them (local runs without SMTP, tests). Keeps the last ones for assertions. */
export class LogMailer implements Mailer {
  readonly configured = false;
  readonly sent: Mail[] = [];

  constructor(private readonly log?: Pick<FastifyBaseLogger, 'info'>) {}

  async send(mail: Mail): Promise<boolean> {
    this.sent.push(mail);
    if (this.sent.length > 50) this.sent.shift();
    this.log?.info({ to: mail.to, subject: mail.subject }, 'mail logged only (SMTP not configured)');
    return false;
  }
}

export type SmtpOptions = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  /** M112: the hosting's mail server carries a self-signed «cloud-panel» certificate — this accepts it on that one hop. */
  tlsRelaxed?: boolean;
};

/** Sends through the website's hosting SMTP account (credentials from the environment only). */
export class SmtpMailer implements Mailer {
  readonly configured = true;
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user ? { user: options.user, pass: options.pass ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      ...(options.tlsRelaxed ? { tls: { rejectUnauthorized: false } } : {}),
    });
  }

  async send(mail: Mail): Promise<boolean> {
    await this.transport.sendMail({ from: this.options.from, to: mail.to.join(', '), subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) });
    return true;
  }
}

/** M112 (owner, 2026-10-21: «نخلي الإشارة توصل من داخل هب vcmem نفسه»): mails sent THROUGH the
 * vcmem hub over plain HTTPS — wp_mail there does the sending, so no SMTP port can block us. */
export class HubMailer implements Mailer {
  readonly configured = true;

  constructor(private readonly hub: HubClient) {}

  async send(mail: Mail): Promise<boolean> {
    const answer = await hubCall(this.hub, 'send_mail', { to: mail.to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) });
    return answer.sent === true;
  }
}

/** M112: the primary path (SMTP) first; ANY failure falls through to the hub channel, so a port
 * block, a TLS hiccup or a hosting outage never loses a mail. */
export class FallbackMailer implements Mailer {
  readonly configured = true;

  constructor(
    private readonly primary: Mailer,
    private readonly fallback: Mailer,
    private readonly log?: Pick<FastifyBaseLogger, 'warn'>,
  ) {}

  async send(mail: Mail): Promise<boolean> {
    try {
      return await this.primary.send(mail);
    } catch (error) {
      this.log?.warn({ err: error, subject: mail.subject }, 'primary mail path failed; sending through the hub');
      return this.fallback.send(mail);
    }
  }
}

/** Comma separated recipients as the website keeps them in its notify_email option. */
export function parseRecipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}
