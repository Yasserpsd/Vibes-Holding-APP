import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';

import { authApi, type TotpSetup } from '@/api/auth';
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
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Mode = 'idle' | 'enable' | 'relink' | 'backup' | 'disable';

/**
 * M140 (owner): «حماية إضافية» — the member links ANY authenticator app (Google Authenticator, Microsoft
 * Authenticator, Authy…) and the sign-in then asks for its 6-digit code after the password. Enabling hands
 * the key once (open the authenticator straight from here, or copy the key); the first code confirms it and
 * eight backup codes show once. Re-linking, new backup codes and switching off all need a current code.
 */
export default function SecurityTotpScreen() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['totp'], queryFn: authApi.totpStatus, enabled: Boolean(me) });
  const [mode, setMode] = useState<Mode>('idle');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!me) {
    return (
      <Screen title={t('security.totpTitle')}>
        <Notice tone="warning" text={t('profile.signInFirst')} />
      </Screen>
    );
  }

  const enabled = status.data?.enabled ?? false;
  const start = (next: Mode) => {
    setMode(next);
    setCode('');
    setSetup(null);
    setCodes(null);
    setError(null);
    setDone(null);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['totp'] });

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (setup) {
        const result = await authApi.totpConfirm(setup.setupToken, code.trim());
        setSetup(null);
        setCodes(result.backupCodes);
        setDone(t('security.totpLinked'));
        await refresh();
      } else if (mode === 'enable') {
        setSetup(await authApi.totpSetup());
        setCode('');
      } else if (mode === 'relink') {
        setSetup(await authApi.totpSetup(code.trim()));
        setCode('');
      } else if (mode === 'backup') {
        const result = await authApi.totpBackup(code.trim());
        setCodes(result.backupCodes);
        setDone(t('security.totpBackupNew'));
        await refresh();
      } else if (mode === 'disable') {
        await authApi.totpDisable(code.trim());
        await refresh();
        start('idle');
        setDone(t('security.totpOff'));
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const openAuthenticator = async () => {
    if (!setup) return;
    try {
      await Linking.openURL(setup.uri);
    } catch {
      setError(t('security.totpNoApp'));
    }
  };

  const shareCodes = async () => {
    if (!codes) return;
    await Share.share({ message: `${t('security.totpBackupTitle')} — Investors Club\n${codes.join('\n')}` }).catch(() => undefined);
  };

  const needsCode = Boolean(setup) || mode === 'relink' || mode === 'backup' || mode === 'disable';
  const codeLabel = setup ? t('security.totpCodeFromApp') : t('security.totpCurrentCode');

  return (
    <Screen title={t('security.totpTitle')} subtitle={t('security.totpSubtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.gold} />
            </View>
            <Text style={styles.sectionTitle}>{t('security.totpState')}</Text>
            <View style={[styles.pill, enabled && styles.pillOn]}>
              <Text style={[styles.pillText, enabled && styles.pillTextOn]}>{status.isLoading ? '…' : enabled ? t('security.totpOn') : t('security.totpOffState')}</Text>
            </View>
          </View>
          <Text style={styles.hint}>{t('security.totpExplain')}</Text>
          {enabled && status.data ? <Text style={styles.hint}>{t('security.totpBackupLeft', { count: status.data.backupLeft })}</Text> : null}
          {done ? <Notice tone="success" text={done} /> : null}
          {mode === 'idle' ? (
            <>
              <GoldHairline />
              {enabled ? (
                <>
                  <AppButton label={t('security.totpRelink')} variant="outline" icon="phone-portrait-outline" onPress={() => start('relink')} />
                  <AppButton label={t('security.totpNewBackup')} variant="outline" icon="key-outline" onPress={() => start('backup')} />
                  <AppButton label={t('security.totpDisable')} variant="ghost" icon="close-circle-outline" onPress={() => start('disable')} />
                </>
              ) : (
                <AppButton label={t('security.totpEnable')} icon="shield-checkmark-outline" onPress={() => start('enable')} />
              )}
            </>
          ) : null}
        </GlassCard>
      </FadeInView>

      {mode !== 'idle' && !codes ? (
        <FadeInView delay={entranceDelay(1)}>
          <GlassCard radius={radii.lg} style={styles.card}>
            <Text style={styles.sectionTitle}>
              {setup ? t('security.totpLinkStep') : mode === 'enable' ? t('security.totpEnable') : mode === 'relink' ? t('security.totpRelink') : mode === 'backup' ? t('security.totpNewBackup') : t('security.totpDisable')}
            </Text>
            {setup ? (
              <>
                <Text style={styles.hint}>{t('security.totpSteps')}</Text>
                <AppButton label={t('security.totpOpenApp')} icon="open-outline" onPress={() => void openAuthenticator()} />
                <Text style={styles.hint}>{t('security.totpKeyHint')}</Text>
                <Text style={styles.secret} selectable>
                  {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
                </Text>
              </>
            ) : mode === 'enable' ? (
              <Text style={styles.hint}>{t('security.totpEnableHint')}</Text>
            ) : (
              <Text style={styles.hint}>{mode === 'disable' ? t('security.totpDisableHint') : t('security.totpCurrentHint')}</Text>
            )}
            {needsCode ? (
              <FormField
                label={codeLabel}
                latin
                autoCapitalize="characters"
                autoCorrect={false}
                textContentType="oneTimeCode"
                maxLength={9}
                value={code}
                onChangeText={(value) => setCode(value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                onSubmitEditing={() => void submit()}
                style={styles.code}
              />
            ) : null}
            {error ? <Notice tone="warning" text={error} /> : null}
            <AppButton
              label={setup ? t('security.totpConfirm') : mode === 'enable' ? t('security.totpStart') : t('auth.totp.submit')}
              icon={setup ? 'checkmark-circle-outline' : 'arrow-forward-outline'}
              loading={busy}
              disabled={needsCode && code.trim().length < 6}
              onPress={() => void submit()}
            />
            <AppButton label={t('common.cancel')} variant="ghost" onPress={() => start('idle')} />
          </GlassCard>
        </FadeInView>
      ) : null}

      {codes ? (
        <FadeInView delay={entranceDelay(1)}>
          <GlassCard radius={radii.lg} style={styles.card}>
            <Text style={styles.sectionTitle}>{t('security.totpBackupTitle')}</Text>
            <Text style={styles.hint}>{t('security.totpBackupHint')}</Text>
            <View style={styles.codes}>
              {codes.map((entry) => (
                <Text key={entry} style={styles.backupCode} selectable>
                  {entry}
                </Text>
              ))}
            </View>
            <AppButton label={t('security.totpSaveCodes')} variant="outline" icon="share-outline" onPress={() => void shareCodes()} />
            <AppButton label={t('security.totpSavedCodes')} icon="checkmark-circle-outline" onPress={() => start('idle')} />
          </GlassCard>
        </FadeInView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart, flex: 1 },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  pill: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  pillOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  pillText: { ...typography.caption, color: colors.textMuted },
  pillTextOn: { color: colors.gold },
  secret: { fontFamily: fonts.semiBold, fontSize: 16, letterSpacing: 2, color: colors.gold, textAlign: 'center', writingDirection: 'ltr' },
  code: { fontFamily: fonts.semiBold, fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  codes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  backupCode: { fontFamily: fonts.semiBold, fontSize: 16, letterSpacing: 1, color: colors.textPrimary, writingDirection: 'ltr', minWidth: '40%', textAlign: 'center' },
});
