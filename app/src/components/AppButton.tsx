import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, gradients, radii, shadows, spacing } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  label: string;
  onPress: () => void;
  /** `primary` glows like the logo's metal; `outline` is a lit hairline; `ghost` is text-quiet. */
  variant?: 'primary' | 'outline' | 'ghost';
  icon?: IoniconName;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Shows a spinner in place of the icon and mutes the press. */
  loading?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function AppButton({ label, onPress, variant = 'primary', icon, style, disabled = false, loading = false }: Props) {
  const primary = variant === 'primary';
  const color = primary ? colors.goldInk : colors.gold;
  const muted = disabled || loading;
  // M38: the button dips under the finger and springs back — felt on every press in the app.
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) => Animated.spring(scale, { toValue: value, speed: 40, bounciness: 5, useNativeDriver: true }).start();
  return (
    <AnimatedPressable
      onPress={muted ? undefined : onPress}
      onPressIn={() => !muted && to(0.96)}
      onPressOut={() => to(1)}
      disabled={muted}
      accessibilityRole="button"
      accessibilityState={{ disabled: muted, busy: loading }}
      style={[styles.base, styles[variant], muted && styles.muted, style, { transform: [{ scale }] }]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={color} />
      ) : null}
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
    borderColor: colors.goldLight,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGold,
  },
  outline: {
    backgroundColor: colors.goldFaint,
    borderColor: colors.borderGold,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  muted: {
    opacity: 0.55,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    lineHeight: 22,
  },
});
