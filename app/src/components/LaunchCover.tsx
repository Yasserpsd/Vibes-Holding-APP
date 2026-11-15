import { Image, StyleSheet, View } from 'react-native';

import { SPLASH_BLACK, SPLASH_EMBLEM, SPLASH_EMBLEM_SIZE } from '@/lib/reloadApp';

/**
 * 2026-11-16 (members: «شاشة سودا بدون سبب»): what the app shows whenever it is not ready to draw a screen — the
 * same picture as the native splash and the reload page (brand black, the emblem at 160 points, centred), so a
 * launch, a restart and a waiting gate all read as one opening screen instead of a bare black one.
 *
 * Self-contained on purpose: no fonts, no t(), no theme tokens, no provider hooks. It is drawn before the language,
 * the theme and the fonts are back, and it must never be the thing that fails.
 *
 * `overlay`: laid over the app (the gates) instead of filling the root. No zIndex (M240); `elevation` only where the
 * gate it replaces had one.
 */
export function LaunchCover({ overlay = false, elevation }: { overlay?: boolean; elevation?: number }) {
  return (
    <View style={[overlay ? styles.overlay : styles.root, elevation ? { elevation } : null]}>
      <Image source={SPLASH_EMBLEM} style={styles.emblem} resizeMode="contain" fadeDuration={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPLASH_BLACK, alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: SPLASH_BLACK, alignItems: 'center', justifyContent: 'center' },
  emblem: { width: SPLASH_EMBLEM_SIZE, height: SPLASH_EMBLEM_SIZE },
});
