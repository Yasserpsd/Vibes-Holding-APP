import type { FastifyInstance } from 'fastify';

import type { AuthService, Me } from '../auth/service.js';

/**
 * M109i «كمّل بياناتك»: registrations and bookings refuse until the member fills the six profile
 * fields the app's completion meter counts (M103). Enforced HERE, on the server, as one preHandler
 * over the gated routes — the app only renders the refusal nicely (code `profile_incomplete` +
 * a CTA to the profile editor). Admins stay free so the owner can demo every flow.
 */
export const PROFILE_GATE_FIELDS = ['jobTitle', 'company', 'city', 'bio', 'website', 'social'] as const;

export function profileComplete(me: Me): boolean {
  return PROFILE_GATE_FIELDS.every((field) => String(me[field] ?? '').trim());
}

export const PROFILE_GATE_MESSAGE =
  'كمّل بياناتك أولًا لإتمام هذا الطلب: الوظيفة والشركة والمدينة والنبذة والموقع وحسابات التواصل — من «حسابي» ← «تعديل الملف الشخصي».';

/** The booking/registration starters; reads and status polls stay open. */
const GATED_ROUTES = new Set([
  'POST /api/payments',
  'POST /api/agenda/:id/register',
  'POST /api/hq/visits',
  'POST /api/projects/:id/unlock',
  // M116 (owner: «نربط تكملة البروفايل بأنه يعمل أي حاجة»): rating a project needs a complete profile too.
  'POST /api/projects/:id/reviews',
]);

export function registerProfileGate(app: FastifyInstance, auth: AuthService): void {
  app.addHook('preHandler', async (request, reply) => {
    if (!GATED_ROUTES.has(`${request.method} ${request.routeOptions.url ?? ''}`)) return;
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await auth.authenticate(token) : null;
    // No (or stale) session: the route's own guard answers its usual 401.
    if (!session) return;
    let me: Me;
    try {
      me = await auth.me(session);
    } catch {
      return;
    }
    if (me.isAdmin || profileComplete(me)) return;
    await reply.code(403).send({ error: { code: 'profile_incomplete', message: PROFILE_GATE_MESSAGE } });
  });
}
