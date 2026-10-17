import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { authApi } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** M79 (owner): the deliberate flow — a reason or a message FIRST, then the final password confirm. */
const REASON_KEYS = ['notUsing', 'notFound', 'otherAccount', 'support', 'other'] as const;
type ReasonKey = (typeof REASON_KEYS)[number];

export default function DeleteAccountScreen() {
  const { me, signOut } = useAuth();
  const [reason, setReason] = useState<ReasonKey | null>(null);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) {
    return (
      <Screen title={t('deleteAccount.title')}>
        <Notice tone="warning" text={t('profile.signInFirst')} />
      </Screen>
    );
  }

  // The owner's accident-proofing: nothing moves until a reason is picked or a message written.
  const ready = reason !== null && (reason !== 'other' || message.trim().length > 0);
  const reasonText = (): string => {
    const picked = reason && reason !== 'other' ? t(`deleteAccount.reason.${reason}`) : '';
    const written = message.trim();
    return [picked, written].filter(Boolean).join(' — ');
  };

  const confirmDelete = async (password: string) => {
    if (!password) {
      setError(t('account.delete.passwordRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.deleteMe(password, reasonText());
      setConfirming(false);
      await signOut();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('deleteAccount.title')} subtitle={t('deleteAccount.subtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <Notice tone="warning" text={t('deleteAccount.warning')} />
      </FadeInView>

      <FadeInView delay={entranceDelay(1)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <Text style={styles.sectionTitle}>{t('deleteAccount.why')}</Text>
          {REASON_KEYS.map((key) => (
            <PressScale key={key} onPress={() => setReason(key)} style={styles.reasonRow} accessibilityRole="radio" accessibilityState={{ selected: reason === key }}>
              <Ionicons name={reason === key ? 'radio-button-on' : 'radio-button-off'} size={20} color={reason === key ? colors.gold : colors.textMuted} />
              <Text style={[styles.reasonLabel, reason === key && styles.reasonChosen]}>{t(`deleteAccount.reason.${key}`)}</Text>
            </PressScale>
          ))}
          <FormField
            label={t('deleteAccount.message')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
            maxLength={500}
            placeholder={t('deleteAccount.messagePlaceholder')}
          />
        </GlassCard>
      </FadeInView>

      <FadeInView delay={entranceDelay(2)}>
        <View style={styles.actions}>
          <AppButton label={t('deleteAccount.continue')} variant="outline" icon="trash-outline" disabled={!ready} onPress={() => setConfirming(true)} />
          {!ready ? <Text style={styles.hint}>{t('deleteAccount.pickFirst')}</Text> : null}
        </View>
      </FadeInView>

      <PasswordPrompt
        visible={confirming}
        title={t('account.delete.title')}
        message={t('account.delete.message')}
        confirmLabel={t('account.delete.confirm')}
        busy={busy}
        error={error}
        onConfirm={(password) => void confirmDelete(password)}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs + 2 },
  reasonLabel: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart },
  reasonChosen: { color: colors.textPrimary },
  actions: { gap: spacing.xs },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
