import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
};

export function Chip({ label, selected = false, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
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
    borderColor: colors.gold,
    backgroundColor: colors.surfaceElevated,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.goldLight,
  },
});
