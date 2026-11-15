import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { EnglishCache } from '../englishCache.js';
import { langOf, type AppLang } from '../lang.js';
import type { MemberRequest, RequestKind } from './model.js';
import type { RequestsService } from './service.js';

export type RequestsRoutesOptions = { service: RequestsService; auth: AuthService; english?: EnglishCache };

/** The values the server itself writes into a row (model.ts): their English is fixed, no translator involved. */
const FIXED_VALUES_EN: Record<string, string> = {
  'نسخة بديلة عن بطاقة سبق تسليمها': 'A replacement for a card already delivered',
  'أكدت استلام البطاقة بنفسك': 'You confirmed receiving the card yourself',
  'في المقر': 'At the HQ',
  'أونلاين': 'Online',
};

/**
 * The rows whose VALUE the server or the management wrote, per kind (the labels are model.ts's own): the request
 * type and the receipt mark of a card, the purpose of an HQ visit (the owner's list), an event's attendance and
 * place. Every other value — a note, a reason, an address, every answer of a form or a service request — is the
 * member's own line.
 */
const MANAGEMENT_VALUES: Partial<Record<RequestKind, ReadonlySet<string>>> = {
  card: new Set(['نوع الطلب', 'تأكيد الاستلام']),
  hq: new Set(['الغرض']),
  agenda: new Set(['الحضور', 'المكان']),
};

/**
 * M242: the timeline as the English app reads it. Translated: the title, the question labels, the management's
 * note on the decision, and the few values the management or the server wrote. NEVER translated: the member's
 * own lines — they are shown as he wrote them and never leave the server for a translator. Nothing here waits
 * for the translator either: a text with no English yet is answered as stored and is in English the next time
 * (one `textsSoon` call for the whole timeline).
 */
export async function requestsInEnglish(requests: MemberRequest[], english: Pick<EnglishCache, 'textsSoon'>, lang: AppLang): Promise<MemberRequest[]> {
  if (lang !== 'en' || !requests.length) return requests;
  const texts: string[] = [];
  const ask = (text: string): number => texts.push(text) - 1;
  const plan = requests.map((entry) => ({
    title: ask(entry.titleEn),
    note: entry.note ? ask(entry.note) : -1,
    rows: entry.rows.map((row) => ({
      label: ask(row.labelEn),
      value: MANAGEMENT_VALUES[entry.kind]?.has(row.label) && !FIXED_VALUES_EN[row.value] ? ask(row.value) : -1,
    })),
  }));
  const shown = await english.textsSoon(texts, lang);
  const at = (index: number, stored: string): string => (index >= 0 ? (shown[index] ?? stored) : stored);
  return requests.map((entry, position) => {
    const mine = plan[position];
    if (!mine) return entry;
    return {
      ...entry,
      titleEn: at(mine.title, entry.titleEn),
      note: entry.note ? at(mine.note, entry.note) : entry.note,
      rows: entry.rows.map((row, index) => ({
        ...row,
        labelEn: at(mine.rows[index]?.label ?? -1, row.labelEn),
        value: MANAGEMENT_VALUES[entry.kind]?.has(row.label) ? (FIXED_VALUES_EN[row.value] ?? at(mine.rows[index]?.value ?? -1, row.value)) : row.value,
      })),
    };
  });
}

export const statusSchema = z.object({ status: z.enum(['pending', 'in_progress', 'done', 'rejected', 'cancelled']), note: z.string().trim().max(300).default('') });
const idSchema = z.object({ id: z.string().uuid() });

/** M138: the member's timeline and the dashboard's status control for the ledger entries. */
export const requestsRoutes: FastifyPluginAsync<RequestsRoutesOptions> = async (app, { service, auth, english }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  // Per-user (rule 8): the global hook already answers every /api/* with Cache-Control: no-store.
  app.get(
    '/api/me/requests',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const requests = await service.timeline(current.session.contactId);
      const lang = langOf(request);
      if (!english || lang !== 'en') return { requests };
      // Owner (2026-11-04): a request reads in English in the English app. M242: that covers what the management
      // wrote (titles, questions, its note) — never the member's own answers — and never holds the screen.
      return { requests: await requestsInEnglish(requests, english, lang) };
    }),
  );

  app.get(
    '/api/admin/requests',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { requests: await service.list() };
    }),
  );

  app.post(
    '/api/admin/requests/:id/status',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(statusSchema, request.body, reply);
      if (!body) return;
      const entry = await service.setStatus(params.id, body.status, admin.me.name || admin.me.email, body.note);
      return { request: entry };
    }),
  );
};
