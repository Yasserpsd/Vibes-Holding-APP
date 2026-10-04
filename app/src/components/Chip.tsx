import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { FadeInView } from '@/components/motion';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
};

/**
 * Filter pill. Press physics mirror PressScale's spring; the Pressable stays local
 * so `accessibilityState.selected` keeps announcing (PressScale doesn't forward it).
 */
export function Chip({ label, selected = false, onPress }: Props) {
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
          style={[styles.chip, selected && styles.chipSelected]}
        >
          <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
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
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.goldLight,
  },
});
