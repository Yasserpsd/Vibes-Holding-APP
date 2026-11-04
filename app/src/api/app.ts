import { env } from '@/config/env';

import { apiGet } from './client';

/** M195: the server's forced-update floor and where the stores are. */
export type AppStatus = {
  minVersion: string;
  updateRequired: boolean;
  message: string;
  storeUrls: { ios: string; android: string };
};

export const appApi = {
  status: () => apiGet<AppStatus>('/api/app/status', { version: env.appVersion }),
};
