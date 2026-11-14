// M157 fix (2026-10-30), widened in M239 (2026-11-14): `expo.locales` (ar/en, the iOS permission-prompt
// texts) also lands in Android's values-b+ar/strings.xml and values-b+en/strings.xml. Android's release
// lint then fails the build with ExtraTranslation («translated here but not found in default locale»)
// for every key that values/strings.xml does not have. Writing the English text of EVERY locale key into
// the default locale satisfies lint; Android never reads these keys, so nothing changes on devices.
// A new key in locales/*.json needs nothing here: the list is read from locales/en.json.
const fs = require('node:fs');
const path = require('node:path');
const { withStringsXml, AndroidConfig } = require('@expo/config-plugins');

// Last resort when locales/en.json cannot be read: the keys the app has shipped with.
const KNOWN = {
  NSUserTrackingUsageDescription:
    'This permission lets us learn which ad introduced you to Investors Club and improve our ads. We never sell your data or share it beyond this purpose.',
  NSMicrophoneUsageDescription: 'The app uses the microphone to record your voice question for the advisor.',
  NSFaceIDUsageDescription: 'The app uses Face ID to unlock the app when the security lock is on.',
};

function readLocale(config, entry) {
  if (entry && typeof entry === 'object') return entry;
  if (typeof entry !== 'string') return {};
  try {
    return JSON.parse(fs.readFileSync(path.resolve(config._internal?.projectRoot ?? process.cwd(), entry), 'utf8'));
  } catch {
    return {};
  }
}

module.exports = function withAndroidTrackingString(config) {
  const locales = config.locales ?? {};
  const english = readLocale(config, locales.en);
  // Every key of every language needs a default twin; English text first, then any language that has it.
  const texts = { ...KNOWN };
  for (const entry of Object.values(locales)) {
    for (const [name, value] of Object.entries(readLocale(config, entry))) {
      if (typeof value === 'string' && value && !texts[name]) texts[name] = value;
    }
  }
  for (const [name, value] of Object.entries(english)) {
    if (typeof value === 'string' && value) texts[name] = value;
  }
  return withStringsXml(config, (mod) => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      Object.entries(texts).map(([name, text]) => ({ $: { name, translatable: 'false' }, _: text })),
      mod.modResults,
    );
    return mod;
  });
};
