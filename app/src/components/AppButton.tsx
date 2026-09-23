import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps } from 'react';
import { Animated, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  icon?: IoniconName;
  style?: StyleProp<ViewStyle>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function AppButton({ label, onPress, variant = 'primary', icon, style }: Props) {
  const outline = variant === 'outline';
  const color = outline ? colors.gold : colors.black;
  // M38: the button dips under the finger and springs back — felt on every press in the app.
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) => Animated.spring(scale, { toValue: value, speed: 40, bounciness: 5, useNativeDriver: true }).start();
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => to(0.96)}
      onPressOut={() => to(1)}
      accessibilityRole="button"
      style={[styles.base, outline ? styles.outline : styles.primary, style, { transform: [{ scale }] }]}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </AnimatedPressable>
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
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    lineHeight: 22,
  },
});
