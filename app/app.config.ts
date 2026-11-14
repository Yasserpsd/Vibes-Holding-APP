import type { ConfigContext, ExpoConfig } from 'expo/config';

// APP_ENV is injected by EAS (see eas.json) or set in the shell for local runs.
// Anything else than "production" is treated as the TEST environment.
type AppEnv = 'test' | 'production';
const APP_ENV: AppEnv = process.env.APP_ENV === 'production' ? 'production' : 'test';
const IS_PRODUCTION = APP_ENV === 'production';

const EAS_PROJECT_ID = '41f3ea2d-5f89-4e33-87c1-ccb795d9166a';
// The version of the binary this tree builds. Bump it with every store build (ASC never attaches a lower one).
const APP_VERSION = '1.3.3';
// OTA_RUNTIME_VERSION=1.2.0 publishes an update for the phones still on an older binary (M162, owner 2026-10-30).
// M239: the server's forced-update floor relies on two facts, so they are enforced here — a store build never
// takes the override (its runtime is always its own version), and a bundle is never published to a runtime NEWER
// than the tree it is built from (roll back by republishing the older update, not by publishing from an older tree).
const OTA_RUNTIME = process.env.EAS_BUILD ? '' : (process.env.OTA_RUNTIME_VERSION ?? '').trim();
const versionParts = (value: string): number[] => value.split('.').map((part) => Number(part) || 0);
if (OTA_RUNTIME) {
  const [runtime, own] = [versionParts(OTA_RUNTIME), versionParts(APP_VERSION)];
  const ahead = [0, 1, 2, 3].map((i) => (runtime[i] ?? 0) - (own[i] ?? 0)).find((diff) => diff !== 0) ?? 0;
  if (ahead > 0) throw new Error(`OTA_RUNTIME_VERSION=${OTA_RUNTIME} is newer than this tree (${APP_VERSION}): publish from the current tree instead.`);
}
const BASE_APP_ID = 'com.vcmem.investorsclub';
const APP_ID = IS_PRODUCTION ? BASE_APP_ID : `${BASE_APP_ID}.preview`;
const BRAND_BLACK = '#0B0B0B';
const BRAND_GOLD = '#C9A227';
// Firebase config for Android push (FCM): path from an EAS file variable on builds; locally, the same
// variable in app/.env pointing at the git-ignored google-services.json.
const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON;
// Public value: the test API. Production gets its URL from EXPO_PUBLIC_API_URL only.
const TEST_API_URL = 'https://api-test.vibesholdingsa.com';
// M239 (owner, 2026-11-14): iOS permission prompts follow the phone's language. The plugin values below are the
// default-locale (English) Info.plist text; locales/ar.json + en.json carry the per-language InfoPlist.strings.
const MIC_EN = 'The app uses the microphone to record your voice question for the advisor.';
const FACE_ID_EN = 'The app uses Face ID to unlock the app when the security lock is on.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // Owner (2026-10-21): the public app name is Latin «Investors Club» in both languages.
  name: IS_PRODUCTION ? 'Investors Club' : 'Investors Club (تجريبي)',
  slug: 'vibes-holding',
  owner: 'vibes-holding',
  // 1.1.0 (M27 stage 4): the first binary with the native modules added since M1 (secure store, notifications,
  // RevenueCat) and without a forced layout direction; its runtime gets its own updates.
  // 1.2.0 (M151): adds expo-document-picker (the advisor's PDF button); new runtime, new OTA branch.
  // M217: 1.3.1 stays (its review was withdrawn for a new iOS build with SKAN ids); same runtime, OTAs unchanged.
  // 1.3.2 (owner, 2026-11-10): new store build for the relationship screenshots + ad-platform readiness; new runtime.
  // 1.3.3 (owner, 2026-11-14: «بيلد جديد بكل التعديلات»): M239 — English/Arabic iOS permission texts (native), the binary's own
  // version sent to the forced-update floor, three-line texts, language fixes; new runtime (OTAs now go to five).
  version: APP_VERSION,
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
  runtimeVersion: OTA_RUNTIME || { policy: 'appVersion' },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    // M46: «Sign in with Apple» — required by Apple once any social sign-in exists.
    usesAppleSignIn: true,
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      // App Store export compliance: standard HTTPS only, no custom encryption.
      ITSAppUsesNonExemptEncryption: false,
      // M217: Apple's privacy-safe install signals (SKAN / AdAttributionKit) for the ad networks we buy on, so a
      // campaign learns from iPhones whose owner declined tracking. Sources (2026-11-08): Google's 3p SKAN list
      // (Google, Meta = Facebook + Instagram, Pangle = TikTok's network), Snap 424m5254lk (ironSource Snap guide +
      // Snap postbacks), TikTok's second ByteDance id 238da6jt44. X has no published id (its SKAN data reaches the
      // MMP by API); LinkedIn runs no app-install ads.
      SKAdNetworkItems: [
        'cstr6suwn9', // Google Ads
        'v9wttpbfk9', // Meta 1/2
        'n38lu8286q', // Meta 2/2
        '424m5254lk', // Snap
        '22mmun2rn5', // TikTok / Pangle
        '238da6jt44', // TikTok / Pangle (2)
      ].map((id) => ({ SKAdNetworkIdentifier: `${id}.skadnetwork` })),
      // Copies of every winning SKAN / AdAttributionKit postback go to AppsFlyer (iOS 15+).
      NSAdvertisingAttributionReportEndpoint: 'https://appsflyer-skadnetwork.com/',
      AdAttributionKit: { AttributionCopyEndpoint: 'https://appsflyer-skadnetwork.com/' },
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
  // M157: per-language iOS permission texts (InfoPlist.strings): the tracking, microphone and Face ID prompts in Arabic and English.
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
    ['expo-audio', { microphonePermission: MIC_EN }],
    // M118d: the biometric app lock (native module: works from the NEXT build; older binaries
    // hide the toggle via requireOptionalNativeModule).
    ['expo-local-authentication', { faceIDPermission: FACE_ID_EN }],
    // M157: ads attribution (TikTok, Meta, X, LinkedIn, Google Ads) through AppsFlyer — native module, binary
    // 1.3.0; older binaries skip it via lib/adsAttribution.ts. The iOS tracking prompt text lives in `locales`
    // (Arabic + English); this default covers any other device language.
    'react-native-appsflyer',
    // M157: pins kotlin-stdlib for react-native-appsflyer (its 2.4.10 default breaks the EAS Android build).
    './plugins/withKotlinStdlibPin',
    // M157: the locales' NSUserTrackingUsageDescription needs a default-locale twin or Android release lint fails (ExtraTranslation).
    './plugins/withAndroidTrackingString',
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
