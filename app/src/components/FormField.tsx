import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { FieldError, RequiredMark } from '@/components/form/FormParts';
import { useFormPalette } from '@/components/form/FormTheme';
import { usePaper } from '@/components/paper';
import { useFieldScroll } from '@/components/Screen';
import { inputStart, isRTL, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  /** Owner (2026-11-06): the hint is one short line that shows only while the field is focused. */
  hintOnFocus?: boolean;
  /** M207: a caution that does not block the form; it shows once the member has left the field. */
  warning?: string | null;
  error?: string | null;
  /** M241: a required field wears a small red star after its label. */
  required?: boolean;
  /** Latin content (e-mail, phone, password) is typed left-to-right in both languages. */
  latin?: boolean;
  /** M195: the row the screen scrolls to when this field holds the first error (useFormErrors.anchor). */
  anchorRef?: Ref<View>;
  /** M227: the input itself, for a screen that must put the cursor here (the sign-up's code field). */
  inputRef?: Ref<TextInput>;
};

/**
 * One labelled input. M195: inside a FormCard it wears the club identity (navy ink, white field, gold
 * focus) and an error paints the border red (#D92D20) with the exact message and a warning icon under it.
 */
export function FormField({ label, hint, hintOnFocus = false, warning, error, required = false, latin = false, anchorRef, inputRef, style, multiline, onFocus, onBlur, ...inputProps }: Props) {
  const [focused, setFocused] = useState(false);
  // Review 2026-11-16: the scroll view around the form keeps the row that holds the cursor above the keyboard
  // (Screen.tsx). The row is this whole block — label, input and the hint or error line — so all of it shows.
  const fieldScroll = useFieldScroll();
  const row = useRef<View | null>(null);
  // The screen's own anchor (scroll to the first error) keeps receiving the same row.
  useImperativeHandle(anchorRef, () => row.current as View, []);
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
  // The dark screens' fields glow while focused; form cards and paper keep their own quiet focus border.
  const glow = !form && !paper && focused && !error;
  return (
    <View ref={row} style={styles.field} collapsable={false}>
      <Text style={[styles.label, paper && styles.paperLabel, form ? { color: error ? form.danger : form.inkSoft } : null]}>
        {label}
        {required ? <RequiredMark /> : null}
      </Text>
      {/* Review 2026-11-16: the focus glow sits on this frame, not on the input. A box shadow set on the input swaps
          its Android background, and Android then resets the input's padding to the stock 4 dp inset: the typed
          text hugged the border for as long as the field was focused. Never collapsed, so the glow coming and
          going does not re-parent the input (which would drop the keyboard). */}
      <View style={[styles.glowFrame, glow && styles.glowOn]} collapsable={false}>
      <TextInput
        ref={inputRef}
        placeholderTextColor={form ? form.placeholder : paper ? colors.paperFaint : colors.textFaint}
        selectionColor={form ? form.fieldFocus : paper ? colors.paperGold : colors.gold}
        accessibilityLabel={label}
        multiline={multiline}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          fieldScroll?.focus(row.current);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          fieldScroll?.blur(row.current);
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
      </View>
      {/* On a form card or on paper the message wears the light palette's red; the dark black-and-gold screens keep the token red. */}
      {error ? (
        form || paper ? (
          <FieldError text={error} />
        ) : (
          <Text style={styles.error}>{error}</Text>
        )
      ) : warning && !focused ? (
        form || paper ? (
          <FieldError text={warning} />
        ) : (
          <Text style={styles.error}>{warning}</Text>
        )
      ) : hint && (!hintOnFocus || focused) ? (
        <Text numberOfLines={hintOnFocus ? 1 : undefined} style={[styles.hint, paper && styles.paperHint, form ? { color: form.muted } : null]}>{hint}</Text>
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
  inputFocused: { borderColor: colors.gold },
  // Same corners as the input, so the glow follows its outline.
  glowFrame: { borderRadius: radii.md },
  glowOn: { boxShadow: shadows.glowGoldFaint },
  inputError: { borderColor: colors.danger },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  // M85: the field on paper — ink on white, a quiet dark-gold focus.
  paperLabel: { color: colors.paperInkSoft },
  paperInput: { color: colors.paperInk, backgroundColor: colors.paperCard, borderColor: colors.paperBorder },
  paperInputFocused: { borderColor: colors.paperGold },
  paperHint: { color: colors.paperMuted },
}));
