import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn } from '@/components/motion';
import { CompletionForm, gateMissing } from '@/components/ProfileCompletionGate';
import { t } from '@/i18n';
import { claimAutoPopup, useAutoPopupFree, usePopupHold } from '@/lib/popupGate';
import { useWeeklyNudge } from '@/lib/weeklyNudge';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M204 (owner, 2026-11-06: «متخليش الناس تمل منك وتمسح التطبيق»): the missing-details reminder, as a light popup
 * with «لاحقًا» instead of the M147/M203 wall; it sleeps a week after «لاحقًا» and shares the M128 slot with every other
 * self-opening popup. M209: the unconfirmed-number reminder left for its own host (WhatsappVerifyHost), which opens
 * AFTER this popup and the intro film; while this popup is up it holds the screen so that one waits.
 */
export function GentlePopups() {
  const { status, me, confirmed } = useAuth();
  const pathname = usePathname();
  // `confirmed`: a popup opened from the saved account, then torn down mid-animation by a 401 sign-out, crashed Fabric
  // on Android («addViewAt: child already has a parent»); the saved copy may also be stale about the number.
  // M204 (owner: «سيب الناس القديمة زي ما هي»): an account from before the WhatsApp sign-up sees no reminder at all.
  const account = status === 'signedIn' && confirmed && me && !me.legacyAccount ? String(me.id) : null;
  const missing = gateMissing(account ? me : null);
  const data = useWeeklyNudge(account && missing.length ? `investorsclub.nudge.data.${account}` : null);
  /** The account that holds this launch's popup slot, and the one that already answered its popup. */
  const [slot, setSlot] = useState<string | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const quiet = pathname.startsWith('/auth') || pathname.startsWith('/profile-edit') || pathname.startsWith('/phone-confirm');
  const candidate = account === null || quiet ? null : data.due ? 'data' : null;
  // The intro film (and any popup already up) goes first: the claim is retried when the screen frees.
  const free = useAutoPopupFree();

  useEffect(() => {
    if (!candidate || !account || slot === account) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive && claimAutoPopup()) setSlot(account);
    });
    return () => {
      alive = false;
    };
  }, [candidate, account, slot, free]);

  const show = account !== null && slot === account && answered !== account ? candidate : null;
  usePopupHold(show !== null);
  if (!account || !show) return null;
  const close = (snooze: () => void) => {
    snooze();
    setFormOpen(false);
    setAnswered(account);
  };

  if (formOpen) return <CompletionForm missing={missing} onLater={() => close(data.snooze)} />;
  const fields = missing.map((key) => t(`dataNudge.field.${key}`)).join(t('dataNudge.separator'));
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => close(data.snooze)}>
      <View style={styles.backdrop}>
        <PopIn style={styles.wrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <View style={styles.ring}>
              <Ionicons name="person-circle-outline" size={36} color={colors.gold} />
            </View>
            <Text style={styles.title}>{t('dataNudge.title')}</Text>
            <Text style={styles.text}>{t('dataNudge.text', { fields })}</Text>
            <AppButton label={t('dataNudge.cta')} icon="create-outline" onPress={() => setFormOpen(true)} />
            <AppButton label={t('dataNudge.later')} variant="outline" onPress={() => close(data.snooze)} />
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.overlay },
  wrap: { width: '100%', maxWidth: 380 },
  card: { padding: spacing.lg, gap: spacing.sm, alignItems: 'stretch' },
  ring: { alignSelf: 'center' },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: 'center' },
  text: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
}));
