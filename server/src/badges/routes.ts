import type { FastifyPluginAsync } from 'fastify';

import type { AgendaService } from '../agenda/service.js';
import { guard, optionalSession } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { PaymentsService } from '../payments/service.js';
import type { ProfilesService } from '../profiles/service.js';

export type BadgesRoutesOptions = { auth: AuthService; agenda: AgendaService; profiles: ProfilesService; payments: PaymentsService };

/** Only the recent past counts; older items never badge, and the answer stays tiny. */
const WINDOW_DAYS = 30;
const MAX_TIMES = 30;

/**
 * M75: the server's newness signal for the «+N» badges on الرئيسية and حسابي — honest timestamps of
 * things that actually happened, which the device compares against its own last-look marks:
 * home = new agenda events + newly published «شخصية ومسيرة» profiles; account = the viewer's own
 * settled payments. Sections with no reliable signal send nothing rather than a guess.
 */
export const badgesRoutes: FastifyPluginAsync<BadgesRoutesOptions> = async (app, { auth, agenda, profiles, payments }) => {
  const whoIs = optionalSession(auth);

  app.get(
    '/api/badges',
    guard(async (request, reply) => {
      const since = Date.now() - WINDOW_DAYS * 86_400_000;
      const recent = (times: (string | null | undefined)[]): string[] =>
        times.filter((time): time is string => Boolean(time && Date.parse(time) > since)).sort().slice(-MAX_TIMES);

      const [eventTimes, people] = await Promise.all([agenda.createdTimes(), profiles.people()]);
      const home = recent([...eventTimes, ...people.map((person) => person.decidedAt ?? person.createdAt)]);

      const who = await whoIs(request);
      let account: string[] = [];
      if (who?.me) {
        const mine = await payments.list(who.me.id);
        account = recent(mine.map((payment) => payment.paidAt ?? payment.failedAt));
      }

      // The account list is the viewer's own (rule 8).
      void reply.header('cache-control', 'no-store');
      return { home, account };
    }),
  );
};
