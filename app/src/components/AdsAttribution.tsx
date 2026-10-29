import { useEffect } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { identifyAdsUser, startAdsAttribution } from '@/lib/adsAttribution';

/**
 * M157: starts the ads-attribution SDK once per launch (install + session, after the iOS tracking
 * prompt) and names the signed-in member to it by numeric id. Renders nothing; lives under the
 * providers in the root layout next to PushRegistrar. A binary without the SDK does nothing here.
 */
export function AdsAttribution() {
  const { status, me } = useAuth();
  const contactId = me?.id ?? null;

  useEffect(() => {
    void startAdsAttribution();
  }, []);

  useEffect(() => {
    if (status !== 'signedIn' || contactId === null) return;
    identifyAdsUser(contactId);
  }, [status, contactId]);

  return null;
}
