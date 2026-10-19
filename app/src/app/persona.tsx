import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { authApi, type Persona } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { GlassCard, GoldGradient } from '@/components/lux';
import { FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

type Choice = { key: Persona; icon: 'compass-outline' | 'rocket-outline' | 'trending-up-outline'; label: StringKey; hint: StringKey };

const CHOICES: Choice[] = [
  { key: 'neutral', icon: 'compass-outline', label: 'persona.pick.neutral', hint: 'persona.pick.neutralHint' },
  { key: 'entrepreneur', icon: 'rocket-outline', label: 'persona.pick.entrepreneur', hint: 'persona.pick.entrepreneurHint' },
  { key: 'investor', icon: 'trending-up-outline', label: 'persona.pick.investor', hint: 'persona.pick.investorHint' },
];

/**
 * M101 «تغيير التوجه»: the member picks his new direction, a code lands in his mailbox, and the
 * confirmed code reshapes the whole app — once every 30 days. Club admins switch instantly with
 * no code and no window, so the owner can present the three experiences to the members.
 */
export default function PersonaScreen() {
  const router = useRouter();
  const { me, setMe } = useAuth();
  const params = useLocalSearchParams<{ pick?: string }>();
  const preset = CHOICES.find((choice) => choice.key === params.pick)?.key ?? null;
  const [picked, setPicked] = useState<Persona | null>(preset);
  const [stage, setStage] = useState<'pick' | 'code'>('pick');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) {
    return (
      <Screen title={t('persona.title')}>
        <Stack.Screen options={{ title: t('persona.title') }} />
        <Notice tone="warning" text={t('card.guest')} />
      </Screen>
    );
  }

  const isAdmin = me.isAdmin;
  const current = me.persona || null;
  const done = (name: string) => {
    Alert.alert(t('persona.doneTitle'), t('persona.doneText', { label: name }));
    router.back();
  };

  const applyAdmin = (persona: Persona) => {
    setBusy(true);
    setError(null);
    authApi
      .updateMe({ persona })
      .then(({ me: updated }) => {
        setMe(updated);
        done(t(CHOICES.find((choice) => choice.key === persona)?.label ?? 'persona.title'));
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const requestCode = () => {
    if (!picked) return;
    if (isAdmin) {
      applyAdmin(picked);
      return;
    }
    setBusy(true);
    setError(null);
    authApi
      .personaRequest(picked)
      .then((answer) => {
        setEmail(answer.email);
        setStage('code');
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const confirm = () => {
    if (code.trim().length < 4) {
      setError(t('persona.needCode'));
      return;
    }
    setBusy(true);
    setError(null);
    authApi
      .personaConfirm(code.trim())
      .then(({ me: updated }) => {
        setMe(updated);
        done(t(CHOICES.find((choice) => choice.key === updated.persona)?.label ?? 'persona.title'));
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <Screen title={t('persona.title')} subtitle={t('persona.subtitle')}>
      <Stack.Screen options={{ title: t('persona.title') }} />

      {/* The rule, said up front: once every 30 days, confirmed by a code to the member's mailbox. */}
      <FadeInView>
        <Notice tone={isAdmin ? 'success' : 'info'} text={isAdmin ? t('persona.adminNote') : t('persona.monthlyNote')} />
      </FadeInView>

      {stage === 'pick' ? (
        <>
          <View style={styles.choices}>
            {CHOICES.map((choice) => {
              const selected = picked === choice.key;
              const isCurrent = current === choice.key;
              return (
                <FadeInView key={choice.key}>
                  <PressScale
                    onPress={busy || isCurrent ? undefined : () => setPicked(choice.key)}
                    glow={selected}
                    glowRadius={radii.xl}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(choice.label)}
                  >
                    {selected ? (
                      <GoldGradient style={[styles.choice, styles.choiceSelected]}>
                        <View style={[styles.choiceIcon, styles.choiceIconSelected]}>
                          <Ionicons name={choice.icon} size={24} color={colors.gold} />
                        </View>
                        <View style={styles.choiceTexts}>
                          <Text style={[styles.choiceLabel, styles.choiceLabelSelected]}>{t(choice.label)}</Text>
                          <Text style={[styles.choiceHint, styles.choiceHintSelected]}>{t(choice.hint)}</Text>
                        </View>
                        <Ionicons name="checkmark-circle" size={26} color={colors.goldInk} />
                      </GoldGradient>
                    ) : (
                      <GlassCard radius={radii.xl} style={[styles.choice, (picked || isCurrent) && styles.choiceDimmed]}>
                        <View style={styles.choiceIcon}>
                          <Ionicons name={choice.icon} size={24} color={isCurrent ? colors.textMuted : colors.gold} />
                        </View>
                        <View style={styles.choiceTexts}>
                          <Text style={styles.choiceLabel}>{t(choice.label)}</Text>
                          <Text style={styles.choiceHint}>{isCurrent ? t('persona.current') : t(choice.hint)}</Text>
                        </View>
                      </GlassCard>
                    )}
                  </PressScale>
                </FadeInView>
              );
            })}
          </View>
          {error ? <Notice tone="warning" text={error} /> : null}
          <AppButton
            label={busy ? t('persona.sending') : isAdmin ? t('persona.applyNow') : t('persona.sendCode')}
            icon={isAdmin ? 'swap-horizontal-outline' : 'mail-outline'}
            loading={busy}
            onPress={() => (busy || !picked ? null : requestCode())}
          />
        </>
      ) : (
        <FadeInView offset={10} style={styles.codeBlock}>
          <Notice tone="success" text={t('persona.codeSent', { email })} />
          <FormField label={t('persona.codeLabel')} value={code} onChangeText={setCode} latin keyboardType="number-pad" maxLength={6} />
          {error ? <Notice tone="warning" text={error} /> : null}
          <AppButton label={busy ? t('persona.sending') : t('persona.confirm')} icon="checkmark-outline" loading={busy} onPress={() => (busy ? null : confirm())} />
          <AppButton label={t('persona.back')} variant="outline" onPress={() => (busy ? null : setStage('pick'))} />
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { gap: spacing.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  // M102 selection language: the chosen card is SHINY GOLD with dark text; the rest fade to gray.
  choiceSelected: { borderRadius: radii.xl, boxShadow: shadows.glowGold, experimental_backgroundImage: gradients.gold },
  choiceDimmed: { opacity: 0.55 },
  choiceIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
  },
  choiceIconSelected: { backgroundColor: colors.goldInk },
  choiceTexts: { flex: 1, gap: 2 },
  choiceLabel: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  choiceLabelSelected: { color: colors.goldInk },
  choiceHint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  choiceHintSelected: { color: colors.goldInk, opacity: 0.75 },
  codeBlock: { gap: spacing.sm },
});
