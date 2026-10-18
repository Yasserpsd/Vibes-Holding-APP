import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

import { useProjectsList } from '@/api/queries';
import type { PublicProject } from '@/api/types';
import { GlassCard } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const ROTATE_MS = 3500;
const FADE_OUT_MS = 220;
const FADE_IN_MS = 320;
const MAX_SLIDES = 8;

/** Seeded Fisher–Yates: the same seed always deals the same hand, so renders stay stable. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/**
 * M84 (owner): the Projects Bank home block «بيقلب كده في الصور زي الموقع بالظبط» — an
 * auto-rotating fade carousel of the bank's project images; a tap opens that project.
 */
export function ProjectsBankCarousel() {
  const router = useRouter();
  const list = useProjectsList({ q: '', sort: 'discover' });
  const [index, setIndex] = useState(0);
  const [opacity] = useState(() => new Animated.Value(1));
  // M95 (owner): «كل مرة تقفل وتفتح تتغير وكل مرة تروح صفحة وترجع تتغير» — a fresh seed on every
  // focus (and every cold start) deals a different hand of projects into the carousel.
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setShuffleSeed(Date.now());
      setIndex(0);
    }, []),
  );

  const page = list.data?.pages[0];
  const slides = useMemo(
    () =>
      shuffled(
        (page?.items ?? []).filter((project): project is PublicProject & { image: string } => Boolean(project.image)),
        shuffleSeed,
      ).slice(0, MAX_SLIDES),
    [page, shuffleSeed],
  );

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() => {
        setIndex((current) => (current + 1) % slides.length);
        Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [opacity, slides.length]);

  if (slides.length === 0) return null;
  const project = slides[Math.min(index, slides.length - 1)];

  return (
    <PressScale onPress={() => router.push({ pathname: '/project/[id]', params: { id: String(project.id) } })} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={project.title}>
      <GlassCard golden radius={radii.xl} style={styles.card}>
        <Animated.View style={{ opacity }}>
          <Image source={{ uri: project.image }} style={styles.image} resizeMode="cover" accessibilityLabel={project.title} />
          <View style={styles.overlay}>
            <Text style={styles.title} numberOfLines={1}>
              {project.title}
            </Text>
            <View style={styles.metaRow}>
              {project.sector ? <Text style={styles.meta}>{project.sector.name}</Text> : null}
              {project.stage ? <Text style={styles.meta}>{project.stage.name}</Text> : null}
            </View>
          </View>
        </Animated.View>
        {slides.length > 1 ? (
          <View style={styles.dots}>
            {slides.map((slide, dot) => (
              <View key={slide.id} style={[styles.dot, dot === index && styles.dotOn]} />
            ))}
          </View>
        ) : null}
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: 'hidden', marginTop: spacing.sm },
  image: { width: '100%', height: 180, backgroundColor: colors.surfaceElevated },
  overlay: {
    position: 'absolute',
    bottom: 0,
    start: 0,
    end: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
    backgroundColor: 'rgba(10, 8, 2, 0.72)',
  },
  title: { ...typography.body, fontFamily: fonts.bold, color: colors.textPrimary, textAlign: textStart },
  metaRow: { flexDirection: 'row', gap: spacing.sm },
  meta: { ...typography.caption, color: colors.goldLight },
  dots: {
    position: 'absolute',
    top: spacing.sm,
    end: spacing.sm,
    flexDirection: 'row',
    gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn: { backgroundColor: colors.gold },
});
