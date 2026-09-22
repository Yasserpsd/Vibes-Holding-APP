import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { t } from '@/i18n';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** True while a message is being sent or the conversation is not ready. */
  busy: boolean;
};

export function Composer({ value, onChange, onSend, busy }: Props) {
  const canSend = !busy && value.trim().length > 0;
  return (
    <View style={styles.bar}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={t('advisor.placeholder')}
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={4000}
        textAlign="right"
        editable={!busy}
        accessibilityLabel={t('advisor.messageLabel')}
      />
      <Pressable
        onPress={onSend}
        disabled={!canSend}
        style={({ pressed }) => [styles.send, !canSend && styles.sendDisabled, pressed && canSend && styles.sendPressed]}
        accessibilityRole="button"
        accessibilityLabel={t('advisor.send')}
      >
        {busy && value.trim().length > 0 ? (
          <ActivityIndicator color={colors.black} size="small" />
        ) : (
          <Ionicons name="send" size={20} color={colors.black} style={styles.sendIcon} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
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
  send: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: colors.goldDark, opacity: 0.6 },
  sendPressed: { backgroundColor: colors.goldLight },
  // Ionicons "send" points to the right; the reading direction here is right-to-left.
  sendIcon: { transform: [{ scaleX: -1 }] },
});
