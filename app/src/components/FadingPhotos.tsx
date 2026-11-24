import { useEffect, useState } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';

import { launchStart } from '@/api/images';
import { sized } from '@/lib/imageUrl';

const HOLD_MS = 6500;
const FADE_OUT_MS = 260;
const FADE_IN_MS = 380;

/**
 * M270 (owner, 2026-11-25: «يبقي في زخم من الصور… صور طول الوقت متجددة»): the photo behind a card — it fills
 * its parent, opens on a different picture every launch and cross-fades to the next one every few seconds.
 * One timer and two native-driver fades per swap; a single picture just sits there. A picture that fails to
 * load leaves the rotation, and with none left the parent's own background shows.
 */
export function FadingPhotos({ urls, points }: { urls: string[]; points: number }) {
  const [index, setIndex] = useState(() => launchStart(urls.length));
  const [opacity] = useState(() => new Animated.Value(1));
  const [failed, setFailed] = useState<string[]>([]);
  const usable = urls.filter((entry) => !failed.includes(entry));

  useEffect(() => {
    if (usable.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() => {
        setIndex((current) => current + 1);
        Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      });
    }, HOLD_MS);
    return () => clearInterval(timer);
  }, [opacity, usable.length]);

  // The rest of the set downloads behind the first picture, so a swap never shows a loading gap.
  const key = urls.join('|');
  useEffect(() => {
    for (const entry of key.split('|')) if (entry) void Image.prefetch(sized(entry, points)).catch(() => undefined);
  }, [key, points]);

  const url = usable[usable.length ? index % usable.length : 0];
  if (!url) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      <Image
        source={{ uri: sized(url, points) }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        resizeMethod="resize"
        accessibilityIgnoresInvertColors
        onError={() => setFailed((current) => (current.includes(url) ? current : [...current, url]))}
      />
    </Animated.View>
  );
}
