import { useEffect, useState } from 'react';
import { Animated, I18nManager, Image, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressScale } from '@/components/motion';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, radii } from '@/theme/tokens';

const ROTATE_MS = 5000;
const FADE_OUT_MS = 240;
const FADE_IN_MS = 340;
/** A sideways drag longer than this (in points) turns the banner by hand. */
const SWIPE_POINTS = 36;
/** In a steady box, a picture whose shape is further than this from the box's is shown whole instead of cropped. */
const SHAPE_TOLERANCE = 0.12;
/** M130b (owner: «متبقاش مقصوصة»): the box follows the photo's own shape within these bounds. */
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 320;

/**
 * M105 (owner): «بانر بيتحرك لوحده» — an auto-rotating fade banner for the owner's photo sets
 * (service pages first). One interval, native-driver fades only; a single photo renders still.
 *
 * M270: the same banner carries the home's moving advertisements — `onPress` makes the showing picture a
 * button, `startAt` opens on another picture each launch, `maxHeight` lets a tall poster show whole, and
 * `steady` holds one height for the whole set (the tallest picture's) so the page under it never jumps.
 * The owner's «وحسن تجربة المستخدم قدر الإمكان» (same day): a set of several pictures also turns by hand —
 * a sideways swipe shows the next or the previous one (mirrored under RTL), and the clock starts again from
 * that picture so it is not taken away a second later. An up-and-down drag still scrolls the page.
 */
type Props = {
  urls: string[];
  height?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  onPress?: (url: string) => void;
  startAt?: number;
  maxHeight?: number;
  steady?: boolean;
};

export function RotatingBanner({ urls, height = 190, style, accessibilityLabel, onPress, startAt = 0, maxHeight = MAX_HEIGHT, steady = false }: Props) {
  const [index, setIndex] = useState(startAt);
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

  // A hand swipe bumps `turns`, which restarts the clock below from the picture the member chose.
  const [turns, setTurns] = useState(0);
  useEffect(() => {
    if (usable.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() => {
        setIndex((current) => current + 1);
        Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [opacity, usable.length, turns]);

  // Only a clearly sideways drag is taken, so the page keeps its vertical scroll and a tap stays a tap.
  const [swipe] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_event, gesture) => {
        if (Math.abs(gesture.dx) < SWIPE_POINTS) return;
        // The next picture comes from the end side: a swipe towards the start asks for it (mirrored under RTL).
        const forward = I18nManager.isRTL ? gesture.dx > 0 : gesture.dx < 0;
        Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
          setIndex((current) => current + (forward ? 1 : -1));
          setTurns((current) => current + 1);
          Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
        });
      },
    }),
  );

  // M130b (owner: «تقليب الصور تقيل»): the set's other photos download behind the first one,
  // so every swap shows an already-cached image instead of a loading hitch. Never fatal.
  useEffect(() => {
    // The SIZED address: the slide draws `sized(url, 360)`, so prefetching the original warmed a different cache entry (and downloaded the full picture for nothing).
    for (const entry of key.split('|').slice(1)) void Image.prefetch(sized(entry, 360)).catch(() => undefined);
  }, [key]);

  // M130b (owner: «الصور تظهر كاملة، متبقاش مقصوصة»): each photo's natural shape sizes the box,
  // so a wide marketing visual with text or a logo renders WHOLE instead of cover-cropped. A very
  // tall photo is capped (a phone portrait would swallow the page) and keeps the old cover crop.
  const [boxWidth, setBoxWidth] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    for (const entry of key.split('|')) {
      // Measured on the same sized variant the slide draws (same shape, and the download is shared).
      Image.getSize(
        sized(entry, 360),
        (w, h) => {
          if (w > 0 && h > 0) setRatios((current) => (current[entry] ? current : { ...current, [entry]: w / h }));
        },
        () => undefined,
      );
    }
  }, [key]);

  const at = usable.length ? ((index % usable.length) + usable.length) % usable.length : 0;
  const url = usable[at];
  if (!url) return null;

  // The whole-photo height for the current slide; clamped, and the prop height until measured.
  // `steady`: the narrowest measured shape (the tallest picture) sizes the box for every slide.
  const measured = usable.map((entry) => ratios[entry]).filter((ratio): ratio is number => Boolean(ratio));
  const ratio = steady && measured.length ? Math.min(...measured) : ratios[url];
  const fitted = boxWidth > 0 && ratio ? boxWidth / ratio : null;
  const boxHeight = fitted ? Math.round(Math.min(Math.max(fitted, MIN_HEIGHT), maxHeight)) : height;
  // Owner (2026-11-25: «استخدم كله… اكبر كمية ممكنة»): a service page now mixes his wide photos with the taller
  // posters. The steady box takes the tallest shape, so a wider picture is drawn WHOLE over a blurred, dimmed copy
  // of itself instead of losing its sides to a cover crop.
  const own = ratios[url];
  const whole = steady && boxWidth > 0 && own !== undefined && Math.abs(own / (boxWidth / boxHeight) - 1) > SHAPE_TOLERANCE;

  const box = (
    <View style={[styles.box, { height: boxHeight }, style]} onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)} {...(usable.length > 1 ? swipe.panHandlers : null)}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        {whole ? <Image key="backdrop" source={{ uri: sized(url, 360) }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={24} accessibilityIgnoresInvertColors /> : null}
        {whole ? <View key="dim" style={[StyleSheet.absoluteFill, styles.dim]} /> : null}
        <Image
          key="photo"
          source={{ uri: sized(url, 360) }}
          style={StyleSheet.absoluteFill}
          resizeMode={whole ? 'contain' : 'cover'}
          resizeMethod="resize"
          accessibilityLabel={accessibilityLabel}
          onError={() => setFailed((current) => (current.includes(url) ? current : [...current, url]))}
        />
      </Animated.View>
      {usable.length > 1 ? (
        <View style={styles.dots}>
          {usable.map((entry, dot) => (
            <View key={`${dot}-${entry.slice(-12)}`} style={[styles.dot, dot === at && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return box;
  return (
    <PressScale onPress={() => onPress(url)} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {box}
    </PressScale>
  );
}

const styles = themedStyles(() => ({
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
  dim: { backgroundColor: 'rgba(0,0,0,0.45)' },
}));
