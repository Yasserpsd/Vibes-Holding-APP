import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View, type ScrollView } from 'react-native';

import { authApi, useAuthConfig, type Country, type PhoneStepResult, type ProfilePatch } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { CountryPicker } from '@/components/CountryPicker';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { ChipRow, ErrorSummary } from '@/components/form/FormParts';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { Screen } from '@/components/Screen';
import { VoiceFill } from '@/components/VoiceFill';
import { getLang, t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { emailFix, nameFix, phoneCountryFix } from '@/lib/fixes';
import { cleanEmail, isEmail, localPhoneDigits, phoneIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * The country and the national digits of the number as the hub shows it: a Saudi number comes as 05… (or its nine
 * digits), every other country as dial code + number. The longest dial code whose remainder fits the country's
 * length wins; Saudi when nothing matches or the list has not arrived.
 */
function splitStoredPhone(stored: string, countries: Country[] | undefined): { country: string; local: string } {
  const digits = stored.replace(/\D+/g, '').replace(/^00/, '');
  const saudi = { country: 'sa', local: localPhoneDigits(stored) };
  if (!countries || !digits || digits.startsWith('0') || (digits.length === 9 && digits.startsWith('5'))) return saudi;
  let best: { code: string; dial: string } | null = null;
  for (const item of countries) {
    const dial = item.dial.replace(/\D+/g, '');
    if (!dial || !digits.startsWith(dial)) continue;
    const rest = digits.length - dial.length;
    if (rest < (item.min ?? 4) || rest > (item.max ?? 12)) continue;
    if (!best || dial.length > best.dial.length) best = { code: item.code, dial };
  }
  return best ? { country: best.code, local: digits.slice(best.dial.length).replace(/^0+/, '') } : saudi;
}

type Key = 'name' | 'contactEmail' | 'phone' | 'jobTitle' | 'company' | 'city' | 'website' | 'bio' | 'social';
/** The fields in the order they sit on the screen: the screen goes to the first one that is wrong. */
const ORDER: Key[] = ['name', 'contactEmail', 'phone', 'jobTitle', 'company', 'city', 'website', 'bio', 'social'];

export default function ProfileEditScreen() {
  const router = useRouter();
  // M203: a sign-in that passed by e-mail lands here: the number on file never received its code.
  const { fixPhone } = useLocalSearchParams<{ fixPhone?: string }>();
  const { me, setMe } = useAuth();
  const { data: config } = useAuthConfig();
  // The member changes the mobile number from here (owner, 2026-10-30); the e-mail stays the account's
  // identity and only the club's admins change it. The number is sent only when it was actually edited.
  // M215: the +966 picker already stands beside the field, so the saved 05… shows without its zero; an untouched number is not sent.
  // The picker starts on the country of the stored number (a foreign number was shown, and saved again, under +966).
  // Until the member touches the number or the picker, both follow the account and the country list as they arrive.
  const stored = splitStoredPhone(me?.phone ?? '', config?.countries);
  const [typedPhone, setPhone] = useState<string | null>(null);
  const [pickedCountry, setCountryCode] = useState<string | null>(null);
  const phone = typedPhone ?? stored.local;
  const countryCode = pickedCountry ?? stored.country;
  const country = config?.countries.find((item) => item.code === countryCode) ?? config?.countries[0];
  const phoneChanged = phone !== stored.local;
  // M161 (owner): the contact e-mail (invoices, club mails) is the member's to change; the sign-in e-mail is not.
  const [contactEmail, setContactEmail] = useState(me?.contactEmail ?? '');
  const contactEmailChanged = cleanEmail(contactEmail) !== cleanEmail(me?.contactEmail ?? '');
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
  // M253 (owner, 2026-11-19): every problem sits under its own field in red, the screen goes to it, and a refusal
  // from the server lands under the field it names; what is not about a field sits by the button with its way out.
  const scrollRef = useRef<ScrollView | null>(null);
  const marks = useFormErrors<Key>(scrollRef);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    marks.clear(key);
  };

  const save = async () => {
    if (busy) return;
    setFailure(null);
    const found: Partial<Record<Key, string>> = {};
    if (form.name.trim().length < 2) found.name = t('profile.nameRequired');
    if (contactEmailChanged && !isEmail(contactEmail)) found.contactEmail = t('profile.contactEmailInvalid');
    if (phoneChanged && phoneIssue(phone, country) !== null) found.phone = t('profile.phoneInvalid');
    if (marks.fail(found, ORDER)) return;
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
    // The address goes as the club stores it: no invisible marks, no trailing dot, lower case (lib/validation).
    if (contactEmailChanged) patch.contactEmail = cleanEmail(contactEmail);
    setBusy(true);
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
      const taken = marks.fromServer(cause, ORDER, { codes: { phone: 'phone', phone_no_whatsapp: 'phone', email_domain: 'contactEmail', invalid_email: 'contactEmail' } });
      if (!taken.length) setFailure(failureOf(cause));
    } finally {
      setBusy(false);
    }
  };

  // The one-tap corrections, as on the sign-up form: offered only when there is ONE right answer.
  const nameMeant = marks.errors.name ? nameFix(form.name) : null;
  const emailMeant = contactEmailChanged ? emailFix(contactEmail) : null;
  const phoneLand = config && marks.errors.phone ? phoneCountryFix(phone, countryCode, config.countries) : null;

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
    <Screen title={t('profile.title')} subtitle={t('profile.subtitle')} scrollRef={scrollRef}>
      <ErrorSummary count={marks.count} />
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
        <FormField
          label={t('profile.name')}
          value={form.name}
          onChangeText={set('name')}
          textContentType="name"
          error={marks.errors.name}
          fix={nameMeant ? { label: t('form.fix.use', { value: nameMeant }), onPress: () => set('name')(nameMeant) } : null}
          anchorRef={marks.anchor('name')}
        />
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
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            value={contactEmail}
            onChangeText={(value) => {
              setContactEmail(value);
              marks.clear('contactEmail');
            }}
            error={marks.errors.contactEmail}
            warning={emailMeant && isEmail(contactEmail) ? t('form.fix.emailMeant') : null}
            fix={
              emailMeant
                ? {
                    label: t('form.fix.use', { value: emailMeant }),
                    onPress: () => {
                      setContactEmail(emailMeant);
                      marks.clear('contactEmail');
                    },
                  }
                : null
            }
            anchorRef={marks.anchor('contactEmail')}
            // Leaving the field shows the address as it will be sent; never while typing.
            onBlur={() => setContactEmail((current) => cleanEmail(current))}
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
          onChangeText={(value) => {
            setPhone(localPhoneDigits(value, country));
            marks.clear('phone');
          }}
          error={marks.errors.phone}
          fix={
            phoneLand
              ? {
                  label: t('form.fix.country', { country: (getLang() === 'en' && phoneLand.country.nameEn) || phoneLand.country.name }),
                  icon: 'earth-outline',
                  onPress: () => {
                    setCountryCode(phoneLand.country.code);
                    setPhone(phoneLand.phone);
                    marks.clear('phone');
                  },
                }
              : null
          }
          anchorRef={marks.anchor('phone')}
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
        <FormField label={t('profile.jobTitle')} value={form.jobTitle} onChangeText={set('jobTitle')} error={marks.errors.jobTitle} anchorRef={marks.anchor('jobTitle')} textContentType="jobTitle" />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <FormField label={t('profile.company')} value={form.company} onChangeText={set('company')} error={marks.errors.company} anchorRef={marks.anchor('company')} textContentType="organizationName" />
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <FormField label={t('profile.city')} value={form.city} onChangeText={set('city')} error={marks.errors.city} anchorRef={marks.anchor('city')} textContentType="addressCity" />
      </FadeInView>
      <FadeInView delay={entranceDelay(4)}>
        <FormField label={t('profile.website')} latin autoCapitalize="none" autoCorrect={false} keyboardType="url" value={form.website} onChangeText={set('website')} error={marks.errors.website} anchorRef={marks.anchor('website')} placeholder="https://" />
      </FadeInView>
      <FadeInView delay={entranceDelay(5)}>
        <FormField label={t('profile.bio')} multiline value={form.bio} onChangeText={set('bio')} error={marks.errors.bio} anchorRef={marks.anchor('bio')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(6)}>
        <FormField label={t('profile.social')} latin autoCapitalize="none" autoCorrect={false} multiline value={form.social} onChangeText={set('social')} error={marks.errors.social} anchorRef={marks.anchor('social')} hint={t('profile.socialHint')} />
      </FadeInView>
      {/* M198 (owner): the password changed from here once — it now lives in حسابي ← إعدادات الأمان only. */}
      {failure ? (
        <FadeInView offset={6}>
          <FormFailure failure={failure} onRetry={() => void save()} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(7)}>
        <AppButton label={busy ? t('profile.saving') : t('profile.save')} icon="save-outline" loading={busy} onPress={() => void save()} />
      </FadeInView>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  group: { gap: spacing.xs, marginBottom: spacing.sm },
  label: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
}));
