import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';

import { authApi, useAuthConfig, type PhoneStepResult } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { CountryPicker } from '@/components/CountryPicker';
import { FormCard, useFormPalette } from '@/components/form/FormTheme';
import { FormField } from '@/components/FormField';
import { PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { VerifiedBadge, badgeTierOf } from '@/components/VerifiedBadge';
import { t } from '@/i18n';
import { saveSetting } from '@/lib/deviceStore';
import { autoPopupHeld, autoPopupsBlocked, markAutoPopupUsed, useAutoPopupFree, usePopupHold } from '@/lib/popupGate';
import { localPhoneDigits, phoneIssue } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, formPalettes, radii, spacing, typography } from '@/theme/tokens';

/**
 * M209 (owner, 2026-11-06 night): every signed-in member whose WhatsApp number is not proven — admins and every persona
 * included, paid or not — gets ONE gentle popup about five seconds after landing in the app. It shows the number already
 * on the account; one tap on «تأكيد» sends the code to it over WhatsApp (the M203 `/api/me/phone/confirm` route) and the
 * code is typed in the same popup. An account with no number is offered the country + number fields instead
 * (`/api/me/phone/start`, the same route the profile form uses). «لاحقًا» closes it for this session; it returns on the
 * next launch. The account menu row «توثيق WhatsApp» opens the very same popup (`showWhatsappVerify`).
 *
 * Order (lib/popupGate): the intro film and the details form go first; this popup waits for the screen to be free,
 * counts five seconds, and never opens over the forced-update cover or on the sign-in / profile / membership screens.
 */
let openManual: (() => void) | null = null;

/** Opens the popup from anywhere (the account menu row). */
export function showWhatsappVerify(): void {
  openManual?.();
}

/** Once per JS launch: «لاحقًا» keeps it away for the rest of the session, the next launch brings it back. */
let shownThisLaunch = false;
const LAST_SHOWN_KEY = 'investorsclub.waVerify.lastShownAt';
const DELAY_MS = 5000;
const QUIET_PATHS = ['/auth', '/profile-edit', '/phone-confirm', '/membership', '/watch'];

