import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import { riyadhNow } from '../hq/service.js';
import { langOf } from '../lang.js';
import { FILL_FIELD_TYPES, type FormFiller } from './fill.js';
import type { HqProposal, IntentDetector } from './intents.js';
import type { AdvisorService } from './service.js';
import { speakable, type SpeechSynthesizer } from './speech.js';
import type { VoiceTranscriber } from './voice.js';

export type AdvisorRoutesOptions = {
  service: AdvisorService;
  auth: AuthService;
  voice?: VoiceTranscriber;
  filler?: FormFiller;
  intents?: IntentDetector;
  speech?: SpeechSynthesizer;
};

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
// M151: 10 MB of PDF is ~13.4 MB of base64; the route limit leaves room for the line and the context.
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const FILE_BODY_LIMIT = 15 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const fileSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9+/=\s]+$/, 'ملف غير صالح').min(100).max(14_200_000),
  name: z.string().trim().min(1).max(200),
  text: z.string().trim().max(4000).default(''),
  context: contextSchema.nullish(),
});
const pollSchema = z.object({ after: z.coerce.number().int().nonnegative().default(0) });
// M145: the app asks whether a chat line is an APP action before sending it to the hub.
const pendingSchema = z.object({
  kind: z.enum(['visit', 'office', 'meeting']),
  hours: z.number().int().min(1).max(12),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  purpose: z.string().trim().max(120).nullable(),
  note: z.string().trim().max(300),
});
const intentSchema = z.object({ text: z.string().trim().max(4000).default(''), pending: pendingSchema.nullish() });

/** Chat with the hub advisor. Every route needs a session; the hub adds its own per-account limits. */
// A one-minute m4a clip is ~1 MB; base64 adds a third. The cap keeps the route harmless.
const voiceSchema = z.object({
  audio: z.string().min(100).max(8_000_000),
  mime: z.enum(['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/wav']).default('audio/m4a'),
});
// M148: the reply's own text, as the app holds it (4000 is the hub's reply cap).
const speakSchema = z.object({ text: z.string().trim().min(1).max(4000) });
// M142: the app describes the form; the key is what the screen stores, the label what the member sees.
const fillSchema = z.object({
  transcript: z.string().trim().min(1).max(6000),
  fields: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Za-z0-9_.-]{1,60}$/),
        label: z.string().trim().min(1).max(160),
        type: z.enum(FILL_FIELD_TYPES).default('text'),
        options: z.array(z.string().trim().min(1).max(160)).max(60).optional(),
        required: z.boolean().optional(),
        hint: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(40),
  known: z.record(z.string(), z.string().max(4000)).optional(),
  country: z.string().regex(/^[a-z]{2}$/i).optional(),
});

export const advisorRoutes: FastifyPluginAsync<AdvisorRoutesOptions> = async (app, { service, auth, voice, filler, intents, speech }) => {
  const requireSession = sessionGuard(auth);
  const maybeSession = optionalSession(auth);
  const limiter = new RateLimiter();

  // M148 «المستشار يرد بالصوت»: a reply's text comes back as an MP3 clip (base64) in the member's language.
  // Members only; the clip is never stored on disk and the same reply is synthesised once.
  app.post(
    '/api/advisor/speak',
    guard(async (request, reply) => {
      if (!speech) return reply.code(404).send({ error: { code: 'speech_off', message: 'الرد الصوتي غير متاح حاليًا' } });
      const current = await requireSession(request, reply);
      if (!current) return;
      if (!limiter.hit(`speak:${request.ip}`, 40, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'طلبات صوتية كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      const body = parse(speakSchema, request.body, reply);
      if (!body) return;
      const text = speakable(body.text);
      if (!text) return reply.code(400).send({ error: { code: 'empty', message: 'لا يوجد نص يُقرأ' } });
      try {
        const audio = await speech.speak(text, langOf(request));
        return { audio: audio.toString('base64'), mime: 'audio/mpeg', chars: text.length };
      } catch {
        return reply.code(502).send({ error: { code: 'speech_failed', message: 'تعذر تحويل الرد إلى صوت، حاول مرة أخرى' } });
      }
    }),
  );

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
      // M142: guests may speak too (the registration form) — on a smaller per-IP budget.
      const current = await maybeSession(request);
      if (!limiter.hit(`voice:${request.ip}`, current ? 20 : 8, 15 * 60_000)) {
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

  // M151 «المستشار يقرأ ملفك»: one PDF (base64, ≤ 10 MB) with an optional line. Checked here (magic bytes, size),
  // stored by the hub in vcmem's uploads under a random name, read by the workflow. Never kept on this server.
  app.post(
    '/api/advisor/file',
    { bodyLimit: FILE_BODY_LIMIT },
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      if (!limiter.hit(`file:${current.session.uuid}`, 12, 60 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'ملفات كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      const body = parse(fileSchema, request.body, reply);
      if (!body) return;
      const bytes = Buffer.from(body.file, 'base64');
      if (bytes.length < 100 || !bytes.subarray(0, 5).equals(PDF_MAGIC)) {
        return reply.code(400).send({ error: { code: 'bad_file', message: 'الملف ليس PDF صالحًا' } });
      }
      if (bytes.length > FILE_MAX_BYTES) {
        return reply.code(413).send({ error: { code: 'too_big', message: 'حجم الملف أكبر من 10 MB' } });
      }
      const name = body.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120) || 'file.pdf';
      const result = await service.send(current.session, body.text, body.context ?? null, request.ip, langOf(request), {
        name: /\.pdf$/i.test(name) ? name : `${name}.pdf`,
        base64: bytes.toString('base64'),
      });
      reply.header('cache-control', 'no-store');
      return result;
    }),
  );

  // M145 «المساعد ينفّذ»: app intents (HQ booking card, open a screen, prefilled service request). No intent → the app sends to the hub as usual.
  app.post(
    '/api/advisor/intent',
    guard(async (request, reply) => {
      if (!intents) return { action: null, reply: null };
      const current = await requireSession(request, reply);
      if (!current) return;
      if (!limiter.hit(`intent:${request.ip}`, 90, 15 * 60_000)) return { action: null, reply: null };
      const body = parse(intentSchema, request.body, reply);
      if (!body) return;
      if (!body.text && !body.pending) return { action: null, reply: null };
      const me = await auth.me(current.session);
      try {
        return await intents.detect({ text: body.text, lang: langOf(request), me, pending: (body.pending ?? null) as HqProposal | null });
      } catch (error) {
        request.log.warn({ err: error }, 'intent detection failed');
        return { action: null, reply: null };
      }
    }),
  );

  // M142 «املأ بصوتك»: one spoken message → the form's values (normalised server-side). The member reviews and submits.
  app.post(
    '/api/advisor/fill-form',
    guard(async (request, reply) => {
      if (!filler) return reply.code(404).send({ error: { code: 'voice_off', message: 'التعبئة الصوتية غير متاحة حاليًا' } });
      const current = await maybeSession(request);
      if (!limiter.hit(`fill:${request.ip}`, current ? 30 : 10, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'محاولات كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      const body = parse(fillSchema, request.body, reply);
      if (!body) return;
      try {
        return await filler.fill({
          transcript: body.transcript,
          lang: langOf(request),
          fields: body.fields,
          known: body.known,
          country: (body.country ?? 'sa').toLowerCase(),
          today: riyadhNow().date,
        });
      } catch {
        return reply.code(502).send({ error: { code: 'fill_failed', message: 'تعذر فهم التسجيل، حاول مرة أخرى' } });
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
