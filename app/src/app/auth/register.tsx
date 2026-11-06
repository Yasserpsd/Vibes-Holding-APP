import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, Text, type ScrollView } from 'react-native';

import { authApi, useAuthConfig, type Persona } from '@/api/auth';
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
import { t, tOptional } from '@/i18n';
import { isEmail, nameIssue, phoneIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

type Form = {
  name: string;
  country: string;
  phone: string;
  email: string;
  password: string;
  persona: Persona | '';
  /** M32: another member's code; checked and stored by the server side. */
  inviteCode: string;
};

const EMPTY: Form = { name: '', country: 'sa', phone: '', email: '', password: '', persona: '', inviteCode: '' };

type Field = keyof Form;
const ORDER: Field[] = ['name', 'country', 'phone', 'email', 'password', 'persona'];

/**
 * The registration form. M195 (owner, 2026-11-04): the club identity (navy + gold, dark tone on the
 * black screen), real checks (a username is not a name, the phone follows the country's rule), red
 * borders and messages under the fields, a red summary on top and an automatic scroll to the first error.
 * M203 (owner, 2026-11-06): the short form: name, country, phone, e-mail, password, category. The code proves the
 * number on WhatsApp; job, bio, interests, member type and company are asked later in the profile (replaces M156).
 */
export default function RegisterScreen() {
  const router = useRouter();
  // M128: arriving from a failed sign-in with no account behind it — say so, plainly.
  // M203: an invite link fills the code and shows the field; otherwise it waits behind a small button.
  const { fromLogin, invite } = useLocalSearchParams<{ fromLogin?: string; invite?: string }>();
  const { data: config, isLoading, error: configError, refetch } = useAuthConfig();
  const scrollRef = useRef<ScrollView | null>(null);
  const [form, setForm] = useState<Form>({ ...EMPTY, inviteCode: invite?.trim().slice(0, 30) ?? '' });
  const [showInvite, setShowInvite] = useState(Boolean(invite?.trim()));
  const errors = useFormErrors<Field>(scrollRef);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const country = config?.countries.find((item) => item.code === form.country) ?? config?.countries[0];
  // M126 (owner): the dial code is right there, so the number never shows a leading zero.
  const phoneExample = country?.example ? country.example.replace(/^0+/, '') : '';
  const set = (key: keyof Form) => (value: string) => {
    errors.clear(key);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    // M156 (owner): a real first + family name; the server applies the full rule (kunya, placeholders, AI).
    const nameProblem = nameIssue(form.name);
    if (nameProblem) next.name = t(`form.error.name.${nameProblem}`);
    if (phoneIssue(form.phone, country) !== null) next.phone = phoneExample ? t('form.error.phone', { example: phoneExample }) : t('form.error.phoneNoExample');
    if (!isEmail(form.email)) next.email = t('form.error.email');
    if (form.password.length < 6) next.password = t('form.error.password');
    if (!form.persona) next.persona = t('form.error.persona');
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
        country: form.country,
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
        persona: form.persona,
        inviteCode: form.inviteCode.trim() || undefined,
      });
      router.push({
        pathname: '/auth/verify',
        params: { flow: 'register', pendingToken: result.pendingToken, email: result.email, text: result.text },
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
          <FormField
            label={t('auth.register.name')}
            value={form.name}
            onChangeText={set('name')}
            error={errors.errors.name}
            anchorRef={errors.anchor('name')}
            hint={t('auth.register.nameHint')}
            textContentType="name"
          />

          <CountryPicker label={t('auth.register.country')} countries={config.countries} selected={form.country} onSelect={set('country')} anchorRef={errors.anchor('country')} />
          <FormField
            label={t('auth.register.phone')}
            latin
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            value={form.phone}
            onChangeText={(value) => set('phone')(value.replace(/\D+/g, '').replace(/^0+/, ''))}
            placeholder={phoneExample || undefined}
            hint={`${phoneExample ? t('auth.register.phoneHint', { example: phoneExample }) : t('auth.register.phoneHintNoExample')} ${t('auth.register.phoneWhatsapp')}`}
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

          {showInvite ? (
          <FormField
            label={t('auth.register.inviteCode')}
            latin
            autoCapitalize="characters"
            autoCorrect={false}
            value={form.inviteCode}
            onChangeText={set('inviteCode')}
            hint={t('auth.register.inviteCodeHint')}
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
