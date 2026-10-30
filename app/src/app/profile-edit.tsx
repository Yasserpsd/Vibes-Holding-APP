import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { authApi, useAuthConfig, type ProfilePatch } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { CountryPicker } from '@/components/CountryPicker';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { VoiceFill } from '@/components/VoiceFill';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { phoneIssue } from '@/lib/validation';
import { colors, spacing, typography } from '@/theme/tokens';

export default function ProfileEditScreen() {
  const router = useRouter();
  const { me, setMe } = useAuth();
  const { data: config } = useAuthConfig();
  // The member changes the mobile number from here (owner, 2026-10-30); the e-mail stays the account's
  // identity and only the club's admins change it. The number is sent only when it was actually edited.
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [countryCode, setCountryCode] = useState('sa');
  const country = config?.countries.find((item) => item.code === countryCode) ?? config?.countries[0];
  const phoneChanged = phone.trim() !== (me?.phone ?? '').trim();
  const [form, setForm] = useState({
    name: me?.name ?? '',
    jobTitle: me?.jobTitle ?? '',
    company: me?.company ?? '',
    city: me?.city ?? '',
    website: me?.website ?? '',
    bio: me?.bio ?? '',
    social: me?.social ?? '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (busy) return;
    if (form.name.trim().length < 2) {
      setError(t('profile.nameRequired'));
      return;
    }
    if (form.password && form.password.length < 6) {
      setError(t('profile.passwordShort'));
      return;
    }
    if (phoneChanged && phoneIssue(phone, country) !== null) {
      setError(t('profile.phoneInvalid'));
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
    if (form.password) patch.password = form.password;
    if (phoneChanged) {
      patch.phone = phone.trim();
      patch.country = countryCode;
    }
    setBusy(true);
    setError(null);
    try {
      const { me: updated } = await authApi.updateMe(patch);
      setMe(updated);
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

  return (
    <Screen title={t('profile.title')} subtitle={t('profile.subtitle')}>
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
          onChangeText={setPhone}
          placeholder={country?.example ? country.example.replace(/^0+/, '') : undefined}
          hint={t('profile.phoneHint')}
        />
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
      <FadeInView delay={entranceDelay(7)}>
        <FormField label={t('profile.newPassword')} latin secureTextEntry autoCapitalize="none" textContentType="newPassword" value={form.password} onChangeText={set('password')} hint={t('profile.newPasswordHint')} />
      </FadeInView>
      {error ? (
        <FadeInView offset={6}>
          <Text style={styles.error}>{error}</Text>
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(8)}>
        <AppButton label={busy ? t('profile.saving') : t('profile.save')} icon="save-outline" loading={busy} onPress={() => void save()} />
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  group: { gap: spacing.xs, marginBottom: spacing.sm },
  label: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});
