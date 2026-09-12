import { requireOptionalNativeModule } from 'expo';
import { Linking } from 'react-native';

import { colors } from '@/theme/tokens';

type WebBrowserModule = typeof import('expo-web-browser');

// expo-web-browser is native. Binaries built before it was added (the M1 APK) do not contain
// it. The native module registry is checked first: requiring the package when the module is
// missing is reported by React Native as a fatal error before any try/catch can run.
export function loadWebBrowser(): WebBrowserModule | null {
  if (!requireOptionalNativeModule('ExpoWebBrowser')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-web-browser') as WebBrowserModule;
  } catch {
    return null;
  }
}

/** Opens a web page inside the app when possible, otherwise in the system browser. */
export async function openLink(url: string): Promise<void> {
  const webBrowser = loadWebBrowser();
  if (webBrowser) {
    try {
      await webBrowser.openBrowserAsync(url, {
        toolbarColor: colors.black,
        controlsColor: colors.gold,
        presentationStyle: webBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
      return;
    } catch {
      // Fall through to the system browser.
    }
  }
  try {
    await Linking.openURL(url);
  } catch {
    // Nothing else to try; the link stays visible on screen.
  }
}
