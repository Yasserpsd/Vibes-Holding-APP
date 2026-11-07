import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { authApi, type PhoneStepResult } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

/** Where the number stands: nothing yet, a code on its way, or proven (the token the sign-up carries). */
export type PhoneProofState = { kind: 'code'; step: PhoneStepResult } | { kind: 'done'; token: string } | null;

type Props = {
  phone: string;
  country: string;
  state: PhoneProofState;
  onChange: (state: PhoneProofState) => void;
  /** Paints the number's own error and answers whether a code may leave for it. */
  check: () => boolean;
  /** M212: the button shows only once the number is complete and right; before that nothing is drawn. */
  ready: boolean;
};

/**
 * M211 (owner, 2026-11-07: «لما ادخل رقمي يظهرلي تأكيد ويوصلني وااكد من نفس الصفحة»): the number is confirmed on the page
 * that asks for it, before any account exists. The parent locks the number while a code is live or once it is proven.
 * M212 (owner, 2026-11-07: «تظهر فقط لما اكتب الرقم صحيح… بمجرد ما اكتب آخر رقم تظهر»): the button is hidden until then.
 */
export function PhoneProofField({ phone, country, state, onChange, check, ready }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy || !check()) return;
    setBusy(true);
    setError(null);
    try {
      onChange({ kind: 'code', step: await authApi.phoneProofStart(phone, country) });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (state?.kind === 'done') {
    return (
      <View style={styles.wrap}>
        <Notice tone="success" text={t('phoneProof.done')} />
        <Pressable accessibilityRole="button" onPress={() => onChange(null)} style={styles.change} hitSlop={8}>
          <Text style={styles.changeText}>{t('phoneCode.changeNumber')}</Text>
        </Pressable>
      </View>
    );
  }

  if (state?.kind === 'code') {
    return (
      <PhoneCodeStep
        step={state.step}
        submitLabel={t('phoneProof.submit')}
        helpText={t('phoneProof.help')}
        onBack={() => onChange(null)}
        onSubmit={async (code) => {
          const { proof } = await authApi.phoneProofConfirm(state.step.stepToken, code);
          onChange({ kind: 'done', token: proof });
        }}
      />
    );
  }

  if (!ready) return null;

  return (
    <View style={styles.wrap}>
      {error ? <Notice tone="warning" text={error} support /> : null}
      <AppButton label={t('phoneProof.confirm')} variant="outline" icon="logo-whatsapp" loading={busy} onPress={() => void start()} />
    </View>
  );
}

const styles = themedStyles(() => ({
  wrap: { gap: spacing.xs },
  change: { alignSelf: 'center', paddingVertical: spacing.xs },
  changeText: { ...typography.caption, color: colors.gold, textDecorationLine: 'underline' },
}));
