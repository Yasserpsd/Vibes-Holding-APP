import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { authApi } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M79 (owner): the deliberate flow — a reason or a message FIRST.
 * M117 (owner, 2026-10-21): three steps so nobody deletes by accident — the password, a code
 * mailed to the account's e-mail, then a random confirm word the screen shows and the member
 * types. Even then nothing is deleted on the spot: the account stays fully usable for 30 days
 * with a countdown in حسابي and a «تراجع» door the whole time.
 */
const REASON_KEYS = ['notUsing', 'notFound', 'otherAccount', 'support', 'other'] as const;
type ReasonKey = (typeof REASON_KEYS)[number];

type Step = 'reason' | 'code' | 'done';

export default function DeleteAccountScreen() {
  const { me } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<ReasonKey | null>(null);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Step 2 + 3: where the code went, and the word the member must type back.
  const [sentTo, setSentTo] = useState('');
  const [word, setWord] = useState('');
  const [code, setCode] = useState('');
  const [typedWord, setTypedWord] = useState('');
  const [daysLeft, setDaysLeft] = useState(30);

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

  const start = async (password: string) => {
    if (!password) {
      setError(t('account.delete.passwordRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await authApi.deleteStart(password, reasonText());
      setSentTo(answer.email);
      setWord(answer.word);
      setConfirming(false);
      setStep('code');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy || code.trim().length < 4 || !typedWord.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await authApi.deleteConfirm(code.trim(), typedWord);
      setDaysLeft(answer.daysLeft);
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
            <Notice text={t('deleteAccount.codeSent', { email: sentTo })} />
            <FormField
              label={t('deleteAccount.codeLabel')}
              value={code}
              onChangeText={setCode}
              latin
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
            />
            {/* Step 3: the random word, shown big — typing it is the last deliberate act. */}
            <Text style={styles.wordLabel}>{t('deleteAccount.wordLabel')}</Text>
            <View style={styles.wordBox}>
              <Text style={styles.word}>{word}</Text>
            </View>
            <FormField label={t('deleteAccount.wordField')} value={typedWord} onChangeText={setTypedWord} maxLength={40} placeholder={word} />
            {error ? <Notice tone="warning" text={error} /> : null}
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

      <PasswordPrompt
        visible={confirming}
        title={t('account.delete.title')}
        message={t('account.delete.message')}
        confirmLabel={t('account.delete.confirm')}
        busy={busy}
        error={error}
        onConfirm={(password) => void start(password)}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
});
