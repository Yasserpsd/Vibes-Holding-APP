import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { GlassCard, GoldHairline } from '@/components/lux';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M79: the security settings of «حسابي» — change the password here, and the accident-proofed account
 * deletion lives tucked at the bottom (its own deliberate flow, /delete-account).
 */
export default function SecurityScreen() {
  const router = useRouter();
  const { me, setMe } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!me) {
    return (
      <Screen title={t('security.title')}>
        <Notice tone="warning" text={t('profile.signInFirst')} />
      </Screen>
    );
  }

  const save = async () => {
    if (busy) return;
    setSaved(false);
    if (password.length < 6) {
      setError(t('profile.passwordShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('security.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { me: updated } = await authApi.updateMe({ password });
      setMe(updated);
      setPassword('');
      setConfirm('');
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('security.title')} subtitle={t('security.subtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <Text style={styles.sectionTitle}>{t('security.changePassword')}</Text>
          <FormField
            label={t('security.newPassword')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="newPassword"
          />
          <FormField
            label={t('security.confirmPassword')}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            textContentType="newPassword"
          />
          {error ? <Notice tone="warning" text={error} /> : null}
          {saved ? <Notice tone="success" text={t('security.passwordSaved')} /> : null}
          <AppButton label={t('security.savePassword')} icon="key-outline" loading={busy} onPress={() => void save()} />
        </GlassCard>
      </FadeInView>

      {/* M79 (owner): deletion is tucked INSIDE security — never a stray tap away out in the open. */}
      <FadeInView delay={entranceDelay(1)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <Text style={styles.sectionTitle}>{t('security.dangerZone')}</Text>
          <Text style={styles.dangerText}>{t('security.deleteHint')}</Text>
          <GoldHairline />
          <AppButton label={t('account.menu.delete')} variant="outline" icon="trash-outline" onPress={() => router.push('/delete-account' as Href)} />
        </GlassCard>
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  dangerText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
});
