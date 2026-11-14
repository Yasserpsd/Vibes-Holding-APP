import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';

export type AppEnv = 'test' | 'production';

type Extra = {
  appEnv?: AppEnv;
  apiBaseUrl?: string;
  googleWebClientId?: string;
  appsflyerDevKey?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

// EXPO_PUBLIC_API_URL is inlined at bundle time (app/.env locally, EAS env for builds and updates).
// The config extra is the fallback for binaries built with the variable set.
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? extra.apiBaseUrl ?? '').replace(/\/+$/, '');

/**
 * M239 (owner, 2026-11-14: only a truly old version is asked to update): the version of the INSTALLED binary, read
 * natively. `Constants.expoConfig.version` is the version the running bundle was published with, so after an OTA an
 * old binary reports the new number; the runtime version of expo-updates is fixed inside the binary (policy
 * `appVersion`) and no OTA can change it. Null when the module is missing or answers something else (dev builds).
 */
function installedVersion(): string | null {
  try {
    const value = (requireOptionalNativeModule('ExpoUpdates') as { runtimeVersion?: unknown } | null)?.runtimeVersion;
    return typeof value === 'string' && /^\d+(\.\d+){1,3}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export const env = {
  appEnv: extra.appEnv ?? 'test',
  isProduction: extra.appEnv === 'production',
  apiBaseUrl,
  // M46/M92: the Google OAuth web client id (a public value, committed in eas.json too). The
  // hardcoded default keeps the button alive in OTA bundles: `eas update` never reads eas.json
  // env, so an export without the variable used to ship '' and silently hide Google sign-in.
  googleWebClientId:
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    extra.googleWebClientId ||
    '980470249678-g51bg4r3u4op57tse8t2nt4vut1fp0cm.apps.googleusercontent.com',
  // M157: the AppsFlyer dev key (a public app key; set in the EAS environment, never in code).
  appsflyerDevKey: process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY || extra.appsflyerDevKey || '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  binaryVersion: installedVersion(),
} as const;
