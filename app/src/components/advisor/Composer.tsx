import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FileButton, fileInputAvailable, formatFileSize, type PendingFile } from '@/components/advisor/FileButton';
import { VoiceButton, voiceInputAvailable } from '@/components/advisor/VoiceButton';
import { GlowButton, PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { inputStart } from '@/i18n/direction';
import { colors, fonts, gradients, radii, shadows, spacing } from '@/theme/tokens';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** True while a message is being sent or the conversation is not ready. */
  busy: boolean;
  /** M151: a PDF waiting to go with the next message (binaries without the picker never set it). */
  attachment?: PendingFile | null;
  onAttach?: (file: PendingFile) => void;
  onDetach?: () => void;
};

export function Composer({ value, onChange, onSend, busy, attachment = null, onAttach, onDetach }: Props) {
  // M104: voice input (binaries without expo-audio hide the mic; see VoiceButton).
  const [listening, setListening] = useState(false);
  const hasContent = value.trim().length > 0 || attachment !== null;
  const canSend = !busy && !listening && hasContent;
  const showSpinner = busy && hasContent;
  const [focused, setFocused] = useState(false);
  // Crossfade between the send mark and the spinner instead of swapping them cold.
  const [cross] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(cross, { toValue: showSpinner ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [cross, showSpinner]);
  return (
    <View style={styles.wrap}>
      {attachment ? (
        <PopIn>
          <View style={styles.attachment}>
            <Ionicons name="document-text" size={18} color={colors.gold} />
            <Text style={styles.attachmentName} numberOfLines={1}>
              {attachment.name}
            </Text>
            <Text style={styles.attachmentSize}>{formatFileSize(attachment.size)}</Text>
            {!busy && onDetach ? (
              <Pressable onPress={onDetach} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('advisor.file.remove')}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </PopIn>
      ) : null}
      <View style={styles.bar}>
        <TextInput
          style={[styles.input, focused && styles.inputFocused]}
          value={value}
          onChangeText={onChange}
          placeholder={t(attachment ? 'advisor.file.placeholder' : 'advisor.placeholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
          textAlign={inputStart()}
          editable={!busy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={t('advisor.messageLabel')}
        />
        {fileInputAvailable() && onAttach && !attachment ? <FileButton disabled={busy || listening} onFile={onAttach} /> : null}
        {voiceInputAvailable() ? (
          <VoiceButton disabled={busy} onBusy={setListening} onText={(text) => onChange(value.trim() ? `${value.trim()} ${text}` : text)} />
        ) : null}
        {/* M152: the ready send button breathes with a soft golden halo — «أفهم إن ده بوتون». */}
        <GlowButton enabled={canSend}>
        <PressScale
          onPress={onSend}
          disabled={!canSend}
          glow
          glowRadius={radii.pill}
          style={[styles.send, canSend ? styles.sendReady : styles.sendDisabled]}
          accessibilityLabel={t('advisor.send')}
        >
          <PopIn key={canSend ? 'ready' : 'idle'}>
            <Animated.View style={{ opacity: cross.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
              <Ionicons name="send" size={20} color={colors.goldInk} style={styles.sendIcon} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.spinner, { opacity: cross }]}>
              <ActivityIndicator color={colors.goldInk} size="small" />
            </Animated.View>
          </PopIn>
        </PressScale>
        </GlowButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // M151: the picked PDF sits above the field until it is sent or removed.
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  attachmentName: { flex: 1, color: colors.textPrimary, fontFamily: fonts.medium, fontSize: 14, writingDirection: 'ltr' },
  attachmentSize: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, writingDirection: 'ltr' },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  // The field lights up golden while the member writes.
  inputFocused: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  send: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendReady: { experimental_backgroundImage: gradients.gold, boxShadow: shadows.glowGold },
  sendDisabled: { backgroundColor: colors.goldDark, opacity: 0.6 },
  spinner: { alignItems: 'center', justifyContent: 'center' },
  // Ionicons "send" points to the right; the reading direction here is right-to-left.
  sendIcon: { transform: [{ scaleX: -1 }] },
});
