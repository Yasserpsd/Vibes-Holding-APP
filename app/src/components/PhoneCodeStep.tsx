import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { authApi, type PhoneStepResult } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { spacing } from '@/theme/tokens';

type Props = {
  step: PhoneStepResult;
  /** Sends the code to the right endpoint; a throw shows under the field and the member stays here. */
  onSubmit: (code: string) => Promise<void>;
  /** Back to the number field (the gate and the profile editor); a sign-in has no number to edit. */
  onBack?: () => void;
  /** M209: the confirm button's label (the popup says «تأكيد الرمز»); defaults to «تأكيد». */
  submitLabel?: string;
};

/**
 * M203 (owner, 2026-11-06): the one code screen of the WhatsApp proof, used by the sign-in, the completion
 * form and the profile editor. M204 (owner, 2026-11-06): no e-mail button; the server mails the code by itself only
 * when WhatsApp did not carry it (`via` then says `email`), and the support line stays under the error.
 */
export function PhoneCodeStep({ step, onSubmit, onBack, submitLabel }: Props) {
  const [via, setVia] = useState(step.via);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(step.resendAfter);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const submit = async (value = code) => {
    if (busy) return;
    if (!/^\d{4}$/.test(value)) {
      setError(t('auth.verify.codeRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await authApi.phoneResend(step.stepToken, 'whatsapp');
      setVia(result.via);
      setCode('');
      setCooldown(result.resendAfter);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Notice
        tone="success"
        text={via === 'whatsapp' ? t('phoneCode.sentWhatsapp', { phone: `‎${step.phone}‎` }) : t('phoneCode.sentEmail', { email: `‎${step.email}‎` })}
      />
      <FormField
        label={t('auth.verify.code')}
        latin
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={4}
        value={code}
        autoFocus
        onChangeText={(value) => {
          // M203 (owner: seconds, not minutes): four digits typed or pasted from WhatsApp finish the step by themselves.
          const digits = value.replace(/\D/g, '').slice(0, 4);
          setCode(digits);
          if (digits.length === 4) void submit(digits);
        }}
        onSubmitEditing={() => void submit()}
        error={error}
      />
      {error ? <Notice tone="warning" text={t('phoneCode.help')} support /> : null}
      <AppButton label={submitLabel ?? t('auth.verify.submit')} icon="checkmark-circle-outline" loading={busy} onPress={() => void submit()} />
      <AppButton
        label={cooldown > 0 ? t('auth.verify.resendIn', { seconds: cooldown }) : t('phoneCode.resendWhatsapp')}
        variant="outline"
        icon="logo-whatsapp"
        disabled={cooldown > 0 || sending}
        onPress={() => void resend()}
      />
      {onBack ? <AppButton label={t('phoneCode.changeNumber')} variant="outline" icon="create-outline" onPress={onBack} /> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  wrap: { gap: spacing.sm },
}));
