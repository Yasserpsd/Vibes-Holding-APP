import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

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
import { authenticate, loadLocalAuth, lockAvailable, lockEnabled, setLockEnabled } from '@/lib/appLock';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M79: the security settings of «حسابي» — change the password here.
 * M118d (owner): the biometric APP LOCK leads the screen, and everything sharp (delete account,
 * report a problem) hides one level deeper behind «إعدادات أمان إضافية».
 */
export default function SecurityScreen() {
  const router = useRouter();
  const { me, setMe } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // M118d: the biometric lock — 'off' binary (pre-lock build), 'unenrolled' device, or ready.
  const [lockState, setLockState] = useState<'loading' | 'missing' | 'unenrolled' | 'ready'>('loading');
  const [lockOn, setLockOn] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!loadLocalAuth()) {
        setLockState('missing');
        return;
      }
      const available = await lockAvailable();
      setLockOn(await lockEnabled());
      setLockState(available ? 'ready' : 'unenrolled');
    })();
  }, []);

  const toggleLock = async (next: boolean) => {
    if (lockBusy) return;
    setLockBusy(true);
    try {
      // Turning it ON asks for the face first, so nobody locks an app he cannot open.
      if (next && !(await authenticate(t('security.lockPrompt')))) return;
      await setLockEnabled(next);
      setLockOn(next);
    } finally {
      setLockBusy(false);
    }
  };

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
      {/* M118d: the app lock first — the face opens the app. */}
      <FadeInView delay={entranceDelay(0)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <Text style={styles.sectionTitle}>{t('security.lockTitle')}</Text>
          {lockState === 'ready' ? (
            <View style={styles.lockRow}>
              <Text style={styles.lockText}>{t('security.lockToggle')}</Text>
              <Switch
                value={lockOn}
                disabled={lockBusy}
                onValueChange={(next) => void toggleLock(next)}
                trackColor={{ true: colors.gold, false: colors.border }}
                thumbColor={colors.textPrimary}
              />
            </View>
          ) : lockState === 'unenrolled' ? (
            <Text style={styles.lockHint}>{t('security.lockEnrollFirst')}</Text>
          ) : lockState === 'missing' ? (
            <Text style={styles.lockHint}>{t('security.lockNextUpdate')}</Text>
          ) : null}
          {lockState === 'ready' ? <Text style={styles.lockHint}>{t('security.lockHint')}</Text> : null}
        </GlassCard>
      </FadeInView>

      <FadeInView delay={entranceDelay(1)}>
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

      {/* M118d (owner): the sharp things live one level deeper, out of a stray tap's reach. */}
      <FadeInView delay={entranceDelay(2)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <Text style={styles.sectionTitle}>{t('security.extraTitle')}</Text>
          <Text style={styles.dangerText}>{t('security.extraHint')}</Text>
          <GoldHairline />
          <AppButton label={t('security.extraOpen')} variant="outline" icon="settings-outline" onPress={() => router.push('/security-extra' as Href)} />
        </GlassCard>
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  dangerText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lockText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  lockHint: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
});
