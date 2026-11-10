import { useEffect } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { forgetAdsUser, identifyAdsUser, startAdsAttribution } from '@/lib/adsAttribution';
import { piiFromMe } from '@/lib/adsUserPii';

/**
 * M157: starts the ads-attribution SDK once per launch (install + session, after the iOS tracking
 * prompt) and names the signed-in member to it by numeric id. Renders nothing; lives under the
 * providers in the root layout next to PushRegistrar. A binary without the SDK does nothing here.
 */
export function AdsAttribution() {
  const { status, me } = useAuth();
  const contactId = me?.id ?? null;
  const email = me?.email;
  const phone = me?.phone;
  const contactEmail = me?.contactEmail;

  useEffect(() => {
    void startAdsAttribution();
  }, []);

  useEffect(() => {
    if (status === 'guest') forgetAdsUser();
  }, [status]);

  useEffect(() => {
    if (status !== 'signedIn' || contactId === null) return;
    // Owner 2026-11-10: hashed e-mail + mobile for ad matching (Snap/TikTok/Meta), behind the same consent gate.
    identifyAdsUser(contactId, piiFromMe({ email, phone, contactEmail }));
  }, [status, contactId, email, phone, contactEmail]);

  return null;
}
