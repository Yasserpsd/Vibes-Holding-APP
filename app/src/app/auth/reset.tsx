import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { ApiError } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { FormField } from '@/components/FormField';
import { EMPTY_IDENTIFIER, identifierPayload, identifierPhoneProblem, identifierValid, LoginIdentifierField, type Identifier } from '@/components/LoginIdentifier';
import { entranceDelay, FadeInView, PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { codeKeyboardType } from '@/components/PhoneCodeStep';
import { Screen } from '@/components/Screen';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { toAsciiDigits } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

/** Seconds before «أعد الإرسال» works again (the e-mail code screen waits the same). */
const RESEND_SECONDS = 60;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { data: config } = useAuthConfig();
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [identifier, setIdentifier] = useState<Identifier>(EMPTY_IDENTIFIER);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  // M253: a refusal about the code or the new password sits under that field; anything else sits by the button with its way out.
  const [failure, setFailure] = useState<Failure | null>(null);
  const [fieldError, setFieldError] = useState<{ field: 'code' | 'password'; message: string } | null>(null);
  const local = (message: string): void => setFailure({ message, code: 'local' });
  const [busy, setBusy] = useState(false);
  // M197: hub 2.26.3 names the inbox (masked) and the Apple/Google sign-up; an older hub sends neither.
  const [sent, setSent] = useState<{ sentTo: string; provider: string; via: string }>({ sentTo: '', provider: '', via: '' });
  const [resent, setResent] = useState(false);

  // The same brake as the sign-in code screens: one message, then the button counts down before the next.
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const request = async (again = false) => {
    if (busy || (again && cooldown > 0)) return;
    if (!identifierValid(identifier)) {
      local(t('auth.reset.loginRequired'));
      return;
    }
    // M128: a wrong-length or wrong-start number never reaches the server.
    const phoneProblem = identifierPhoneProblem(identifier, config?.countries);
    if (phoneProblem) {
      local(phoneProblem);
      return;
    }
    setBusy(true);
    setFailure(null);
    setFieldError(null);
    try {
      const { login, country } = identifierPayload(identifier);
      const result = await authApi.resetRequest(login, country);
      setSent({ sentTo: result.sentTo ?? '', provider: result.provider ?? '', via: result.via ?? '' });
      setResent(again);
      setCooldown(RESEND_SECONDS);
      setStep('confirm');
    } catch (cause) {
      setFailure(failureOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    if (!/^\d{4,6}$/.test(code)) {
      setFieldError({ field: 'code', message: t('auth.verify.codeRequired') });
      return;
    }
    if (password.length < 6) {
      setFieldError({ field: 'password', message: t('auth.reset.passwordShort') });
      return;
    }
    setBusy(true);
    setFailure(null);
    setFieldError(null);
    try {
      const { login, country } = identifierPayload(identifier);
      await authApi.resetConfirm(login, code, password, country);
      setStep('done');
    } catch (cause) {
      const refused = cause instanceof ApiError ? (cause.code === 'bad_code' ? 'code' : cause.fields.find((item) => item.field === 'password' || item.field === 'code')?.field) : undefined;
      if (refused === 'code' || refused === 'password') setFieldError({ field: refused, message: failureOf(cause).message });
      else setFailure(failureOf(cause));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <Screen title={t('auth.reset.title')}>
        <PopIn style={styles.doneIcon}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        </PopIn>
        <FadeInView delay={entranceDelay(1)}>
          <Notice tone="success" text={t('auth.reset.done')} />
        </FadeInView>
        <FadeInView delay={entranceDelay(2)}>
          <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.replace('/auth/login')} />
        </FadeInView>
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.reset.title')}
      subtitle={
        step === 'request'
          ? t('auth.reset.subtitleRequest')
          : sent.sentTo
            ? sent.via === 'whatsapp'
              ? t('auth.reset.sentWhatsapp', { phone: `‎${sent.sentTo}‎` })
              : t('auth.reset.sentMail', { email: `‎${sent.sentTo}‎` })
            : t('auth.reset.subtitleConfirm', { login: identifier.value.trim() })
      }
    >
      <FadeInView key={step} style={styles.fields}>
        {step === 'confirm' && config?.testCode ? <Notice tone="warning" text={t('auth.verify.testCode', { code: config.testCode })} /> : null}
        {step === 'confirm' && sent.provider ? <Notice tone="info" text={t('auth.reset.socialNote', { provider: sent.provider === 'apple' ? 'Apple' : 'Google' })} /> : null}
        {step === 'confirm' && resent ? <Notice tone="success" text={t('auth.reset.resent')} /> : null}
        <LoginIdentifierField value={identifier} onChange={setIdentifier} countries={config?.countries} editable={step === 'request'} />
        {step === 'confirm' ? (
          <>
            <FormField label={t('auth.verify.code')} latin keyboardType={codeKeyboardType} textContentType="oneTimeCode" maxLength={6} value={code}
              error={fieldError?.field === 'code' ? fieldError.message : null}
              onChangeText={(value) => {
                setCode(toAsciiDigits(value).replace(/\D/g, ''));
                if (fieldError?.field === 'code') setFieldError(null);
              }}
            />
            <FormField label={t('auth.reset.newPassword')} latin secureTextEntry autoCapitalize="none" textContentType="newPassword" value={password}
              error={fieldError?.field === 'password' ? fieldError.message : null}
              onChangeText={(value) => {
                setPassword(value);
                if (fieldError?.field === 'password') setFieldError(null);
              }}
              hint={t('auth.register.passwordHint')}
            />
          </>
        ) : null}
      </FadeInView>
      {failure ? (
        <FadeInView offset={8}>
          <FormFailure failure={failure} onRetry={() => void (step === 'request' ? request() : confirm())} />
        </FadeInView>
      ) : null}
      {step === 'request' ? (
        <FadeInView key="request-submit" delay={entranceDelay(1)}>
          <AppButton label={t('auth.reset.send')} icon="logo-whatsapp" loading={busy} onPress={() => void request()} />
        </FadeInView>
      ) : (
        <FadeInView key="confirm-submit" delay={entranceDelay(1)}>
          <AppButton label={t('auth.reset.save')} icon="key-outline" loading={busy} onPress={() => void confirm()} />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || cooldown > 0 }}
            onPress={() => void request(true)}
            disabled={busy || cooldown > 0}
            style={styles.resend}
            hitSlop={8}
          >
            <Text style={[styles.resendText, cooldown > 0 && styles.resendWaiting]}>
              {cooldown > 0 ? t('auth.verify.resendIn', { seconds: cooldown }) : t('auth.reset.resend')}
            </Text>
          </Pressable>
          {/* M204 (owner): WhatsApp only, with no e-mail way out; a member the code cannot reach writes to the support line. */}
          <SupportLink problem={t('auth.reset.noCode')} />
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  fields: { gap: spacing.md },
  doneIcon: { alignSelf: 'center', marginTop: spacing.md },
  resend: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.xs },
  resendText: { ...typography.caption, color: colors.goldText, textDecorationLine: 'underline' },
  resendWaiting: { color: colors.textMuted, textDecorationLine: 'none' },
}));
