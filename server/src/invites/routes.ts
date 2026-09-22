import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { InvitesService } from './service.js';

export type InvitesRoutesOptions = { service: InvitesService; auth: AuthService };

const configSchema = z
  .object({
    giftText: z.string().trim().min(10, 'اكتب وصف الهدية (سطر على الأقل)').max(500),
    shareText: z.string().trim().min(10, 'اكتب نص الدعوة (سطر على الأقل)').max(700),
  })
  .partial();
const giftSchema = z.object({ note: z.string().trim().min(2, 'اكتب ما سلّمته للعضو (كود خصم، كتاب…)').max(300) });
const idSchema = z.object({ id: z.string().uuid() });

/**
 * M32: «الدعوات». The member's side is one read — his code is his membership number, the share
 * text and the gift wording come from the dashboard, and his nominees are listed with how far
 * each one got. The code itself is checked and stored by the hub during registration
 * (`/api/auth/register` + plugin 2.7.2), not here.
 */
export const invitesRoutes: FastifyPluginAsync<InvitesRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/invites',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const me = await auth.me(current.session);
      const config = await service.config();
      return {
        code: me.cardNumber,
        eligible: me.membership.status === 'active',
        giftText: config.giftText,
        shareText: config.shareText.replaceAll('{code}', me.cardNumber),
        invited: await service.mine(me.id),
      };
    }),
  );

  app.get(
    '/api/admin/invites',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { invites: await service.list(), config: await service.config() };
    }),
  );

  app.post(
    '/api/admin/invites/config',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(configSchema, request.body, reply);
      if (!input) return;
      return { config: await service.saveConfig(input) };
    }),
  );

  app.post(
    '/api/admin/invites/:id/gift',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const input = parse(giftSchema, request.body, reply);
      if (!input) return;
      const record = await service.markGift(params.id, input.note, admin.me.name || admin.me.email);
      if (!record) return reply.code(404).send({ error: { code: 'not_found', message: 'الدعوة غير موجودة' } });
      return { invite: record };
    }),
  );
};
