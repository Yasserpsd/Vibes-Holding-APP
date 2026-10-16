import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { FadeInView } from '@/components/motion';
import { usePaper } from '@/components/paper';
import { inputStart, isRTL, textStart } from '@/i18n/direction';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Latin content (e-mail, phone, password) is typed left-to-right in both languages. */
  latin?: boolean;
};

export function FormField({ label, hint, error, latin = false, style, multiline, onFocus, onBlur, ...inputProps }: Props) {
  const [focused, setFocused] = useState(false);
  // M85: inside a PaperCard the field wears the light palette on its own.
  const paper = usePaper();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, paper && styles.paperLabel]}>{label}</Text>
      <TextInput
        placeholderTextColor={paper ? colors.paperMuted : colors.textMuted}
        selectionColor={paper ? colors.paperGold : colors.gold}
        multiline={multiline}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          paper && styles.paperInput,
          latin ? styles.latin : { textAlign: inputStart(), writingDirection: isRTL() ? 'rtl' : 'ltr' },
          multiline && styles.multiline,
          focused && !error ? (paper ? styles.paperInputFocused : styles.inputFocused) : null,
          error ? styles.inputError : null,
          style,
        ]}
      />
      {error ? (
        <FadeInView offset={4}>
          <Text style={styles.error}>{error}</Text>
        </FadeInView>
      ) : hint ? (
        <Text style={[styles.hint, paper && styles.paperHint]}>{hint}</Text>
      ) : null}
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
  inputFocused: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  inputError: { borderColor: colors.danger },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  // M85: the field on paper — ink on white, a quiet dark-gold focus.
  paperLabel: { color: colors.paperInkSoft },
  paperInput: { color: colors.paperInk, backgroundColor: colors.paperCard, borderColor: colors.paperBorder },
  paperInputFocused: { borderColor: colors.paperGold },
  paperHint: { color: colors.paperMuted },
});
