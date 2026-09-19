import type { Readable } from 'node:stream';
import type { FastifyPluginAsync } from 'fastify';

import { adminGuard, guard, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { uploadInputSchema, type MediaService } from './service.js';
import { DiskMediaStore, UploadTokenError, UploadTooLargeError } from './store.js';

export type MediaRoutesOptions = { service: MediaService; auth: AuthService };

const NOT_FOUND = { error: { code: 'not_found', message: 'الملف غير موجود' } };

/** `bytes=start-end` for one range; null when the header is absent, malformed or cannot be satisfied. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] === '' || match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start <= end && start < size ? { start, end } : null;
}

/** Uploaded media (M15): tickets for the dashboard and the public `/media/<key>` links the posts carry. */
export const mediaRoutes: FastifyPluginAsync<MediaRoutesOptions> = async (app, { service, auth }) => {
  const requireAdmin = adminGuard(auth);
  const store = service.store;

  app.get(
    '/api/admin/uploads/config',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return service.config();
    }),
  );

  app.post(
    '/api/admin/uploads',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(uploadInputSchema, request.body, reply);
      if (!input) return;
      return reply.code(201).send(await service.createUpload(input));
    }),
  );

  // Disk store only (development, tests): the signed ticket in the query is the permission, like a presigned bucket URL.
  // With a bucket the route does not exist. A raw image or video body reaches the handler as a stream (this parser is
  // scoped to this plugin); JSON and text bodies keep Fastify's default 1 MB limit, so the server never buffers a large body.
  if (store instanceof DiskMediaStore) {
    app.addContentTypeParser(/^(image|video)\//, (_request, payload, done) => done(null, payload));
    app.put(
      '/api/admin/uploads/put',
      guard(async (request, reply) => {
        try {
          const ticket = store.readToken(String((request.query as { ticket?: unknown }).ticket ?? ''));
          if ((request.headers['content-type'] ?? '').toLowerCase() !== ticket.contentType) throw new UploadTokenError('content type differs from the ticket');
          if (Number(request.headers['content-length'] ?? 0) > ticket.maxBytes) throw new UploadTooLargeError('declared length over the limit');
          await store.write(ticket, request.body as Readable);
          return await reply.code(204).send();
        } catch (error) {
          if (error instanceof UploadTooLargeError) return reply.code(413).send({ error: { code: 'too_large', message: 'حجم الملف أكبر من الحد المسموح' } });
          if (error instanceof UploadTokenError || error instanceof SyntaxError) {
            return reply.code(403).send({ error: { code: 'invalid_token', message: 'إذن الرفع غير صالح أو انتهت مدته، أعد المحاولة' } });
          }
          throw error;
        }
      }),
    );
  }

  app.get('/media/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*'];
    const location = await service.locate(key);
    if (!location) return reply.code(404).send(NOT_FOUND);
    // The presigned link lives for an hour; the redirect may be reused for ten minutes of it.
    if ('redirect' in location) return reply.header('cache-control', 'public, max-age=600').redirect(location.redirect, 302);
    if (!(store instanceof DiskMediaStore)) return reply.code(404).send(NOT_FOUND);

    reply
      .header('content-type', location.contentType)
      .header('accept-ranges', 'bytes')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable');
    const range = parseRange(request.headers.range, location.size);
    if (request.headers.range && !range) return reply.code(416).header('content-range', `bytes */${location.size}`).send();
    if (range) {
      return reply
        .code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${location.size}`)
        .header('content-length', range.end - range.start + 1)
        .send(store.open(location.path, range));
    }
    return reply.header('content-length', location.size).send(store.open(location.path));
  });
};
