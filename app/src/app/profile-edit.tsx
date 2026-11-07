import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { authApi, useAuthConfig, type PhoneStepResult, type ProfilePatch } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { ChipRow } from '@/components/form/FormParts';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { Screen } from '@/components/Screen';
import { VoiceFill } from '@/components/VoiceFill';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { localPhoneDigits, phoneIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

export default function ProfileEditScreen() {
  const router = useRouter();
  // M203: a sign-in that passed by e-mail lands here: the number on file never received its code.
  const { fixPhone } = useLocalSearchParams<{ fixPhone?: string }>();
  const { me, setMe } = useAuth();
  const { data: config } = useAuthConfig();
  // The member changes the mobile number from here (owner, 2026-10-30); the e-mail stays the account's
  // identity and only the club's admins change it. The number is sent only when it was actually edited.
  // M215: the +966 picker already stands beside the field, so the saved 05… shows without its zero; an untouched number is not sent.
  const [phone, setPhone] = useState(localPhoneDigits(me?.phone ?? ''));
  const [countryCode, setCountryCode] = useState('sa');
  const country = config?.countries.find((item) => item.code === countryCode) ?? config?.countries[0];
  const phoneChanged = phone !== localPhoneDigits(me?.phone ?? '');
  // M161 (owner): the contact e-mail (invoices, club mails) is the member's to change; the sign-in e-mail is not.
  const [contactEmail, setContactEmail] = useState(me?.contactEmail ?? '');
  const contactEmailChanged = contactEmail.trim().toLowerCase() !== (me?.contactEmail ?? '').trim().toLowerCase();
  const [form, setForm] = useState({
    name: me?.name ?? '',
    jobTitle: me?.jobTitle ?? '',
    company: me?.company ?? '',
    city: me?.city ?? '',
    website: me?.website ?? '',
    bio: me?.bio ?? '',
    social: me?.social ?? '',
  });
  // M203: asked later, here, instead of at sign-up.
  const [memberType, setMemberType] = useState<'individual' | 'company' | ''>(me?.memberType ?? '');
  const [step, setStep] = useState<PhoneStepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (busy) return;
    if (form.name.trim().length < 2) {
      setError(t('profile.nameRequired'));
      return;
    }
    if (phoneChanged && phoneIssue(phone, country) !== null) {
      setError(t('profile.phoneInvalid'));
      return;
    }
    if (contactEmailChanged && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail.trim())) {
      setError(t('profile.contactEmailInvalid'));
      return;
    }
    const patch: ProfilePatch = {
      name: form.name.trim(),
      jobTitle: form.jobTitle.trim(),
      company: form.company.trim(),
      city: form.city.trim(),
      website: form.website.trim(),
      bio: form.bio.trim(),
      social: form.social.trim(),
    };
    if (memberType && memberType !== (me?.memberType ?? '')) patch.memberType = memberType;
    if (contactEmailChanged) patch.contactEmail = contactEmail.trim().toLowerCase();
    setBusy(true);
    setError(null);
    try {
      const { me: updated } = await authApi.updateMe(patch);
      setMe(updated);
      // M203: a new number is saved only after its WhatsApp code.
      if (phoneChanged) {
        const started = await authApi.phoneStart(phone.trim(), countryCode);
        if ('saved' in started) setMe(started.me);
        else {
          setStep(started);
          return;
        }
      }
      router.back();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <Screen title={t('profile.title')}>
        <Notice tone="warning" text={t('profile.signInFirst')} />
      </Screen>
    );
  }

  if (step) {
    return (
      <Screen title={t('phoneCode.title')} subtitle={t('phoneCode.subtitle')}>
        <FadeInView delay={entranceDelay(0)}>
          <PhoneCodeStep
            step={step}
            onBack={() => setStep(null)}
            onSubmit={async (code) => {
              const { me: updated } = await authApi.phoneConfirm(step.stepToken, code);
              setMe(updated);
              router.back();
            }}
          />
        </FadeInView>
      </Screen>
    );
  }

  return (
    <Screen title={t('profile.title')} subtitle={t('profile.subtitle')}>
      {fixPhone ? (
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="warning" text={t('phoneCode.fixPhone')} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(0)}>
        <VoiceFill
          fields={[
            { key: 'name', label: t('profile.name'), type: 'text', required: true },
            { key: 'jobTitle', label: t('profile.jobTitle'), type: 'text' },
            { key: 'company', label: t('profile.company'), type: 'text' },
            { key: 'city', label: t('profile.city'), type: 'text' },
            { key: 'website', label: t('profile.website'), type: 'text' },
            { key: 'bio', label: t('profile.bio'), type: 'textarea' },
            { key: 'social', label: t('profile.social'), type: 'textarea' },
          ]}
          values={{ name: form.name, jobTitle: form.jobTitle, company: form.company, city: form.city, website: form.website, bio: form.bio, social: form.social }}
          onFill={(values) => setForm((current) => ({ ...current, ...values }))}
        />
        <FormField label={t('profile.name')} value={form.name} onChangeText={set('name')} textContentType="name" />
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <FormField label={t('profile.email')} latin editable={false} value={me.email} hint={t('profile.emailLocked')} />
        {/* Owner (2026-11-03): two e-mail boxes confused members — the contact e-mail shows only when the
            sign-in address is an Apple relay or missing. */}
        {me.emailRelay || !me.email ? (
          <FormField
            label={t('profile.contactEmail')}
            latin
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            value={contactEmail}
            onChangeText={setContactEmail}
            hint={t('profile.contactEmailHint')}
          />
        ) : null}
        {config ? (
          <View style={styles.group}>
            <Text style={styles.label}>{t('profile.country')}</Text>
            <CountryPicker countries={config.countries} selected={countryCode} onSelect={setCountryCode} />
          </View>
        ) : null}
        <FormField
          label={t('profile.phone')}
          latin
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          value={phone}
          onChangeText={(value) => setPhone(localPhoneDigits(value, country))}
          placeholder={country?.example ? country.example.replace(/^0+/, '') : undefined}
          hint={`${t('profile.phoneHint')} ${t('phoneCode.phoneHint')}`}
        />
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <View style={styles.group}>
          <Text style={styles.label}>{t('auth.register.memberType')}</Text>
          <ChipRow>
            <Chip label={t('auth.register.memberType.individual')} selected={memberType === 'individual'} onPress={() => setMemberType('individual')} />
            <Chip label={t('auth.register.memberType.company')} selected={memberType === 'company'} onPress={() => setMemberType('company')} />
          </ChipRow>
        </View>
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <FormField label={t('profile.jobTitle')} value={form.jobTitle} onChangeText={set('jobTitle')} textContentType="jobTitle" />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <FormField label={t('profile.company')} value={form.company} onChangeText={set('company')} textContentType="organizationName" />
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <FormField label={t('profile.city')} value={form.city} onChangeText={set('city')} textContentType="addressCity" />
      </FadeInView>
      <FadeInView delay={entranceDelay(4)}>
        <FormField label={t('profile.website')} latin autoCapitalize="none" keyboardType="url" value={form.website} onChangeText={set('website')} placeholder="https://" />
      </FadeInView>
      <FadeInView delay={entranceDelay(5)}>
        <FormField label={t('profile.bio')} multiline value={form.bio} onChangeText={set('bio')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(6)}>
        <FormField label={t('profile.social')} latin autoCapitalize="none" multiline value={form.social} onChangeText={set('social')} hint={t('profile.socialHint')} />
      </FadeInView>
      {/* M198 (owner): the password changed from here once — it now lives in حسابي ← إعدادات الأمان only. */}
      {error ? (
        <FadeInView offset={6}>
          <Text style={styles.error}>{error}</Text>
          <SupportLink problem={error} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(7)}>
        <AppButton label={busy ? t('profile.saving') : t('profile.save')} icon="save-outline" loading={busy} onPress={() => void save()} />
      </FadeInView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  group: { gap: spacing.xs, marginBottom: spacing.sm },
  label: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
}));
