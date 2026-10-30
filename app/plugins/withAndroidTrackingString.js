// M157 fix (2026-10-30): `expo.locales` (ar/en, the iOS tracking-prompt text) also lands in Android's
// values-b+ar/strings.xml and values-b+en/strings.xml. Android's release lint then fails the build with
// ExtraTranslation («translated here but not found in default locale») because values/strings.xml has
// no NSUserTrackingUsageDescription. Writing the English text into the default locale satisfies lint;
// Android never reads the key, so nothing changes on devices.
const { withStringsXml, AndroidConfig } = require('@expo/config-plugins');

const NAME = 'NSUserTrackingUsageDescription';

module.exports = function withAndroidTrackingString(config) {
  // `locales.en` is the JSON path in app.config.ts (an object once resolved): take the text from there.
  let fallback;
  const en = config.locales && config.locales.en;
  if (en && typeof en === 'object') fallback = en[NAME];
  else if (typeof en === 'string') {
    try {
      fallback = JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(config._internal?.projectRoot ?? process.cwd(), en), 'utf8'))[NAME];
    } catch {
      fallback = undefined;
    }
  }
  const text =
    typeof fallback === 'string' && fallback
      ? fallback
      : 'This permission lets us learn which ad introduced you to Investors Club and improve our ads. We never sell your data or share it beyond this purpose.';
  return withStringsXml(config, (mod) => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: NAME, translatable: 'false' }, _: text }],
      mod.modResults,
    );
    return mod;
  });
};
