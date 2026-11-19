import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, type ScrollView } from 'react-native';

import { authApi, useAuthConfig, type Persona } from '@/api/auth';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { ChipRow, ErrorSummary, FieldGroup, type FieldFix } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneProofField, type PhoneProofHandle, type PhoneProofState } from '@/components/PhoneProofField';
import { Screen } from '@/components/Screen';
import { SocialButtons } from '@/components/SocialButtons';
import { StateView } from '@/components/StateView';
import { getLang, t, tOptional } from '@/i18n';
import { trackRegistration } from '@/lib/adsAttribution';
import { emailFix, nameFix, phoneCountryFix } from '@/lib/fixes';
import { markIntroDue } from '@/lib/introGate';
import { cleanEmail, isEmail, localPhoneDigits, nameIssue, phoneIssue } from '@/lib/validation';
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
/** M253: the order a refusal from the server is looked for in — the invite code can be refused too. */
const SERVER_ORDER: Field[] = [...ORDER, 'inviteCode'];
/** M253: the field a refusal belongs under when the server (or the hub behind it) names a code and no field. */
const CODE_FIELDS: Partial<Record<string, Field>> = {
  phone: 'phone',
  phone_no_whatsapp: 'phone',
  email_domain: 'email',
  invalid_email: 'email',
  exists: 'email',
  invite_code: 'inviteCode',
  invite_unavailable: 'inviteCode',
};

