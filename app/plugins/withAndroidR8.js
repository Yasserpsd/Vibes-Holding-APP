// M240: Google Play flags the bundle «DEX code optimization is below our threshold — Obfuscation (2%)»
// and wants every category at 25% or more by February 2027. The Expo template already wires R8
// (`minifyEnabled enableMinifyInReleaseBuilds` in android/app/build.gradle) behind this gradle property,
// so turning it on is the whole fix. Resource shrinking stays off: it is not what Play measures and it
// can drop assets that are loaded by name.
const { withGradleProperties } = require('@expo/config-plugins');

const KEY = 'android.enableMinifyInReleaseBuilds';

module.exports = function withAndroidR8(config) {
  return withGradleProperties(config, (mod) => {
    const existing = mod.modResults.find((item) => item.type === 'property' && item.key === KEY);
    if (existing) existing.value = 'true';
    else mod.modResults.push({ type: 'property', key: KEY, value: 'true' });
    return mod;
  });
};
