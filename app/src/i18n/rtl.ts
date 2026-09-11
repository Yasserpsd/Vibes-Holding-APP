import { I18nManager } from 'react-native';

// The app is Arabic-first and always RTL. Native builds are forced to RTL at
// launch by the expo-localization config plugin (forcesRTL in app.config.ts).
// This runtime call covers development clients and any platform that did not
// apply the native flag yet; it takes effect on the next app start.
export function ensureRTL(): void {
  if (!I18nManager.isRTL) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  }
}
