import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { ApiError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { EMPTY_IDENTIFIER, identifierPayload, identifierPhoneProblem, identifierValid, LoginIdentifierField, type Identifier } from '@/components/LoginIdentifier';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
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
  // M126: the phone is the first-class identifier — a number from any country or an e-mail.
  const [identifier, setIdentifier] = useState<Identifier>(EMPTY_IDENTIFIER);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!identifierValid(identifier) || !password) {
      setError(t(identifier.mode === 'phone' ? 'auth.login.requiredPhone' : 'auth.login.requiredEmail'));
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
      const result = await authApi.login(login, password, country);
      if (result.pending) {
        router.push({ pathname: '/auth/verify', params: { pendingToken: result.pendingToken, email: result.email, text: result.text } });
        return;
      }
      await signIn(result.token, result.me);
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
    } catch (cause) {
      setError(errorMessage(cause));
      // M128 (owner): no account behind these details → straight to registration, with a notice there.
      if (cause instanceof ApiError && cause.code === 'no_account') {
        router.push({ pathname: '/auth/register', params: { fromLogin: '1' } });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      {config?.adminOnly ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice text={t('auth.login.adminOnly')} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(1)}>
        <SocialButtons onError={setError} />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <LoginIdentifierField value={identifier} onChange={setIdentifier} countries={config?.countries} />
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
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
      </FadeInView>
      {error ? (
        <FadeInView offset={8}>
          <Text style={styles.error}>{error}</Text>
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(4)}>
        <AppButton label={t('auth.login.submit')} icon="log-in-outline" loading={busy} onPress={() => void submit()} />
      </FadeInView>
      <FadeInView delay={entranceDelay(5)}>
        <Link href="/auth/reset" asChild>
          <PressScale>
            <Text style={styles.link}>{t('auth.login.forgot')}</Text>
          </PressScale>
        </Link>
      </FadeInView>
      {config?.registrationOpen === false ? null : (
        <FadeInView delay={entranceDelay(6)}>
          <AppButton label={t('auth.login.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  link: { ...typography.body, color: colors.goldLight, textAlign: 'center', paddingVertical: spacing.sm },
});
