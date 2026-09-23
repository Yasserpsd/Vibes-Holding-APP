import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SocialButtons } from '@/components/SocialButtons';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, spacing, typography } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { data: config } = useAuthConfig();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!login.trim() || !password) {
      setError(t('auth.login.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.login(login.trim(), password);
      if (result.pending) {
        router.push({ pathname: '/auth/verify', params: { pendingToken: result.pendingToken, email: result.email, text: result.text } });
        return;
      }
      await signIn(result.token, result.me);
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      {config?.adminOnly ? <Notice text={t('auth.login.adminOnly')} /> : null}
      <SocialButtons onError={setError} />
      <FormField
        label={t('auth.login.field')}
        latin
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        value={login}
        onChangeText={setLogin}
        placeholder={t('auth.login.placeholder')}
      />
      <FormField
        label={t('common.password')}
        latin
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? t('auth.login.busy') : t('auth.login.submit')} icon="log-in-outline" onPress={() => (busy ? undefined : void submit())} />
      <Link href="/auth/reset" style={styles.link}>
        {t('auth.login.forgot')}
      </Link>
      {config?.registrationOpen === false ? null : (
        <AppButton label={t('auth.login.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  link: { ...typography.body, color: colors.goldLight, textAlign: 'center', paddingVertical: spacing.sm },
});
