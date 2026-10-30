// M157 fix (2026-10-30): react-native-appsflyer's android/build.gradle reads
// `rootProject.ext.kotlin_stdlib_version` and falls back to kotlin-stdlib 2.4.10, which is newer
// than the Kotlin compiler the Expo SDK ships (2.1.20) — the EAS Android build then dies in
// `:react-native-appsflyer:compileReleaseKotlin` with «Module was compiled with an incompatible
// version of Kotlin» and unresolved `mapOf`/`to`. Pinning the ext property keeps the stdlib on the
// project's own Kotlin. Remove once the module ships a matching default.
const { withProjectBuildGradle } = require('@expo/config-plugins');

const KOTLIN_STDLIB_VERSION = '2.1.20';
const MARKER = 'kotlin_stdlib_version';
const BLOCK = [
  '// react-native-appsflyer: keep kotlin-stdlib on the project Kotlin (its default 2.4.10 breaks compileReleaseKotlin).',
  `ext { ${MARKER} = "${KOTLIN_STDLIB_VERSION}" }`,
  '',
].join('\n');

module.exports = function withKotlinStdlibPin(config) {
  return withProjectBuildGradle(config, (mod) => {
    const { contents } = mod.modResults;
    if (!contents.includes(MARKER)) {
      mod.modResults.contents = contents.includes('allprojects {')
        ? contents.replace('allprojects {', `${BLOCK}\nallprojects {`)
        : `${contents}\n${BLOCK}`;
    }
    return mod;
  });
};
