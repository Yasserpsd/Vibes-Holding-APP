import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { EMPTY_IDENTIFIER, identifierPayload, identifierPhoneProblem, identifierValid, LoginIdentifierField, type Identifier } from '@/components/LoginIdentifier';
import { entranceDelay, FadeInView, PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { data: config } = useAuthConfig();
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [identifier, setIdentifier] = useState<Identifier>(EMPTY_IDENTIFIER);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // M197: hub 2.26.3 names the inbox (masked) and the Apple/Google sign-up; an older hub sends neither.
  const [sent, setSent] = useState<{ sentTo: string; provider: string; via: string }>({ sentTo: '', provider: '', via: '' });
  const [resent, setResent] = useState(false);

  const request = async (again = false) => {
    if (busy) return;
    if (!identifierValid(identifier)) {
      setError(t('auth.reset.loginRequired'));
      return;
    }
    // M128: a wrong-length or wrong-start number never reaches the server.
    const phoneProblem = identifierPhoneProblem(identifier, config?.countries);
    if (phoneProblem) {
      setError(phoneProblem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { login, country } = identifierPayload(identifier);
      const result = await authApi.resetRequest(login, country);
      setSent({ sentTo: result.sentTo ?? '', provider: result.provider ?? '', via: result.via ?? '' });
      setResent(again);
      setStep('confirm');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    if (!/^\d{4,6}$/.test(code)) {
      setError(t('auth.verify.codeRequired'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.reset.passwordShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { login, country } = identifierPayload(identifier);
      await authApi.resetConfirm(login, code, password, country);
      setStep('done');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <Screen title={t('auth.reset.title')}>
        <PopIn style={styles.doneIcon}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        </PopIn>
        <FadeInView delay={entranceDelay(1)}>
          <Notice tone="success" text={t('auth.reset.done')} />
        </FadeInView>
        <FadeInView delay={entranceDelay(2)}>
          <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.replace('/auth/login')} />
        </FadeInView>
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.reset.title')}
      subtitle={
        step === 'request'
          ? t('auth.reset.subtitleRequest')
          : sent.sentTo
            ? sent.via === 'whatsapp'
              ? t('auth.reset.sentWhatsapp', { phone: `‎${sent.sentTo}‎` })
              : t('auth.reset.sentMail', { email: `‎${sent.sentTo}‎` })
            : t('auth.reset.subtitleConfirm', { login: identifier.value.trim() })
      }
    >
      <FadeInView key={step} style={styles.fields}>
        {step === 'confirm' && config?.testCode ? <Notice tone="warning" text={t('auth.verify.testCode', { code: config.testCode })} /> : null}
        {step === 'confirm' && sent.provider ? <Notice tone="info" text={t('auth.reset.socialNote', { provider: sent.provider === 'apple' ? 'Apple' : 'Google' })} /> : null}
        {step === 'confirm' && resent ? <Notice tone="success" text={t('auth.reset.resent')} /> : null}
        <LoginIdentifierField value={identifier} onChange={setIdentifier} countries={config?.countries} editable={step === 'request'} />
        {step === 'confirm' ? (
          <>
            <FormField label={t('auth.verify.code')} latin keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} />
            <FormField label={t('auth.reset.newPassword')} latin secureTextEntry autoCapitalize="none" textContentType="newPassword" value={password} onChangeText={setPassword} hint={t('auth.register.passwordHint')} />
          </>
        ) : null}
      </FadeInView>
      {error ? (
        <FadeInView offset={8}>
          <Text style={styles.error}>{error}</Text>
          <SupportLink problem={error} />
        </FadeInView>
      ) : null}
      {step === 'request' ? (
        <FadeInView key="request-submit" delay={entranceDelay(1)}>
          <AppButton label={t('auth.reset.send')} icon="logo-whatsapp" loading={busy} onPress={() => void request()} />
        </FadeInView>
      ) : (
        <FadeInView key="confirm-submit" delay={entranceDelay(1)}>
          <AppButton label={t('auth.reset.save')} icon="key-outline" loading={busy} onPress={() => void confirm()} />
          <Pressable accessibilityRole="button" onPress={() => void request(true)} disabled={busy} style={styles.resend} hitSlop={8}>
            <Text style={styles.resendText}>{t('auth.reset.resend')}</Text>
          </Pressable>
          {/* M204 (owner): WhatsApp only, with no e-mail way out; a member the code cannot reach writes to the support line. */}
          <SupportLink problem={t('auth.reset.noCode')} />
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  fields: { gap: spacing.md },
  doneIcon: { alignSelf: 'center', marginTop: spacing.md },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  resend: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.xs },
  resendText: { ...typography.caption, color: colors.gold, textDecorationLine: 'underline' },
}));
