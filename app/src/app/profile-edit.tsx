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
      setError('الاسم مطلوب');
      return;
    }
    if (form.password && form.password.length < 6) {
      setError('كلمة المرور الجديدة 6 أحرف على الأقل');
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
      <Screen title="تعديل الملف الشخصي">
        <Notice tone="warning" text="سجّل الدخول أولًا." />
      </Screen>
    );
  }

  return (
    <Screen title="تعديل الملف الشخصي" subtitle="البريد الإلكتروني ورقم الجوال يتغيّران عبر إدارة النادي.">
      <FormField label="الاسم الكامل" value={form.name} onChangeText={set('name')} textContentType="name" />
      <FormField label="المسمى الوظيفي" value={form.jobTitle} onChangeText={set('jobTitle')} textContentType="jobTitle" />
      <FormField label="الشركة" value={form.company} onChangeText={set('company')} textContentType="organizationName" />
      <FormField label="المدينة" value={form.city} onChangeText={set('city')} textContentType="addressCity" />
      <FormField label="موقع الشركة" latin autoCapitalize="none" keyboardType="url" value={form.website} onChangeText={set('website')} placeholder="https://" />
      <FormField label="نبذة مختصرة" multiline value={form.bio} onChangeText={set('bio')} />
      <FormField label="روابط التواصل الاجتماعي" latin autoCapitalize="none" multiline value={form.social} onChangeText={set('social')} hint="رابط في كل سطر" />
      <FormField label="كلمة مرور جديدة (اختياري)" latin secureTextEntry autoCapitalize="none" textContentType="newPassword" value={form.password} onChangeText={set('password')} hint="اتركه فارغًا إن لم ترد تغييرها" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'} icon="save-outline" onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: 'right' },
});
