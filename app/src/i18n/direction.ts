import { requireOptionalNativeModule } from 'expo';
import { DevSettings, I18nManager } from 'react-native';

import { loadSetting, saveSetting } from '@/lib/deviceStore';

import { getLang, saveLang, type Lang } from './index';

// The layout direction is native and fixed for a launch: Arabic runs right-to-left, English
// left-to-right, and a change of language takes effect after a restart. Styles read these
// constants instead of writing 'right' or a chevron by hand, so one screen serves both directions.
export const isRTL = I18nManager.isRTL;
/** The arrow of a «from, to» pair follows the reading direction. */
export const arrowForward: 'arrow-back' | 'arrow-forward' = isRTL ? 'arrow-back' : 'arrow-forward';
/**
 * Where a line of text starts. A Text reads `left` and `right` relative to the layout direction:
 * `left` is the start edge (the right side in Arabic), `right` is the end edge. Seen on the emulator
 * (RN 0.86): `textAlign: 'right'` drew Arabic titles and labels on the LEFT of a right-to-left screen.
 */
export const textStart = 'left' as const;
/** The far edge of a line of text (times, amounts): see `textStart`. */
export const textEnd = 'right' as const;
/** A TextInput reads `left` and `right` as the physical sides, so its start follows the language. */
export const inputStart: 'left' | 'right' = isRTL ? 'right' : 'left';
/** The «open this row» chevron points away from the text. */
export const chevronForward: 'chevron-back' | 'chevron-forward' = isRTL ? 'chevron-back' : 'chevron-forward';

const ATTEMPT_KEY = 'investorsclub.lang.restart';

async function restart(): Promise<void> {
  if (requireOptionalNativeModule('ExpoUpdates')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await (require('expo-updates') as typeof import('expo-updates')).reloadAsync();
      return;
    } catch {
      // Development builds run without expo-updates: the dev reload below serves them.
    }
  }
  if (__DEV__) DevSettings.reload();
}

/**
 * Makes the native direction follow the language loaded by `initI18n()`. Runs behind the splash
 * screen. A binary that forces its own direction (runtime 1.0.0) would ask for a restart at every
 * start, so one language gets one restart only.
 */
export async function syncDirection(): Promise<void> {
  const lang = getLang();
  const wantRTL = lang === 'ar';
  if (I18nManager.isRTL === wantRTL) {
    await saveSetting(ATTEMPT_KEY, null);
    return;
  }
  I18nManager.allowRTL(wantRTL);
  I18nManager.forceRTL(wantRTL);
  if ((await loadSetting(ATTEMPT_KEY)) === lang) return;
  await saveSetting(ATTEMPT_KEY, lang);
  await restart();
}

/** The member's choice in «حسابي»: saved, then the app restarts in the new language and direction. */
export async function switchLanguage(next: Lang): Promise<void> {
  if (next === getLang()) return;
  await saveLang(next);
  await saveSetting(ATTEMPT_KEY, null);
  I18nManager.allowRTL(next === 'ar');
  I18nManager.forceRTL(next === 'ar');
  await restart();
}
