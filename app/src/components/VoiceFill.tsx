import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, View } from 'react-native';

import { advisorApi, type FillField } from '@/api/advisor';
import { errorMessage } from '@/api/client';
import { audio, readBase64 } from '@/components/advisor/VoiceButton';
import { GlowButton, PressScale } from '@/components/motion';
import { usePaper } from '@/components/paper';
import { textStart } from '@/i18n/direction';
import { t } from '@/i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

export type { FillField } from '@/api/advisor';

type Props = {
  /** The form as the server should understand it: keys the screen stores, labels the member sees. */
  fields: FillField[];
  /** What the form holds now — kept unless the member says otherwise. */
  values: Record<string, string>;
  /** The server's answer: every field key → value ('' = nothing heard), plus the required keys still empty. */
  onFill: (values: Record<string, string>, missing: string[]) => void;
  /** ISO country of the member (phone dial code); Saudi when omitted. */
  country?: string;
  disabled?: boolean;
};

/**
 * M142 «املأ بصوتك»: one tap records, the next stops; the clip becomes text, the server turns the
 * text into the form's values and the screen writes them into its fields. The member always
 * reviews and presses the normal submit button — voice never submits. expo-audio is native, so
 * binaries without it (none in the stores today) simply never show the pill.
 */
export function VoiceFill(props: Props) {
  if (!audio) return null;
  return <VoiceFillInner {...props} />;
}

function VoiceFillInner({ fields, values, onFill, country, disabled = false }: Props) {
  const mod = audio as NonNullable<typeof audio>;
  const recorder = mod.useAudioRecorder(mod.RecordingPresets.HIGH_QUALITY);
  const paper = usePaper();
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'done' | 'partial'; text: string } | null>(null);
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!recording) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, recording]);

  const start = async () => {
    const permission = await mod.AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('voiceFill.title'), t('advisor.voiceNoPermission'));
      return;
    }
    await mod.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setOutcome(null);
    setRecording(true);
  };

  const stop = async () => {
    setRecording(false);
    setWorking(true);
    try {
      await recorder.stop();
      await mod.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error(t('advisor.voiceFailed'));
      const { text } = await advisorApi.transcribe(await readBase64(uri), 'audio/m4a');
      if (!text) {
        Alert.alert(t('voiceFill.title'), t('advisor.voiceEmpty'));
        return;
      }
      const known = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
      const result = await advisorApi.fillForm({ transcript: text, fields, known, country });
      onFill(result.values, result.missing);
      setOutcome(
        result.missing.length && result.followUp
          ? { tone: 'partial', text: `${t('voiceFill.partial')} ${result.followUp}` }
          : { tone: 'done', text: t('voiceFill.done') },
      );
    } catch (cause) {
      Alert.alert(t('voiceFill.title'), errorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const press = () => {
    if (working || disabled) return;
    void (recording ? stop() : start());
  };

  const label = recording ? t('voiceFill.stop') : working ? t('voiceFill.working') : t('voiceFill.start');
  return (
    <View style={styles.wrap}>
      {/* M152: the pill breathes with a golden halo so the member sees he can dictate the form. */}
      <GlowButton strong={recording} enabled={!disabled || recording} style={styles.glow}>
      <PressScale
        onPress={press}
        glow={recording}
        glowRadius={radii.pill}
        style={[styles.pill, paper && styles.pillPaper, recording && styles.pillRecording, (disabled || working) && styles.pillMuted]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: working, disabled: disabled || working }}
      >
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <Ionicons name={recording ? 'stop-circle' : working ? 'hourglass-outline' : 'mic'} size={20} color={recording ? colors.white : colors.gold} />
        </Animated.View>
        <Text style={[styles.pillText, paper && styles.pillTextPaper, recording && styles.pillTextRecording]} numberOfLines={1}>
          {label}
        </Text>
      </PressScale>
      </GlowButton>
      <Text style={[styles.hint, paper && styles.hintPaper]}>{outcome ? outcome.text : t('voiceFill.hint')}</Text>
      {outcome ? (
        <View style={[styles.outcomeBar, outcome.tone === 'done' ? styles.outcomeDone : styles.outcomePartial]} accessibilityElementsHidden />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginBottom: spacing.xs },
  // The halo hugs the pill (the pill keeps its own flex-start inside the wrapper).
  glow: { alignSelf: 'flex-start' },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  pillPaper: { backgroundColor: colors.white, borderColor: colors.paperGold },
  pillRecording: { backgroundColor: colors.danger, borderColor: colors.danger, boxShadow: shadows.glowGoldStrong },
  pillMuted: { opacity: 0.65 },
  pillText: { ...typography.body, fontFamily: fonts.semiBold, color: colors.gold },
  pillTextPaper: { color: colors.paperGold },
  pillTextRecording: { color: colors.white },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  hintPaper: { color: colors.paperMuted },
  outcomeBar: { height: 2, borderRadius: 1, width: 56 },
  outcomeDone: { backgroundColor: colors.success },
  outcomePartial: { backgroundColor: colors.gold },
});
