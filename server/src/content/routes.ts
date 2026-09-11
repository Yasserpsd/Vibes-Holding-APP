import type { FastifyPluginAsync } from 'fastify';

import type { KV } from '../store.js';
import { getGoldenContent } from './golden.js';

export type ContentRoutesOptions = { kv: KV };

export const contentRoutes: FastifyPluginAsync<ContentRoutesOptions> = async (app, { kv }) => {
  app.get('/api/golden', async () => getGoldenContent(kv));
};
