import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { authApi, phoneStepPath, useAuthConfig } from '@/api/auth';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { FormField } from '@/components/FormField';
import { EMPTY_IDENTIFIER, identifierPayload, identifierPhoneProblem, identifierValid, LoginIdentifierField, type Identifier } from '@/components/LoginIdentifier';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { passwordRoad, quickStepPath } from '@/lib/quickEntry';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SocialButtons } from '@/components/SocialButtons';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, sessionExpired, dismissSessionExpired } = useAuth();
  const { data: config } = useAuthConfig();
  // The «انتهت الجلسة» line is shown once: it is forgotten when the member leaves this screen.
  useEffect(() => dismissSessionExpired, [dismissSessionExpired]);
  // M126: the phone is the first-class identifier — a number from any country or an e-mail.
  // M253: the sign-up form sends a member who already has an account here, with the address filled in.
  // M272: the gate sends `password=1` (its «e-mail or password» line), or a number the code could not open, with the
  // server's sentence in `why`; `confirm=1` = this password sign-in must prove that number too.
  const params = useLocalSearchParams<{ email?: string; number?: string; country?: string; why?: string; confirm?: string; password?: string }>();
  const knownEmail = params.email;
  const [identifier, setIdentifier] = useState<Identifier>(() => {
    if (knownEmail) return { mode: 'email', country: 'sa', value: knownEmail };
    return params.number ? { mode: 'phone', country: params.country ?? EMPTY_IDENTIFIER.country, value: params.number } : EMPTY_IDENTIFIER;
  });
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  // M272: the number a code sign-in was just refused (here or at the gate): its password sign-in proves it too.
  const [mustProve, setMustProve] = useState(params.confirm === '1' ? params.number : undefined);
  const [usePassword, setUsePassword] = useState(Boolean(knownEmail || params.why || params.password));

  const submit = async () => {
    if (!identifierValid(identifier) || !password) {
      setFailure({ message: t(identifier.mode === 'phone' ? 'auth.login.requiredPhone' : 'auth.login.requiredEmail'), code: 'local' });
      return;
    }
    // M128: a wrong-length or wrong-start number never reaches the server.
    const phoneProblem = identifierPhoneProblem(identifier, config?.countries);
    if (phoneProblem) {
      setFailure({ message: phoneProblem, code: 'local' });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const { login, country } = identifierPayload(identifier);
      const result = await authApi.login(login, password, country, identifier.mode === 'phone' && identifier.value.trim() === mustProve);
      if (result.pending) {
        router.push({ pathname: '/auth/verify', params: { pendingToken: result.pendingToken, email: result.email, text: result.text } });
        return;
      }
      // M140: the account has an authenticator app — its code ends the sign-in.
      if ('totp' in result) {
        router.push(`/auth/totp?stepToken=${encodeURIComponent(result.stepToken)}` as Href);
        return;
      }
      // M203: the password was right; the WhatsApp code ends the sign-in.
      if ('phoneStep' in result) {
        router.push(phoneStepPath(result) as Href);
        return;
      }
      await signIn(result.token, result.me);
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
    } catch (cause) {
      setFailure(failureOf(cause));
      // M128 (owner): no account behind these details → straight to registration, with a notice there.
      // M272: a number is not sent to the long form — the button under the sentence starts the quick sign-up.
      if (cause instanceof ApiError && cause.code === 'no_account' && !(config?.quickEntry && identifier.mode === 'phone')) {
        router.push({ pathname: '/auth/register', params: { fromLogin: '1' } });
      }
    } finally {
      setBusy(false);
    }
  };

  // M259 (owner, 2026-11-19: «الدخول برمز واتساب بدل كلمة المرور»): the number and a four-digit WhatsApp code sign the
  // member in — nothing to remember. Offered only where the server says it can (a proven number; the server refuses
  // the rest with the sentence that says to use the password once).
  const codeLogin = async () => {
    if (busy || codeBusy) return;
    if (!identifierValid(identifier)) {
      setFailure({ message: t('auth.login.requiredPhone'), code: 'local' });
      return;
    }
    const phoneProblem = identifierPhoneProblem(identifier, config?.countries);
    if (phoneProblem) {
      setFailure({ message: phoneProblem, code: 'local' });
      return;
    }
    setCodeBusy(true);
    setFailure(null);
    const { login, country } = identifierPayload(identifier);
    try {
      // M272: one road for both — an account gets its sign-in code, a new number goes on to the short sign-up.
      if (config?.quickEntry) {
        router.push(quickStepPath(await authApi.quickStart(login, country ?? identifier.country), login, country ?? identifier.country));
        return;
      }
      const step = await authApi.codeLoginStart(login, country ?? identifier.country);
      router.push(`${phoneStepPath(step)}&flow=code` as Href);
    } catch (cause) {
      // A number that belongs to an account already: the password field opens, with the sentence that says why.
      if (passwordRoad(cause, login, country ?? identifier.country)) setUsePassword(true);
      if (cause instanceof ApiError && cause.code === 'code_login_password') setMustProve(login);
      setFailure(failureOf(cause));
      if (cause instanceof ApiError && cause.code === 'no_account') router.push({ pathname: '/auth/register', params: { fromLogin: '1' } });
    } finally {
      setCodeBusy(false);
    }
  };
  const codeLoginShown = Boolean(config?.codeLogin) && identifier.mode === 'phone';
  const newNumber = Boolean(config?.quickEntry) && identifier.mode === 'phone' && failure?.code === 'no_account';
  // M262 (owner, 2026-11-22: «الدخول يكون برقم واتس اب علي طول»): where the code sign-in works, it IS the sign-in —
  // the number and one gold button, nothing to remember. The password waits behind «الدخول بكلمة المرور» (and shows
  // by itself for an e-mail, for an address handed over by the sign-up form, and when the server says this account
  // must use its password).
  const codeFirst = codeLoginShown && !usePassword;

  return (
    <Screen title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      {/* The saved session was refused when the app opened: say why the member must sign in again, once. */}
      {sessionExpired ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="warning" text={t('errors.code.session_expired')} />
        </FadeInView>
      ) : null}
      {params.why ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="warning" text={params.why} />
        </FadeInView>
      ) : null}
      {config?.adminOnly ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice text={t('auth.login.adminOnly')} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(1)}>
        <SocialButtons onError={(message) => setFailure({ message, code: 'social' })} />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <LoginIdentifierField value={identifier} onChange={setIdentifier} countries={config?.countries} />
      </FadeInView>
      {codeFirst ? null : (
      <FadeInView delay={entranceDelay(3)}>
        <FormField
          label={t('common.password')}
          latin
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
      </FadeInView>
      )}
      {/* M253: the refusal with the button that ends it — a new password for a wrong one, another try for a lost connection. */}
      {failure ? (
        <FadeInView offset={8}>
          <FormFailure
            failure={failure}
            onRetry={() => void (codeFirst ? codeLogin() : submit())}
            actions={[
              failure.code === 'bad_login' || failure.code === 'bad_password' ? { label: t('auth.login.forgot'), icon: 'key-outline', onPress: () => router.push('/auth/reset') } : null,
              newNumber ? { label: t('quick.createWithCode'), icon: 'logo-whatsapp', onPress: () => void codeLogin() } : null,
            ]}
          />
        </FadeInView>
      ) : null}
      {codeFirst ? (
        <>
          <FadeInView delay={entranceDelay(4)}>
            <AppButton label={t('auth.login.withCode')} icon="logo-whatsapp" loading={codeBusy} onPress={() => void codeLogin()} />
          </FadeInView>
          <FadeInView delay={entranceDelay(5)}>
            <PressScale onPress={() => setUsePassword(true)} accessibilityRole="button">
              <Text style={styles.link}>{t('auth.login.withPassword')}</Text>
            </PressScale>
          </FadeInView>
        </>
      ) : (
        <>
          <FadeInView delay={entranceDelay(4)}>
            <AppButton label={t('auth.login.submit')} icon="log-in-outline" loading={busy} onPress={() => void submit()} />
          </FadeInView>
          {codeLoginShown ? (
            <FadeInView delay={entranceDelay(4)}>
              <AppButton label={t('auth.login.withCode')} variant="outline" icon="logo-whatsapp" loading={codeBusy} onPress={() => void codeLogin()} />
            </FadeInView>
          ) : null}
          <FadeInView delay={entranceDelay(5)}>
            <Link href="/auth/reset" asChild>
              <PressScale>
                <Text style={styles.link}>{t('auth.login.forgot')}</Text>
              </PressScale>
            </Link>
          </FadeInView>
        </>
      )}
      {config?.registrationOpen === false ? null : (
        <FadeInView delay={entranceDelay(6)}>
          <AppButton label={t('auth.login.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  link: { ...typography.body, color: colors.goldLightText, textAlign: 'center', paddingVertical: spacing.sm },
}));
