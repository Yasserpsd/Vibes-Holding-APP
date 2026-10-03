import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import type { Notifier } from '../mail/notify.js';
import type { KV } from '../store.js';
import { getFormsContent, type FormDef, type FormFieldDef } from './content.js';

/**
 * M16: submissions of the in-app registration forms (شركاء النجاح, the workshop). A submission is
 * validated against the form's own definition, kept for the dashboard list and mailed to the
 * management. Guests may send a public form (the web form is public too); a signed-in sender's
 * account data rides along.
 */
export const FORM_SUBMISSIONS_KEY = 'forms:submissions';
const MAX_SUBMISSIONS = 3000;
const MAX_TEXT = 300;
const MAX_LONG_TEXT = 2000;
export const AGREED = '1';

export type FormAnswer = { key: string; label: string; value: string };

export type FormSubmission = {
  id: string;
  formKey: string;
  formTitle: string;
  /** Null when a guest sent a public form. */
  contactId: number | null;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  answers: FormAnswer[];
  createdAt: string;
  handled: boolean;
  handledBy: string | null;
  handledAt: string | null;
};

export type MySubmission = Pick<FormSubmission, 'id' | 'formKey' | 'createdAt'>;

export function mySubmission(entry: FormSubmission): MySubmission {
  const { id, formKey, createdAt } = entry;
  return { id, formKey, createdAt };
}

/** What one field accepts; selects accept the choice in either language (the app sends what it shows). */
function fieldProblem(field: FormFieldDef, raw: string, optionsOf: (field: FormFieldDef) => Set<string>): string | null {
  const value = raw.trim();
  if (!value) return field.required ? `اكتب «${field.label}» أولًا` : null;
  if (field.type === 'agree') return value === AGREED ? null : `وافق على «${field.label}» أولًا`;
  if (field.type === 'select') return optionsOf(field).has(value) ? null : `اختر قيمة من قائمة «${field.label}»`;
  const max = field.type === 'textarea' ? MAX_LONG_TEXT : MAX_TEXT;
  return value.length > max ? `«${field.label}» أطول من المسموح` : null;
}

type Deps = { kv: KV; notifier: Notifier };

export class FormsService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<FormSubmission[]> {
    return (await this.deps.kv.get<{ submissions: FormSubmission[] }>(FORM_SUBMISSIONS_KEY))?.submissions ?? [];
  }

  private mutate<T>(change: (submissions: FormSubmission[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const submissions = await this.load();
      const result = change(submissions);
      submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await this.deps.kv.set(FORM_SUBMISSIONS_KEY, { submissions: submissions.slice(0, MAX_SUBMISSIONS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async mine(contactId: number): Promise<FormSubmission[]> {
    return (await this.load()).filter((entry) => entry.contactId === contactId);
  }

  async list(): Promise<FormSubmission[]> {
    return this.load();
  }

  async submit(formKey: string, raw: Record<string, string>, me: Me | null, now = new Date()): Promise<FormSubmission> {
    const arabic = await getFormsContent(this.deps.kv, 'ar');
    const form = arabic.forms.find((entry) => entry.key === formKey);
    if (!form) throw new RequestError('not_found', 'هذا النموذج غير موجود', 404);
    if (form.access === 'signedIn' && !me) throw new RequestError('unauthorized', 'سجّل الدخول أولًا', 401);
    if (!form.open) throw new RequestError('closed', form.closedText || 'التسجيل مغلق حاليًا', 409);

    // The app of either language sends the choice it shows; both readings of the list are accepted.
    const english = await getFormsContent(this.deps.kv, 'en');
    const optionsOf = (field: FormFieldDef): Set<string> => {
      const twin = english.forms.find((entry) => entry.key === form.key)?.fields.find((entry) => entry.key === field.key);
      return new Set([...(field.options ?? []), ...(twin?.options ?? [])]);
    };
    for (const field of form.fields) {
      const problem = fieldProblem(field, raw[field.key] ?? '', optionsOf);
      if (problem) throw new RequestError('invalid_field', problem, 400);
    }

    const answers: FormAnswer[] = form.fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.type === 'agree' ? 'نعم' : (raw[field.key] ?? '').trim(),
    }));
    const byPrefill = (wanted: FormFieldDef['prefill']): string => {
      const field = form.fields.find((entry) => entry.prefill === wanted);
      return field ? (raw[field.key] ?? '').trim() : '';
    };
    const formName = [byPrefill('firstName'), byPrefill('lastName')].filter(Boolean).join(' ');
    const submission: FormSubmission = {
      id: randomUUID(),
      formKey: form.key,
      formTitle: form.title,
      contactId: me?.id ?? null,
      name: formName || me?.name || '',
      phone: byPrefill('phone') || me?.phone || '',
      email: byPrefill('email') || me?.email || '',
      personaLabel: me?.personaLabel ?? '',
      answers,
      createdAt: now.toISOString(),
      handled: false,
      handledBy: null,
      handledAt: null,
    };
    await this.mutate((submissions) => {
      if (form.once && me && submissions.some((entry) => entry.contactId === me.id && entry.formKey === form.key)) {
        throw new RequestError('already_registered', 'سجّلنا طلبك في هذا النموذج من قبل، وستتواصل معك الإدارة', 409);
      }
      submissions.push(submission);
    });
    this.deps.notifier.formSubmitted(submission);
    return submission;
  }

  /** The dashboard marks a submission answered (or back again); the name on the toggle is kept. */
  async setHandled(id: string, handled: boolean, adminName: string, now = new Date()): Promise<FormSubmission> {
    return this.mutate((submissions) => {
      const entry = submissions.find((submission) => submission.id === id);
      if (!entry) throw new RequestError('not_found', 'هذا التسجيل غير موجود', 404);
      entry.handled = handled;
      entry.handledBy = handled ? adminName : null;
      entry.handledAt = handled ? now.toISOString() : null;
      return entry;
    });
  }

  /** The open forms and their titles, for the dashboard's filter chips. */
  async definitions(): Promise<Pick<FormDef, 'key' | 'title' | 'open'>[]> {
    const content = await getFormsContent(this.deps.kv, 'ar');
    return content.forms.map(({ key, title, open }) => ({ key, title, open }));
  }
}
