import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { inputStart, isRTL, textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Latin content (e-mail, phone, password) is typed left-to-right in both languages. */
  latin?: boolean;
};

export function FormField({ label, hint, error, latin = false, style, multiline, ...inputProps }: Props) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.gold}
        multiline={multiline}
        {...inputProps}
        style={[
          styles.input,
          latin ? styles.latin : { textAlign: inputStart(), writingDirection: isRTL() ? 'rtl' : 'ltr' },
          multiline && styles.multiline,
          error ? styles.inputError : null,
          style,
        ]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  latin: { textAlign: 'left', writingDirection: 'ltr' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
});
