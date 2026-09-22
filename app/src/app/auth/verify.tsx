import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { newsApi } from '@/api/news';
import { ApiError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { hubText, t } from '@/i18n';
import { fonts } from '@/theme/tokens';

type Params = { pendingToken?: string; email?: string; text?: string; interests?: string };

export default function VerifyScreen() {
  const { pendingToken, email, text, interests } = useLocalSearchParams<Params>();
  const router = useRouter();
  const { signIn } = useAuth();
  const queryClient = useQueryClient();
  const { data: config } = useAuthConfig();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(text ? hubText(text, 'auth.verify.sent') : null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(!pendingToken);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const finish = () => {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/account');
  };

  const submit = async () => {
    if (busy || !pendingToken) return;
    if (!/^\d{6}$/.test(code)) {
      setError(t('auth.verify.codeRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.verify(pendingToken, code);
      // Interests chosen at signup are saved before the session is announced, so mounted screens
      // (the news tab) load them on their first request; a failure here must not block the account.
      const chosen = (interests ?? '').split(',').filter(Boolean);
      if (chosen.length > 0) await newsApi.savePrefs(chosen, result.token).catch(() => undefined);
      await signIn(result.token, result.me);
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      finish();
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && (cause.status === 410 || cause.status === 403)) setExpired(true);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy || cooldown > 0 || !pendingToken) return;
    setError(null);
    try {
      const result = await authApi.resend(pendingToken);
      setInfo(hubText(result.text, 'auth.verify.resent'));
      setCooldown(60);
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 410) setExpired(true);
    }
  };

  return (
    <Screen title={t('auth.verify.title')} subtitle={t('auth.verify.subtitle', { email: email || t('auth.verify.yourEmail') })}>
      {info ? <Notice tone="success" text={info} /> : null}
      {config?.testCode ? <Notice tone="warning" text={t('auth.verify.testCode', { code: config.testCode })} /> : null}
      <FormField
        label={t('auth.verify.code')}
        latin
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={6}
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
        onSubmitEditing={() => void submit()}
        error={error}
        style={styles.code}
        editable={!expired}
      />
      {expired ? (
        <AppButton label={t('auth.verify.backToLogin')} icon="arrow-undo-outline" onPress={() => router.replace('/auth/login')} />
      ) : (
        <>
          <AppButton label={busy ? t('auth.verify.busy') : t('auth.verify.submit')} icon="checkmark-circle-outline" onPress={() => void submit()} />
          <AppButton
            label={cooldown > 0 ? t('auth.verify.resendIn', { seconds: cooldown }) : t('auth.verify.resend')}
            variant="outline"
            icon="mail-outline"
            onPress={() => void resend()}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.semiBold, fontSize: 24, letterSpacing: 8, textAlign: 'center' },
});
