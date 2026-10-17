import Constants from 'expo-constants';

export type AppEnv = 'test' | 'production';

type Extra = {
  appEnv?: AppEnv;
  apiBaseUrl?: string;
  googleWebClientId?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

// EXPO_PUBLIC_API_URL is inlined at bundle time (app/.env locally, EAS env for builds and updates).
// The config extra is the fallback for binaries built with the variable set.
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? extra.apiBaseUrl ?? '').replace(/\/+$/, '');

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
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
