import { useEffect, useState } from 'react';
import { Animated, Image, StyleSheet, useWindowDimensions } from 'react-native';

import { SPLASH_BLACK, SPLASH_EMBLEM, SPLASH_EMBLEM_SIZE } from '@/lib/reloadApp';

/**
 * M118 (owner, 2026-10-21, with his own artwork: «بعتلك الصورة اللي انا عايزها وخليها تظهر جزء من
 * الثانية سريعة جدا»): the golden-sparkles logo artwork flashes over the whole screen the moment
 * the app opens — well under a second — then fades away. Pure JS, so it rides OTA to every binary.
 */
const ARTWORK = require('../../assets/images/splash-flash.jpg');
const HOLD_MS = 700;
const FADE_MS = 350;
/** An artwork that has not decoded by then is skipped: the cover leaves instead of waiting on it. */
const LOAD_TIMEOUT_MS = 1_500;

/**
 * 2026-11-16 (members: «شاشة سودا بدون سبب»): the cover used to be a bare black view until the 1080×1920 artwork
 * was decoded. Until then it now shows the opening screen (brand black and the emblem, like the native splash and
 * LaunchCover), and the artwork's hold starts when the artwork is really on screen.
 */
export function SplashFlash() {
  const { width, height } = useWindowDimensions();
  const [opacity] = useState(() => new Animated.Value(1));
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!loaded) {
      const giveUp = setTimeout(() => setGone(true), LOAD_TIMEOUT_MS);
      return () => clearTimeout(giveUp);
    }
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [loaded, opacity]);

  if (gone) return null;
  return (
    <Animated.View style={[styles.cover, { opacity }]} pointerEvents="none">
      {loaded ? null : <Image source={SPLASH_EMBLEM} style={styles.emblem} resizeMode="contain" fadeDuration={0} />}
      <Image
        source={ARTWORK}
        style={[styles.artwork, { width, height, opacity: loaded ? 1 : 0 }]}
        resizeMode="cover"
        fadeDuration={0}
        onLoad={() => setLoaded(true)}
        onError={() => setGone(true)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: SPLASH_BLACK, elevation: 1000, alignItems: 'center', justifyContent: 'center' },
  emblem: { width: SPLASH_EMBLEM_SIZE, height: SPLASH_EMBLEM_SIZE },
  artwork: { position: 'absolute', top: 0, left: 0 },
});
