import Ionicons from '@expo/vector-icons/Ionicons';
import { requireOptionalNativeModule } from 'expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Linking } from 'react-native';

import { advisorApi } from '@/api/advisor';
import { errorMessage } from '@/api/client';
import { GlowButton, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
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

/** The server takes about six minutes of m4a (8 MB of base64): a recording nobody stops ends, and is transcribed, at three. */
const MAX_RECORDING_MS = 180_000;

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
  // The press handlers read these, never the state of an older render.
  const recordingRef = useRef(false);
  const working = useRef(false);
  const latest = useRef({ stop: (): void => undefined, discard: (): void => undefined });
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
    try {
      const permission = await mod.AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        // After a refusal the system stops asking: the way back is the app's page in the device settings.
        Alert.alert(t('advisor.voiceTitle'), t('advisor.voiceNoPermission'), [
          { text: t('common.close'), style: 'cancel' },
          { text: t('advisor.voiceOpenSettings'), onPress: () => void Linking.openSettings().catch(() => undefined) },
        ]);
        return;
      }
      await mod.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
      onBusy(true);
    } catch {
      // The microphone is taken (a call, another app) or the audio session refused: say so instead of failing silently.
      Alert.alert(t('advisor.voiceTitle'), t('advisor.voiceStartFailed'));
      void mod.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    }
  };

  const stop = async () => {
    recordingRef.current = false;
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

  /** The member left the screen or the app: the recording is thrown away, the microphone is released. */
  const discard = () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    onBusy(false);
    void (async () => {
      try {
        await recorder.stop();
        await mod.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch {
        // Already released with the screen.
      }
    })();
  };

  useEffect(() => {
    latest.current = {
      // Through the same lock as a press, so a tap at the limit cannot start a second recording.
      stop: () => {
        if (working.current || !recordingRef.current) return;
        working.current = true;
        void stop().finally(() => {
          working.current = false;
        });
      },
      discard,
    };
  });

  // The advisor tab stays mounted while the member is elsewhere, so unmounting is not enough: a blur ends the recording too.
  useFocusEffect(useCallback(() => () => latest.current.discard(), []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') latest.current.discard();
    });
    return () => subscription.remove();
  }, []);
  // A recording nobody stops would outgrow what the server takes: at the limit it stops and is transcribed.
  useEffect(() => {
    if (!recording) return;
    const timer = setTimeout(() => latest.current.stop(), MAX_RECORDING_MS);
    return () => clearTimeout(timer);
  }, [recording]);

  const press = () => {
    // A recording in progress can always be stopped, even when the composer went busy meanwhile.
    if (sending || working.current || (disabled && !recordingRef.current)) return;
    working.current = true;
    void (recordingRef.current ? stop() : start()).finally(() => {
      working.current = false;
    });
  };

  // M152 (owner): the mic glows and breathes all the time — stronger and faster while it listens.
  return (
    <GlowButton strong={recording} enabled={!disabled || recording}>
    <PressScale
      onPress={press}
      glow={recording}
      glowRadius={radii.pill}
      style={[styles.button, recording && styles.buttonRecording, (disabled || sending) && !recording && styles.buttonMuted]}
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

const styles = themedStyles(() => ({
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
}));
