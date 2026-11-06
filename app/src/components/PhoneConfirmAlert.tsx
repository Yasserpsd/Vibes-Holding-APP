import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Text, TextInput, View } from 'react-native';

import { authApi, type PhoneStepResult } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn, PressScale } from '@/components/motion';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  /** «لاحقًا»: the popup sleeps for a week. */
  onLater: () => void;
  /** The number proved itself. */
  onDone: () => void;
  /** The registered number is wrong: the profile editor takes a new one with its own code. */
  onWrongNumber: () => void;
  /** M204: opened by a new dealing (lib/whatsappGate): says why, and its second button cancels instead of «لاحقًا». */
  required?: boolean;
};

/**
 * M204 (owner, 2026-11-06: «اربطها بس بوب اب خفيف كده يطلع والشخص يقدر ياكد منه فورا»): the whole WhatsApp proof
 * inside one light popup. The button asks for the code (one paid message, only on the member's tap), the four digits
 * are typed here and finish by themselves, and «لاحقًا» is always there. Replaces the M203 alert + separate screen.
 */
export function PhoneConfirmAlert({ onLater, onDone, onWrongNumber, required }: Props) {
  const { setMe } = useAuth();
  const [step, setStep] = useState<PhoneStepResult | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setCode('');
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const ask = () =>
    run(async () => {
      const started = await authApi.phoneCurrent();
      setStep(started);
      setCooldown(started.resendAfter);
    });

  const resend = () =>
    run(async () => {
      if (!step) return;
      const result = await authApi.phoneResend(step.stepToken, 'whatsapp');
      setCode('');
      setCooldown(result.resendAfter);
    });

  const check = (value: string) =>
    run(async () => {
      if (!step) return;
      const { me } = await authApi.phoneConfirm(step.stepToken, value);
      setMe(me);
      onDone();
    });

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onLater}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
        <PopIn style={styles.wrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <View style={styles.ring}>
              <Ionicons name="logo-whatsapp" size={34} color={colors.whatsapp} />
            </View>
            <Text style={styles.title}>{t(required ? 'waGate.title' : 'phoneAlert.title')}</Text>
            <Text style={styles.text}>{step ? t('phoneCode.sentWhatsapp', { phone: `‎${step.phone}‎` }) : t(required ? 'waGate.text' : 'phoneAlert.text')}</Text>
            {step ? (
              <View style={styles.codeRow}>
                <TextInput
                  style={styles.code}
                  value={code}
                  onChangeText={(value) => {
                    const digits = value.replace(/\D/g, '').slice(0, 4);
                    setCode(digits);
                    if (digits.length === 4) void check(digits);
                  }}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={4}
                  autoFocus
                  editable={!busy}
                  placeholder="••••"
                  placeholderTextColor={colors.textMuted}
                  selectionColor={colors.gold}
                  accessibilityLabel={t('auth.verify.code')}
                />
                {busy ? <ActivityIndicator color={colors.gold} style={styles.spinner} /> : null}
              </View>
            ) : null}
            {error ? (
              <>
                <Text style={styles.error}>{error}</Text>
                <SupportLink problem={error} />
              </>
            ) : null}
            {step ? (
              <View style={styles.links}>
                <PressScale onPress={() => void resend()} disabled={cooldown > 0 || busy} accessibilityRole="button">
                  <Text style={[styles.link, cooldown > 0 ? styles.linkOff : null]}>
                    {cooldown > 0 ? t('auth.verify.resendIn', { seconds: cooldown }) : t('phoneCode.resendWhatsapp')}
                  </Text>
                </PressScale>
                <PressScale onPress={onWrongNumber} accessibilityRole="button">
                  <Text style={styles.link}>{t('phoneAlert.wrongNumber')}</Text>
                </PressScale>
              </View>
            ) : (
              <AppButton label={t('phoneAlert.cta')} icon="logo-whatsapp" loading={busy} onPress={() => void ask()} />
            )}
            <AppButton label={t(required ? 'waGate.cancel' : 'phoneAlert.later')} variant="outline" onPress={onLater} />
          </GlassCard>
        </PopIn>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.overlay },
  wrap: { width: '100%', maxWidth: 380 },
  card: { padding: spacing.lg, gap: spacing.sm, alignItems: 'stretch' },
  ring: { alignSelf: 'center' },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: 'center' },
  text: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  codeRow: { alignItems: 'center', justifyContent: 'center' },
  code: {
    alignSelf: 'center',
    minWidth: 190,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  spinner: { position: 'absolute', end: spacing.sm },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: spacing.lg, rowGap: spacing.xs, paddingVertical: spacing.xs },
  link: { ...typography.caption, color: colors.gold, textAlign: 'center' },
  linkOff: { color: colors.textMuted },
}));
