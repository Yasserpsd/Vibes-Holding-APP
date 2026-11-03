import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { RequestError } from '../auth/guard.js';
import type { MediaStore, UploadTicket } from '../media/store.js';

/**
 * M193 (owner, 2026-11-03): a registration form's attachment (the Success Partners pitch deck).
 * The phone asks for an upload ticket and sends the bytes straight to the private bucket (or the
 * disk store in development), then submits the form with the file's link as the field's answer.
 *
 * The files live under `forms/` — outside the posts' `posts/` prefix, so the media sweep never
 * touches them and the public `/media/<key>` route never serves them. The link is a capability URL
 * (`/forms/files/<key>`, a random UUID in the key) that only the management sees: the dashboard and
 * the notification mail. It redirects to a short-lived presigned link and is never cached.
 */
export const FORM_FILE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
export const FORM_FILE_MAX_BYTES = 25 * 1024 * 1024;

const KEY_PATTERN = /^forms\/\d{4}\/\d{2}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(pdf|pptx?|docx?|jpg|png)$/;
const LINK_PATH = '/forms/files/';

export const formFileInputSchema = z.object({
  filename: z.string().trim().max(300).default(''),
  contentType: z.string().trim().toLowerCase().min(3).max(120),
  size: z.number().int().positive(),
});
export type FormFileInput = z.infer<typeof formFileInputSchema>;

export function isFormFileKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** The key behind a form-file link of any host (a changed public domain must not orphan old links). */
export function formFileKeyOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { pathname } = new URL(url);
  if (!pathname.startsWith(LINK_PATH)) return null;
  const key = pathname.slice(LINK_PATH.length);
  return isFormFileKey(key) ? key : null;
}

export type FormFilesOptions = { store: MediaStore; origin: string; enabled: boolean };

export class FormFiles {
  constructor(private readonly options: FormFilesOptions) {}

  get store(): MediaStore {
    return this.options.store;
  }

  linkFor(key: string): string {
    return `${this.options.origin}${LINK_PATH}${key}`;
  }

  async createUpload(input: FormFileInput, now = new Date()): Promise<{ url: string; upload: UploadTicket }> {
    if (!this.options.enabled) throw new RequestError('uploads_unavailable', 'رفع الملفات غير متاح حاليًا، أرسل الطلب بدون الملف وستطلبه منك الإدارة', 503);
    const extension = FORM_FILE_TYPES[input.contentType];
    if (!extension) throw new RequestError('unsupported_type', 'نوع الملف غير مدعوم: ارفع ملف PDF أو PowerPoint أو Word أو صورة JPG أو PNG');
    if (input.size > FORM_FILE_MAX_BYTES) throw new RequestError('too_large', 'حجم الملف أكبر من 25 ميجابايت');
    const month = now.toISOString().slice(0, 7).replace('-', '/');
    const key = `forms/${month}/${randomUUID()}.${extension}`;
    return { url: this.linkFor(key), upload: await this.options.store.ticket(key, input.contentType, FORM_FILE_MAX_BYTES) };
  }

  /** A form answer may only point at a form file of ours that really arrived. */
  async check(url: string, label: string): Promise<void> {
    const key = formFileKeyOf(url);
    if (!key) throw new RequestError('invalid_field', `ارفع «${label}» من زر الإرفاق`, 400);
    const info = await this.options.store.head(key);
    if (!info) throw new RequestError('invalid_field', `لم يكتمل رفع «${label}»، ارفعه من جديد`, 400);
  }
}
