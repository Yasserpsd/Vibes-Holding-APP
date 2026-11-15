import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { t } from '@/i18n';
import { authenticate, lockAvailable, lockEnabled } from '@/lib/appLock';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, spacing } from '@/theme/tokens';

/** How long in the background before the lock asks for the face again. */
const RELOCK_AFTER_MS = 45_000;
/** How long the opening cover waits for the saved setting before it gives way. */
const READ_TIMEOUT_MS = 4_000;

/**
 * M118d: the biometric gate over the whole app. While the lock is on (security settings), a cold
 * start and every long return from the background cover the app until the face/fingerprint opens
 * it. Binaries without the native module never lock (the setting also cannot be turned on there).
 */
export function AppLockGate() {
  // null = the setting is still being read: the cover stands without the prompt, so the app's content never shows
  // first on a cold start; false = open; true = locked, waiting for the face/fingerprint.
  const [locked, setLocked] = useState<boolean | null>(null);
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
    // The member is never trapped: a read that fails, or one that does not answer in time, means «not locked».
    const watchdog = setTimeout(() => setLocked((current) => current ?? false), READ_TIMEOUT_MS);
    void (async () => {
      let on = false;
      try {
        on = (await lockEnabled()) && (await lockAvailable());
      } catch {
        on = false;
      }
      clearTimeout(watchdog);
      setLocked(on);
      if (on) void tryUnlock();
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
    return () => {
      clearTimeout(watchdog);
      subscription.remove();
    };
    // Mount-once gate; the handlers re-read the setting on every event.
  }, []);

  if (locked === false) return null;
  // Still reading the setting: the bare cover, with no prompt and nothing to press.
  if (locked === null) return <View style={styles.cover} />;
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

const styles = themedStyles(() => ({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
}));
