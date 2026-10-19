import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

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
 */
export function Chip({ label, selected = false, dimmed = false, onPress }: Props) {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) =>
    Animated.spring(scale, { toValue: value, speed: 40, bounciness: 5, useNativeDriver: true }).start();
  return (
    <FadeInView offset={6} duration={240}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={onPress}
          onPressIn={() => to(0.95)}
          onPressOut={() => to(1)}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          style={[styles.chip, selected && styles.chipSelected, !selected && dimmed && styles.chipDimmed]}
        >
          <Text style={[styles.label, selected && styles.labelSelected, !selected && dimmed && styles.labelDimmed]} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
      </Animated.View>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.goldLight,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGold,
  },
  chipDimmed: { opacity: 0.45 },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.goldInk,
    fontFamily: fonts.bold,
  },
  labelDimmed: { color: colors.textMuted },
});
