import { useEffect, useState } from 'react';
import { Animated, Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii } from '@/theme/tokens';

const ROTATE_MS = 5000;
const FADE_OUT_MS = 240;
const FADE_IN_MS = 340;

/**
 * M105 (owner): «بانر بيتحرك لوحده» — an auto-rotating fade banner for the owner's photo sets
 * (service pages first). One interval, native-driver fades only; a single photo renders still.
 */
export function RotatingBanner({ urls, height = 190, style, accessibilityLabel }: { urls: string[]; height?: number; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const [index, setIndex] = useState(0);
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (urls.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() => {
        setIndex((current) => (current + 1) % urls.length);
        Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [opacity, urls]);

  const url = urls[Math.min(index, urls.length - 1)];
  if (!url) return null;

  return (
    <View style={[styles.box, { height }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" accessibilityLabel={accessibilityLabel} />
      </Animated.View>
      {urls.length > 1 ? (
        <View style={styles.dots}>
          {urls.map((entry, dot) => (
            <View key={`${dot}-${entry.slice(-12)}`} style={[styles.dot, dot === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  dots: { position: 'absolute', bottom: 8, alignSelf: 'center', flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn: { backgroundColor: colors.gold },
});
