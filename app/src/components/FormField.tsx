import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Latin content (e-mail, phone, password) is typed left-to-right inside the RTL layout. */
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
          latin ? styles.latin : styles.arabic,
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
  label: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
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
  arabic: { textAlign: 'right', writingDirection: 'rtl' },
  latin: { textAlign: 'left', writingDirection: 'ltr' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
  error: { ...typography.caption, color: colors.danger, textAlign: 'right' },
});
