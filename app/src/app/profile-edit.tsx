import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi, type ProfilePatch } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, typography } from '@/theme/tokens';

export default function ProfileEditScreen() {
  const router = useRouter();
  const { me, setMe } = useAuth();
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
      <FormField label={t('profile.name')} value={form.name} onChangeText={set('name')} textContentType="name" />
      <FormField label={t('profile.jobTitle')} value={form.jobTitle} onChangeText={set('jobTitle')} textContentType="jobTitle" />
      <FormField label={t('profile.company')} value={form.company} onChangeText={set('company')} textContentType="organizationName" />
      <FormField label={t('profile.city')} value={form.city} onChangeText={set('city')} textContentType="addressCity" />
      <FormField label={t('profile.website')} latin autoCapitalize="none" keyboardType="url" value={form.website} onChangeText={set('website')} placeholder="https://" />
      <FormField label={t('profile.bio')} multiline value={form.bio} onChangeText={set('bio')} />
      <FormField label={t('profile.social')} latin autoCapitalize="none" multiline value={form.social} onChangeText={set('social')} hint={t('profile.socialHint')} />
      <FormField label={t('profile.newPassword')} latin secureTextEntry autoCapitalize="none" textContentType="newPassword" value={form.password} onChangeText={set('password')} hint={t('profile.newPasswordHint')} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? t('profile.saving') : t('profile.save')} icon="save-outline" onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
});
