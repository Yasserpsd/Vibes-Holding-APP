import { apiRequest } from './client';

// Mirrors server/src/push/routes.ts: one Expo push token per device, owned by the signed-in account.
/** M176: one personal daily suggestion — mirrors server/src/companion/tips.ts. */
/** M214: `image` = the picture of what the tip sells (an older server sends none). */
export type CompanionTip = { id: string; key: string; title: string; body: string; route: string; day: string; image?: string | null };

export type PushRegistration = { token: string; platform: 'ios' | 'android'; deviceName?: string; appVersion?: string };

export const pushApi = {
  register: (input: PushRegistration) => apiRequest<{ ok: true; tokens: number }>('POST', '/api/push/tokens', { body: input }),
  /** Called before the local session is cleared, so the token still belongs to a signed-in request. */
  unregister: (token: string, sessionToken: string) => apiRequest<{ ok: true }>('DELETE', '/api/push/tokens', { body: { token }, token: sessionToken }),
};

// M87b: the member's mute switch for the advisor's daily message (server-side, follows the account).
export const companionApi = {
  me: () => apiRequest<{ muted: boolean }>('GET', '/api/companion/me'),
  /** M176: the member's personal daily suggestions (newest first) for the notifications tab. */
  tips: () => apiRequest<{ tips: CompanionTip[] }>('GET', '/api/companion/tips'),
  setMuted: (muted: boolean) => apiRequest<{ muted: boolean }>('PUT', '/api/companion/me', { body: { muted } }),
};
