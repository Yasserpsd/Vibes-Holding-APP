import Constants from 'expo-constants';

export type AppEnv = 'test' | 'production';

type Extra = {
  appEnv?: AppEnv;
  apiBaseUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const env = {
  appEnv: extra.appEnv ?? 'test',
  isProduction: extra.appEnv === 'production',
  apiBaseUrl: extra.apiBaseUrl ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
