import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { t } from '@/i18n';
import { authenticate, lockAvailable, lockEnabled } from '@/lib/appLock';
import { colors, fonts, spacing } from '@/theme/tokens';

/** How long in the background before the lock asks for the face again. */
const RELOCK_AFTER_MS = 45_000;

/**
 * M118d: the biometric gate over the whole app. While the lock is on (security settings), a cold
 * start and every long return from the background cover the app until the face/fingerprint opens
 * it. Binaries without the native module never lock (the setting also cannot be turned on there).
 */
export function AppLockGate() {
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  const tryUnlock = async () => {
    setChecking(true);
    try {
      if (await authenticate(t('security.lockPrompt'))) setLocked(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void (async () => {
      if ((await lockEnabled()) && (await lockAvailable())) {
        setLocked(true);
        void tryUnlock();
      }
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (hiddenAt.current === null) hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away < RELOCK_AFTER_MS) return;
      void (async () => {
        if ((await lockEnabled()) && (await lockAvailable())) {
          setLocked(true);
          void tryUnlock();
        }
      })();
    });
    return () => subscription.remove();
    // Mount-once gate; the handlers re-read the setting on every event.
  }, []);

  if (!locked) return null;
  return (
    <View style={styles.cover}>
      <Image source={require('../../assets/images/club-emblem.png')} style={styles.emblem} resizeMode="contain" />
      <View style={styles.row}>
        <Ionicons name="lock-closed" size={18} color={colors.gold} />
        <Text style={styles.text}>{t('security.lockedTitle')}</Text>
      </View>
      <AppButton label={t('security.unlock')} icon="finger-print-outline" loading={checking} onPress={() => void tryUnlock()} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 999,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  emblem: { width: 110, height: 110, opacity: 0.9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 26, color: colors.textPrimary, textAlign: 'center' },
});
