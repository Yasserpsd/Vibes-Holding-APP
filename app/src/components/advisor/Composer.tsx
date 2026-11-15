import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FileButton, fileInputAvailable, formatFileSize, type PendingFile } from '@/components/advisor/FileButton';
import { stopSpeech } from '@/components/advisor/speech';
import { VoiceButton, voiceInputAvailable } from '@/components/advisor/VoiceButton';
import { GlowButton, PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { inputStart, isRTL, markParagraphs, textDir, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
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
  /** Air under the field: the chat passes the height of the raised advisor button while the keyboard is closed. */
  bottomRoom?: number;
  /** The keyboard is up: the PDF hint line gives its height back, so on a short screen the field stays above the keys. */
  keyboardOpen?: boolean;
};

export function Composer({ value, onChange, onSend, busy, attachment = null, onAttach, onDetach, bottomRoom = 0, keyboardOpen = false }: Props) {
  // M104: voice input (binaries without expo-audio hide the mic; see VoiceButton).
  const [listening, setListening] = useState(false);
  const hasContent = value.trim().length > 0 || attachment !== null;
  const canSend = !busy && !listening && hasContent;
  const showSpinner = busy && hasContent;
  const [focused, setFocused] = useState(false);
  // A transcript arrives seconds after the tap: it joins what the field holds NOW, not what it held then.
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);
  // The mic and a playing reply share the audio session: listening silences the reply first.
  const listen = (on: boolean) => {
    if (on) stopSpeech();
    setListening(on);
  };
  // Crossfade between the send mark and the spinner instead of swapping them cold.
  const [cross] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(cross, { toValue: showSpinner ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [cross, showSpinner]);
  return (
    <View style={[styles.wrap, bottomRoom > 0 ? { paddingBottom: bottomRoom } : null]}>
      {attachment ? (
        <PopIn>
          <View style={styles.attachment}>
            <Ionicons name="document-text" size={18} color={colors.gold} />
            <Text style={[styles.attachmentName, textDir(attachment.name)]} numberOfLines={1}>
              {markParagraphs(attachment.name)}
            </Text>
            {attachment.size > 0 ? <Text style={styles.attachmentSize}>{formatFileSize(attachment.size)}</Text> : null}
            {!busy && onDetach ? (
              <Pressable onPress={onDetach} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('advisor.file.remove')}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </PopIn>
      ) : fileInputAvailable() && onAttach && !keyboardOpen ? (
        // The limit is said before a file is picked; the picked file takes this line's place. Hidden while the
        // keyboard is open: the member is writing, and a short screen has no room for the line above the keys.
        <Text style={styles.fileHint} numberOfLines={1}>
          {t('advisor.file.hint')}
        </Text>
      ) : null}
      <View style={styles.bar}>
        {/* Review 2026-11-16: the focus glow sits on this frame, not on the input. A box shadow set on the input swaps
            its Android background, and Android then resets the input's padding to the stock 4 dp inset: the words
            hugged the border while typing. Never collapsed, so the glow does not re-parent the focused input. */}
        <View style={[styles.inputFrame, focused && styles.inputFrameFocused]} collapsable={false}>
        <TextInput
          style={[styles.input, focused && styles.inputFocused]}
          value={value}
          onChangeText={onChange}
          placeholder={t(attachment ? 'advisor.file.placeholder' : 'advisor.placeholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
          textAlign={inputStart()}
          // Stays editable while a message is on its way: a field that locks gives up the keyboard after every
          // send (and the list jumps with it). `canSend` keeps a second send from going out.
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={t('advisor.messageLabel')}
        />
        </View>
        {fileInputAvailable() && onAttach && !attachment ? <FileButton disabled={busy || listening} onFile={onAttach} /> : null}
        {voiceInputAvailable() ? (
          <VoiceButton
            disabled={busy}
            onBusy={listen}
            onText={(text) => {
              const current = latestValue.current.trim();
              onChange(current ? `${current} ${text}` : text);
            }}
          />
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
              <Ionicons name="send" size={20} color={colors.goldInk} style={isRTL() ? styles.sendIcon : undefined} />
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

const styles = themedStyles(() => ({
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
  fileHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: textStart, marginHorizontal: spacing.md, marginTop: spacing.xs },
  // The frame takes the row's free width and carries the focus glow; same corners as the input.
  inputFrame: { flex: 1, borderRadius: radii.lg },
  inputFrameFocused: { boxShadow: shadows.glowGoldFaint },
  input: {
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
  inputFocused: { borderColor: colors.gold },
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
  // Ionicons "send" points to the right: mirrored only in Arabic, where the reading direction is right-to-left.
  sendIcon: { transform: [{ scaleX: -1 }] },
}));
