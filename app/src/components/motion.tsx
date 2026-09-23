import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type AccessibilityRole, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

/**
 * M38: the app's motion, with the core `Animated` API only — no new native module, so every
 * animation ships over OTA on the current binary. Transforms and opacity run on the native driver.
 */

/** Staggers a list: the first cards slide in one after the other, the rest appear instantly. */
export const entranceDelay = (index: number, step = 60, cap = 8) => Math.min(Math.max(index, 0), cap) * step;

type FadeInProps = {
  children: ReactNode;
  delay?: number;
  duration?: number;
  /** How far the content slides up while fading in; 0 fades in place. */
  offset?: number;
  style?: StyleProp<ViewStyle>;
};

/** Mount entrance: fade in while sliding up a little. Vertical only, so RTL never mirrors it. */
export function FadeInView({ children, delay = 0, duration = 420, offset = 16, style }: FadeInProps) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, delay, duration]);
  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

type PressScaleProps = {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** The pressable content box (layout, borders, padding). */
  style?: StyleProp<ViewStyle>;
  /** The animated wrapper (margins, flex within the parent). */
  wrapStyle?: StyleProp<ViewStyle>;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  hitSlop?: number;
};

/** A touch the finger can feel: the card dips under the press and springs back. */
export function PressScale({ children, onPress, onLongPress, disabled, style, wrapStyle, accessibilityRole = 'button', accessibilityLabel, hitSlop }: PressScaleProps) {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (value: number) => Animated.spring(scale, { toValue: value, speed: 40, bounciness: 5, useNativeDriver: true }).start();
  return (
    <Animated.View style={[wrapStyle, { transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        onPressIn={() => to(0.965)}
        onPressOut={() => to(1)}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        hitSlop={hitSlop}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** A soft opacity loop for skeletons and waiting states. */
export function usePulse(from = 0.4, to = 1, duration = 700): Animated.Value {
  const [pulse] = useState(() => new Animated.Value(from));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: to, duration, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: from, duration, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, from, to, duration]);
  return pulse;
}

/** Ghost cards while a list loads: alive, instead of an empty page with a spinner. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  const pulse = usePulse();
  return (
    <Animated.View style={[skeletonStyles.wrap, { opacity: pulse }]}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={skeletonStyles.card}>
          <View style={skeletonStyles.thumb} />
          <View style={skeletonStyles.lines}>
            <View style={[skeletonStyles.bar, skeletonStyles.barWide]} />
            <View style={[skeletonStyles.bar, skeletonStyles.barMid]} />
            <View style={[skeletonStyles.bar, skeletonStyles.barShort]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** Counts the shown number from where it stands to its target (the first render counts up from zero). */
export function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    const from = latest.current;
    const start = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (target - from) * eased);
      latest.current = next;
      setValue(next);
      if (progress >= 1) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [target, duration]);
  return value;
}

/** A light band sweeping across gold surfaces (the membership card's metal sheen). */
export function Sheen({ width, height, band = 90, duration = 2600, delay = 1200 }: { width: number; height: number; band?: number; duration?: number; delay?: number }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(delay),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, duration, delay]);
  const travel = width + band * 2;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Animated.View
        style={{
          position: 'absolute',
          top: -height * 0.4,
          left: -band * 2,
          width: band,
          height: height * 1.8,
          backgroundColor: 'rgba(255, 244, 204, 0.14)',
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) },
            { rotate: '18deg' },
          ],
        }}
      />
    </View>
  );
}

/** A bar growing to its share (poll results, meters). Width animates on the JS driver: a few bars, no cost. */
export function GrowBar({ percent, color = colors.gold, height = 8, trackColor = colors.surfaceElevated, delay = 0 }: { percent: number; color?: string; height?: number; trackColor?: string; delay?: number }) {
  const [progress] = useState(() => new Animated.Value(0));
  const share = Math.max(0, Math.min(100, percent));
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: share, duration: 650, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [progress, share, delay]);
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' }}>
      <Animated.View style={{ height: '100%', borderRadius: height / 2, backgroundColor: color, width: progress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  wrap: { gap: spacing.sm, alignSelf: 'stretch' },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumb: { width: 72, height: 72, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  lines: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  bar: { height: 12, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  barWide: { alignSelf: 'stretch' },
  barMid: { width: '70%' },
  barShort: { width: '45%' },
});
