import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard, parse, sessionGuard } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { AdvisorService } from './service.js';
import type { VoiceTranscriber } from './voice.js';

export type AdvisorRoutesOptions = { service: AdvisorService; auth: AuthService; voice?: VoiceTranscriber };

// The app names what the member looks at; the server builds the context text itself (advisor/context.ts).
const selection = z.string().trim().max(1000).nullish();
const contextSchema = z.union([
  z.object({ type: z.literal('project'), id: z.number().int().positive(), selection }),
  z.object({ type: z.literal('news'), id: z.string().regex(/^[a-f0-9]{16}$/), selection }),
  // Home portals and services open the advisor with the screen as the page context.
  z.object({ type: z.literal('portal'), id: z.enum(['neutral', 'entrepreneur', 'investor']), selection }),
  z.object({ type: z.literal('service'), id: z.string().regex(/^[a-z0-9-]{1,40}$/), selection }),
  z.object({ type: z.literal('post'), id: z.string().uuid(), selection }),
  z.object({ type: z.literal('video'), id: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/), selection }),
  z.object({ type: z.literal('screen'), id: z.string().regex(/^[a-z0-9-]{1,40}$/), selection }),
]);
const messageSchema = z.object({
  text: z.string().trim().min(1, 'اكتب رسالتك أولًا').max(4000, 'الرسالة طويلة، الحد 4000 حرف'),
  context: contextSchema.nullish(),
});
const pollSchema = z.object({ after: z.coerce.number().int().nonnegative().default(0) });

/** Chat with the hub advisor. Every route needs a session; the hub adds its own per-account limits. */
// A one-minute m4a clip is ~1 MB; base64 adds a third. The cap keeps the route harmless.
const voiceSchema = z.object({
  audio: z.string().min(100).max(8_000_000),
  mime: z.enum(['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/wav']).default('audio/m4a'),
});

export const advisorRoutes: FastifyPluginAsync<AdvisorRoutesOptions> = async (app, { service, auth, voice }) => {
  const requireSession = sessionGuard(auth);
  const limiter = new RateLimiter();

  app.get(
    '/api/advisor/history',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return service.history(current.session);
    }),
  );

  app.post(
    '/api/advisor/message',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      if (!limiter.hit(`message:${request.ip}`, 60, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'رسائل كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      const body = parse(messageSchema, request.body, reply);
      if (!body) return;
      return service.send(current.session, body.text, body.context ?? null, request.ip, langOf(request));
    }),
  );

  // M104: the member's recorded question becomes text; the app sends it as an ordinary message.
  app.post(
    '/api/advisor/transcribe',
    { bodyLimit: 10_000_000 },
    guard(async (request, reply) => {
      if (!voice) return reply.code(404).send({ error: { code: 'voice_off', message: 'الإدخال الصوتي غير متاح حاليًا' } });
      const current = await requireSession(request, reply);
      if (!current) return;
      if (!limiter.hit(`voice:${request.ip}`, 20, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'تسجيلات كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      const body = parse(voiceSchema, request.body, reply);
      if (!body) return;
      let audio: Buffer;
      try {
        audio = Buffer.from(body.audio, 'base64');
      } catch {
        return reply.code(400).send({ error: { code: 'bad_audio', message: 'تعذر قراءة التسجيل' } });
      }
      if (audio.length < 100) return reply.code(400).send({ error: { code: 'bad_audio', message: 'التسجيل قصير جدًا' } });
      try {
        const text = await voice.transcribe(audio, body.mime, langOf(request));
        return { text };
      } catch {
        return reply.code(502).send({ error: { code: 'voice_failed', message: 'تعذر تحويل الصوت إلى نص، حاول مرة أخرى' } });
      }
    }),
  );

  app.get(
    '/api/advisor/poll',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const query = parse(pollSchema, request.query, reply);
      if (!query) return;
      return service.poll(current.session, query.after);
    }),
  );
};