/**
 * The registration form. M195 (owner, 2026-11-04): the club identity (navy + gold, dark tone on the
 * black screen), real checks (a username is not a name, the phone follows the country's rule), red
 * borders and messages under the fields, a red summary on top and an automatic scroll to the first error.
 * M203 (owner, 2026-11-06): the short form: name, country, phone, e-mail, password, category, job. The code proves
 * the number on WhatsApp; bio, interests, member type and company are asked later in the profile.
 * M211 (owner, 2026-11-07): the number is confirmed right here, before the account exists, and the form does not go
 * through without it.
 * M212 (owner, 2026-11-07: «نفس صفحة التسجيل عادي جدا… بس لما يكون في بوتون يأكد رقم واتس اب»): a first Google/Apple
 * sign-in lands on this same form (name and e-mail filled by the provider, no password), and the WhatsApp button
 * appears only once the number is complete and right.
 * M253 (owner, 2026-11-19: «أي خطأ يحصل يظهر زرار فوري يحل المشكلة… محدش يواجه أي مشكلة أثناء التسجيل»): a refusal
 * from the server lands under its own field like a local one, and every field that has ONE right correction
 * offers it as a button — the e-mail meant («gmial.com»), the name without digits and signs, the country a
 * number was typed for, signing in when the account exists already, going on without a refused invite code.
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
  // M239 (owner, 2026-11-14: a right e-mail kept its red warning): the handlers read the newest values from here, never
  // from the render they were created in — an autofill writes a field and leaves it inside one render.
  const [newest] = useState(() => ({ form }));
  const [showInvite, setShowInvite] = useState(Boolean(invite?.trim()));
  const errors = useFormErrors<Field>(scrollRef);
  const [failure, setFailure] = useState<Failure | null>(null);
  // M253: what each field held when the server refused it — the red line stays until the member changes that value.
  const [refused, setRefused] = useState<{ values: Partial<Record<Field, string>>; code: string }>({ values: {}, code: '' });
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<PhoneProofState>(null);
  // M227: the sign-up button was pressed before the number was proven; the proof then finishes the sign-up by itself.
  const [autoProof, setAutoProof] = useState(false);
  const proofRef = useRef<PhoneProofHandle | null>(null);
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
    const draft = { ...newest.form, [key]: value };
    newest.form = draft;
    setForm(draft);
    if (!issueOf(key, draft)) errors.clear(key);
    // The number's rule follows the country.
    if (key === 'country' && draft.phone && !issueOf('phone', draft)) errors.clear('phone');
    // M211: the proof belongs to one number in one country.
    if (key === 'country') setProof(null);
  };
  const blur = (key: Field) => () => {
    // M253: the server's verdict on this exact value stands; the local check knows less.
    if (errors.errors[key] && refused.values[key] === newest.form[key]) return;
    // Leaving the e-mail field shows the address as it will be sent (invisible marks, a trailing dot, capitals gone);
    // never while typing. The provider's own address of a Google/Apple sign-up is left as it came.
    if (key === 'email' && !social) {
      const cleaned = cleanEmail(newest.form.email);
      if (cleaned !== newest.form.email) set('email')(cleaned);
    }
    errors.check(key, issueOf(key, newest.form));
  };
  const validate = (proven: PhoneProofState = proof) => {
    const next: Partial<Record<Field, string>> = {};
    for (const key of ORDER) {
      const message = issueOf(key, newest.form);
      if (message) next[key] = message;
    }
    if ((config?.phoneProofRequired || social) && proven?.kind !== 'done' && !next.phone) next.phone = t('phoneProof.required');
    return next;
  };
  const phoneReady = issueOf('phone', form) === null;
  // M239: a red warning never outlives its reason — whatever painted it, it goes once the value on screen is right.
  const shown = errors.errors;
  const clearError = errors.clear;
  useEffect(() => {
    for (const key of ['name', 'email', 'password', 'jobTitle'] as const) {
      if (shown[key] && refused.values[key] !== form[key] && issueOf(key, form) === null) clearError(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- issueOf is rebuilt every render; the values are what matter
  }, [form, shown, clearError, refused]);

  /** `proven` is the proof that has just arrived, before the state caught up with it. */
  const submit = async (proven: PhoneProofState = proof) => {
    if (busy) return;
    const latest = newest.form;
    setFailure(null);
    setRefused({ values: {}, code: '' });
    // M227 (owner, 2026-11-11: a member pressed the button without confirming and did not understand a code was due):
    // a right number that is not proven yet gets its code at once, the page goes up to the code field, and the
    // sign-up finishes by itself when the code is right.
    if ((config?.phoneProofRequired || social) && proven?.kind !== 'done' && phoneReady) {
      setAutoProof(true);
      errors.clear('phone');
      proofRef.current?.request();
      setTimeout(() => errors.scrollTo('phone'), 50);
      return;
    }
    if (errors.fail(validate(proven), ORDER) || !latest.persona) return;
    setBusy(true);
    try {
      // M212: the account of a first Google/Apple sign-in is born here, with the form's fields and the proven number.
      if (social) {
        if (proven?.kind !== 'done') return;
        const result = await authApi.socialComplete(social.token, proven.token, {
          name: latest.name.trim(),
          persona: latest.persona,
          jobTitle: latest.jobTitle.trim(),
          inviteCode: latest.inviteCode.trim() || undefined,
        });
        if (result.created) markIntroDue();
        await signIn(result.token, result.me);
        if (result.created) trackRegistration(social.provider, result.me);
        void queryClient.invalidateQueries({ queryKey: ['news'] });
        void queryClient.invalidateQueries({ queryKey: ['interests'] });
        if (router.canDismiss()) router.dismissAll();
        router.replace('/membership');
        return;
      }
      const result = await authApi.register({
        name: latest.name.trim(),
        country: latest.country,
        phone: latest.phone.trim(),
        email: cleanEmail(latest.email),
        password: latest.password,
        persona: latest.persona,
        jobTitle: latest.jobTitle.trim(),
        inviteCode: latest.inviteCode.trim() || undefined,
        phoneProof: proven?.kind === 'done' ? proven.token : undefined,
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
      trackRegistration('email', result.me);
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      void queryClient.invalidateQueries({ queryKey: ['interests'] });
      if (router.canDismiss()) router.dismissAll();
      router.replace('/membership');
    } catch (cause) {
      // M211: the proof outlived its half hour: the button comes back.
      if (cause instanceof ApiError && cause.code === 'phone_proof_required') setProof(null);
      // M253: the refusal goes under the field it is about (red border, its sentence, the screen at it).
      if (cause instanceof ApiError && CODE_FIELDS[cause.code] === 'inviteCode') setShowInvite(true);
      const taken = errors.fromServer(cause, SERVER_ORDER, { codes: CODE_FIELDS });
      if (taken.length) {
        setRefused({ values: Object.fromEntries(taken.map((key) => [key, latest[key]])), code: cause instanceof ApiError ? cause.code : '' });
        return;
      }
      setFailure(failureOf(cause));
    } finally {
      setBusy(false);
    }
  };

  // M253: the one-tap corrections. Each is offered only when there is ONE right answer; the label says what a tap writes.
  const nameMeant = nameFix(form.name);
  const emailMeant = social ? null : emailFix(form.email);
  const phoneLand = config && !proof && errors.errors.phone ? phoneCountryFix(form.phone, form.country, config.countries) : null;
  const fixes: Partial<Record<Field, FieldFix | null>> = {
    name: nameMeant ? { label: t('form.fix.use', { value: nameMeant }), onPress: () => set('name')(nameMeant) } : null,
    email:
      errors.errors.email && refused.code === 'exists' && refused.values.email === form.email
        ? { label: t('form.fix.signIn'), icon: 'log-in-outline', onPress: () => router.replace({ pathname: '/auth/login', params: { email: cleanEmail(form.email) } }) }
        : emailMeant
          ? { label: t('form.fix.use', { value: emailMeant }), onPress: () => set('email')(emailMeant) }
          : null,
    phone: phoneLand
      ? {
          label: t('form.fix.country', { country: (getLang() === 'en' && phoneLand.country.nameEn) || phoneLand.country.name }),
          icon: 'earth-outline',
          onPress: () => {
            set('country')(phoneLand.country.code);
            set('phone')(phoneLand.phone);
          },
        }
      : null,
    inviteCode: errors.errors.inviteCode
      ? {
          label: t('form.fix.dropInvite'),
          icon: 'arrow-forward-circle-outline',
          onPress: () => {
            set('inviteCode')('');
            errors.clear('inviteCode');
            void submit();
          },
        }
      : null,
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
          <SocialButtons onError={(message) => setFailure({ message, code: 'social' })} />
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
            fix={fixes.name}
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
            fix={fixes.phone}
            anchorRef={errors.anchor('phone')}
            onBlur={blur('phone')}
          />
          {config.phoneProofRequired || social ? (
            <PhoneProofField
              phone={form.phone}
              country={form.country}
              state={proof}
              ready={phoneReady}
              ref={proofRef}
              auto={autoProof}
              onChange={(next) => {
                setProof(next);
                if (next) errors.clear('phone');
                if (next?.kind === 'code') return;
                setAutoProof(false);
                if (next && autoProof) void submit(next);
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
            warning={emailMeant && isEmail(form.email) ? t('form.fix.emailMeant') : null}
            fix={fixes.email}
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
            onChangeText={(value) => {
              set('inviteCode')(value);
              errors.clear('inviteCode');
            }}
            error={errors.errors.inviteCode}
            fix={fixes.inviteCode}
            anchorRef={errors.anchor('inviteCode')}
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
          <FormFailure failure={failure} onRetry={() => void submit()} />
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
  inviteText: { ...typography.caption, color: colors.goldText, textDecorationLine: 'underline' },
}));
