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
  // M109h: a photo that fails to load (a stale upload, a network hiccup) leaves the rotation
  // instead of cycling an empty gray frame; with none left the banner steps aside entirely.
  const [failed, setFailed] = useState<string[]>([]);
  // A new photo set gets a clean slate (reset during render, the React way for derived state).
  const key = urls.join('|');
  const [failedFor, setFailedFor] = useState(key);
  if (failedFor !== key) {
    setFailedFor(key);
    setFailed([]);
    setIndex(0);
  }
  const usable = urls.filter((entry) => !failed.includes(entry));

  useEffect(() => {
    if (usable.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() => {
        setIndex((current) => current + 1);
        Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [opacity, usable.length]);

  // M130b (owner: «تقليب الصور تقيل»): the set's other photos download behind the first one,
  // so every swap shows an already-cached image instead of a loading hitch. Never fatal.
  useEffect(() => {
    for (const entry of key.split('|').slice(1)) void Image.prefetch(entry).catch(() => undefined);
  }, [key]);

  const url = usable[usable.length ? index % usable.length : 0];
  if (!url) return null;

  return (
    <View style={[styles.box, { height }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          resizeMethod="resize"
          accessibilityLabel={accessibilityLabel}
          onError={() => setFailed((current) => (current.includes(url) ? current : [...current, url]))}
        />
      </Animated.View>
      {usable.length > 1 ? (
        <View style={styles.dots}>
          {usable.map((entry, dot) => (
            <View key={`${dot}-${entry.slice(-12)}`} style={[styles.dot, dot === index % usable.length && styles.dotOn]} />
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
