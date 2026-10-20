import { useEffect, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';

/**
 * M118 (owner, 2026-10-21, with his own artwork: «بعتلك الصورة اللي انا عايزها وخليها تظهر جزء من
 * الثانية سريعة جدا»): the golden-sparkles logo artwork flashes over the whole screen the moment
 * the app opens — well under a second — then fades away. Pure JS, so it rides OTA to every binary.
 */
const ARTWORK = require('../../assets/images/splash-flash.jpg');
const HOLD_MS = 700;
const FADE_MS = 350;

export function SplashFlash() {
  const { width, height } = useWindowDimensions();
  const [opacity] = useState(() => new Animated.Value(1));
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [opacity]);

  if (gone) return null;
  return (
    <Animated.View style={[styles.cover, { opacity }]} pointerEvents="none">
      <Animated.Image source={ARTWORK} style={{ width, height }} resizeMode="cover" fadeDuration={0} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000', zIndex: 1000, elevation: 1000, alignItems: 'center', justifyContent: 'center' },
});
