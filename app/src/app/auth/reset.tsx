import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, typography } from '@/theme/tokens';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { data: config } = useAuthConfig();
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (busy) return;
    if (login.trim().length < 3) {
      setError(t('auth.reset.loginRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.resetRequest(login.trim());
      setStep('confirm');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
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
      await authApi.resetConfirm(login.trim(), code, password);
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
        <Notice tone="success" text={t('auth.reset.done')} />
        <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.replace('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.reset.title')}
      subtitle={step === 'request' ? t('auth.reset.subtitleRequest') : t('auth.reset.subtitleConfirm', { login: login.trim() })}
    >
      {step === 'confirm' && config?.testCode ? <Notice tone="warning" text={t('auth.verify.testCode', { code: config.testCode })} /> : null}
      <FormField
        label={t('auth.login.field')}
        latin
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={login}
        onChangeText={setLogin}
        editable={step === 'request'}
      />
      {step === 'confirm' ? (
        <>
          <FormField label={t('auth.verify.code')} latin keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} />
          <FormField label={t('auth.reset.newPassword')} latin secureTextEntry autoCapitalize="none" textContentType="newPassword" value={password} onChangeText={setPassword} hint={t('auth.register.passwordHint')} />
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {step === 'request' ? (
        <AppButton label={busy ? t('auth.reset.sending') : t('auth.reset.send')} icon="mail-outline" onPress={() => void request()} />
      ) : (
        <AppButton label={busy ? t('auth.reset.saving') : t('auth.reset.save')} icon="key-outline" onPress={() => void confirm()} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
});
