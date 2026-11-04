import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, type ScrollView } from 'react-native';

import { authApi, useAuthConfig, type Persona } from '@/api/auth';
import { useInterests } from '@/api/interests';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { ChipRow, ErrorSummary, FieldGroup } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SocialButtons } from '@/components/SocialButtons';
import { StateView } from '@/components/StateView';
import { VoiceFill } from '@/components/VoiceFill';
import { t, tOptional } from '@/i18n';
import { isEmail, nameIssue, phoneIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

type Form = {
  name: string;
  /** M69: «فرد / شركة» — choosing شركة reveals the required company-name field. */
  memberType: 'individual' | 'company';
  companyName: string;
  country: string;
  phone: string;
  email: string;
  password: string;
  persona: Persona | '';
  bio: string;
  jobTitle: string;
  /** M32: another member's membership number; checked and stored by the server side. */
  inviteCode: string;
  /** M107: the unified interests (1 to 3), saved with the account right after the code is verified. */
  interests: string[];
  /** The «أخرى» short text. */
  interestsOther: string;
};

const EMPTY: Form = { name: '', memberType: 'individual', companyName: '', country: 'sa', phone: '', email: '', password: '', persona: '', bio: '', jobTitle: '', inviteCode: '', interests: [], interestsOther: '' };

const MEMBER_TYPES = ['individual', 'company'] as const;
type Field = keyof Form;
const ORDER: Field[] = ['name', 'memberType', 'companyName', 'country', 'phone', 'email', 'password', 'persona', 'bio', 'jobTitle', 'interests'];

/**
 * The registration form. M195 (owner, 2026-11-04): the club identity (navy + gold, dark tone on the
 * black screen), real checks (a username is not a name, the phone follows the country's rule), red
 * borders and messages under the fields, a red summary on top and an automatic scroll to the first error.
 */
export default function RegisterScreen() {
  const router = useRouter();
  // M128: arriving from a failed sign-in with no account behind it — say so, plainly.
  const { fromLogin } = useLocalSearchParams<{ fromLogin?: string }>();
  const { data: config, isLoading, error: configError, refetch } = useAuthConfig();
  const interestsList = useInterests();
  const scrollRef = useRef<ScrollView | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const errors = useFormErrors<Field>(scrollRef);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const country = config?.countries.find((item) => item.code === form.country) ?? config?.countries[0];
  // M126 (owner): the dial code is right there, so the number never shows a leading zero.
  const phoneExample = country?.example ? country.example.replace(/^0+/, '') : '';
  const set = (key: Exclude<keyof Form, 'interests'>) => (value: string) => {
    errors.clear(key);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const maxInterests = interestsList.data?.max ?? 3;
  const toggleInterest = (key: string) => {
    errors.clear('interests');
    setForm((current) => {
      if (current.interests.includes(key)) return { ...current, interests: current.interests.filter((item) => item !== key) };
      if (current.interests.length >= maxInterests) {
        // Owner: the limit shows in red the moment a fourth one is tapped.
        errors.set('interests', t('form.error.interests.max', { max: maxInterests }));
        return current;
      }
      return { ...current, interests: [...current.interests, key] };
    });
  };

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    // M156 (owner): a real first + family name; the server applies the full rule (kunya, placeholders, AI).
    const nameProblem = nameIssue(form.name);
    if (nameProblem) next.name = t(`form.error.name.${nameProblem}`);
    if (form.memberType === 'company' && form.companyName.trim().length < 2) next.companyName = t('form.error.company');
    if (phoneIssue(form.phone, country) !== null) next.phone = phoneExample ? t('form.error.phone', { example: phoneExample }) : t('form.error.phoneNoExample');
    if (!isEmail(form.email)) next.email = t('form.error.email');
    if (form.password.length < 6) next.password = t('form.error.password');
    if (!form.persona) next.persona = t('form.error.persona');
    if (form.bio.trim().length < 10) next.bio = t('form.error.bio');
    if (form.jobTitle.trim().length < 2) next.jobTitle = t('form.error.jobTitle');
    if (interestsList.data && interestsList.data.interests.length > 0 && form.interests.length === 0) next.interests = t('form.error.interests.min');
    return next;
  };

  const submit = async () => {
    if (busy) return;
    setSubmitError(null);
    if (errors.fail(validate(), ORDER) || !form.persona) return;
    setBusy(true);
    try {
      const result = await authApi.register({
        name: form.name.trim(),
        memberType: form.memberType,
        companyName: form.memberType === 'company' ? form.companyName.trim() : undefined,
        country: form.country,
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
        persona: form.persona,
        bio: form.bio.trim(),
        jobTitle: form.jobTitle.trim() || undefined,
        inviteCode: form.inviteCode.trim() || undefined,
        // M120 (owner): the interests ride to the hub so the «عضو جديد» admin mail names them.
        interests: form.interests.length ? form.interests : undefined,
        interestsOther: form.interestsOther.trim() || undefined,
      });
      router.push({
        pathname: '/auth/verify',
        params: { flow: 'register', pendingToken: result.pendingToken, email: result.email, text: result.text, interests: form.interests.join(','), interestsOther: form.interestsOther.trim() },
      });
    } catch (cause) {
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
    <Screen title={t('auth.register.title')} subtitle={t('auth.register.subtitle')} scrollRef={scrollRef}>
      {fromLogin ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="warning" text={t('auth.register.fromLogin')} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(0)}>
        <SocialButtons onError={setSubmitError} />
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <FormCard tone="dark">
          <ErrorSummary count={errors.count} />
          <Notice text={t('auth.register.phonePolicy')} />
          {/* M142: the member says it all once; phone, e-mail, password and code stay typed. */}
          <VoiceFill
            fields={[
              { key: 'name', label: t('auth.register.name'), type: 'text', required: true },
              { key: 'companyName', label: t('auth.register.companyName'), type: 'text' },
              { key: 'jobTitle', label: t('auth.register.jobTitle'), type: 'text', required: true },
              { key: 'bio', label: t('auth.register.bio'), type: 'textarea', required: true },
              ...(interestsList.data
                ? [{ key: 'interests', label: t('auth.register.interests'), type: 'multiselect' as const, options: interestsList.data.interests.map((item) => item.label), hint: t('voiceFill.hintInterests'), required: true }]
                : []),
              { key: 'interestsOther', label: t('interests.otherLabel'), type: 'text' },
            ]}
            values={{
              name: form.name,
              companyName: form.companyName,
              jobTitle: form.jobTitle,
              bio: form.bio,
              interests: form.interests.map((key) => interestsList.data?.interests.find((item) => item.key === key)?.label ?? '').filter(Boolean).join('، '),
              interestsOther: form.interestsOther,
            }}
            country={form.country}
            onFill={(values) => {
              errors.reset();
              setForm((current) => {
                const list = interestsList.data?.interests ?? [];
                const picked = values.interests
                  ? values.interests
                      .split('، ')
                      .map((label) => list.find((item) => item.label === label)?.key)
                      .filter((key): key is string => Boolean(key))
                      .slice(0, maxInterests)
                  : current.interests;
                return {
                  ...current,
                  name: values.name ?? current.name,
                  companyName: values.companyName ?? current.companyName,
                  memberType: values.companyName ? 'company' : current.memberType,
                  jobTitle: values.jobTitle ?? current.jobTitle,
                  bio: values.bio ?? current.bio,
                  interests: picked,
                  interestsOther: values.interestsOther ?? current.interestsOther,
                };
              });
            }}
          />

          <FormField
            label={t('auth.register.name')}
            value={form.name}
            onChangeText={set('name')}
            error={errors.errors.name}
            anchorRef={errors.anchor('name')}
            hint={t('auth.register.nameHint')}
            textContentType="name"
          />

          <FieldGroup label={t('auth.register.memberType')} error={errors.errors.memberType} anchorRef={errors.anchor('memberType')}>
            <ChipRow>
              {MEMBER_TYPES.map((item) => (
                <Chip key={item} label={t(`auth.register.memberType.${item}`)} selected={item === form.memberType} onPress={() => set('memberType')(item)} />
              ))}
            </ChipRow>
          </FieldGroup>
          {form.memberType === 'company' ? (
            <FadeInView offset={8}>
              <FormField
                label={t('auth.register.companyName')}
                value={form.companyName}
                onChangeText={set('companyName')}
                error={errors.errors.companyName}
                anchorRef={errors.anchor('companyName')}
                textContentType="organizationName"
              />
            </FadeInView>
          ) : null}

          <CountryPicker label={t('auth.register.country')} countries={config.countries} selected={form.country} onSelect={set('country')} anchorRef={errors.anchor('country')} />
          <FormField
            label={t('auth.register.phone')}
            latin
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            value={form.phone}
            onChangeText={(value) => set('phone')(value.replace(/\D+/g, '').replace(/^0+/, ''))}
            placeholder={phoneExample || undefined}
            hint={phoneExample ? t('auth.register.phoneHint', { example: phoneExample }) : t('auth.register.phoneHintNoExample')}
            error={errors.errors.phone}
            anchorRef={errors.anchor('phone')}
          />
          <FormField
            label={t('auth.register.email')}
            latin
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            value={form.email}
            onChangeText={set('email')}
            hint={t('auth.register.emailPolicy')}
            error={errors.errors.email}
            anchorRef={errors.anchor('email')}
          />
          <FormField
            label={t('common.password')}
            latin
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            value={form.password}
            onChangeText={set('password')}
            hint={t('auth.register.passwordHint')}
            error={errors.errors.password}
            anchorRef={errors.anchor('password')}
          />

          <FieldGroup label={t('auth.register.persona')} error={errors.errors.persona} anchorRef={errors.anchor('persona')}>
            <ChipRow>
              {config.personas.map((item) => (
                <Chip key={item.key} label={tOptional(`persona.${item.key}`) ?? item.label} selected={item.key === form.persona} onPress={() => set('persona')(item.key)} />
              ))}
            </ChipRow>
          </FieldGroup>

          <FormField
            label={t('auth.register.bio')}
            multiline
            value={form.bio}
            onChangeText={set('bio')}
            error={errors.errors.bio}
            anchorRef={errors.anchor('bio')}
            placeholder={t('auth.register.bioPlaceholder')}
          />
          <FormField
            label={t('auth.register.jobTitle')}
            value={form.jobTitle}
            onChangeText={set('jobTitle')}
            error={errors.errors.jobTitle}
            anchorRef={errors.anchor('jobTitle')}
            textContentType="jobTitle"
          />
          <FormField
            label={t('auth.register.inviteCode')}
            latin
            autoCapitalize="characters"
            autoCorrect={false}
            value={form.inviteCode}
            onChangeText={set('inviteCode')}
            hint={t('auth.register.inviteCodeHint')}
            placeholder="I-0000000000"
          />

          {interestsList.data && interestsList.data.interests.length > 0 ? (
            <FieldGroup label={t('auth.register.interests')} error={errors.errors.interests} anchorRef={errors.anchor('interests')}>
              <ChipRow>
                {interestsList.data.interests.map((interest) => (
                  <Chip key={interest.key} label={interest.label} selected={form.interests.includes(interest.key)} onPress={() => toggleInterest(interest.key)} />
                ))}
              </ChipRow>
              {form.interests.includes('other') ? (
                <FadeInView offset={8}>
                  <FormField label={t('interests.otherLabel')} value={form.interestsOther} onChangeText={set('interestsOther')} placeholder={t('interests.otherPlaceholder')} maxLength={120} />
                </FadeInView>
              ) : null}
            </FieldGroup>
          ) : null}

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
}));
