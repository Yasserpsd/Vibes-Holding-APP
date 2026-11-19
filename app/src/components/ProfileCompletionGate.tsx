import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi, displayProfile, useAuthConfig, type Me, type Persona, type PhoneStepResult } from '@/api/auth';
import { GATE_FIELDS } from '@/api/gateFields';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { ChipRow, ErrorSummary, FieldGroup, type FieldFix } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { FieldScrollProvider, useFieldScroller } from '@/components/Screen';
import { VoiceFill } from '@/components/VoiceFill';
import { getLang, t, tOptional } from '@/i18n';
import { deviceCountry } from '@/lib/deviceCountry';
import { emailFix, nameFix, phoneCountryFix } from '@/lib/fixes';
import { cleanEmail, isEmail, localPhoneDigits, nameIssue, phoneIssue } from '@/lib/validation';
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
 * M203 (owner, 2026-11-06, replaces the M147 list): name, phone, category, job, and the real address of an Apple
 * relay account. The number is saved only after its WhatsApp code; bio, interests, member type and company
 * are asked later in the profile (the 7-day «كمّل بياناتك» popup and the interests screen).
 * M204 (owner, 2026-11-06: «اي بيانات ناقصة يطلعه بوب اب جميل كده ويقدر يدوس لاحقا عادي»): no wall any more. A weekly
 * popup (GentlePopups) offers this form, and «لاحقًا» closes it at any moment.
 */
export function gateMissing(me: Me | null | undefined): Field[] {
  // M168: a newer server may name a field this bundle has no input for — never ask the member for it.
  if (!me || me.isAdmin) return [];
  return (me.profileMissing ?? []).filter((key): key is Field => (ORDER as readonly string[]).includes(key) && (GATE_FIELDS as readonly string[]).includes(key));
}

type Field = 'name' | 'contactEmail' | 'phone' | 'persona' | 'jobTitle';
const ORDER: Field[] = ['name', 'contactEmail', 'phone', 'persona', 'jobTitle'];

