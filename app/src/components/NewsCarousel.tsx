import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, I18nManager, Image, PanResponder, StyleSheet, Text, View } from 'react-native';

import { useNewsFeed, type NewsItem } from '@/api/news';
import { GlassCard } from '@/components/lux';
import { MarketsStrip } from '@/components/MarketsStrip';
import { FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { textDir, textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const ROTATE_MS = 4500;
const SLIDES = 8;

/**
 * M176 (owner, 2026-11-01, «خلي الأخبار تحت شوية وتتحرك كاروسيل… تشد أكتر»): the news door became a
 * moving carousel of the latest real items (rule 7: original title, source, time, snippet — tap opens
 * the item with its «اقرأ من المصدر»). One card at a time, auto-advancing, swipeable; the live price
 * strip (TASI, gold, dollar, then «مشاهدة الكل») sits right above it.
 */
export function NewsCarousel({ who }: { who: string }) {
  const router = useRouter();
  const feed = useNewsFeed(undefined, who);
  const items = useMemo(() => (feed.data?.pages[0]?.items ?? []).slice(0, SLIDES), [feed.data]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(0);
  const [motion] = useState(() => new Animated.Value(1));

  const go = (step: number) => {
    if (items.length < 2) return;
    Animated.timing(motion, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setIndex((current) => (current + step + items.length) % items.length);
      Animated.timing(motion, { toValue: 1, duration: 320, useNativeDriver: true }).start();
    });
  };

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(motion, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setIndex((current) => (current + 1) % items.length);
        Animated.timing(motion, { toValue: 1, duration: 320, useNativeDriver: true }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
    // `paused` restarts the timer after a manual swipe.
  }, [items.length, motion, paused]);

  // A swipe toward the reading direction's end shows the next item (right-to-left in Arabic).
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) < 40) return;
      const forward = I18nManager.isRTL ? gesture.dx > 0 : gesture.dx < 0;
      go(forward ? 1 : -1);
      setPaused((value) => value + 1);
    },
  });

  if (!items.length) return null;
  const item = items[index % items.length] as NewsItem;
  const shift = motion.interpolate({ inputRange: [0, 1], outputRange: [I18nManager.isRTL ? -24 : 24, 0] });

  return (
    <FadeInView delay={200}>
      <SectionHeader icon="newspaper-outline" title={t('home.newsDoor')} subtitle={t('home.newsDoorSub')} cta={t('home.newsAll')} onPress={() => router.push('/news' as Href)} />
      <MarketsStrip />
      <View {...pan.panHandlers}>
        <PressScale onPress={() => router.push(`/news/${item.id}` as Href)} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={item.title}>
          <Animated.View style={{ opacity: motion, transform: [{ translateX: shift }] }}>
            <GlassCard style={styles.card}>
              {item.image ? <Image source={{ uri: sized(item.image, 480) }} style={styles.image} resizeMode="cover" /> : null}
              <View style={styles.body}>
                <View style={styles.meta}>
                  <View style={styles.sourcePill}>
                    <Text style={styles.source} numberOfLines={1}>{item.source.name}</Text>
                  </View>
                  <Text style={styles.time} numberOfLines={1}>{formatRelativeTime(item.publishedAt)}</Text>
                </View>
                <Text style={[styles.title, textDir(item.title)]} numberOfLines={3}>{item.title}</Text>
                {item.snippet ? <Text style={[styles.snippet, textDir(item.snippet)]} numberOfLines={2}>{item.snippet}</Text> : null}
              </View>
            </GlassCard>
          </Animated.View>
        </PressScale>
      </View>
      <View style={styles.dots}>
        {items.map((entry, dot) => (
          <View key={entry.id} style={[styles.dot, dot === index % items.length && styles.dotOn]} />
        ))}
      </View>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: 'hidden' },
  image: { width: '100%', height: 150, backgroundColor: colors.surfaceElevated },
  body: { padding: spacing.md, gap: spacing.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sourcePill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.borderGoldSoft, maxWidth: '60%' },
  source: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.goldLight },
  time: { ...typography.caption, color: colors.textMuted, flex: 1, textAlign: textStart },
  title: { ...typography.subtitle, fontSize: 17, lineHeight: 27, color: colors.textPrimary, textAlign: textStart },
  snippet: { ...typography.body, fontSize: 14, lineHeight: 22, color: colors.textSecondary, textAlign: textStart },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderGoldSoft },
  dotOn: { width: 18, backgroundColor: colors.gold },
});
