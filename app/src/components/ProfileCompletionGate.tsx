import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi, displayProfile, useAuthConfig, type Persona } from '@/api/auth';
import { GATE_FIELDS } from '@/api/gateFields';
import { errorMessage } from '@/api/client';
import { interestsApi, useInterests } from '@/api/interests';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { ChipRow, ErrorSummary, FieldGroup } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { VoiceFill } from '@/components/VoiceFill';
import { t, tOptional } from '@/i18n';
import { isEmail, nameIssue, phoneIssue } from '@/lib/validation';
import { brand, fonts, formPalettes, radii, spacing, typography } from '@/theme/tokens';

const PERSONAS: Persona[] = ['neutral', 'entrepreneur', 'investor'];

/** The app's own wording for a persona (English in the English app); the server label is only a fallback. */
const personaLabel = (item: { key: Persona; label: string }): string => tOptional(`persona.${item.key}`) ?? item.label;

/**
 * M147 «أكمل ملفك» (owner: «إجباري يكمل باقي البيانات بمجرد ما يسجل دخول»): a Google/Apple-born
 * account lands with a name and an e-mail only. While the server lists missing fields, this cover
 * sits over the whole app and nothing else is usable until the member saves them. The hub then
 * mails the admins «اكتمل تسجيل عضو» (plugin 2.21.3). Admins and older servers (no list) are never
 * blocked. M156 (owner, 2026-10-29) adds the job, a real first + family name (a kunya such as
 * «أبو جنا» is sent back here) and, for an Apple «Hide My Email» account, the real address his
 * invoices and membership confirmations go to.
 * M195 (owner, 2026-11-04): the club identity (navy + gold on a light sheet), every field checked for
 * real (a username such as «yasser4.designer» is refused as a name), red borders and messages under
 * the fields, a red summary on top and an automatic scroll to the first error.
 */
export function ProfileCompletionGate() {
  const { status, me } = useAuth();
  // M168: a newer server may name a field this bundle has no input for — never wall the member behind it.
  const missing = (me?.profileMissing ?? []).filter((key) => (GATE_FIELDS as readonly string[]).includes(key));
  if (status !== 'signedIn' || !me || me.isAdmin || !missing.length) return null;
  return <CompletionForm missing={missing} />;
}

type Field = 'name' | 'contactEmail' | 'memberType' | 'company' | 'phone' | 'persona' | 'interests' | 'bio' | 'jobTitle';
const ORDER: Field[] = ['name', 'contactEmail', 'memberType', 'company', 'phone', 'persona', 'interests', 'bio', 'jobTitle'];

