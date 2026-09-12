import { useQuery } from '@tanstack/react-query';

import type { Me } from './auth';
import { apiGet, apiRequest } from './client';

// Mirrors server/src/membership/service.ts (StoreConfig, SyncResult).
export type StoreConfig = {
  provider: 'revenuecat';
  productId: string;
  entitlement: string;
  /** RevenueCat public SDK keys; null on a platform the owner has not connected yet. */
  apiKeys: { android: string | null; ios: string | null };
  appUserIdPrefix: string;
  environment: 'test' | 'production';
  termsUrl: string | null;
  privacyUrl: string | null;
  restCheck: boolean;
};

export type SyncResult = {
  me: Me;
  checked: boolean;
  entitlementActive: boolean | null;
  activation: 'activated' | 'pending' | 'ignored' | 'skipped' | 'duplicate' | 'none';
  reason: string | null;
};

export function useStoreConfig(enabled = true) {
  return useQuery({
    queryKey: ['membership', 'store'],
    queryFn: () => apiGet<StoreConfig>('/api/membership/store'),
    staleTime: 10 * 60_000,
    enabled,
  });
}

export const membershipApi = {
  /** After a purchase or restore: the server re-reads the membership (the store result itself is never trusted). */
  sync: () => apiRequest<SyncResult>('POST', '/api/membership/sync', { body: {} }),
};
