import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { authApi, useAuthConfig, type Persona } from '@/api/auth';
import { useNewsTopics } from '@/api/news';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView, PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SocialButtons } from '@/components/SocialButtons';
import { StateView } from '@/components/StateView';
import { t, tOptional } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { isEmail, isLocalPhone } from '@/lib/validation';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

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
  /** News interests (optional): saved with the account right after the code is verified. */
  interests: string[];
};

const EMPTY: Form = { name: '', memberType: 'individual', companyName: '', country: 'sa', phone: '', email: '', password: '', persona: '', bio: '', jobTitle: '', inviteCode: '', interests: [] };

const MEMBER_TYPES = ['individual', 'company'] as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A persona radio row that dips under the finger like every V2 surface. Kept local (instead of
 * PressScale) because the radio needs `accessibilityState={{ selected }}` on the pressable itself.
 */
function PersonaRow({ selected, onPress, children }: { selected: boolean; onPress: () => void; children: ReactNode }) {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) => Animated.spring(scale, { toValue: value, speed: 40, bounciness: 5, useNativeDriver: true }).start();
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.persona, selected && styles.personaSelected, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

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
    if (form.name.trim().length < 2) next.name = t('auth.register.error.name');
    if (form.memberType === 'company' && form.companyName.trim().length < 2) next.companyName = t('auth.register.error.companyName');
    if (!isLocalPhone(form.phone, country?.pattern))
      next.phone = country?.example ? t('auth.register.error.phone', { example: country.example }) : t('auth.register.error.phoneNoExample');
    if (!isEmail(form.email)) next.email = t('auth.register.error.email');
    if (form.password.length < 6) next.password = t('auth.register.error.password');
    if (!form.persona) next.persona = t('auth.register.error.persona');
    if (form.bio.trim().length < 10) next.bio = t('auth.register.error.bio');
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
    <Screen title={t('auth.register.title')} subtitle={t('auth.register.subtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <SocialButtons onError={setSubmitError} />
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <Notice text={t('auth.register.phonePolicy')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <FormField label={t('auth.register.name')} value={form.name} onChangeText={set('name')} error={errors.name} textContentType="name" />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)} style={styles.group}>
        <Text style={styles.label}>{t('auth.register.memberType')}</Text>
        <View style={styles.memberTypes}>
          {MEMBER_TYPES.map((item) => {
            const selected = item === form.memberType;
            return (
              <View key={item} style={styles.memberType}>
                <PersonaRow selected={selected} onPress={() => setForm((current) => ({ ...current, memberType: item }))}>
                  {selected ? (
                    <PopIn>
                      <Ionicons name="radio-button-on" size={20} color={colors.gold} />
                    </PopIn>
                  ) : (
                    <Ionicons name="radio-button-off" size={20} color={colors.textMuted} />
                  )}
                  <Text style={[styles.personaText, selected && styles.personaTextSelected]}>{t(`auth.register.memberType.${item}`)}</Text>
                </PersonaRow>
              </View>
            );
          })}
        </View>
        {form.memberType === 'company' ? (
          <FadeInView offset={8}>
            <FormField
              label={t('auth.register.companyName')}
              value={form.companyName}
              onChangeText={set('companyName')}
              error={errors.companyName}
              textContentType="organizationName"
            />
          </FadeInView>
        ) : null}
      </FadeInView>
      <FadeInView delay={entranceDelay(3)} style={styles.group}>
        <Text style={styles.label}>{t('auth.register.country')}</Text>
        <CountryPicker countries={config.countries} selected={form.country} onSelect={set('country')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(4)}>
        <FormField
          label={t('auth.register.phone')}
          latin
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          value={form.phone}
          onChangeText={set('phone')}
          placeholder={country?.example || undefined}
          hint={country?.example ? t('auth.register.phoneHint', { example: country.example }) : t('auth.register.phoneHintNoExample')}
          error={errors.phone}
        />
      </FadeInView>
      <FadeInView delay={entranceDelay(5)}>
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
          error={errors.email}
        />
      </FadeInView>
      <FadeInView delay={entranceDelay(6)}>
        <FormField
          label={t('common.password')}
          latin
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
          value={form.password}
          onChangeText={set('password')}
          hint={t('auth.register.passwordHint')}
          error={errors.password}
        />
      </FadeInView>
      <FadeInView delay={entranceDelay(7)} style={styles.group}>
        <Text style={styles.label}>{t('auth.register.persona')}</Text>
        {config.personas.map((item) => {
          const selected = item.key === form.persona;
          return (
            <PersonaRow key={item.key} selected={selected} onPress={() => set('persona')(item.key)}>
              {selected ? (
                <PopIn>
                  <Ionicons name="radio-button-on" size={20} color={colors.gold} />
                </PopIn>
              ) : (
                <Ionicons name="radio-button-off" size={20} color={colors.textMuted} />
              )}
              <Text style={[styles.personaText, selected && styles.personaTextSelected]}>{tOptional(`persona.${item.key}`) ?? item.label}</Text>
            </PersonaRow>
          );
        })}
        {errors.persona ? (
          <FadeInView offset={8}>
            <Text style={styles.error}>{errors.persona}</Text>
          </FadeInView>
        ) : null}
      </FadeInView>
      <FadeInView delay={entranceDelay(8)}>
        <FormField label={t('auth.register.bio')} multiline value={form.bio} onChangeText={set('bio')} error={errors.bio} placeholder={t('auth.register.bioPlaceholder')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(9)}>
        <FormField label={t('auth.register.jobTitle')} value={form.jobTitle} onChangeText={set('jobTitle')} textContentType="jobTitle" />
      </FadeInView>
      <FadeInView delay={entranceDelay(10)}>
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
      </FadeInView>
      {topics.data && topics.data.topics.length > 0 ? (
        <FadeInView delay={entranceDelay(11)} style={styles.group}>
          <Text style={styles.label}>{t('auth.register.interests')}</Text>
          <View style={styles.chips}>
            {topics.data.topics.map((topic) => (
              <Chip key={topic.key} label={topic.label} selected={form.interests.includes(topic.key)} onPress={() => toggleInterest(topic.key)} />
            ))}
          </View>
        </FadeInView>
      ) : null}
      {submitError ? (
        <FadeInView offset={8}>
          <Text style={styles.error}>{submitError}</Text>
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(12)}>
        <AppButton label={t('auth.register.submit')} icon="person-add-outline" loading={busy} onPress={() => void submit()} />
      </FadeInView>
      <FadeInView delay={entranceDelay(13)}>
        <Text style={styles.footnote}>{t('auth.register.footnote')}</Text>
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  // M69: «فرد / شركة» side by side right under the name field.
  memberTypes: { flexDirection: 'row', gap: spacing.sm },
  memberType: { flex: 1 },
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
  // The chosen persona lights up: soft gold fill, hairline gold border, a whisper of neon.
  personaSelected: { borderColor: colors.borderGold, backgroundColor: colors.goldSoft, boxShadow: shadows.glowGoldFaint },
  personaText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart },
  personaTextSelected: { color: colors.goldLight },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  footnote: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
