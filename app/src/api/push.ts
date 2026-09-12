import { apiRequest } from './client';

// Mirrors server/src/push/routes.ts: one Expo push token per device, owned by the signed-in account.
export type PushRegistration = { token: string; platform: 'ios' | 'android'; deviceName?: string; appVersion?: string };

export const pushApi = {
  register: (input: PushRegistration) => apiRequest<{ ok: true; tokens: number }>('POST', '/api/push/tokens', { body: input }),
  /** Called before the local session is cleared, so the token still belongs to a signed-in request. */
  unregister: (token: string, sessionToken: string) => apiRequest<{ ok: true }>('DELETE', '/api/push/tokens', { body: { token }, token: sessionToken }),
};
