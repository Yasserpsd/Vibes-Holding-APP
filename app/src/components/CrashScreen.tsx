import { router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getLang } from '@/i18n';
import { nativeRollbackStands, noteCrash } from '@/lib/crashGuard';
import { dropQueryCacheFile } from '@/lib/queryCache';
import { SPLASH_BLACK, SPLASH_EMBLEM, reloadApp } from '@/lib/reloadApp';

/**
 * 2026-11-16 (members: «شاشة سودا بدون سبب»): what the member sees when a screen throws while drawing — instead of
 * the dead black window on Android, or the app closing on iPhone. Mounted by the error boundaries of app/_layout.tsx:
 * `scope="app"` for the root (nothing else is left on screen), `scope="screen"` for one broken screen inside the
 * stack (the rest of the app is alive, so «رجوع» is offered too).
 *
 * Kept free of everything that could itself be the failure: no provider hooks, no themed styles, no t(), no shared
 * button. The wording is fixed here in both languages (the saved language decides; Arabic when it cannot be read).
 */
const COPY = {
  ar: {
    app: 'حدث خطأ غير متوقع في التطبيق. نعتذر عن ذلك، ويُرجى إعادة تشغيل التطبيق للمتابعة.',
    screen: 'تعذّر عرض هذه الصفحة. يمكنك الرجوع والمتابعة، أو إعادة تشغيل التطبيق.',
    restart: 'إعادة تشغيل التطبيق',
    back: 'رجوع',
  },
  en: {
    app: 'Something went wrong in the app. We apologise; please restart the app to continue.',
    screen: 'This page could not be shown. You can go back and continue, or restart the app.',
    restart: 'Restart the app',
    back: 'Back',
  },
} as const;

function copy(): (typeof COPY)['ar' | 'en'] {
  try {
    return getLang() === 'en' ? COPY.en : COPY.ar;
  } catch {
    return COPY.ar;
  }
}

type Props = { error: Error; retry: () => Promise<void>; scope?: 'app' | 'screen' };

export function CrashScreen({ error, retry, scope = 'app' }: Props) {
  // A broken update must still be rolled back by expo-updates, and it can only do that before anything is mounted:
  // an error in the very FIRST render of a cold start on a downloaded update is thrown on, uncaught, exactly as
  // before these boundaries existed. After the root layout's first commit this never fires (lib/crashGuard.ts).
  if (nativeRollbackStands()) throw error;

  const [busy, setBusy] = useState(false);
  const text = copy();

  useEffect(() => {
    noteCrash(scope, error);
    // A throw in the very first frame leaves the native splash up (the layout's own effect never ran).
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [scope, error]);

  const restart = () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      // A saved answer may be what broke the screen: the next start draws from the server.
      await dropQueryCacheFile();
      if (await reloadApp()) return;
      // This binary cannot restart itself: draw the tree again instead.
      setBusy(false);
      void retry().catch(() => undefined);
    })();
  };

  const back = () => {
    try {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/');
    } catch {
      // No navigator to ask: fall through to a fresh draw.
    }
    void retry().catch(() => undefined);
  };

  return (
    <View style={styles.cover}>
      <Image source={SPLASH_EMBLEM} style={styles.emblem} resizeMode="contain" fadeDuration={0} />
      <Text style={styles.message}>{scope === 'screen' ? text.screen : text.app}</Text>
      <Pressable accessibilityRole="button" onPress={restart} disabled={busy} style={[styles.button, busy ? styles.dimmed : null]}>
        <Text style={styles.buttonLabel} numberOfLines={1}>
          {text.restart}
        </Text>
      </Pressable>
      {scope === 'screen' ? (
        <Pressable accessibilityRole="button" onPress={back} style={[styles.button, styles.outline]}>
          <Text style={[styles.buttonLabel, styles.outlineLabel]} numberOfLines={1}>
            {text.back}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const GOLD = '#C9A227';

// Fixed colours on purpose (the brand black of the opening screen): the theme may be what failed to load.
const styles = StyleSheet.create({
  cover: { flex: 1, backgroundColor: SPLASH_BLACK, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48, gap: 20 },
  emblem: { width: 96, height: 96 },
  message: { color: '#F2F2F2', fontSize: 16, lineHeight: 28, textAlign: 'center' },
  button: { alignSelf: 'stretch', minHeight: 50, borderRadius: 14, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  buttonLabel: { color: SPLASH_BLACK, fontSize: 16, lineHeight: 26, fontWeight: '700' },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: GOLD },
  outlineLabel: { color: GOLD },
  dimmed: { opacity: 0.6 },
});
