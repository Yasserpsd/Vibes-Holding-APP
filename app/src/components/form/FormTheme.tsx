import { createContext, useContext, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { themedStyles } from '@/theme/styles';
import { formPalettes, radii, shadows, spacing, type FormPalette, type FormTone } from '@/theme/tokens';

/**
 * M195 (owner, 2026-11-04: «الهوية بتاعة اللون تكون موحدة»): every form wears the club's navy-and-gold
 * identity, in a light or a dark tone, through this context. FormField, Chip, CountryPicker, AppButton,
 * Notice and VoiceFill read the palette on their own; a screen only wraps its form in <FormCard>.
 * Outside a FormCard the components keep their black-and-gold look (the rest of the app, until M196).
 */
const FormContext = createContext<FormPalette | null>(null);

/** The palette of the enclosing FormCard, or null outside one. */
export const useFormPalette = (): FormPalette | null => useContext(FormContext);

type FormCardProps = {
  children: ReactNode;
  tone?: FormTone;
  style?: StyleProp<ViewStyle>;
  /** Bare: the palette only, no card drawn around the children (for full-screen sheets). */
  bare?: boolean;
};

export function FormCard({ children, tone = 'light', style, bare = false }: FormCardProps) {
  const palette = formPalettes[tone];
  return (
    <FormContext.Provider value={palette}>
      {bare ? (
        <View style={style}>{children}</View>
      ) : (
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.cardBorder }, tone === 'dark' && styles.cardDark, style]}>{children}</View>
      )}
    </FormContext.Provider>
  );
}

const styles = themedStyles(() => ({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.md,
    boxShadow: shadows.lift,
  },
  cardDark: { boxShadow: shadows.glowGoldFaint },
}));
