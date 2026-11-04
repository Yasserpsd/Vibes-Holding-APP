import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { useFormPalette } from '@/components/form/FormTheme';
import { FadeInView } from '@/components/motion';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  label: string;
  selected?: boolean;
  /** M102: true while a SIBLING is chosen — this pill then fades to a quiet gray. */
  dimmed?: boolean;
  onPress: () => void;
};

/**
 * Filter pill. Press physics mirror PressScale's spring; the Pressable stays local
 * so `accessibilityState.selected` keeps announcing (PressScale doesn't forward it).
 * M102 (owner): the chosen pill turns SHINY GOLD with BLACK text — unmistakable — while
 * its siblings fade to gray, so the selection reads at a glance.
 * M195 (owner, 2026-11-04): inside a FormCard the pill wears the club identity instead — white with a
 * thin gold border and navy text, and navy with gold text plus a ✓ once chosen (gold on navy in the
 * dark tone). Same rule in both tones, so the forms look like one app.
 */
export function Chip({ label, selected = false, dimmed = false, onPress }: Props) {
  const palette = useFormPalette();
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) =>
    Animated.spring(scale, { toValue: value, speed: 40, bounciness: 5, useNativeDriver: true }).start();
  const formStyle = palette
    ? selected
      ? { backgroundColor: palette.chipSelectedBg, borderColor: palette.chipSelectedBorder }
      : { backgroundColor: palette.chipBg, borderColor: palette.chipBorder }
    : null;
  const formText = palette ? { color: selected ? palette.chipSelectedText : palette.chipText } : null;
  return (
    <FadeInView offset={6} duration={240}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={onPress}
          onPressIn={() => to(0.95)}
          onPressOut={() => to(1)}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          style={[
            styles.chip,
            palette ? styles.chipForm : null,
            !palette && selected && styles.chipSelected,
            formStyle,
            !selected && dimmed && (palette ? styles.chipDimmedForm : styles.chipDimmed),
          ]}
        >
          {palette && selected ? <Ionicons name="checkmark-circle" size={16} color={palette.chipSelectedText} /> : null}
          <Text
            style={[styles.label, palette ? styles.labelForm : null, selected && styles.labelSelected, !palette && selected && styles.labelSelectedGold, formText, !palette && !selected && dimmed && styles.labelDimmed]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </Pressable>
      </Animated.View>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipForm: { minHeight: 40, paddingVertical: spacing.sm },
  chipSelected: {
    borderColor: colors.goldLight,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGold,
  },
  chipDimmed: { opacity: 0.45 },
  chipDimmedForm: { opacity: 0.7 },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  labelForm: { fontSize: 14, lineHeight: 22 },
  labelSelected: { fontFamily: fonts.bold },
  labelSelectedGold: { color: colors.goldInk },
  labelDimmed: { color: colors.textMuted },
});