export function WhatsappVerifyHost() {
  const { status, me, confirmed } = useAuth();
  const pathname = usePathname();
  const free = useAutoPopupFree();
  const [open, setOpen] = useState(false);
  const due = status === 'signedIn' && confirmed && me?.phoneRequired === true;
  const quiet = QUIET_PATHS.some((path) => pathname.startsWith(path));
  usePopupHold(open);

  useEffect(() => {
    openManual = () => setOpen(true);
    return () => {
      openManual = null;
    };
  }, []);

  useEffect(() => {
    if (!due || quiet || !free || open || shownThisLaunch) return;
    const timer = setTimeout(() => {
      if (autoPopupHeld() || autoPopupsBlocked()) return;
      shownThisLaunch = true;
      markAutoPopupUsed();
      void saveSetting(LAST_SHOWN_KEY, new Date().toISOString());
      setOpen(true);
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, quiet, free, open]);

  if (!open || status !== 'signedIn') return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <PopIn style={styles.wrap}>
            <FormCard tone="light" style={styles.card}>
              <Body onClose={() => setOpen(false)} />
            </FormCard>
          </PopIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = useFormPalette() ?? formPalettes.light;
  const { me, setMe } = useAuth();
  const { data: config } = useAuthConfig();
  const [step, setStep] = useState<PhoneStepResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('sa');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const hasNumber = Boolean(me?.phone?.trim());
  const typing = !hasNumber || editing;
  const country = config?.countries.find((item) => item.code === countryCode) ?? config?.countries[0];
  const example = country?.example ? country.example.replace(/^0+/, '') : '';

  const sendToSaved = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStep(await authApi.phoneCurrent());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendToTyped = async () => {
    if (busy) return;
    if (phoneIssue(phone, country) !== null) {
      setPhoneError(example ? t('form.error.phone', { example }) : t('form.error.phoneNoExample'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await authApi.phoneStart(phone.trim(), countryCode);
      if ('saved' in started) {
        setMe(started.me);
        setDone(true);
      } else {
        setStep(started);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const tier = badgeTierOf(me) ?? 'verified';
    return (
      <>
        <View style={styles.ring}>
          <VerifiedBadge tier={tier} size={64} />
        </View>
        <Text style={[styles.title, { color: palette.ink }]}>{t('wa.popup.doneTitle')}</Text>
        <Text style={[styles.text, { color: palette.inkSoft }]}>{t('wa.popup.doneText')}</Text>
        <AppButton label={t('wa.popup.doneButton')} icon="checkmark-circle-outline" onPress={onClose} />
      </>
    );
  }

  return (
    <>
      <View style={styles.ring}>
        <Ionicons name="logo-whatsapp" size={40} color={colors.whatsapp} />
      </View>
      <Text style={[styles.title, { color: palette.ink }]}>{t('wa.popup.title')}</Text>

      {step ? (
        <PhoneCodeStep
          step={step}
          submitLabel={t('wa.popup.confirmCode')}
          onBack={() => {
            setStep(null);
            setEditing(true);
          }}
          onSubmit={async (code) => {
            const { me: updated } = await authApi.phoneConfirm(step.stepToken, code);
            setMe(updated);
            setDone(true);
          }}
        />
      ) : typing ? (
        <>
          <Text style={[styles.text, { color: palette.inkSoft }]}>{t('wa.popup.noNumberText')}</Text>
          {config ? (
            <View style={styles.group}>
              <CountryPicker label={t('auth.register.country')} countries={config.countries} selected={countryCode} onSelect={setCountryCode} />
              <FormField
                label={t('auth.register.phone')}
                value={phone}
                onChangeText={(value) => {
                  setPhone(localPhoneDigits(value, country));
                  setPhoneError(null);
                }}
                error={phoneError}
                latin
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                placeholder={example || undefined}
                hint={t('phoneCode.phoneHint')}
                hintOnFocus
              />
            </View>
          ) : null}
          {error ? <Notice tone="warning" text={error} support /> : null}
          <AppButton label={t('wa.popup.send')} icon="logo-whatsapp" loading={busy} disabled={!config} onPress={() => void sendToTyped()} />
          {hasNumber ? <AppButton label={t('phoneAlert.later')} variant="outline" onPress={() => setEditing(false)} /> : null}
        </>
      ) : (
        <>
          <Text style={[styles.text, { color: palette.inkSoft }]}>{t('wa.popup.text')}</Text>
          <View style={[styles.numberBox, { backgroundColor: palette.field, borderColor: palette.fieldBorder }]}>
            <Text style={[styles.numberLabel, { color: palette.muted }]}>{t('wa.popup.numberLabel')}</Text>
            <Text style={[styles.number, { color: palette.ink }]}>{`‎${me?.phone ?? ''}‎`}</Text>
          </View>
          {error ? <Notice tone="warning" text={error} support /> : null}
          <AppButton label={t('wa.popup.confirm')} icon="logo-whatsapp" loading={busy} onPress={() => void sendToSaved()} />
          <Text onPress={() => setEditing(true)} style={[styles.link, { color: palette.accent }]} accessibilityRole="button">
            {t('phoneAlert.wrongNumber')}
          </Text>
        </>
      )}

      {/* «لاحقًا»: closes it for this session; it comes back on the next launch. */}
      {done ? null : <AppButton label={t('phoneAlert.later')} variant="outline" onPress={onClose} />}
    </>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  wrap: { width: '100%', maxWidth: 380 },
  card: { padding: spacing.lg, gap: spacing.sm },
  ring: { alignSelf: 'center' },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, textAlign: 'center' },
  text: { ...typography.body, textAlign: 'center' },
  group: { gap: spacing.sm },
  numberBox: { borderRadius: radii.lg, borderWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center', gap: 2 },
  numberLabel: { ...typography.caption, textAlign: 'center' },
  number: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 28, letterSpacing: 1, textAlign: 'center', writingDirection: 'ltr' },
  link: { ...typography.caption, textAlign: 'center', paddingVertical: spacing.xs },
}));
