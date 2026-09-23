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
  // M46: the Google OAuth web client id (public). Empty = the Google button stays hidden.
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? extra.googleWebClientId ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
