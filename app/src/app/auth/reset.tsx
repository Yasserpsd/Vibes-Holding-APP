import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { EMPTY_IDENTIFIER, identifierPayload, identifierPhoneProblem, identifierValid, LoginIdentifierField, type Identifier } from '@/components/LoginIdentifier';
import { entranceDelay, FadeInView, PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
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

  const request = async () => {
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
      await authApi.resetRequest(login, country);
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
      subtitle={step === 'request' ? t('auth.reset.subtitleRequest') : t('auth.reset.subtitleConfirm', { login: identifier.value.trim() })}
    >
      <FadeInView key={step} style={styles.fields}>
        {step === 'confirm' && config?.testCode ? <Notice tone="warning" text={t('auth.verify.testCode', { code: config.testCode })} /> : null}
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
        </FadeInView>
      ) : null}
      {step === 'request' ? (
        <FadeInView key="request-submit" delay={entranceDelay(1)}>
          <AppButton label={t('auth.reset.send')} icon="mail-outline" loading={busy} onPress={() => void request()} />
        </FadeInView>
      ) : (
        <FadeInView key="confirm-submit" delay={entranceDelay(1)}>
          <AppButton label={t('auth.reset.save')} icon="key-outline" loading={busy} onPress={() => void confirm()} />
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  doneIcon: { alignSelf: 'center', marginTop: spacing.md },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
});
