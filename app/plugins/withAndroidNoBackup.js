// M241: `android.allowBackup: false` (app.config.ts) keeps the session's mirror file out of Google's
// auto-backup. The AppsFlyer SDK's own manifest declares allowBackup="true", so the manifest merger
// refuses the build («Attribute application@allowBackup value=(false) … is also present … value=(true)»)
// unless the app says its value wins. This plugin adds that one word to tools:replace, keeping whatever
// another plugin already put there. Found by the local release lint, before any EAS build was spent.
const { withAndroidManifest } = require('@expo/config-plugins');

const ATTRIBUTE = 'android:allowBackup';

module.exports = function withAndroidNoBackup(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$ = manifest.$ ?? {};
    if (!manifest.$['xmlns:tools']) manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const application = manifest.application?.[0];
    if (application) {
      application.$ = application.$ ?? {};
      application.$[ATTRIBUTE] = 'false';
      const replaced = String(application.$['tools:replace'] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (!replaced.includes(ATTRIBUTE)) replaced.push(ATTRIBUTE);
      application.$['tools:replace'] = replaced.join(',');
    }
    return mod;
  });
};