function CompletionForm({ missing }: { missing: NonNullable<ReturnType<typeof useAuth>['me']>['profileMissing'] }) {
  const { me, setMe } = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const configQuery = useAuthConfig();
  const config = configQuery.data;
  const interestsList = useInterests();
  const scrollRef = useRef<ScrollView | null>(null);
  const form = useFormErrors<Field>(scrollRef);
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
  const phoneExample = country?.example ? country.example.replace(/^0+/, '') : '';
  const maxInterests = interestsList.data?.max ?? 3;
  const toggleInterest = (key: string) => {
    form.clear('interests');
    setInterests((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (current.length >= maxInterests) {
        // Owner: the limit shows in red the moment a fourth one is tapped.
        form.set('interests', t('form.error.interests.max', { max: maxInterests }));
        return current;
      }
      return [...current, key];
    });
  };
  const wantsCompany = memberType === 'company' || (need('company') && !need('memberType'));

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    const nameProblem = need('name') ? nameIssue(name) : null;
    if (nameProblem) next.name = t(`form.error.name.${nameProblem}`);
    if (need('contactEmail') && !isEmail(contactEmail)) next.contactEmail = t('form.error.email');
    if (need('memberType') && !memberType) next.memberType = t('form.error.memberType');
    if (wantsCompany && company.trim().length < 2) next.company = t('form.error.company');
    if (need('phone') && phoneIssue(phone, country) !== null) next.phone = phoneExample ? t('form.error.phone', { example: phoneExample }) : t('form.error.phoneNoExample');
    if (need('persona') && !persona) next.persona = t('form.error.persona');
    if (need('interests') && interests.length === 0) next.interests = t('form.error.interests.min');
    if (need('bio') && bio.trim().length < 10) next.bio = t('form.error.bio');
    if (need('jobTitle') && jobTitle.trim().length < 2) next.jobTitle = t('form.error.jobTitle');
    return next;
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (form.fail(validate(), ORDER)) return;
    setBusy(true);
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

  const field = (key: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    form.clear(key);
  };

  return (
    <View style={styles.cover}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <Image source={require('../../assets/images/club-logo.png')} style={styles.emblem} resizeMode="contain" />
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={22} color={brand.navy} />
            <Text style={styles.title}>{t('completeProfile.title', { name: me ? displayProfile(me).name : '' })}</Text>
          </View>
          <Text style={styles.body}>{t('completeProfile.body')}</Text>

          <FormCard tone="light">
            <ErrorSummary count={form.count} />
            <VoiceFill
              fields={[
                ...(need('name') ? [{ key: 'name', label: t('completeProfile.name'), type: 'text' as const, required: true }] : []),
                ...(need('company') || memberType === 'company' ? [{ key: 'company', label: t('auth.register.companyName'), type: 'text' as const, required: true }] : []),
                ...(need('phone') ? [{ key: 'phone', label: t('auth.register.phone'), type: 'phone' as const, required: true }] : []),
                ...(need('persona') && config ? [{ key: 'persona', label: t('completeProfile.persona'), type: 'select' as const, options: config.personas.map(personaLabel), required: true }] : []),
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
                persona: persona ? personaLabel({ key: persona, label: config?.personas.find((item) => item.key === persona)?.label ?? '' }) : '',
                interests: interests.map((key) => interestsList.data?.interests.find((item) => item.key === key)?.label ?? '').filter(Boolean).join('، '),
                bio,
                jobTitle,
              }}
              country={countryCode}
              disabled={waiting}
              onFill={(values) => {
                form.reset();
                if (values.name) setName(values.name);
                if (values.company) setCompany(values.company);
                if (values.phone) setPhone(values.phone);
                const pickedPersona = config?.personas.find((item) => personaLabel(item) === values.persona || item.label === values.persona)?.key;
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

            {need('name') ? (
              <FormField
                label={t('completeProfile.name')}
                value={name}
                onChangeText={field('name', setName)}
                hint={t('completeProfile.nameHint')}
                error={form.errors.name}
                anchorRef={form.anchor('name')}
                textContentType="name"
              />
            ) : null}

            {need('contactEmail') ? (
              <View style={styles.group}>
                {/* Owner (2026-10-30): the member must understand WHY — invoices and every contact go to this address only. */}
                <Notice text={t('completeProfile.contactEmailWhy')} />
                <FormField
                  label={t('completeProfile.contactEmail')}
                  value={contactEmail}
                  onChangeText={field('contactEmail', setContactEmail)}
                  hint={t('completeProfile.contactEmailHint')}
                  error={form.errors.contactEmail}
                  anchorRef={form.anchor('contactEmail')}
                  latin
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                />
              </View>
            ) : null}

            {need('memberType') ? (
              <FieldGroup label={t('auth.register.memberType')} error={form.errors.memberType} anchorRef={form.anchor('memberType')}>
                <ChipRow>
                  <Chip label={t('auth.register.memberType.individual')} selected={memberType === 'individual'} onPress={() => field('memberType', setMemberType as (value: string) => void)('individual')} />
                  <Chip label={t('auth.register.memberType.company')} selected={memberType === 'company'} onPress={() => field('memberType', setMemberType as (value: string) => void)('company')} />
                </ChipRow>
              </FieldGroup>
            ) : null}

            {wantsCompany ? (
              <FormField
                label={t('auth.register.companyName')}
                value={company}
                onChangeText={field('company', setCompany)}
                error={form.errors.company}
                anchorRef={form.anchor('company')}
                textContentType="organizationName"
              />
            ) : null}

            {need('phone') && config ? (
              <View style={styles.group}>
                <CountryPicker label={t('auth.register.country')} countries={config.countries} selected={countryCode} onSelect={field('phone', setCountryCode)} />
                <FormField
                  label={t('auth.register.phone')}
                  value={phone}
                  onChangeText={(value) => field('phone', setPhone)(value.replace(/\D+/g, '').replace(/^0+/, ''))}
                  error={form.errors.phone}
                  anchorRef={form.anchor('phone')}
                  latin
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  placeholder={phoneExample || undefined}
                />
              </View>
            ) : null}

            {need('persona') && config ? (
              <FieldGroup label={t('completeProfile.persona')} error={form.errors.persona} anchorRef={form.anchor('persona')}>
                <ChipRow>
                  {PERSONAS.map((key) => {
                    const item = config.personas.find((entry) => entry.key === key);
                    return item ? <Chip key={key} label={personaLabel(item)} selected={persona === key} onPress={() => field('persona', setPersona as (value: string) => void)(key)} /> : null;
                  })}
                </ChipRow>
              </FieldGroup>
            ) : null}

            {need('interests') && interestsList.data ? (
              <FieldGroup label={t('auth.register.interests')} error={form.errors.interests} anchorRef={form.anchor('interests')}>
                <ChipRow>
                  {interestsList.data.interests.map((interest) => (
                    <Chip key={interest.key} label={interest.label} selected={interests.includes(interest.key)} onPress={() => toggleInterest(interest.key)} />
                  ))}
                </ChipRow>
                {interests.includes('other') ? <FormField label={t('interests.otherLabel')} value={interestsOther} onChangeText={setInterestsOther} maxLength={120} /> : null}
              </FieldGroup>
            ) : null}

            {need('bio') ? (
              <FormField
                label={t('auth.register.bio')}
                multiline
                value={bio}
                onChangeText={field('bio', setBio)}
                error={form.errors.bio}
                anchorRef={form.anchor('bio')}
                placeholder={t('auth.register.bioPlaceholder')}
                maxLength={600}
              />
            ) : null}

            {need('jobTitle') ? (
              <FormField
                label={t('completeProfile.jobTitle')}
                value={jobTitle}
                onChangeText={field('jobTitle', setJobTitle)}
                error={form.errors.jobTitle}
                anchorRef={form.anchor('jobTitle')}
                textContentType="jobTitle"
              />
            ) : null}

            {waiting && !failed ? (
              <View style={styles.loading}>
                <ActivityIndicator color={brand.gold} />
                <Text style={styles.loadingText}>{t('completeProfile.loading')}</Text>
              </View>
            ) : null}
            {failed ? (
              <View style={styles.group}>
                <Notice tone="warning" text={t('completeProfile.loadFailed')} support />
                <AppButton label={t('common.retry')} icon="refresh-outline" variant="outline" onPress={retryFields} />
              </View>
            ) : null}

            {error ? <Notice tone="warning" text={error} support /> : null}
            <AppButton label={busy ? t('completeProfile.saving') : t('completeProfile.save')} icon="checkmark-circle-outline" loading={busy} disabled={waiting} onPress={() => void submit()} />
          </FormCard>
          <Text style={styles.foot}>{t('completeProfile.foot')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 900, elevation: 900, backgroundColor: formPalettes.light.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.md },
  emblem: { width: 110, height: 110, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: brand.navy, textAlign: 'center' },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 25, color: formPalettes.light.inkSoft, textAlign: 'center' },
  group: { gap: spacing.sm },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  loadingText: { ...typography.caption, color: formPalettes.light.muted },
  foot: { ...typography.caption, color: formPalettes.light.muted, textAlign: 'center', borderRadius: radii.md },
});
