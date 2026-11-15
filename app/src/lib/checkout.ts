import Constants from 'expo-constants';
import { Linking } from 'react-native';

import { env } from '@/config/env';
import { colors } from '@/theme/tokens';
import { loadWebBrowser } from '@/lib/openLink';

/** The app's deep-link scheme (investorsclub-preview in test builds, investorsclub in production). */
export function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  // A config without a scheme falls back by environment, so a production app never builds a preview return link.
  return (Array.isArray(scheme) ? scheme[0] : scheme) ?? (env.isProduction ? 'investorsclub' : 'investorsclub-preview');
}

export function paymentReturnUrl(paymentId: string): string {
  return `${appScheme()}://payment/${paymentId}`;
}

export type CheckoutOutcome = 'returned' | 'closed' | 'external';

/**
 * Opens the gateway checkout in the in-app browser as an auth session: the page's «العودة إلى التطبيق»
 * link (the app scheme) closes it and brings the app back. The payment status itself always comes
 * from the server, never from the browser result.
 */
export async function openCheckout(url: string, returnUrl: string): Promise<CheckoutOutcome> {
  const webBrowser = loadWebBrowser();
  if (webBrowser) {
    try {
      const result = await webBrowser.openAuthSessionAsync(url, returnUrl, {
        toolbarColor: colors.black,
        controlsColor: colors.gold,
        showInRecents: true,
      });
      return result.type === 'success' ? 'returned' : 'closed';
    } catch {
      // Fall through to the system browser.
    }
  }
  try {
    await Linking.openURL(url);
    return 'external';
  } catch {
    return 'closed';
  }
}
