import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authApi, useAuthConfig, type Persona } from '@/api/auth';
import { useNewsTopics } from '@/api/news';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { isEmail, isLocalPhone } from '@/lib/validation';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Form = {
  name: string;
  country: string;
  phone: string;
  email: string;
  password: string;
  persona: Persona | '';
  bio: string;
  jobTitle: string;
  /** News interests (optional): saved with the account right after the code is verified. */
  interests: string[];
};

const EMPTY: Form = { name: '', country: 'sa', phone: '', email: '', password: '', persona: '', bio: '', jobTitle: '', interests: [] };

export default function RegisterScreen() {
  const router = useRouter();
  const { data: config, isLoading, error: configError, refetch } = useAuthConfig();
  const topics = useNewsTopics();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const country = config?.countries.find((item) => item.code === form.country) ?? config?.countries[0];
  const set = (key: Exclude<keyof Form, 'interests'>) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const toggleInterest = (key: string) =>
    setForm((current) => ({ ...current, interests: current.interests.includes(key) ? current.interests.filter((item) => item !== key) : [...current.interests, key] }));

  const validate = (): boolean => {
    const next: Partial<Record<keyof Form, string>> = {};
    if (form.name.trim().length < 2) next.name = 'الاسم مطلوب';
    if (!isLocalPhone(form.phone, country?.pattern)) next.phone = `اكتب الرقم بهذا الشكل: ${country?.example ?? '0558318777'}`;
    if (!isEmail(form.email)) next.email = 'اكتب بريدًا إلكترونيًا صحيحًا';
    if (form.password.length < 6) next.password = 'كلمة المرور 6 أحرف على الأقل';
    if (!form.persona) next.persona = 'اختر فئتك في النادي';
    if (form.bio.trim().length < 10) next.bio = 'اكتب نبذة مختصرة عنك (سطر على الأقل)';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (busy || !validate() || !form.persona) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await authApi.register({
        name: form.name.trim(),
        country: form.country,
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
        persona: form.persona,
        bio: form.bio.trim(),
        jobTitle: form.jobTitle.trim() || undefined,
      });
      router.push({
        pathname: '/auth/verify',
        params: { pendingToken: result.pendingToken, email: result.email, text: result.text, interests: form.interests.join(',') },
      });
    } catch (cause) {
      setSubmitError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <Screen title="إنشاء حساب">
        <StateView loading={isLoading} error={configError} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  if (!config.registrationOpen) {
    return (
      <Screen title="إنشاء حساب">
        <Notice tone="warning" text="التسجيل غير متاح في النسخة التجريبية حاليًا. سجّل الدخول بحساب الإدارة." />
        <AppButton label="تسجيل الدخول" variant="outline" icon="log-in-outline" onPress={() => router.replace('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen title="إنشاء حساب" subtitle="حساب واحد لكل مواقع المنظومة والتطبيق.">
      <Notice text={config.phonePolicy} />
      <FormField label="الاسم الكامل" value={form.name} onChangeText={set('name')} error={errors.name} textContentType="name" />
      <View style={styles.group}>
        <Text style={styles.label}>الدولة</Text>
        <View style={styles.chips}>
          {config.countries.map((item) => (
            <Chip key={item.code} label={`${item.flag} ${item.name}`} selected={item.code === form.country} onPress={() => set('country')(item.code)} />
          ))}
        </View>
      </View>
      <FormField
        label="رقم الجوال"
        latin
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        value={form.phone}
        onChangeText={set('phone')}
        placeholder={country?.example}
        hint={`بدون مسافات وبدون رمز الدولة، مثال: ${country?.example ?? '0558318777'}`}
        error={errors.phone}
      />
      <FormField
        label="البريد الإلكتروني"
        latin
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        value={form.email}
        onChangeText={set('email')}
        hint={config.emailPolicy}
        error={errors.email}
      />
      <FormField
        label="كلمة المرور"
        latin
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        value={form.password}
        onChangeText={set('password')}
        hint="6 أحرف على الأقل"
        error={errors.password}
      />
      <View style={styles.group}>
        <Text style={styles.label}>فئتك في النادي</Text>
        {config.personas.map((item) => {
          const selected = item.key === form.persona;
          return (
            <Pressable
              key={item.key}
              onPress={() => set('persona')(item.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.persona, selected && styles.personaSelected, pressed && styles.pressed]}
            >
              <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.gold : colors.textMuted} />
              <Text style={[styles.personaText, selected && styles.personaTextSelected]}>{item.label}</Text>
            </Pressable>
          );
        })}
        {errors.persona ? <Text style={styles.error}>{errors.persona}</Text> : null}
      </View>
      <FormField label="نبذة مختصرة عنك" multiline value={form.bio} onChangeText={set('bio')} error={errors.bio} placeholder="مجالك، خبرتك، أو ما تبحث عنه في النادي" />
      <FormField label="المسمى الوظيفي (اختياري)" value={form.jobTitle} onChangeText={set('jobTitle')} textContentType="jobTitle" />
      {topics.data && topics.data.topics.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.label}>اهتماماتك في الأخبار (اختياري)</Text>
          <View style={styles.chips}>
            {topics.data.topics.map((topic) => (
              <Chip key={topic.key} label={topic.label} selected={form.interests.includes(topic.key)} onPress={() => toggleInterest(topic.key)} />
            ))}
          </View>
        </View>
      ) : null}
      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
      <AppButton label={busy ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'} icon="person-add-outline" onPress={() => void submit()} />
      <Text style={styles.footnote}>بعد إنشاء الحساب يصلك رمز تفعيل على بريدك الإلكتروني.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  persona: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  personaSelected: { borderColor: colors.gold, backgroundColor: colors.surfaceElevated },
  pressed: { opacity: 0.8 },
  personaText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: 'right' },
  personaTextSelected: { color: colors.textPrimary },
  error: { ...typography.caption, color: colors.danger, textAlign: 'right' },
  footnote: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
