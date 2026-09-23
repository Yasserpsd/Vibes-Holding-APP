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
const BRAND_GOLD = '#C9A227';
// Firebase config for Android push (FCM): path from an EAS file variable on builds; locally, the same
// variable in app/.env pointing at the git-ignored google-services.json.
const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON;
// Public value: the test API. Production gets its URL from EXPO_PUBLIC_API_URL only.
const TEST_API_URL = 'https://vibes-holding-app-production.up.railway.app';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_PRODUCTION ? 'نادي المستثمرين' : 'نادي المستثمرين (تجريبي)',
  slug: 'vibes-holding',
  owner: 'vibes-holding',
  // 1.1.0 (M27 stage 4): the first binary with the native modules added since M1 (secure store, notifications,
  // RevenueCat) and without a forced layout direction; its runtime gets its own updates.
  version: '1.1.0',
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
    // M46: «Sign in with Apple» — required by Apple once any social sign-in exists.
    usesAppleSignIn: true,
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
    ...(GOOGLE_SERVICES ? { googleServicesFile: GOOGLE_SERVICES } : {}),
  },
  // Mobile only: keeps expo export and eas update from bundling a web build.
  platforms: ['ios', 'android'],
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
    // Right-to-left layout is supported, not forced: the direction follows the app's language
    // (src/i18n/direction.ts sets it before the first screen mounts).
    ['expo-localization', { supportsRTL: true }],
    // Member notifications: white club mark on the brand gold (Android small icon), one default channel.
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: BRAND_GOLD, defaultChannel: 'default' }],
    // M46: social sign-in in seconds — Google on Android, Apple on iOS (native modules: needs a new build).
    'expo-apple-authentication',
    '@react-native-google-signin/google-signin',
  ],
  experiments: { typedRoutes: true },
  extra: {
    appEnv: APP_ENV,
    // Public value only. EXPO_PUBLIC_API_URL (EAS environment or app/.env) wins; test builds and
    // updates fall back to the test server so a publish without the variable still works.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? (IS_PRODUCTION ? '' : TEST_API_URL),
    // M46, public value (rule 1 allows it): the Google OAuth WEB client id — native Google sign-in asks
    // for the ID token with this audience. Empty until the owner creates it in Google Cloud; the app
    // hides the Google button while it is empty.
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
    supportsRTL: true,
    eas: { projectId: EAS_PROJECT_ID },
  },
});
