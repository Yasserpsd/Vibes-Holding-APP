import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';

export type Mail = { to: string[]; subject: string; text: string };

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

export type SmtpOptions = { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };

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
    });
  }

  async send(mail: Mail): Promise<boolean> {
    await this.transport.sendMail({ from: this.options.from, to: mail.to.join(', '), subject: mail.subject, text: mail.text });
    return true;
  }
}

/** Comma separated recipients as the website keeps them in its notify_email option. */
export function parseRecipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}
