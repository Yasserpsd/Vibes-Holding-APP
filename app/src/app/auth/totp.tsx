import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { authApi } from '@/api/auth';
import { ApiError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { colors, fonts, shadows, spacing } from '@/theme/tokens';

type Params = { stepToken?: string };

/** M140: the account switched «حماية إضافية» on — the sign-in ends with the code of its authenticator app (or a backup code). */
export default function TotpScreen() {
  const { stepToken } = useLocalSearchParams<Params>();
  const router = useRouter();
  const { signIn } = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(!stepToken);
  const [focused, setFocused] = useState(false);

  const submit = async () => {
    if (busy || !stepToken) return;
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed) && !/^[A-Z2-7]{4}-?[A-Z2-7]{4}$/i.test(trimmed)) {
      setError(t('auth.totp.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.totp(stepToken, trimmed);
      await signIn(result.token, result.me);
      void queryClient.invalidateQueries();
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && (cause.status === 410 || cause.status === 429)) setExpired(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('auth.totp.title')} subtitle={t('auth.totp.subtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <Notice text={expired ? t('auth.totp.expired') : t('auth.totp.hint')} tone={expired ? 'warning' : 'info'} />
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <FormField
          label={t('auth.totp.code')}
          latin
          autoCapitalize="characters"
          autoCorrect={false}
          textContentType="oneTimeCode"
          maxLength={9}
          value={code}
          onChangeText={(value) => setCode(value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
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
        <FadeInView delay={entranceDelay(2)}>
          <AppButton label={t('auth.totp.submit')} icon="shield-checkmark-outline" loading={busy} onPress={() => void submit()} />
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.semiBold, fontSize: 26, letterSpacing: 6, textAlign: 'center' },
  codeFocused: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  spacer: { height: spacing.sm },
});
