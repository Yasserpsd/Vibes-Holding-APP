import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse } from './auth/guard.js';
import type { AuthService } from './auth/service.js';
import { EnglishCache } from './englishCache.js';
import type { KV } from './store.js';
import type { Translator } from './translate.js';

/**
 * M282 (owner, 2026-11-26, «لو عملته انجليزي ميبقاش في ولا كلمة عربي… اسماء تترجم كل شئ يكون انجليزي اوتوماتيك»):
 * the dashboard's English mode sends every Arabic text it still shows (members' names, poll texts, «other»
 * answers, project names, server reasons) here and swaps in the English. Display-only for the admin; nothing
 * stored changes and the app keeps its own originals (news included, rule 7). Each text is translated once
 * and cached in kv.
 */

export const DASHBOARD_TRANSLATE_SYSTEM =
  'You put the texts shown on an Arabic investors-club admin dashboard into natural English. A text that is a person\'s, company\'s or place\'s name is transliterated into its standard Latin spelling (e.g. «محمد المقبلي» → "Mohammed Al-Muqbili", «فايبز فينشرز» → "Vibes Ventures"), never translated by meaning and never given a title. Every other text is translated faithfully: keep numbers, dates, times, phone numbers, currencies, emoji and URLs exactly as they are; never add, drop or embellish information. The English must hold no Arabic letters. Reply ONLY with JSON {"texts": string[]} of the same length and order as the input; empty strings stay empty.';

/** How many texts and how long each, per call — a dashboard page shows a few hundred short texts at most. */
const MAX_TEXTS = 200;
const MAX_LENGTH = 20_000;

const bodySchema = z.object({ texts: z.array(z.string().max(MAX_LENGTH)).max(MAX_TEXTS) });

export type DashboardEnglishOptions = { kv: KV; auth: AuthService; translator: Translator };

export const dashboardEnglishRoutes: FastifyPluginAsync<DashboardEnglishOptions> = async (app, { kv, auth, translator }) => {
  const requireAdmin = dashboardGuard(auth);
  const cache = new EnglishCache(kv, translator, 'admin');

  app.post(
    '/api/admin/english',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(bodySchema, request.body, reply);
      if (!body) return;
      reply.header('cache-control', 'no-store');
      // A text the translator could not do comes back as sent; the dashboard asks again on its next render.
      return { texts: await cache.texts(body.texts, 'en') };
    }),
  );
};
