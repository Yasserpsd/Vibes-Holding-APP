import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Text, View } from 'react-native';

import { authApi, type AuthConfig } from '@/api/auth';
import { ApiError } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { EMPTY_IDENTIFIER, identifierPhoneProblem, identifierValid, LoginIdentifierField, type Identifier } from '@/components/LoginIdentifier';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { passwordRoad, quickStepPath } from '@/lib/quickEntry';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * M272, second place (owner, 2026-11-25, on the account tab of a phone that had once chosen «المتابعة كضيف» and so
 * never meets the gate again: «هو الدخول السريع اللي اتفقنا عليه فين؟»): the gate's one number field, wherever a
 * guest is asked to sign in. An account gets its WhatsApp code; a new number gets the proof and the short form —
 * the same road as the gate (`/api/auth/quick/start`), with the e-mail and password way one small link below.
 */
export function QuickEntryForm({ config, onRefused }: { config: AuthConfig | undefined; onRefused?: () => void }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState<Identifier>(EMPTY_IDENTIFIER);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    if (busy) return;
    const problem = !identifierValid(identifier) ? t('quick.numberRequired') : identifierPhoneProblem(identifier, config?.countries);
    if (problem) {
      setFailure({ message: problem, code: 'local' });
      return;
    }
    const number = identifier.value.trim();
    setBusy(true);
    setFailure(null);
    try {
      const step = await authApi.quickStart(number, identifier.country);
      Keyboard.dismiss();
      router.push(quickStepPath(step, number, identifier.country));
    } catch (cause) {
      Keyboard.dismiss();
      // The server switched the field off since this screen was drawn: the caller falls back to its buttons.
      if (cause instanceof ApiError && cause.code === 'code_login_off') onRefused?.();
      const road = passwordRoad(cause, number, identifier.country);
      if (road) router.push(road);
      else setFailure(failureOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <LoginIdentifierField
        phoneOnly
        value={identifier}
        onChange={(value) => {
          setIdentifier(value);
          setFailure(null);
        }}
        onSubmit={() => void enter()}
        countries={config?.countries}
      />
      {failure ? <FormFailure failure={failure} onRetry={() => void enter()} /> : null}
      <AppButton label={t('quick.submit')} icon="logo-whatsapp" loading={busy} onPress={() => void enter()} />
      <PressScale onPress={() => router.push('/auth/login?password=1')} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.link}>{t('quick.withPassword')}</Text>
      </PressScale>
    </View>
  );
}

const styles = themedStyles(() => ({
  form: { gap: spacing.sm + 4 },
  link: { ...typography.body, color: colors.goldLightText, textAlign: 'center', paddingVertical: spacing.xs },
}));
