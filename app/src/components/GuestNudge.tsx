import { useRouter, useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { useGuestGate } from '@/auth/GuestGate';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** M74: after the guest has browsed around a bit, a soft (dismissible) invitation to create an account. */
const NUDGE_AFTER_MS = 90_000;

/**
 * The soft registration pop-up of the guest week: it appears once per launch after the visitor has
 * wandered a while, invites him to create an account, and steps aside so he keeps browsing. Never
 * shown to signed-in members or over the gate/auth screens.
 */
export function GuestNudge() {
  const router = useRouter();
  const segments = useSegments();
  const { status } = useAuth();
  const { locked, ready } = useGuestGate();
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);

  const first = segments[0];
  const atGate = first === 'welcome' || first === 'auth';
  const browsing = status === 'guest' && ready && !locked && !atGate;

  useEffect(() => {
    if (!browsing || shown.current) return;
    const timer = setTimeout(() => {
      shown.current = true;
      setVisible(true);
    }, NUDGE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [browsing]);

  const dismiss = () => setVisible(false);
  const go = (path: '/auth/register' | '/auth/login') => {
    setVisible(false);
    router.push(path);
  };

  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <Text style={styles.title}>{t('guestNudge.title')}</Text>
            <Text style={styles.text}>{t('guestNudge.text')}</Text>
            <AppButton label={t('guestNudge.register')} icon="person-add-outline" onPress={() => go('/auth/register')} />
            <AppButton label={t('guestNudge.signIn')} variant="outline" icon="log-in-outline" onPress={() => go('/auth/login')} />
            <PressScale onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('guestNudge.later')}>
              <Text style={styles.later}>{t('guestNudge.later')}</Text>
            </PressScale>
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
  card: { gap: spacing.sm, padding: spacing.md },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  later: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs },
});
