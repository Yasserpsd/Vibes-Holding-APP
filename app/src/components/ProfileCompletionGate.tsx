import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi, useAuthConfig, type Persona } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { interestsApi, useInterests } from '@/api/interests';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PaperCard } from '@/components/paper';
import { VoiceFill } from '@/components/VoiceFill';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { phoneIssue } from '@/lib/validation';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const NAVY = '#0d274a';
const PERSONAS: Persona[] = ['neutral', 'entrepreneur', 'investor'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** M156: a real name is at least two words of two letters each (the server applies the full rule). */
const twoWords = (value: string) => value.trim().split(/\s+/).filter((word) => word.length >= 2).length >= 2;

/**
 * M147 «أكمل ملفك» (owner: «إجباري يكمل باقي البيانات بمجرد ما يسجل دخول»): a Google/Apple-born
 * account lands with a name and an e-mail only. While the server lists missing fields, this cover
 * sits over the whole app and nothing else is usable until the member saves them. The hub then
 * mails the admins «اكتمل تسجيل عضو» (plugin 2.21.3). Admins and older servers (no list) are never
 * blocked. M156 (owner, 2026-10-29) adds the job, a real first + family name (a kunya such as
 * «أبو جنا» is sent back here) and, for an Apple «Hide My Email» account, the real address his
 * invoices and membership confirmations go to.
 */
export function ProfileCompletionGate() {
  const { status, me } = useAuth();
  if (status !== 'signedIn' || !me || me.isAdmin || !me.profileMissing?.length) return null;
  return <CompletionForm missing={me.profileMissing} />;
}

function CompletionForm({ missing }: { missing: NonNullable<ReturnType<typeof useAuth>['me']>['profileMissing'] }) {
  const { me, setMe } = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const configQuery = useAuthConfig();
  const config = configQuery.data;
  const interestsList = useInterests();
  const need = (key: string) => (missing ?? []).includes(key as never);
  // M165 (owner, 2026-10-31): the country, phone, persona and interests fields are drawn from two server
  // answers. Until both are here the member sees a spinner, never an empty card; a failure shows a
  // retry button and retries by itself, so nobody has to close and reopen the app to get the fields.
  const needsConfig = need('phone') || need('persona');
  const needsInterests = need('interests');
  const waiting = (needsConfig && !config) || (needsInterests && !interestsList.data);
  const fetching = (needsConfig && configQuery.isFetching) || (needsInterests && interestsList.isFetching);
  const failed = waiting && !fetching;
  const retryFields = () => {
    if (needsConfig && !config) void configQuery.refetch();
    if (needsInterests && !interestsList.data) void interestsList.refetch();
  };
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(retryFields, 15_000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryFields reads the latest queries when it fires
  }, [failed]);
  const [name, setName] = useState(me?.name ?? '');
  const [contactEmail, setContactEmail] = useState(me?.contactEmail ?? '');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('sa');
  const [persona, setPersona] = useState<Persona | ''>('');
  const [interests, setInterests] = useState<string[]>([]);
  const [interestsOther, setInterestsOther] = useState('');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [jobTitle, setJobTitle] = useState(me?.jobTitle ?? '');
  const [company, setCompany] = useState(me?.company ?? '');
  const [memberType, setMemberType] = useState<'individual' | 'company' | ''>(me?.memberType || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = config?.countries.find((item) => item.code === countryCode) ?? config?.countries[0];
  const maxInterests = interestsList.data?.max ?? 3;
  const toggleInterest = (key: string) =>
    setInterests((current) => (current.includes(key) ? current.filter((item) => item !== key) : current.length >= maxInterests ? current : [...current, key]));

  const submit = async () => {
    if (busy) return;
    if (need('name') && !twoWords(name)) return setError(t('completeProfile.error.name'));
    if (need('contactEmail') && !EMAIL.test(contactEmail.trim())) return setError(t('completeProfile.error.contactEmail'));
    if (need('memberType') && !memberType) return setError(t('completeProfile.error.memberType'));
    const wantsCompany = memberType === 'company' || (need('company') && !need('memberType'));
    if (wantsCompany && company.trim().length < 2) return setError(t('completeProfile.error.company'));
    if (need('phone') && phoneIssue(phone, country) !== null) return setError(t('completeProfile.error.phone'));
    if (need('persona') && !persona) return setError(t('completeProfile.error.persona'));
    if (need('interests') && interests.length === 0) return setError(t('completeProfile.error.interests'));
    if (need('bio') && bio.trim().length < 10) return setError(t('completeProfile.error.bio'));
    if (need('jobTitle') && jobTitle.trim().length < 2) return setError(t('completeProfile.error.jobTitle'));
    setBusy(true);
    setError(null);
    try {
      if (need('interests')) await interestsApi.save({ keys: interests, other: interests.includes('other') ? interestsOther : '' });
      const { me: updated } = await authApi.updateMe({
        ...(need('name') ? { name: name.trim() } : {}),
        ...(need('contactEmail') ? { contactEmail: contactEmail.trim().toLowerCase() } : {}),
        ...(need('memberType') && memberType ? { memberType } : {}),
        ...(wantsCompany ? { company: company.trim() } : {}),
        ...(need('phone') ? { phone: phone.trim(), country: countryCode } : {}),
        ...(need('persona') && persona ? { persona } : {}),
        ...(need('interests') ? { interests, interestsOther } : {}),
        ...(need('bio') ? { bio: bio.trim() } : {}),
        ...(need('jobTitle') ? { jobTitle: jobTitle.trim() } : {}),
      });
      setMe(updated);
      void queryClient.invalidateQueries({ queryKey: ['interests'] });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.cover}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <Image source={require('../../assets/images/club-logo.png')} style={styles.emblem} resizeMode="contain" />
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={22} color={NAVY} />
            <Text style={styles.title}>{t('completeProfile.title', { name: me?.name ?? '' })}</Text>
          </View>
          <Text style={styles.body}>{t('completeProfile.body')}</Text>

          <PaperCard pinned>
          <VoiceFill
            fields={[
              ...(need('name') ? [{ key: 'name', label: t('completeProfile.name'), type: 'text' as const, required: true }] : []),
              ...(need('company') || memberType === 'company' ? [{ key: 'company', label: t('auth.register.companyName'), type: 'text' as const, required: true }] : []),
              ...(need('phone') ? [{ key: 'phone', label: t('auth.register.phone'), type: 'phone' as const, required: true }] : []),
              ...(need('persona') && config ? [{ key: 'persona', label: t('completeProfile.persona'), type: 'select' as const, options: config.personas.map((item) => item.label), required: true }] : []),
              ...(need('interests') && interestsList.data
                ? [{ key: 'interests', label: t('auth.register.interests'), type: 'multiselect' as const, options: interestsList.data.interests.map((item) => item.label), required: true }]
                : []),
              ...(need('bio') ? [{ key: 'bio', label: t('auth.register.bio'), type: 'textarea' as const, required: true }] : []),
              ...(need('jobTitle') ? [{ key: 'jobTitle', label: t('completeProfile.jobTitle'), type: 'text' as const, required: true }] : []),
            ]}
            values={{
              name,
              company,
              phone,
              persona: config?.personas.find((item) => item.key === persona)?.label ?? '',
              interests: interests.map((key) => interestsList.data?.interests.find((item) => item.key === key)?.label ?? '').filter(Boolean).join('، '),
              bio,
              jobTitle,
            }}
            country={countryCode}
            disabled={waiting}
            onFill={(values) => {
              if (values.name) setName(values.name);
              if (values.company) setCompany(values.company);
              if (values.phone) setPhone(values.phone);
              const pickedPersona = config?.personas.find((item) => item.label === values.persona)?.key;
              if (pickedPersona) setPersona(pickedPersona);
              if (values.interests) {
                const keys = values.interests
                  .split('، ')
                  .map((label) => interestsList.data?.interests.find((item) => item.label === label)?.key)
                  .filter((key): key is string => Boolean(key))
                  .slice(0, maxInterests);
                if (keys.length) setInterests(keys);
              }
              if (values.bio) setBio(values.bio);
              if (values.jobTitle) setJobTitle(values.jobTitle);
            }}
          />

          {need('name') ? <FormField label={t('completeProfile.name')} value={name} onChangeText={setName} hint={t('completeProfile.nameHint')} textContentType="name" /> : null}

          {need('contactEmail') ? (
            <View style={styles.group}>
              {/* Owner (2026-10-30): the member must understand WHY — invoices and every contact go to this address only. */}
              <Notice text={t('completeProfile.contactEmailWhy')} />
              <FormField
                label={t('completeProfile.contactEmail')}
                value={contactEmail}
                onChangeText={setContactEmail}
                hint={t('completeProfile.contactEmailHint')}
                latin
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
              />
            </View>
          ) : null}

          {need('memberType') ? (
            <View style={styles.group}>
              <Text style={styles.label}>{t('auth.register.memberType')}</Text>
              <View style={styles.chips}>
                <Chip label={t('auth.register.memberType.individual')} selected={memberType === 'individual'} onPress={() => setMemberType('individual')} />
                <Chip label={t('auth.register.memberType.company')} selected={memberType === 'company'} onPress={() => setMemberType('company')} />
              </View>
            </View>
          ) : null}

          {need('company') || memberType === 'company' ? <FormField label={t('auth.register.companyName')} value={company} onChangeText={setCompany} textContentType="organizationName" /> : null}

          {need('phone') && config ? (
            <View style={styles.group}>
              <Text style={styles.label}>{t('auth.register.country')}</Text>
              <CountryPicker countries={config.countries} selected={countryCode} onSelect={setCountryCode} />
              <FormField
                label={t('auth.register.phone')}
                value={phone}
                onChangeText={setPhone}
                latin
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                placeholder={country?.example ? country.example.replace(/^0+/, '') : undefined}
              />
            </View>
          ) : null}

          {need('persona') && config ? (
            <View style={styles.group}>
              <Text style={styles.label}>{t('completeProfile.persona')}</Text>
              <View style={styles.chips}>
                {PERSONAS.map((key) => {
                  const item = config.personas.find((entry) => entry.key === key);
                  return item ? <Chip key={key} label={item.label} selected={persona === key} onPress={() => setPersona(key)} /> : null;
                })}
              </View>
            </View>
          ) : null}

          {need('interests') && interestsList.data ? (
            <View style={styles.group}>
              <Text style={styles.label}>{t('auth.register.interests')}</Text>
              <View style={styles.chips}>
                {interestsList.data.interests.map((interest) => (
                  <Chip key={interest.key} label={interest.label} selected={interests.includes(interest.key)} onPress={() => toggleInterest(interest.key)} />
                ))}
              </View>
              {interests.includes('other') ? <FormField label={t('interests.otherLabel')} value={interestsOther} onChangeText={setInterestsOther} maxLength={120} /> : null}
            </View>
          ) : null}

          {need('bio') ? <FormField label={t('auth.register.bio')} multiline value={bio} onChangeText={setBio} placeholder={t('auth.register.bioPlaceholder')} maxLength={600} /> : null}

          {need('jobTitle') ? <FormField label={t('completeProfile.jobTitle')} value={jobTitle} onChangeText={setJobTitle} textContentType="jobTitle" /> : null}

          {waiting && !failed ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.gold} />
              <Text style={styles.loadingText}>{t('completeProfile.loading')}</Text>
            </View>
          ) : null}
          {failed ? (
            <View style={styles.group}>
              <Notice tone="warning" text={t('completeProfile.loadFailed')} />
              <AppButton label={t('common.retry')} icon="refresh-outline" variant="outline" onPress={retryFields} />
            </View>
          ) : null}

          {error ? <Notice tone="warning" text={error} /> : null}
          </PaperCard>
          <AppButton label={busy ? t('completeProfile.saving') : t('completeProfile.save')} icon="checkmark-circle-outline" loading={busy} disabled={waiting} onPress={() => void submit()} />
          <Text style={styles.foot}>{t('completeProfile.foot')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 900, elevation: 900, backgroundColor: colors.white },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  emblem: { width: 110, height: 110, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: NAVY, textAlign: 'center' },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 25, color: '#111827', textAlign: 'center' },
  group: { gap: spacing.xs },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  loadingText: { ...typography.caption, color: '#374151' },
  label: { ...typography.caption, fontFamily: fonts.semiBold, fontSize: 14, color: '#111827', textAlign: textStart },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  foot: { ...typography.caption, color: '#374151', textAlign: 'center', borderRadius: radii.md },
});
