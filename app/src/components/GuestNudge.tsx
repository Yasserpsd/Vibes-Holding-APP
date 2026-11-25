import { useRouter, useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { useAuthConfig } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { useGuestGate } from '@/auth/GuestGate';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { claimAutoPopup, useAutoPopupFree, usePopupHold } from '@/lib/popupGate';
import { themedStyles } from '@/theme/styles';
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
  // M277: with the quick entry one button is enough — the number field signs in and opens an account alike.
  const quickEntry = Boolean(useAuthConfig().data?.quickEntry);
  const segments = useSegments();
  const { status } = useAuth();
  const { locked, ready } = useGuestGate();
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);
  const { height: windowHeight } = useWindowDimensions();
  // M128 (owner): one self-opening popup per launch. The nudge waits while another popup is up (or the forced-update
  // cover), takes the launch's slot, and holds the screen while open so nothing (the workshop ad) opens on top of it.
  const free = useAutoPopupFree();
  usePopupHold(visible);

  const first = segments[0];
  const atGate = first === 'welcome' || first === 'auth';
  const browsing = status === 'guest' && ready && !locked && !atGate;

  useEffect(() => {
    if (!browsing || !free || shown.current) return;
    const timer = setTimeout(() => {
      // The slot is taken (another automatic popup already opened this launch) or a popup is up right now: no nudge.
      if (!claimAutoPopup()) return;
      shown.current = true;
      setVisible(true);
    }, NUDGE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [browsing, free]);

  const dismiss = () => setVisible(false);
  const go = (path: '/auth/register' | '/auth/login') => {
    setVisible(false);
    router.push(path);
  };

  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible={visible} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          {/* 2026-11-16 (members: «كلام بيختفي»): on a short screen or with large system text the card stops at 88% of
              the window — the words scroll inside it and the buttons stay in view (the WorkshopAd treatment). */}
          <GlassCard golden radius={radii.xxl} style={[styles.card, { maxHeight: Math.round(windowHeight * 0.88) }]}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} bounces={false}>
              <Text style={styles.title}>{t('guestNudge.title')}</Text>
              <Text style={styles.text}>{t('guestNudge.text')}</Text>
            </ScrollView>
            <AppButton label={t('guestNudge.register')} icon="person-add-outline" onPress={() => go(quickEntry ? '/auth/login' : '/auth/register')} />
            {quickEntry ? null : <AppButton label={t('guestNudge.signIn')} variant="outline" icon="log-in-outline" onPress={() => go('/auth/login')} />}
            <PressScale onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('guestNudge.later')}>
              <Text style={styles.later}>{t('guestNudge.later')}</Text>
            </PressScale>
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
  card: { gap: spacing.sm, padding: spacing.md },
  // The text part gives way first when the card reaches its cap; the buttons under it keep their height.
  scroll: { flexGrow: 0 },
  scrollContent: { gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  later: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs },
}));
