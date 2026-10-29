import Ionicons from '@expo/vector-icons/Ionicons';
import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { Alert, Animated, StyleSheet } from 'react-native';

import { advisorApi } from '@/api/advisor';
import { errorMessage } from '@/api/client';
import { GlowButton, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { colors, radii, shadows } from '@/theme/tokens';

/**
 * M104 «اسأل بصوتك»: hold-free voice input — one tap records, the next stops, the server turns
 * the clip into text and the composer receives it. expo-audio is a NATIVE module: binaries built
 * before it hide the button entirely (requireOptionalNativeModule), so OTA updates stay safe.
 */
export const audio = requireOptionalNativeModule('ExpoAudio')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-audio') as typeof import('expo-audio'))
  : null;

export function voiceInputAvailable(): boolean {
  return audio !== null;
}

/** file:// clip → base64 without expo-file-system (fetch + FileReader work on local uris in RN). */
export async function readBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

type Props = {
  /** The transcribed text, ready for the composer. */
  onText: (text: string) => void;
  /** True while recording or transcribing — the composer shows it. */
  onBusy: (busy: boolean) => void;
  disabled: boolean;
};

export function VoiceButton({ onText, onBusy, disabled }: Props) {
  if (!audio) return null;
  return <VoiceButtonInner onText={onText} onBusy={onBusy} disabled={disabled} />;
}

function VoiceButtonInner({ onText, onBusy, disabled }: Props) {
  const mod = audio as NonNullable<typeof audio>;
  const recorder = mod.useAudioRecorder(mod.RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  // RN Animated lint pattern: a lazy useState keeps the value stable without touching a ref in render.
  const [pulse] = useState(() => new Animated.Value(1));

  // The red mic breathes while it listens.
  useEffect(() => {
    if (!recording) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, recording]);

  const start = async () => {
    const permission = await mod.AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('advisor.voiceTitle'), t('advisor.voiceNoPermission'));
      return;
    }
    await mod.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    onBusy(true);
  };

  const stop = async () => {
    setRecording(false);
    setSending(true);
    try {
      await recorder.stop();
      await mod.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error(t('advisor.voiceFailed'));
      const base64 = await readBase64(uri);
      const { text } = await advisorApi.transcribe(base64, 'audio/m4a');
      if (text) onText(text);
      else Alert.alert(t('advisor.voiceTitle'), t('advisor.voiceEmpty'));
    } catch (cause) {
      Alert.alert(t('advisor.voiceTitle'), errorMessage(cause));
    } finally {
      setSending(false);
      onBusy(false);
    }
  };

  const press = () => {
    if (sending || disabled) return;
    void (recording ? stop() : start());
  };

  // M152 (owner): the mic glows and breathes all the time — stronger and faster while it listens.
  return (
    <GlowButton strong={recording} enabled={!disabled || recording}>
    <PressScale
      onPress={press}
      glow={recording}
      glowRadius={radii.pill}
      style={[styles.button, recording && styles.buttonRecording, (disabled || sending) && styles.buttonMuted]}
      accessibilityRole="button"
      accessibilityLabel={t(recording ? 'advisor.voiceStop' : 'advisor.voiceStart')}
      accessibilityState={{ busy: sending }}
    >
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Ionicons name={recording ? 'stop' : sending ? 'hourglass-outline' : 'mic'} size={20} color={recording ? colors.white : colors.gold} />
      </Animated.View>
    </PressScale>
    </GlowButton>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRecording: { backgroundColor: colors.danger, borderColor: colors.danger, boxShadow: shadows.glowGoldStrong },
  buttonMuted: { opacity: 0.6 },
});
