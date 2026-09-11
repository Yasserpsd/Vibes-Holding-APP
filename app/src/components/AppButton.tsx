import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  icon?: IoniconName;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({ label, onPress, variant = 'primary', icon, style }: Props) {
  const outline = variant === 'outline';
  const color = outline ? colors.gold : colors.black;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.base, outline ? styles.outline : styles.primary, pressed && styles.pressed, style]}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  primary: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: colors.goldDark,
  },
  pressed: {
    opacity: 0.75,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    lineHeight: 22,
  },
});
