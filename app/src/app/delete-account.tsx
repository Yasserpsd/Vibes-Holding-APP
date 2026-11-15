import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { availableSocialProvider, socialSignIn } from '@/auth/social';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { codeKeyboardType } from '@/components/PhoneCodeStep';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { toAsciiDigits } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M79 (owner): the deliberate flow — a reason or a message FIRST.
 * M117 (owner, 2026-10-21): three steps so nobody deletes by accident — the password, a code
 * mailed to the account's e-mail, then a random confirm word the screen shows and the member
 * types. Even then nothing is deleted on the spot: the account stays fully usable for 30 days
 * with a countdown in حسابي and a «تراجع» door the whole time.
 * M241 (2026-11-15): the first step takes one of two proofs — the password, or the member's own Apple / Google
 * account for an account that was born from that button and never had a password.
 */
const REASON_KEYS = ['notUsing', 'notFound', 'otherAccount', 'support', 'other'] as const;
type ReasonKey = (typeof REASON_KEYS)[number];

type Step = 'reason' | 'code' | 'done';

export default function DeleteAccountScreen() {
  const { me } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<ReasonKey | null>(null);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Step 2 + 3: where the code went, and the word the member must type back.
  const [sentTo, setSentTo] = useState('');
  /** M204: the masked number when the code went on WhatsApp; empty = it went to the e-mail. */
  const [codePhone, setCodePhone] = useState('');
  const [word, setWord] = useState('');
  const [code, setCode] = useState('');
  const [typedWord, setTypedWord] = useState('');
  const [daysLeft, setDaysLeft] = useState(30);
  // M241: an account born from the Apple / Google button never chose a password, so the same button proves the owner.
  // It shows only where the sign-in screen would show it: the provider is on at the server and this binary has its module.
  const { data: config } = useAuthConfig();
  const provider = availableSocialProvider(config?.social);
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  /** A closed prompt drops the answer of a request that is still on its way. */
  const attempt = useRef(0);

  if (!me) {
    return (
      <Screen title={t('deleteAccount.title')}>
        <Notice tone="warning" text={t('profile.signInFirst')} />
      </Screen>
    );
  }

  // The owner's accident-proofing: nothing moves until a reason is picked or a message written.
  const ready = reason !== null && (reason !== 'other' || message.trim().length > 0);
  const reasonText = (): string => {
    const picked = reason && reason !== 'other' ? t(`deleteAccount.reason.${reason}`) : '';
    const written = message.trim();
    return [picked, written].filter(Boolean).join(' — ');
  };

  /** Either proof ends the same way: the code is on its way and the confirm word is known. */
  const begun = (answer: Awaited<ReturnType<typeof authApi.deleteStart>>) => {
    setSentTo(answer.email);
    setCodePhone(answer.via === 'whatsapp' ? (answer.phone ?? '') : '');
    setWord(answer.word);
    setConfirming(false);
    setStep('code');
  };

  const start = async (password: string) => {
    // One request at a time, whichever proof it carries.
    if (busy || socialBusy) return;
    if (!password) {
      setError(t('account.delete.passwordRequired'));
      return;
    }
    const run = ++attempt.current;
    setBusy(true);
    setError(null);
    setSocialError(null);
    try {
      const answer = await authApi.deleteStart({ password }, reasonText());
      if (run === attempt.current) begun(answer);
    } catch (cause) {
      if (run === attempt.current) setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  // M241: the provider's own sheet hands a fresh identity token, and the server checks it is this account's.
  const startSocial = async () => {
    if (busy || socialBusy || !provider) return;
    const run = ++attempt.current;
    setSocialBusy(true);
    setError(null);
    setSocialError(null);
    Keyboard.dismiss();
    try {
      const signed = await socialSignIn(provider);
      if (run !== attempt.current) return;
      if (!signed.ok) {
        // A closed provider sheet is the member changing his mind: nothing to say.
        if (!signed.cancelled) setSocialError(t('errors.code.social_token'));
        return;
      }
      const answer = await authApi.deleteStart({ social: { provider: signed.provider, token: signed.token } }, reasonText());
      if (run === attempt.current) begun(answer);
    } catch (cause) {
      if (run === attempt.current) setSocialError(errorMessage(cause));
    } finally {
      setSocialBusy(false);
    }
  };

  const confirm = async () => {
    if (busy || code.trim().length < 4 || !typedWord.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await authApi.deleteConfirm(code.trim(), typedWord);
      setDaysLeft(answer.daysLeft);
      // The countdown band of حسابي caches its answer for a minute: refresh it so it shows the moment the member returns.
      void queryClient.invalidateQueries({ queryKey: ['delete-state'] });
      setStep('done');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <Screen title={t('deleteAccount.title')}>
        <FadeInView>
          <GlassCard radius={radii.lg} style={styles.card}>
            <Ionicons name="hourglass-outline" size={34} color={colors.warning} style={styles.doneIcon} />
            <Text style={styles.doneTitle}>{t('deleteAccount.scheduledTitle')}</Text>
            <Text style={styles.doneText}>{t('deleteAccount.scheduledText', { days: String(daysLeft) })}</Text>
            <AppButton label={t('deleteAccount.backHome')} icon="home-outline" onPress={() => router.back()} />
          </GlassCard>
        </FadeInView>
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen title={t('deleteAccount.title')} subtitle={t('deleteAccount.codeSubtitle')}>
        <FadeInView>
          <GlassCard radius={radii.lg} style={styles.card}>
            <Notice text={codePhone ? t('phoneCode.sentWhatsapp', { phone: `‎${codePhone}‎` }) : t('deleteAccount.codeSent', { email: sentTo })} />
            <FormField
              label={t('deleteAccount.codeLabel')}
              value={code}
              onChangeText={(value) => setCode(toAsciiDigits(value).replace(/\D/g, ''))}
              latin
              keyboardType={codeKeyboardType}
              maxLength={6}
              placeholder="000000"
            />
            {/* Step 3: the random word, shown big — typing it is the last deliberate act. */}
            <Text style={styles.wordLabel}>{t('deleteAccount.wordLabel')}</Text>
            <View style={styles.wordBox}>
              <Text style={styles.word}>{word}</Text>
            </View>
            <FormField label={t('deleteAccount.wordField')} value={typedWord} onChangeText={setTypedWord} maxLength={40} placeholder={word} />
            {error ? <Notice tone="warning" text={error} support /> : null}
            <AppButton label={t('deleteAccount.confirmFinal')} icon="trash-outline" disabled={code.trim().length < 4 || !typedWord.trim()} loading={busy} onPress={() => void confirm()} />
            <Text style={styles.hint}>{t('deleteAccount.graceHint')}</Text>
          </GlassCard>
        </FadeInView>
      </Screen>
    );
  }

  return (
    <Screen title={t('deleteAccount.title')} subtitle={t('deleteAccount.subtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <Notice tone="warning" text={t('deleteAccount.warning')} />
      </FadeInView>

      <FadeInView delay={entranceDelay(1)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <Text style={styles.sectionTitle}>{t('deleteAccount.why')}</Text>
          {REASON_KEYS.map((key) => (
            <PressScale key={key} onPress={() => setReason(key)} style={styles.reasonRow} accessibilityRole="radio" accessibilityState={{ selected: reason === key }}>
              <Ionicons name={reason === key ? 'radio-button-on' : 'radio-button-off'} size={20} color={reason === key ? colors.gold : colors.textMuted} />
              <Text style={[styles.reasonLabel, reason === key && styles.reasonChosen]}>{t(`deleteAccount.reason.${key}`)}</Text>
            </PressScale>
          ))}
          <FormField
            label={t('deleteAccount.message')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
            maxLength={500}
            placeholder={t('deleteAccount.messagePlaceholder')}
          />
        </GlassCard>
      </FadeInView>

      <FadeInView delay={entranceDelay(2)}>
        <View style={styles.actions}>
          <AppButton label={t('deleteAccount.continue')} variant="outline" icon="trash-outline" disabled={!ready} onPress={() => setConfirming(true)} />
          {!ready ? <Text style={styles.hint}>{t('deleteAccount.pickFirst')}</Text> : null}
        </View>
      </FadeInView>

      {/* The proof step: the password as before and, where this phone can run it, the member's Apple / Google account under it. */}
      <PasswordPrompt
        visible={confirming}
        title={provider ? t('deleteAccount.proofTitle') : t('account.delete.title')}
        message={provider ? t('deleteAccount.proofText') : t('account.delete.message')}
        confirmLabel={t('account.delete.confirm')}
        busy={busy}
        error={error}
        onConfirm={(password) => void start(password)}
        alternative={
          provider
            ? {
                label: t(provider === 'apple' ? 'deleteAccount.withApple' : 'deleteAccount.withGoogle'),
                icon: provider === 'apple' ? 'logo-apple' : 'logo-google',
                onPress: () => void startSocial(),
                loading: socialBusy,
                error: socialError,
              }
            : null
        }
        onCancel={() => {
          attempt.current += 1;
          setConfirming(false);
          setError(null);
          setSocialError(null);
        }}
      />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  card: { gap: spacing.sm, padding: spacing.md },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs + 2 },
  reasonLabel: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart },
  reasonChosen: { color: colors.textPrimary },
  actions: { gap: spacing.xs },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  wordLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  wordBox: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldFaint,
  },
  word: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 34, color: colors.gold, textAlign: 'center' },
  doneIcon: { alignSelf: 'center' },
  doneTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: 'center' },
  doneText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
}));
