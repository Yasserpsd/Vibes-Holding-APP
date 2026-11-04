import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Switch, Text, View, type ScrollView } from 'react-native';

import { authApi } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { ErrorSummary } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { GlassCard, GoldHairline } from '@/components/lux';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { authenticate, loadLocalAuth, lockAvailable, lockEnabled, setLockEnabled } from '@/lib/appLock';
import type { IoniconName } from '@/lib/icons';
import { themedStyles } from '@/theme/styles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M79: the security settings of «حسابي» — change the password here.
 * M118d (owner): the biometric APP LOCK leads the screen, and everything sharp (delete account,
 * report a problem) hides one level deeper behind «إعدادات أمان إضافية».
 * M198 (owner, 2026-11-04: «انقل تغيير كلمة المرور من تعديل بيانات حسابي … حطها في إعدادات الأمان»):
 * this is now the ONLY place the password changes, in the M195 form identity (navy/gold dark card,
 * red errors under the fields, a summary on top).
 */
export default function SecurityScreen() {
  const router = useRouter();
  const { me, setMe } = useAuth();
  const scrollRef = useRef<ScrollView | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useFormErrors<'password' | 'confirm'>(scrollRef);
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
    setError(null);
    const next: Partial<Record<'password' | 'confirm', string>> = {};
    if (password.length < 6) next.password = t('profile.passwordShort');
    else if (password !== confirm) next.confirm = t('security.passwordMismatch');
    if (form.fail(next, ['password', 'confirm'])) return;
    setBusy(true);
    try {
      const { me: updated } = await authApi.updateMe({ password });
      setMe(updated);
      setPassword('');
      setConfirm('');
      form.reset();
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('security.title')} subtitle={t('security.subtitle')} scrollRef={scrollRef}>
      {/* M118d: the app lock first — the face opens the app. */}
      <FadeInView delay={entranceDelay(0)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <CardTitle icon="finger-print-outline" title={t('security.lockTitle')} />
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

      {/* M198: the password form in the club's form identity (M195) — the only place it changes now. */}
      <FadeInView delay={entranceDelay(1)}>
        <FormCard tone="dark">
          <CardTitle icon="key-outline" title={t('security.changePassword')} />
          <ErrorSummary count={form.count} />
          <FormField
            label={t('security.newPassword')}
            hint={t('security.passwordHint')}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              form.clear('password');
            }}
            error={form.errors.password}
            anchorRef={form.anchor('password')}
            latin
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
          />
          <FormField
            label={t('security.confirmPassword')}
            value={confirm}
            onChangeText={(value) => {
              setConfirm(value);
              form.clear('confirm');
            }}
            error={form.errors.confirm}
            anchorRef={form.anchor('confirm')}
            latin
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
          />
          {error ? <Notice tone="warning" text={error} support /> : null}
          {saved ? <Notice tone="success" text={t('security.passwordSaved')} /> : null}
          <AppButton label={t('security.savePassword')} icon="key-outline" loading={busy} onPress={() => void save()} />
        </FormCard>
      </FadeInView>

      {/* M140 (owner): «حماية إضافية» — any authenticator app as the second step of the sign-in. */}
      <FadeInView delay={entranceDelay(2)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <CardTitle icon="shield-checkmark-outline" title={t('security.totpTitle')} />
          <Text style={styles.lockHint}>{t('security.totpCardHint')}</Text>
          <GoldHairline />
          <AppButton label={t('security.totpOpen')} variant="outline" icon="shield-checkmark-outline" onPress={() => router.push('/security-2fa' as Href)} />
        </GlassCard>
      </FadeInView>

      {/* M118d (owner): the sharp things live one level deeper, out of a stray tap's reach. */}
      <FadeInView delay={entranceDelay(3)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <CardTitle icon="settings-outline" title={t('security.extraTitle')} />
          <Text style={styles.dangerText}>{t('security.extraHint')}</Text>
          <GoldHairline />
          <AppButton label={t('security.extraOpen')} variant="outline" icon="settings-outline" onPress={() => router.push('/security-extra' as Href)} />
        </GlassCard>
      </FadeInView>
    </Screen>
  );
}

/** Icons pass: each security card leads with its own small golden icon badge. */
function CardTitle({ icon, title }: { icon: IoniconName; title: string }) {
  return (
    <View style={styles.cardTitleRow}>
      <View style={styles.cardTitleIcon}>
        <Ionicons name={icon} size={16} color={colors.gold} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { gap: spacing.sm, padding: spacing.md },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitleIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
  },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart, flex: 1 },
  dangerText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lockText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  lockHint: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
}));
