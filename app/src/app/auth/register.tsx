import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, Text, type ScrollView } from 'react-native';

import { authApi, useAuthConfig, type Persona } from '@/api/auth';
import { ApiError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { ChipRow, ErrorSummary, FieldGroup } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneProofField, type PhoneProofState } from '@/components/PhoneProofField';
import { Screen } from '@/components/Screen';
import { SocialButtons } from '@/components/SocialButtons';
import { StateView } from '@/components/StateView';
import { t, tOptional } from '@/i18n';
import { trackRegistration } from '@/lib/adsAttribution';
import { markIntroDue } from '@/lib/introGate';
import { isEmail, localPhoneDigits, nameIssue, phoneIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

type Form = {
  name: string;
  country: string;
  phone: string;
  email: string;
  password: string;
  persona: Persona | '';
  jobTitle: string;
  /** M32: another member's code; checked and stored by the server side. */
  inviteCode: string;
};

const EMPTY: Form = { name: '', country: 'sa', phone: '', email: '', password: '', persona: '', jobTitle: '', inviteCode: '' };

type Field = keyof Form;
const ORDER: Field[] = ['name', 'country', 'phone', 'email', 'password', 'persona', 'jobTitle'];

/**
 * The registration form. M195 (owner, 2026-11-04): the club identity (navy + gold, dark tone on the
 * black screen), real checks (a username is not a name, the phone follows the country's rule), red
 * borders and messages under the fields, a red summary on top and an automatic scroll to the first error.
 * M203 (owner, 2026-11-06): the short form: name, country, phone, e-mail, password, category, job. The code proves
 * the number on WhatsApp; bio, interests, member type and company are asked later in the profile.
 * M211 (owner, 2026-11-07): the number is confirmed right here, before the account exists, and the form does not go
 * through without it.
 * M212 (owner, 2026-11-07: Â«ÙÙØ³ ØµÙØ­Ø© Ø§ÙØªØ³Ø¬ÙÙ Ø¹Ø§Ø¯Ù Ø¬Ø¯Ø§â¦ Ø¨Ø³ ÙÙØ§ ÙÙÙÙ ÙÙ Ø¨ÙØªÙÙ ÙØ£ÙØ¯ Ø±ÙÙ ÙØ§ØªØ³ Ø§Ø¨Â»): a first Google/Apple
 * sign-in lands on this same form (name and e-mail filled by the provider, no password), and the WhatsApp button
 * appears only once the number is complete and right.
 */
export default function RegisterScreen() {
  const router = useRouter();
  // M128: arriving from a failed sign-in with no account behind it — say so, plainly.
  // M203: an invite link fills the code and shows the field; otherwise it waits behind a small button.
  const { fromLogin, invite, signupToken, provider, name: socialName, email: socialEmail } = useLocalSearchParams<{
    fromLogin?: string;
    invite?: string;
    signupToken?: string;
    provider?: string;
    name?: string;
    email?: string;
  }>();
  // M212: the first Google/Apple sign-in that brought the member here; its identity waits on the server for half an hour.
  const social = signupToken
    ? { token: signupToken, provider: provider === 'apple' ? ('apple' as const) : ('google' as const), label: provider === 'apple' ? 'Apple' : 'Google' }
    : null;
  const { data: config, isLoading, error: configError, refetch } = useAuthConfig();
  const scrollRef = useRef<ScrollView | null>(null);
  const [form, setForm] = useState<Form>({ ...EMPTY, name: socialName?.trim() ?? '', email: socialEmail?.trim() ?? '', inviteCode: invite?.trim().slice(0, 30) ?? '' });
  const [showInvite, setShowInvite] = useState(Boolean(invite?.trim()));
  const errors = useFormErrors<Field>(scrollRef);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<PhoneProofState>(null);
  const { signIn } = useAuth();
  const queryClient = useQueryClient();

  const country = config?.countries.find((item) => item.code === form.country) ?? config?.countries[0];
  // M126 (owner): the dial code is right there, so the number never shows a leading zero.
  const phoneExample = country?.example ? country.example.replace(/^0+/, '') : '';
  /** The verdict on one field of a draft — null when it is fine. */
  const issueOf = (key: Field, draft: Form): string | null => {
    // M212: the provider vouches for the e-mail and there is no password to set.
    if (social && (key === 'email' || key === 'password')) return null;
    switch (key) {
      // M207 (owner, 2026-11-06): only an empty name stops the form; an odd one shows the warning under the field.
      case 'name':
        return draft.name.trim().length < 2 ? t('form.error.name.empty') : null;
      case 'phone': {
        const land = config?.countries.find((item) => item.code === draft.country) ?? country;
        const example = land?.example ? land.example.replace(/^0+/, '') : '';
        if (phoneIssue(draft.phone, land) === null) return null;
        return example ? t('form.error.phone', { example }) : t('form.error.phoneNoExample');
      }
      case 'email':
        return isEmail(draft.email) ? null : t('form.error.email');
      case 'password':
        return draft.password.length < 6 ? t('form.error.password') : null;
      case 'persona':
        return draft.persona ? null : t('form.error.persona');
      case 'jobTitle':
        return draft.jobTitle.trim().length < 2 ? t('form.error.jobTitle') : null;
      default:
        return null;
    }
  };
  // Owner (2026-11-07: «خلي التحذير يطلع لما أسيب الخانة… مش وأنا بكتب»): typing never paints a NEW red warning; an
  // existing red goes the moment the value is right, and the verdict on a field comes when the member leaves it (or submits).
  const set = (key: keyof Form) => (value: string) => {
    const draft = { ...form, [key]: value };
    setForm(draft);
    if (!issueOf(key, draft)) errors.clear(key);
    // The number's rule follows the country.
    if (key === 'country' && draft.phone && !issueOf('phone', draft)) errors.clear('phone');
    // M211: the proof belongs to one number in one country.
    if (key === 'country') setProof(null);
  };
  const blur = (key: Field) => () => errors.check(key, issueOf(key, form));
  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    for (const key of ORDER) {
      const message = issueOf(key, form);
      if (message) next[key] = message;
    }
    if ((config?.phoneProofRequired || social) && proof?.kind !== 'done' && !next.phone) next.phone = t('phoneProof.required');
    return next;
  };
  const phoneReady = issueOf('phone', form) === null;

  const submit = async () => {
    if (busy) return;
    setSubmitError(null);
    if (errors.fail(validate(), ORDER) || !form.persona) return;
    setBusy(true);
    try {
      // M212: the account of a first Google/Apple sign-in is born here, with the form's fields and the proven number.
      if (social) {
        if (proof?.kind !== 'done') return;
        const result = await authApi.socialComplete(social.token, proof.token, {
          name: form.name.trim(),
          persona: form.persona,
          jobTitle: form.jobTitle.trim(),
          inviteCode: form.inviteCode.trim() || undefined,
        });
        if (result.created) markIntroDue();
        await signIn(result.token, result.me);
        if (result.created) trackRegistration(social.provider);
        void queryClient.invalidateQueries({ queryKey: ['news'] });
        void queryClient.invalidateQueries({ queryKey: ['interests'] });
        if (router.canDismiss()) router.dismissAll();
        router.replace('/membership');
        return;
      }
      const result = await authApi.register({
        name: form.name.trim(),
        country: form.country,
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
        persona: form.persona,
        jobTitle: form.jobTitle.trim(),
        inviteCode: form.inviteCode.trim() || undefined,
        phoneProof: proof?.kind === 'done' ? proof.token : undefined,
      });
      if (result.pending) {
        router.push({
          pathname: '/auth/verify',
          params: { flow: 'register', pendingToken: result.pendingToken, email: result.email, text: result.text },
        });
        return;
      }
      // M211: the number was proven here, so the account is open already. M209: the intro film is marked BEFORE the session.
      markIntroDue();
      await signIn(result.token, result.me);
      trackRegistration('email');
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      void queryClient.invalidateQueries({ queryKey: ['interests'] });
      if (router.canDismiss()) router.dismissAll();
      router.replace('/membership');
    } catch (cause) {
      // M211: the proof outlived its half hour: the button comes back.
      if (cause instanceof ApiError && cause.code === 'phone_proof_required') setProof(null);
      setSubmitError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <Screen title={t('auth.register.title')}>
        <StateView loading={isLoading} error={configError} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  if (!config.registrationOpen) {
    return (
      <Screen title={t('auth.register.title')}>
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="warning" text={t('auth.register.closed')} />
        </FadeInView>
        <FadeInView delay={entranceDelay(1)}>
          <AppButton label={t('auth.login.title')} variant="outline" icon="log-in-outline" onPress={() => router.replace('/auth/login')} />
        </FadeInView>
      </Screen>
    );
  }

  return (
    <Screen title={t('auth.register.title')} subtitle={social ? t('auth.register.socialSubtitle') : t('auth.register.subtitle')} scrollRef={scrollRef}>
      {fromLogin ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="warning" text={t('auth.register.fromLogin')} />
        </FadeInView>
      ) : null}
      {social ? null : (
        <FadeInView delay={entranceDelay(0)}>
          <SocialButtons onError={setSubmitError} />
        </FadeInView>
      )}
      <FadeInView delay={entranceDelay(1)}>
        {/* Owner (2026-11-06): the white form of the profile gate is the one look for sign-up too. */}
        <FormCard tone="light">
          <ErrorSummary count={errors.count} />
          <Notice text={t('auth.register.phonePolicy')} />
          <FormField
            label={t('auth.register.name')}
            value={form.name}
            onChangeText={set('name')}
            error={errors.errors.name}
            anchorRef={errors.anchor('name')}
            onBlur={blur('name')}
            hint={t('auth.register.nameHint')}
            hintOnFocus
            warning={form.name.trim().length >= 2 && nameIssue(form.name) ? t('form.nameWarning') : null}
            textContentType="name"
          />

          <CountryPicker label={t('auth.register.country')} countries={config.countries} selected={form.country} onSelect={set('country')} anchorRef={errors.anchor('country')} />
          <FormField
            label={t('auth.register.phone')}
            latin
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            value={form.phone}
            editable={!proof}
            onChangeText={(value) => set('phone')(localPhoneDigits(value, country))}
            placeholder={phoneExample || undefined}
            hint={t('auth.register.phoneWhatsapp')}
            hintOnFocus
            error={errors.errors.phone}
            anchorRef={errors.anchor('phone')}
            onBlur={blur('phone')}
          />
          {config.phoneProofRequired || social ? (
            <PhoneProofField
              phone={form.phone}
              country={form.country}
              state={proof}
              ready={phoneReady}
              onChange={(next) => {
                setProof(next);
                if (next) errors.clear('phone');
              }}
              check={() => {
                const issue = issueOf('phone', form);
                errors.check('phone', issue);
                return issue === null;
              }}
            />
          ) : null}
          <FormField
            label={t('auth.register.email')}
            latin
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            value={form.email}
            editable={!social}
            hint={social ? t('auth.register.socialEmailHint', { provider: social.label }) : undefined}
            onChangeText={set('email')}
            error={errors.errors.email}
            anchorRef={errors.anchor('email')}
            onBlur={blur('email')}
          />
          {social ? null : (
          <FormField
            label={t('common.password')}
            latin
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            value={form.password}
            onChangeText={set('password')}
            hint={t('auth.register.passwordHint')}
            hintOnFocus
            error={errors.errors.password}
            anchorRef={errors.anchor('password')}
            onBlur={blur('password')}
          />
          )}

          <FieldGroup label={t('auth.register.persona')} error={errors.errors.persona} anchorRef={errors.anchor('persona')}>
            <ChipRow>
              {config.personas.map((item) => (
                <Chip key={item.key} label={tOptional(`persona.${item.key}`) ?? item.label} selected={item.key === form.persona} onPress={() => set('persona')(item.key)} />
              ))}
            </ChipRow>
          </FieldGroup>

          <FormField
            label={t('auth.register.jobTitle')}
            value={form.jobTitle}
            onChangeText={set('jobTitle')}
            error={errors.errors.jobTitle}
            anchorRef={errors.anchor('jobTitle')}
            onBlur={blur('jobTitle')}
            textContentType="jobTitle"
          />
          {showInvite ? (
          <FormField
            label={t('auth.register.inviteCode')}
            latin
            autoCapitalize="characters"
            autoCorrect={false}
            value={form.inviteCode}
            onChangeText={set('inviteCode')}
            hint={t('auth.register.inviteCodeHint')}
            hintOnFocus
            placeholder="FAR2"
          />
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setShowInvite(true)} style={styles.invite} hitSlop={8}>
              <Text style={styles.inviteText}>{t('auth.register.haveInvite')}</Text>
            </Pressable>
          )}

          {/* The management's WhatsApp line right under the failure (owner, 2026-11-03: under every error, and in حسابي). */}
          {submitError ? <Notice tone="warning" text={submitError} support /> : null}
          <AppButton label={t('auth.register.submit')} icon="person-add-outline" loading={busy} onPress={() => void submit()} />
        </FormCard>
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <Text style={styles.footnote}>{t('auth.register.footnote')}</Text>
      </FadeInView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  footnote: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  invite: { alignSelf: 'center', paddingVertical: spacing.xs },
  inviteText: { ...typography.caption, color: colors.gold, textDecorationLine: 'underline' },
}));
