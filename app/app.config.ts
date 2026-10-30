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
const TEST_API_URL = 'https://api-test.vibesholdingsa.com';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // Owner (2026-10-21): the public app name is Latin «Investors Club» in both languages.
  name: IS_PRODUCTION ? 'Investors Club' : 'Investors Club (تجريبي)',
  slug: 'vibes-holding',
  owner: 'vibes-holding',
  // 1.1.0 (M27 stage 4): the first binary with the native modules added since M1 (secure store, notifications,
  // RevenueCat) and without a forced layout direction; its runtime gets its own updates.
  // 1.2.0 (M151): adds expo-document-picker (the advisor's PDF button); new runtime, new OTA branch.
  version: '1.3.0',
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
      // App Store export compliance: standard HTTPS only, no custom encryption.
      ITSAppUsesNonExemptEncryption: false,
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
  // M157: per-language iOS permission texts (InfoPlist.strings): the tracking prompt in Arabic and English.
  locales: { ar: './locales/ar.json', en: './locales/en.json' },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      {
        // M106b (owner: «اللوجو مقصوص»): Android 12+ clips the splash into a centered inset, so the
        // SQUARE emblem goes there (never cropped); the full logo greets on the welcome screen instead.
        image: './assets/images/club-emblem.png',
        imageWidth: 160,
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
    // M19: videos play inside the app — expo-video for uploaded files, react-native-webview for the
    // YouTube embedded player (native modules: need a new build; old binaries keep the in-app browser).
    'expo-video',
    // M104: the advisor listens — microphone recording (native module: needs a new build; old
    // binaries hide the mic button via requireOptionalNativeModule).
    ['expo-audio', { microphonePermission: 'يستخدم التطبيق الميكروفون لتسجيل سؤالك الصوتي للمستشار.' }],
    // M118d: the biometric app lock (native module: works from the NEXT build; older binaries
    // hide the toggle via requireOptionalNativeModule).
    ['expo-local-authentication', { faceIDPermission: 'يستخدم التطبيق بصمة الوجه لفتح التطبيق عند تفعيل قفل الأمان.' }],
    // M157: ads attribution (TikTok, Meta, X, LinkedIn, Google Ads) through AppsFlyer — native module, binary
    // 1.3.0; older binaries skip it via lib/adsAttribution.ts. The iOS tracking prompt text lives in `locales`
    // (Arabic + English); this default covers any other device language.
    'react-native-appsflyer',
    [
      'expo-tracking-transparency',
      { userTrackingPermission: 'This permission lets us learn which ad introduced you to Investors Club and improve our ads. We never sell your data or share it beyond this purpose.' },
    ],
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
    // M157, public app key (rule 1 allows it): the AppsFlyer dev key from the EAS environment
    // (EXPO_PUBLIC_APPSFLYER_DEV_KEY). Empty = the attribution SDK never starts.
    appsflyerDevKey: process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY ?? '',
    supportsRTL: true,
    eas: { projectId: EAS_PROJECT_ID },
  },
});
