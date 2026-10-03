import { RequestError } from '../auth/guard.js';
import type { KV } from '../store.js';
import type { Notifier } from './notify.js';

/**
 * M16: who receives the management's notification mails. The owner edits the list from the
 * dashboard; while nothing is saved there, the `NOTIFY_EMAIL` variable keeps working as before.
 * The notifier itself holds the current list in memory: boot loads the saved one, every save
 * swaps it, and a cleared list falls back to the variable.
 */
export const NOTIFY_SETTINGS_KEY = 'settings:notify';
export const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

type Stored = { recipients: string[]; by: string; at: string };

export type NotifySettings = {
  recipients: string[];
  /** Where the active list comes from: the dashboard's saved list or the server variable. */
  source: 'dashboard' | 'env';
  /** The variable's own list, shown so the owner knows what a reset returns to. */
  envRecipients: string[];
  by: string | null;
  at: string | null;
};

type Deps = { kv: KV; envRecipients: string[]; notifier: Notifier };

export class NotifyRecipients {
  constructor(private readonly deps: Deps) {}

  private async stored(): Promise<Stored | null> {
    const entry = await this.deps.kv.get<Partial<Stored>>(NOTIFY_SETTINGS_KEY);
    if (!entry || !Array.isArray(entry.recipients)) return null;
    const recipients = entry.recipients.filter((value): value is string => typeof value === 'string' && EMAIL.test(value));
    if (!recipients.length) return null;
    return { recipients, by: String(entry.by ?? ''), at: String(entry.at ?? '') };
  }

  /** Boot: the saved list (when there is one) replaces the variable's before the first mail. */
  async init(): Promise<void> {
    const saved = await this.stored();
    if (saved) this.deps.notifier.setRecipients(saved.recipients);
  }

  async get(): Promise<NotifySettings> {
    const saved = await this.stored();
    return {
      recipients: saved?.recipients ?? this.deps.envRecipients,
      source: saved ? 'dashboard' : 'env',
      envRecipients: this.deps.envRecipients,
      by: saved?.by || null,
      at: saved?.at || null,
    };
  }

  async set(raw: string[], by: string, now = new Date()): Promise<NotifySettings> {
    const recipients = [...new Set(raw.map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (!recipients.length) throw new RequestError('empty_list', 'اكتب بريدًا واحدًا على الأقل حتى لا تضيع إشعارات التسجيل والدفع', 400);
    if (recipients.length > MAX_RECIPIENTS) throw new RequestError('too_many', `الحد ${MAX_RECIPIENTS} عناوين`, 400);
    const bad = recipients.find((value) => !EMAIL.test(value));
    if (bad) throw new RequestError('invalid_email', `هذا العنوان غير صالح: ${bad}`, 400);
    await this.deps.kv.set(NOTIFY_SETTINGS_KEY, { recipients, by, at: now.toISOString() } satisfies Stored);
    this.deps.notifier.setRecipients(recipients);
    return this.get();
  }

  /** Back to the server variable (the dashboard's «استرجاع قيمة الخادم»). */
  async reset(): Promise<NotifySettings> {
    await this.deps.kv.delete(NOTIFY_SETTINGS_KEY);
    this.deps.notifier.setRecipients(this.deps.envRecipients);
    return this.get();
  }
}
