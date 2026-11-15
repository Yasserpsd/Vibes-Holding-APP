import { requireOptionalNativeModule } from 'expo';
import { DevSettings, Image, Keyboard, TextInput } from 'react-native';

/**
 * 2026-11-16 (members: «شاشة سودا بدون سبب»): every restart of the JavaScript side used to show expo-updates' own
 * reload page (white, a blue spinner) and then a bare black gap. One helper restarts the app for everybody — the
 * update found at launch, the language and theme switch, the «restart» banner, the recovery screen — and makes the
 * reload page look like the opening screen: the brand black and the club emblem at the native splash's size.
 */

/** The native splash screen's own look (app.config.ts): brand black, the square emblem 160 points wide. */
export const SPLASH_BLACK = '#0B0B0B';
export const SPLASH_EMBLEM = require('../../assets/images/club-emblem.png');
export const SPLASH_EMBLEM_SIZE = 160;
/** Only seen if the native side cannot draw the emblem and falls back to its spinner. */
const BRAND_GOLD = '#C9A227';

type ReloadImage = { url: string; width: number; height: number; scale: number };

/**
 * The emblem as the native reload page can read it: a file, a web address or a data URI. A bundle that still runs
 * from the binary's own resources on Android names its pictures by resource id, which that page cannot open: the
 * reload then shows the brand black alone, and the launch cover draws the emblem as soon as JavaScript is back.
 */
function reloadImage(): ReloadImage | undefined {
  try {
    const uri = Image.resolveAssetSource(SPLASH_EMBLEM)?.uri;
    if (!uri || !/^(file|https?|data):/i.test(uri)) return undefined;
    return { url: uri, width: SPLASH_EMBLEM_SIZE, height: SPLASH_EMBLEM_SIZE, scale: 1 };
  } catch {
    return undefined;
  }
}

/**
 * Restarts the JavaScript side (the newest downloaded update is the one that starts). Never throws: `true` when
 * the restart was handed to the native side, `false` when this binary cannot restart itself (no updates module
 * outside development) — the caller then stays where it is.
 */
export async function reloadApp(): Promise<boolean> {
  if (requireOptionalNativeModule('ExpoUpdates')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const updates = require('expo-updates') as typeof import('expo-updates');
      try {
        await updates.reloadAsync({
          reloadScreenOptions: {
            backgroundColor: SPLASH_BLACK,
            image: reloadImage(),
            imageResizeMode: 'contain',
            fade: true,
            spinner: { enabled: false, color: BRAND_GOLD },
          },
        });
        return true;
      } catch {
        // A native side that refuses the options: the plain reload below.
      }
      await updates.reloadAsync();
      return true;
    } catch {
      // Development builds run without expo-updates: the dev reload below serves them.
    }
  }
  if (__DEV__) {
    DevSettings.reload();
    return true;
  }
  return false;
}

/** Screens where a restart would take what the member is writing or paying (a path, or anything under it). */
const FORM_ROUTES = ['/auth', '/form', '/service', '/profile-edit', '/contact', '/posts/compose', '/people/apply', '/checkout'];

let currentPath = '/';

/** The open screen's path, noted by ScreenTracker on every navigation. */
export function noteCurrentPath(path: string): void {
  currentPath = path || '/';
}

/**
 * The second lock on a restart nobody asked for (the update found at launch): a focused text field, an open keyboard
 * or a form route means the member may be typing, and the update waits for the banner or the next launch instead.
 * A state that cannot be read counts as typing.
 */
export function memberMayBeTyping(): boolean {
  try {
    if (TextInput.State.currentlyFocusedInput() != null) return true;
    if (Keyboard.isVisible()) return true;
  } catch {
    return true;
  }
  return FORM_ROUTES.some((route) => currentPath === route || currentPath.startsWith(`${route}/`));
}
