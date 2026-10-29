import type { FastifyBaseLogger } from 'fastify';

import type { Notifier } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
import { changeMail, receiptMail } from './mail.js';
import type { MemberRequest, Recipient } from './model.js';

export type MemberNoticesDeps = { notifier: Notifier; push: PushService; log: FastifyBaseLogger; publicUrl?: string };

/**
 * M138 (owner, 2026-10-28: «لأي عملية يعملها العميل توصل على إيميله… وأي عملية تحصل لازم يوصله بيها إشعار»):
 * the member's receipt mail when he starts anything, and a mail + push on every status change.
 * Never blocks a request: both sends run in the background and log their outcome.
 */
export class MemberNotices {
  constructor(private readonly deps: MemberNoticesDeps) {}

  private get appUrl(): string {
    return `${this.deps.publicUrl ?? 'https://vcmem.com'}/app`;
  }

  private static address(to: Recipient): string {
    return (to.contactEmail ?? '').trim() || to.email.trim();
  }

  /** The receipt: mailed at once, in the member's language. */
  received(entry: MemberRequest, to: Recipient): void {
    const lang = to.lang === 'en' ? 'en' : 'ar';
    const { subject, mail } = receiptMail(entry, to.name, lang, this.appUrl);
    this.deps.notifier.memberMail(MemberNotices.address(to), subject, mail, `${entry.kind} receipt`);
  }

  /** A status change: mail + push (the push is skipped where the store already sends its own). */
  changed(entry: MemberRequest, to: Recipient, options: { push?: boolean } = {}): void {
    const lang = to.lang === 'en' ? 'en' : 'ar';
    const { subject, mail } = changeMail(entry, to.name, lang, this.appUrl);
    this.deps.notifier.memberMail(MemberNotices.address(to), subject, mail, `${entry.kind} ${entry.status}`);
    if (options.push !== false) this.deps.push.requestChanged(entry);
  }
}
