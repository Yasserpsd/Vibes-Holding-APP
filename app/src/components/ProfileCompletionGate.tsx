import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi, displayProfile, useAuthConfig, type Persona, type PhoneStepResult } from '@/api/auth';
import { GATE_FIELDS } from '@/api/gateFields';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { ChipRow, ErrorSummary, FieldGroup } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
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
 * M203 (owner, 2026-11-06, replaces the M147 + M156 list): name, phone, category, and the real address of an Apple
 * relay account. The number is saved only after its WhatsApp code; job, bio, interests, member type and company
 * are asked later in the profile (the 7-day «كمّل بياناتك» popup and the interests screen).
 */
export function ProfileCompletionGate() {
  const { status, me } = useAuth();
  // M168: a newer server may name a field this bundle has no input for — never wall the member behind it.
  const missing = (me?.profileMissing ?? []).filter((key) => (GATE_FIELDS as readonly string[]).includes(key) && key !== 'phoneCode');
  if (status !== 'signedIn' || !me || me.isAdmin || !missing.length) return null;
  return <CompletionForm missing={missing} />;
}

type Field = 'name' | 'contactEmail' | 'phone' | 'persona';
const ORDER: Field[] = ['name', 'contactEmail', 'phone', 'persona'];

function CompletionForm({ missing }: { missing: NonNullable<ReturnType<typeof useAuth>['me']>['profileMissing'] }) {
  const { me, setMe } = useAuth();
  const insets = useSafeAreaInsets();
  const configQuery = useAuthConfig();
  const config = configQuery.data;
  const scrollRef = useRef<ScrollView | null>(null);
  const form = useFormErrors<Field>(scrollRef);
  const need = (key: string) => (missing ?? []).includes(key as never);
  // M165 (owner, 2026-10-31): the country, phone and persona fields are drawn from the server's answer. Until it
  // is here the member sees a spinner, never an empty card; a failure shows a retry button and retries by itself.
  const needsConfig = need('phone') || need('persona');
  const waiting = needsConfig && !config;
  const fetching = needsConfig && configQuery.isFetching;
  const failed = waiting && !fetching;
  const retryFields = () => {
    if (needsConfig && !config) void configQuery.refetch();
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
  /** M203: the code step of the number; the fields come back with «تغيير الرقم». */
  const [step, setStep] = useState<PhoneStepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const country = config?.countries.find((item) => item.code === countryCode) ?? config?.countries[0];
  const phoneExample = country?.example ? country.example.replace(/^0+/, '') : '';
  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    const nameProblem = need('name') ? nameIssue(name) : null;
    if (nameProblem) next.name = t(`form.error.name.${nameProblem}`);
    if (need('contactEmail') && !isEmail(contactEmail)) next.contactEmail = t('form.error.email');
    if (need('phone') && phoneIssue(phone, country) !== null) next.phone = phoneExample ? t('form.error.phone', { example: phoneExample }) : t('form.error.phoneNoExample');
    if (need('persona') && !persona) next.persona = t('form.error.persona');
    return next;
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (form.fail(validate(), ORDER)) return;
    setBusy(true);
    try {
      const rest = {
        ...(need('name') ? { name: name.trim() } : {}),
        ...(need('contactEmail') ? { contactEmail: contactEmail.trim().toLowerCase() } : {}),
        ...(need('persona') && persona ? { persona } : {}),
      };
      if (Object.keys(rest).length) setMe((await authApi.updateMe(rest)).me);
      // The number last: its code (or the switch being off) completes the account at the hub.
      if (need('phone')) {
        const started = await authApi.phoneStart(phone.trim(), countryCode);
        if ('saved' in started) setMe(started.me);
        else setStep(started);
      }
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

          {step ? (
            <FormCard tone="light">
              <PhoneCodeStep
                step={step}
                onBack={() => setStep(null)}
                onSubmit={async (code) => {
                  const { me: updated } = await authApi.phoneConfirm(step.stepToken, code);
                  setMe(updated);
                }}
              />
            </FormCard>
          ) : null}
          {step ? null : (
          <FormCard tone="light">
            <ErrorSummary count={form.count} />
            {need('name') || need('phone') || need('persona') ? (
            <VoiceFill
              fields={[
                ...(need('name') ? [{ key: 'name', label: t('completeProfile.name'), type: 'text' as const, required: true }] : []),
                ...(need('phone') ? [{ key: 'phone', label: t('auth.register.phone'), type: 'phone' as const, required: true }] : []),
                ...(need('persona') && config ? [{ key: 'persona', label: t('completeProfile.persona'), type: 'select' as const, options: config.personas.map(personaLabel), required: true }] : []),
              ]}
              values={{
                name,
                phone,
                persona: persona ? personaLabel({ key: persona, label: config?.personas.find((item) => item.key === persona)?.label ?? '' }) : '',
              }}
              country={countryCode}
              disabled={waiting}
              onFill={(values) => {
                form.reset();
                if (values.name) setName(values.name);
                if (values.phone) setPhone(values.phone);
                const pickedPersona = config?.personas.find((item) => personaLabel(item) === values.persona || item.label === values.persona)?.key;
                if (pickedPersona) setPersona(pickedPersona);
              }}
            />
            ) : null}

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
                  hint={t('phoneCode.phoneHint')}
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
          )}
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
