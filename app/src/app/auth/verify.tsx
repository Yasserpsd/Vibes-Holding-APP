import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { interestsApi } from '@/api/interests';
import { ApiError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView, GrowBar } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { hubText, t } from '@/i18n';
import { colors, fonts, shadows, spacing } from '@/theme/tokens';

type Params = { pendingToken?: string; email?: string; text?: string; interests?: string; interestsOther?: string };

export default function VerifyScreen() {
  const { pendingToken, email, text, interests, interestsOther } = useLocalSearchParams<Params>();
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
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // M78 (owner): «اي حد يسجل بعديها يظهرله بوابة الدفع مباشر» — a fresh account lands straight
  // on the membership screen (its payment lives there: the store sheet in-app, rule 3).
  const finish = () => {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/membership');
  };

  const submit = async () => {
    if (busy || !pendingToken) return;
    if (!/^\d{4,6}$/.test(code)) {
      setError(t('auth.verify.codeRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.verify(pendingToken, code);
      // M140: an account with an authenticator app finishes on its code screen.
      if ('totp' in result) {
        router.push(`/auth/totp?stepToken=${encodeURIComponent(result.stepToken)}` as Href);
        return;
      }
      // Interests chosen at signup are saved before the session is announced, so mounted screens
      // (the news tab) load them on their first request; a failure here must not block the account.
      const chosen = (interests ?? '').split(',').filter(Boolean);
      if (chosen.length > 0) await interestsApi.save({ keys: chosen, other: interestsOther || undefined }, result.token).catch(() => undefined);
      await signIn(result.token, result.me);
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      void queryClient.invalidateQueries({ queryKey: ['interests'] });
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
      {info ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="success" text={info} />
        </FadeInView>
      ) : null}
      {config?.testCode ? (
        <FadeInView delay={entranceDelay(1)}>
          <Notice tone="warning" text={t('auth.verify.testCode', { code: config.testCode })} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(2)}>
        <FormField
          label={t('auth.verify.code')}
          latin
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          onSubmitEditing={() => void submit()}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          error={error}
          style={[styles.code, focused && styles.codeFocused]}
          editable={!expired}
        />
      </FadeInView>
      {expired ? (
        <FadeInView offset={8}>
          <AppButton label={t('auth.verify.backToLogin')} icon="arrow-undo-outline" onPress={() => router.replace('/auth/login')} />
        </FadeInView>
      ) : (
        <>
          <FadeInView delay={entranceDelay(3)}>
            <AppButton label={t('auth.verify.submit')} icon="checkmark-circle-outline" loading={busy} onPress={() => void submit()} />
          </FadeInView>
          <FadeInView delay={entranceDelay(4)} style={styles.resendBlock}>
            <AppButton
              label={cooldown > 0 ? t('auth.verify.resendIn', { seconds: cooldown }) : t('auth.verify.resend')}
              variant="outline"
              icon="mail-outline"
              onPress={() => void resend()}
            />
            {cooldown > 0 ? <GrowBar percent={(cooldown / 60) * 100} height={4} /> : null}
          </FadeInView>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The one-time code reads like a minted number: large, centered, spaced.
  code: { fontFamily: fonts.semiBold, fontSize: 28, letterSpacing: 10, textAlign: 'center' },
  // While typing, the box lights up with the golden focus halo.
  codeFocused: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  resendBlock: { gap: spacing.sm },
});
