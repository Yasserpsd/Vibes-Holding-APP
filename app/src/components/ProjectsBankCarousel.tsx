import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

/**
 * M84 (owner): the Projects Bank home block «بيقلب كده في الصور زي الموقع بالظبط» — an
 * auto-rotating fade carousel of the bank's project images; a tap opens that project.
 */
export function ProjectsBankCarousel() {
  const router = useRouter();
  const list = useProjectsList({ q: '', sort: 'discover' });
  const [index, setIndex] = useState(0);
  const [opacity] = useState(() => new Animated.Value(1));

  const slides = (list.data?.pages[0]?.items ?? []).filter((project): project is PublicProject & { image: string } => Boolean(project.image)).slice(0, MAX_SLIDES);

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
