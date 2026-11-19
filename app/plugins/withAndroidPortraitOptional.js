// The app is portrait-only (`orientation: 'portrait'` in app.config.ts), and Android reads that as a REQUIRED
// hardware feature, `android.hardware.screen.portrait`: a device that does not report it cannot install the app.
// Google Play began to flag this on 2026-11-19 (release 1.3.5: «Required hardware feature declarations are
// restricting your app's availability»). Declaring the feature as not required keeps the app portrait and lets
// those devices install it. Native: takes effect from the first build after 1.3.5 (14).
const { withAndroidManifest } = require('@expo/config-plugins');

const FEATURE = 'android.hardware.screen.portrait';

module.exports = function withAndroidPortraitOptional(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const features = (manifest['uses-feature'] ?? []).filter((item) => item?.$?.['android:name'] !== FEATURE);
    features.push({ $: { 'android:name': FEATURE, 'android:required': 'false' } });
    manifest['uses-feature'] = features;
    return mod;
  });
};
