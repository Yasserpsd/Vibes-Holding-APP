import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, View, type TextInput } from 'react-native';

import { authApi } from '@/api/auth';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { FormCard } from '@/components/form/FormTheme';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { trackRegistration } from '@/lib/adsAttribution';
import { markIntroDue } from '@/lib/introGate';
import { clearSignupDraft } from '@/lib/signupDraft';
import { cleanEmail, isEmail, nameIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

type Field = 'first' | 'last' | 'job' | 'email' | 'invite';

type Props = {
  /** The proof of the number, good for half an hour. */
  proof: string;
  number: string;
  country: string;
  /** The hub is older than 2.34.0 and still wants an address with every account. */
  needsEmail: boolean;
};

/**
 * M272: what is left of the sign-up once the number is proven — the name (two fields, M257) and the job (M203, «مهمة
 * جدا»). No password and no category: the account signs in by WhatsApp code and starts as «محايد», free to choose
 * later. The invite code waits behind one line, so a representative's invitation is still counted.
 */
export function QuickFinishForm({ proof, number, country, needsEmail }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signIn } = useAuth();
  const [values, setValues] = useState<Record<Field, string>>({ first: '', last: '', job: '', email: '', invite: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [expired, setExpired] = useState(false);
  const [taken, setTaken] = useState(false);
  const [askEmail, setAskEmail] = useState(needsEmail);
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstInput = useRef<TextInput | null>(null);
  const lastInput = useRef<TextInput | null>(null);
  const jobInput = useRef<TextInput | null>(null);

  // `autoFocus` right after the code step marked the field and left the keyboard down (seen on Android): focus once the
  // code's own keyboard has gone.
  useEffect(() => {
    const timer = setTimeout(() => firstInput.current?.focus(), 450);
    return () => clearTimeout(timer);
  }, []);

  // The dashboard's «أسباب تعثّر التسجيل»: this is the sign-up form of the quick road, counted like the long one.
  useEffect(() => {
    void authApi.formOpened('register').catch(() => undefined);
  }, []);

  const set = (key: Field) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const name = `${values.first.trim()} ${values.last.trim()}`.replace(/\s+/g, ' ').trim();

  const submit = async () => {
    if (busy) return;
    const problems: Partial<Record<Field, string>> = {
      first: values.first.trim().length < 2 ? t('form.error.firstName') : undefined,
      last: values.last.trim().length < 2 ? t('form.error.lastName') : undefined,
      job: values.job.trim().length < 2 ? t('form.error.jobTitle') : undefined,
      email: askEmail && !isEmail(values.email) ? t('form.error.email') : undefined,
    };
    setErrors(problems);
    setFailure(null);
    if (Object.values(problems).some(Boolean)) return;
    Keyboard.dismiss();
    setBusy(true);
    try {
      const result = await authApi.register({
        name,
        country,
        phone: number,
        ...(askEmail ? { email: cleanEmail(values.email) } : {}),
        persona: 'neutral',
        personaDefaulted: true,
        jobTitle: values.job.trim(),
        inviteCode: values.invite.trim() || undefined,
        phoneProof: proof,
      });
      clearSignupDraft();
      // The proof opens the account at once; a mailed activation would mean the hub did not take the proof.
      if (result.pending) {
        router.replace({ pathname: '/auth/verify', params: { flow: 'register', pendingToken: result.pendingToken, email: result.email, text: result.text } });
        return;
      }
      // M209: the intro film is marked BEFORE the session is announced.
      markIntroDue();
      await signIn(result.token, result.me);
      trackRegistration('phone', result.me);
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      void queryClient.invalidateQueries({ queryKey: ['interests'] });
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/');
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : '';
      const message = failureOf(cause).message;
      if (code === 'phone_proof_required') setExpired(true);
      else if (code === 'invite_code' || code === 'invite_unavailable' || code === 'referral') {
        setShowInvite(true);
        setErrors({ invite: message });
      } else if (code === 'email_required' || code === 'email_domain' || code === 'invalid_email') {
        setAskEmail(true);
        setErrors({ email: message });
      } else {
        setTaken(code === 'exists');
        setFailure(failureOf(cause));
      }
    } finally {
      setBusy(false);
    }
  };

  // The proof outlived its half hour: one tap back to the number sends a fresh code.
  if (expired) {
    return (
      <View style={styles.wrap}>
        <Notice tone="warning" text={t('quick.expired')} />
        <AppButton label={t('quick.again')} icon="logo-whatsapp" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Notice tone="success" text={t('phoneProof.done')} />
      <FormCard tone="light">
        <FormField
          label={t('auth.register.firstName')}
          value={values.first}
          onChangeText={set('first')}
          error={errors.first}
          inputRef={firstInput}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => lastInput.current?.focus()}
          textContentType="givenName"
          autoComplete="name-given"
        />
        <FormField
          label={t('auth.register.lastName')}
          value={values.last}
          onChangeText={set('last')}
          error={errors.last}
          inputRef={lastInput}
          warning={values.last.trim().length >= 2 && nameIssue(name) ? t('form.nameWarning') : null}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => jobInput.current?.focus()}
          textContentType="familyName"
          autoComplete="name-family"
        />
        <FormField
          label={t('auth.register.jobTitle')}
          value={values.job}
          onChangeText={set('job')}
          error={errors.job}
          inputRef={jobInput}
          returnKeyType={askEmail ? 'next' : 'go'}
          onSubmitEditing={() => (askEmail ? undefined : void submit())}
          textContentType="jobTitle"
        />
        {askEmail ? (
          <FormField
            label={t('profile.email')}
            latin
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={values.email}
            onChangeText={set('email')}
            error={errors.email}
            textContentType="emailAddress"
            autoComplete="email"
          />
        ) : null}
        {showInvite ? (
          <FormField
            label={t('auth.register.inviteCode')}
            latin
            autoCapitalize="characters"
            autoCorrect={false}
            value={values.invite}
            onChangeText={set('invite')}
            error={errors.invite}
            hint={t('auth.register.inviteCodeHint')}
          />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setShowInvite(true)} style={styles.invite} hitSlop={8}>
            <Text style={styles.inviteText}>{t('auth.register.haveInvite')}</Text>
          </Pressable>
        )}
        <FormFailure
          failure={failure}
          onRetry={() => void submit()}
          actions={[taken ? { label: t('form.fix.signIn'), icon: 'log-in-outline', onPress: () => router.replace('/auth/login') } : null]}
        />
        <AppButton label={t('quick.finish.submit')} icon="checkmark-circle-outline" loading={busy} onPress={() => void submit()} />
      </FormCard>
      <SupportLink />
    </View>
  );
}

const styles = themedStyles(() => ({
  wrap: { gap: spacing.sm },
  invite: { alignSelf: 'center', paddingVertical: spacing.xs },
  inviteText: { ...typography.caption, color: colors.goldText, textDecorationLine: 'underline' },
}));