export function CompletionForm({ missing, onLater }: { missing: Field[]; onLater: () => void }) {
  const { me, setMe } = useAuth();
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onLater();
      return true;
    });
    return () => back.remove();
  }, [onLater]);
  const insets = useSafeAreaInsets();
  const configQuery = useAuthConfig();
  const config = configQuery.data;
  const scrollRef = useRef<ScrollView | null>(null);
  const form = useFormErrors<Field>(scrollRef);
  // Review 2026-11-16: the field that holds the cursor stays above the keyboard (same mechanism as Screen).
  const keeper = useFieldScroller(scrollRef);
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
  // M256: the picker opens on the country the phone is in.
  const [countryCode, setCountryCode] = useState(deviceCountry);
  const [persona, setPersona] = useState<Persona | ''>('');
  const [jobTitle, setJobTitle] = useState(me?.jobTitle ?? '');
  // M206: Google and Apple sign-ups skip the register screen, so this is where a representative's code is typed.
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  /** M203: the code step of the number; the fields come back with «تغيير الرقم». */
  const [step, setStep] = useState<PhoneStepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // M253: what each field held when the server refused it — the red line stays until the member changes that value.
  const [refused, setRefused] = useState<{ values: Partial<Record<Field, string>> }>({ values: {} });

  const country = config?.countries.find((item) => item.code === countryCode) ?? config?.countries[0];
  const phoneExample = country?.example ? country.example.replace(/^0+/, '') : '';
  /** The verdict on one field for a given value — null when it is fine or not asked for. */
  const issueOf = (key: Field, value: string, land = country): string | null => {
    if (!need(key)) return null;
    switch (key) {
      // M207 (owner, 2026-11-06): only an empty name stops the form; an odd one shows the warning under the field.
      case 'name':
        return value.trim().length < 2 ? t('form.error.name.empty') : null;
      case 'contactEmail':
        return isEmail(value) ? null : t('form.error.email');
      case 'phone': {
        if (phoneIssue(value, land) === null) return null;
        const example = land?.example ? land.example.replace(/^0+/, '') : '';
        return example ? t('form.error.phone', { example }) : t('form.error.phoneNoExample');
      }
      case 'persona':
        return value ? null : t('form.error.persona');
      case 'jobTitle':
        return value.trim().length < 2 ? t('form.error.jobTitle') : null;
      default:
        return null;
    }
  };
  const current: Record<Field, string> = { name, contactEmail, phone, persona, jobTitle };
  // M239 (owner, 2026-11-14: a right e-mail kept its red warning on the sign-up form): a warning never outlives its
  // reason — an autofill can write a field and leave it inside one render, and the leave then judges the old value.
  const shown = form.errors;
  const clearError = form.clear;
  useEffect(() => {
    const values = { name, contactEmail, jobTitle };
    for (const key of ['name', 'contactEmail', 'jobTitle'] as const) {
      if (shown[key] && refused.values[key] !== values[key] && issueOf(key, values[key]) === null) clearError(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- issueOf is rebuilt every render; the values are what matter
  }, [name, contactEmail, jobTitle, shown, clearError, refused]);
  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    for (const key of ORDER) {
      const message = issueOf(key, current[key]);
      if (message) next[key] = message;
    }
    return next;
  };

  const submit = async () => {
    if (busy) return;
    setFailure(null);
    setRefused({ values: {} });
    if (form.fail(validate(), ORDER)) return;
    setBusy(true);
    try {
      const rest = {
        ...(need('name') ? { name: name.trim() } : {}),
        ...(need('contactEmail') ? { contactEmail: cleanEmail(contactEmail) } : {}),
        ...(need('persona') && persona ? { persona } : {}),
        ...(need('jobTitle') ? { jobTitle: jobTitle.trim() } : {}),
        ...(me?.inviteOpen && inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
      };
      if (Object.keys(rest).length) setMe((await authApi.updateMe(rest)).me);
      // The number last: its code (or the switch being off) completes the account at the hub.
      if (need('phone')) {
        const started = await authApi.phoneStart(phone.trim(), countryCode);
        if ('saved' in started) setMe(started.me);
        else setStep(started);
      }
    } catch (cause) {
      // M253: the refusal goes under the field it is about (red border, its sentence, the screen at it).
      const taken = form.fromServer(cause, ORDER, { codes: { phone: 'phone', phone_no_whatsapp: 'phone', email_domain: 'contactEmail', invalid_email: 'contactEmail' } });
      if (taken.length) setRefused({ values: Object.fromEntries(taken.map((key) => [key, current[key]])) });
      else setFailure(failureOf(cause));
      if (cause instanceof ApiError && (cause.code === 'invite_code' || cause.code === 'invite_unavailable')) setShowInvite(true);
    } finally {
      setBusy(false);
    }
  };

  // Owner (2026-11-07: «خلي التحذير يطلع لما أسيب الخانة… مش وأنا بكتب»): typing never paints a NEW red warning; an
  // existing red goes the moment the value is right, and the verdict on a field comes when the member leaves it (or submits).
  const field = (key: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    if (!issueOf(key, value)) form.clear(key);
  };
  const blur = (key: Field) => () => {
    // M253: the server's verdict on this exact value stands; the local check knows less.
    if (form.errors[key] && refused.values[key] === current[key]) return;
    form.check(key, issueOf(key, current[key]));
  };
  const pickCountry = (code: string) => {
    setCountryCode(code);
    const land = config?.countries.find((item) => item.code === code) ?? country;
    if (phone && !issueOf('phone', phone, land)) form.clear('phone');
  };

  // M253 (owner, 2026-11-19: «أي خطأ يحصل يظهر زرار فوري يحل المشكلة»): the one-tap corrections, as on the sign-up form.
  const nameMeant = need('name') ? nameFix(name) : null;
  const emailMeant = need('contactEmail') ? emailFix(contactEmail) : null;
  const phoneLand = config && form.errors.phone ? phoneCountryFix(phone, countryCode, config.countries) : null;
  const nameFixButton: FieldFix | null = nameMeant ? { label: t('form.fix.use', { value: nameMeant }), onPress: () => field('name', setName)(nameMeant) } : null;
  const emailFixButton: FieldFix | null = emailMeant ? { label: t('form.fix.use', { value: emailMeant }), onPress: () => field('contactEmail', setContactEmail)(emailMeant) } : null;
  const phoneFixButton: FieldFix | null = phoneLand
    ? {
        label: t('form.fix.country', { country: (getLang() === 'en' && phoneLand.country.nameEn) || phoneLand.country.name }),
        icon: 'earth-outline',
        onPress: () => {
          setCountryCode(phoneLand.country.code);
          setPhone(phoneLand.phone);
          form.clear('phone');
        },
      }
    : null;
  const inviteRefused = failure?.code === 'invite_code' || failure?.code === 'invite_unavailable';

  return (
    // The status-bar inset sits on the cover itself, not inside the scrolled content: now that the form scrolls
    // above the keyboard, its lines would otherwise slide under the clock and the battery.
    <View style={[styles.cover, { paddingTop: insets.top }]}>
      {/* Review 2026-11-16: `padding` on Android too — edge-to-edge no longer resizes the window for the keyboard, and
          `undefined` left the lower fields and the save button behind the keys. The cover starts at the top of the
          screen, so no offset on either platform. */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <FieldScrollProvider value={keeper.field}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          {...keeper.scrollProps}
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
              <AppButton label={t('dataNudge.later')} variant="outline" onPress={onLater} />
            </FormCard>
          ) : null}
          {step ? null : (
          <FormCard tone="light">
            <ErrorSummary count={form.count} />
            {need('name') || need('phone') || need('persona') || need('jobTitle') ? (
            <VoiceFill
              fields={[
                ...(need('name') ? [{ key: 'name', label: t('completeProfile.name'), type: 'text' as const, required: true }] : []),
                ...(need('phone') ? [{ key: 'phone', label: t('auth.register.phone'), type: 'phone' as const, required: true }] : []),
                ...(need('persona') && config ? [{ key: 'persona', label: t('completeProfile.persona'), type: 'select' as const, options: config.personas.map(personaLabel), required: true }] : []),
                ...(need('jobTitle') ? [{ key: 'jobTitle', label: t('completeProfile.jobTitle'), type: 'text' as const, required: true }] : []),
              ]}
              values={{
                name,
                phone,
                persona: persona ? personaLabel({ key: persona, label: config?.personas.find((item) => item.key === persona)?.label ?? '' }) : '',
                jobTitle,
              }}
              country={countryCode}
              disabled={waiting}
              onFill={(values) => {
                form.reset();
                if (values.name) setName(values.name);
                if (values.phone) setPhone(values.phone);
                const pickedPersona = config?.personas.find((item) => personaLabel(item) === values.persona || item.label === values.persona)?.key;
                if (pickedPersona) setPersona(pickedPersona);
                if (values.jobTitle) setJobTitle(values.jobTitle);
              }}
            />
            ) : null}

            {need('name') ? (
              <FormField
                label={t('completeProfile.name')}
                value={name}
                onChangeText={field('name', setName)}
                hint={t('completeProfile.nameHint')}
                hintOnFocus
                warning={name.trim().length >= 2 && nameIssue(name) ? t('form.nameWarning') : null}
                error={form.errors.name}
                fix={nameFixButton}
                anchorRef={form.anchor('name')}
                onBlur={blur('name')}
                textContentType="name"
              />
            ) : null}

            {need('contactEmail') ? (
              <View style={styles.group}>
                {/* Owner (2026-10-30): the member must understand WHY — invoices and every contact go to this address only. */}
                <FormField
                  label={t('completeProfile.contactEmail')}
                  // M257: the «why» shows when the member taps the field, not as a block above it.
                  hint={t('completeProfile.contactEmailWhy')}
                  value={contactEmail}
                  onChangeText={field('contactEmail', setContactEmail)}
                  error={form.errors.contactEmail}
                  warning={emailMeant && isEmail(contactEmail) ? t('form.fix.emailMeant') : null}
                  fix={emailFixButton}
                  anchorRef={form.anchor('contactEmail')}
                  // Leaving the field shows the address as it will be sent; never while typing.
                  onBlur={() => {
                    const cleaned = cleanEmail(contactEmail);
                    if (cleaned !== contactEmail) setContactEmail(cleaned);
                    form.check('contactEmail', issueOf('contactEmail', cleaned));
                  }}
                  latin
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  autoComplete="email"
                />
              </View>
            ) : null}

            {need('phone') && config ? (
              <View style={styles.group}>
                <CountryPicker label={t('auth.register.country')} countries={config.countries} selected={countryCode} onSelect={pickCountry} />
                <FormField
                  label={t('auth.register.phone')}
                  value={phone}
                  onChangeText={(value) => field('phone', setPhone)(localPhoneDigits(value, country))}
                  error={form.errors.phone}
                  fix={phoneFixButton}
                  anchorRef={form.anchor('phone')}
                  onBlur={blur('phone')}
                  latin
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  placeholder={phoneExample || undefined}
                  hint={t('phoneCode.phoneHint')}
                  hintOnFocus
                />
              </View>
            ) : null}

            {need('persona') && config ? (
              <FieldGroup label={t('completeProfile.persona')} error={form.errors.persona} hint={persona ? t(`persona.hint.${persona}`) : undefined} anchorRef={form.anchor('persona')}>
                <ChipRow>
                  {PERSONAS.map((key) => {
                    const item = config.personas.find((entry) => entry.key === key);
                    return item ? <Chip key={key} label={personaLabel(item)} selected={persona === key} onPress={() => field('persona', setPersona as (value: string) => void)(key)} /> : null;
                  })}
                </ChipRow>
              </FieldGroup>
            ) : null}

            {need('jobTitle') ? (
              <FormField
                label={t('completeProfile.jobTitle')}
                value={jobTitle}
                onChangeText={field('jobTitle', setJobTitle)}
                error={form.errors.jobTitle}
                anchorRef={form.anchor('jobTitle')}
                onBlur={blur('jobTitle')}
                textContentType="jobTitle"
              />
            ) : null}

            {me?.inviteOpen ? (
              showInvite ? (
                <FormField
                  label={t('auth.register.inviteCode')}
                  latin
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  hint={t('auth.register.inviteCodeHint')}
                  hintOnFocus
                  placeholder="FAR2"
                />
              ) : (
                <Pressable accessibilityRole="button" onPress={() => setShowInvite(true)} style={styles.invite} hitSlop={8}>
                  <Text style={styles.inviteText}>{t('auth.register.haveInvite')}</Text>
                </Pressable>
              )
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

            <FormFailure
              failure={failure}
              onRetry={() => void submit()}
              actions={[
                inviteRefused
                  ? {
                      label: t('form.fix.clearInvite'),
                      icon: 'close-circle-outline',
                      onPress: () => {
                        setInviteCode('');
                        setFailure(null);
                      },
                    }
                  : null,
              ]}
            />
            <AppButton label={busy ? t('completeProfile.saving') : t('completeProfile.save')} icon="checkmark-circle-outline" loading={busy} disabled={waiting} onPress={() => void submit()} />
            <AppButton label={t('dataNudge.later')} variant="outline" onPress={onLater} />
          </FormCard>
          )}
          <Text style={styles.foot}>{t('completeProfile.foot')}</Text>
        </ScrollView>
        </FieldScrollProvider>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, elevation: 900, backgroundColor: formPalettes.light.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.md },
  emblem: { width: 110, height: 110, alignSelf: 'center' },
  invite: { alignSelf: 'center', paddingVertical: spacing.xs },
  inviteText: { ...typography.caption, color: brand.navy, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  // The title may shrink inside its row, so a long line («Welcome <name>, complete your details») wraps to a second
  // line within the screen's side padding instead of running to both edges.
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: brand.navy, textAlign: 'center', flexShrink: 1 },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 25, color: formPalettes.light.inkSoft, textAlign: 'center' },
  group: { gap: spacing.sm },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  loadingText: { ...typography.caption, color: formPalettes.light.muted },
  foot: { ...typography.caption, color: formPalettes.light.muted, textAlign: 'center', borderRadius: radii.md },
});
