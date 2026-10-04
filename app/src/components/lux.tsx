import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, gradients, radii, shadows } from '@/theme/tokens';

/**
 * Luxury visual primitives for the V2 overhaul. Everything here is core RN only
 * (boxShadow + experimental_backgroundImage, both supported by the current binary's
 * new architecture), so the whole look ships over OTA.
 */

const emblem = require('../../assets/images/club-emblem.png');

type GoldGradientProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Gradient preset from the theme; `gold` reads like the logo's metal. */
  variant?: keyof typeof gradients;
};

/** A view washed in one of the brand gradients, with a solid fallback color underneath. */
export function GoldGradient({ children, style, variant = 'gold' }: GoldGradientProps) {
  const fallback = variant === 'gold' ? colors.gold : colors.surfaceElevated;
  return (
    <View style={[{ backgroundColor: fallback, experimental_backgroundImage: gradients[variant] }, style]}>
      {children}
    </View>
  );
}

type GlassCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Gold hairline border + faint halo; the default quiet card keeps the neutral border. */
  golden?: boolean;
  /** Corner radius of the card (keep it in sync with inner content). */
  radius?: number;
};

/** The standard premium card: machined dark surface, hairline border, soft depth. */
export function GlassCard({ children, style, golden = false, radius = radii.lg }: GlassCardProps) {
  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderWidth: 1,
          borderColor: golden ? colors.borderGold : colors.border,
          backgroundColor: colors.surface,
          experimental_backgroundImage: gradients.surface,
          boxShadow: golden ? shadows.glowGoldFaint : shadows.lift,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type NeonPulseProps = {
  /** Match the wrapped surface's borderRadius so the ring hugs its corners. */
  radius?: number;
  /** Peak halo; the ring breathes between a whisper and this. */
  intensity?: 'soft' | 'strong';
  duration?: number;
};

/**
 * A breathing golden neon ring. Absolutely fills its parent (which needs position
 * relative — any RN View is), ignores touches, animates opacity on the native driver.
 */
export function NeonPulse({ radius = radii.lg, intensity = 'soft', duration = 2200 }: NeonPulseProps) {
  const [glow] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.35, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, duration]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: glow,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: colors.borderGold,
          boxShadow: intensity === 'strong' ? shadows.glowGoldStrong : shadows.glowGold,
        },
      ]}
    />
  );
}

/** A thin golden divider that reads as a lit filament, not a border. */
export function GoldHairline({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          height: StyleSheet.hairlineWidth * 2,
          borderRadius: 1,
          backgroundColor: colors.goldDark,
          experimental_backgroundImage:
            'linear-gradient(90deg, rgba(230,186,84,0) 0%, rgba(242,206,116,0.9) 50%, rgba(230,186,84,0) 100%)',
        },
        style,
      ]}
    />
  );
}

type EmblemWatermarkProps = {
  /** Rendered size of the emblem square. */
  size?: number;
  /** Watermark strength; stays a whisper by default. */
  opacity?: number;
  style?: StyleProp<ViewStyle>;
};

/** The club emblem ghosted behind content. Position via `style` (start/end/top/bottom are RTL-aware). */
export function EmblemWatermark({ size = 220, opacity = 0.05, style }: EmblemWatermarkProps) {
  return (
    <View pointerEvents="none" style={[styles.watermark, style]}>
      <Image source={emblem} style={{ width: size, height: size, opacity }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  watermark: { position: 'absolute', top: -24, end: -40 },
});
