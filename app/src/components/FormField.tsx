import { useState, type Ref } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { FieldError } from '@/components/form/FormParts';
import { useFormPalette } from '@/components/form/FormTheme';
import { usePaper } from '@/components/paper';
import { inputStart, isRTL, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Latin content (e-mail, phone, password) is typed left-to-right in both languages. */
  latin?: boolean;
  /** M195: the row the screen scrolls to when this field holds the first error (useFormErrors.anchor). */
  anchorRef?: Ref<View>;
};

/**
 * One labelled input. M195: inside a FormCard it wears the club identity (navy ink, white field, gold
 * focus) and an error paints the border red (#D92D20) with the exact message and a warning icon under it.
 */
export function FormField({ label, hint, error, latin = false, anchorRef, style, multiline, onFocus, onBlur, ...inputProps }: Props) {
  const [focused, setFocused] = useState(false);
  // M85: inside a PaperCard the field wears the light palette on its own.
  const paper = usePaper();
  const form = useFormPalette();
  const formInput = form
    ? {
        color: form.ink,
        backgroundColor: form.field,
        borderColor: error ? form.danger : focused ? form.fieldFocus : form.fieldBorder,
        borderWidth: error || focused ? 1.5 : 1,
      }
    : null;
  return (
    <View ref={anchorRef} style={styles.field} collapsable={false}>
      <Text style={[styles.label, paper && styles.paperLabel, form ? { color: error ? form.danger : form.inkSoft } : null]}>{label}</Text>
      <TextInput
        placeholderTextColor={form ? form.placeholder : paper ? colors.paperFaint : colors.textFaint}
        selectionColor={form ? form.fieldFocus : paper ? colors.paperGold : colors.gold}
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
          !form && focused && !error ? (paper ? styles.paperInputFocused : styles.inputFocused) : null,
          !form && error ? styles.inputError : null,
          formInput,
          style,
        ]}
      />
      {error ? (
        form ? (
          <FieldError text={error} />
        ) : (
          <Text style={styles.error}>{error}</Text>
        )
      ) : hint ? (
        <Text style={[styles.hint, paper && styles.paperHint, form ? { color: form.muted } : null]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
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
    minHeight: 50,
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
}));
