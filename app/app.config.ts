import type { ConfigContext, ExpoConfig } from 'expo/config';

// APP_ENV is injected by EAS (see eas.json) or set in the shell for local runs.
// Anything else than "production" is treated as the TEST environment.
type AppEnv = 'test' | 'production';
const APP_ENV: AppEnv = process.env.APP_ENV === 'production' ? 'production' : 'test';
const IS_PRODUCTION = APP_ENV === 'production';

const EAS_PROJECT_ID = '41f3ea2d-5f89-4e33-87c1-ccb795d9166a';
const BASE_APP_ID = 'com.vcmem.investorsclub';
const APP_ID = IS_PRODUCTION ? BASE_APP_ID : `${BASE_APP_ID}.preview`;
const BRAND_BLACK = '#0B0B0B';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_PRODUCTION ? 'نادي المستثمرين' : 'نادي المستثمرين (تجريبي)',
  slug: 'vibes-holding',
  owner: 'vibes-holding',
  version: '1.0.0',
  scheme: IS_PRODUCTION ? 'investorsclub' : 'investorsclub-preview',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: BRAND_BLACK,
  assetBundlePatterns: ['**/*'],
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    package: APP_ID,
    adaptiveIcon: {
      backgroundColor: BRAND_BLACK,
      foregroundImage: './assets/images/adaptive-icon.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
    output: 'static',
  },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/images/club-logo.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: BRAND_BLACK,
      },
    ],
    ['expo-localization', { supportsRTL: true, forcesRTL: true }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    appEnv: APP_ENV,
    // Public value only. Filled in when the M2 server exists (EXPO_PUBLIC_API_URL per EAS profile).
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
    supportsRTL: true,
    forcesRTL: true,
    eas: { projectId: EAS_PROJECT_ID },
  },
});
