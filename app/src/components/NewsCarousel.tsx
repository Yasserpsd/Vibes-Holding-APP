import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Animated, Easing, I18nManager, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { useHomeNews, useNumberOfDay, type NewsItem } from '@/api/news';
import { GlassCard } from '@/components/lux';
import { BreakingPill, isBreaking } from '@/components/news/NewsCard';
import { MarketsStrip } from '@/components/MarketsStrip';
import { FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { textDir, textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const ROTATE_MS = 4500;
const SLIDES = 8;
// The next card peeks in at the reading end so the strip reads as something to flip through.
const PEEK = 32;
const GAP = 10;
// Transforms are physical: the next card sits toward the reading end (left in Arabic, right in English).
const DIR = I18nManager.isRTL ? -1 : 1;

/**
 * M176 (owner, 2026-11-01, «خلي الأخبار تحت شوية وتتحرك كاروسيل… تشد أكتر»): the news door became a
 * moving carousel of the latest real items (rule 7: original title, source, time, snippet — tap opens
 * the item with its «اقرأ من المصدر»); the live price strip sits right above it.
 * Owner, 2026-11-01 («اقدر اقلب بينها… لو خبر عاجبني ارجعه»): the card follows the finger both ways,
 * the next one peeks in, the first touch stops the auto-advance for good, and the dots jump to an item.
 * Every card keeps one height (image or fallback, two title lines, two snippet lines).
 */
// M182 (owner, 2026-11-02): the carousel's items come from the server's home scope — money and
// business only (markets, oil, gold, crypto…), the spiciest headlines first, same for everyone.
export function NewsCarousel() {
  const router = useRouter();
  const feed = useHomeNews();
  const items = useMemo(() => (feed.data?.items ?? []).slice(0, SLIDES), [feed.data]);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [touched, setTouched] = useState(false);
  const [drag] = useState(() => new Animated.Value(0));
  const cardWidth = width ? width - PEEK : 0;
  const step = cardWidth + GAP;
  // The pager's handlers are created once; they read the live count and step from `live`.
  const [pager] = useState(() => {
    const live = { count: 0, step: 0, busy: false };
    // JS-driven on purpose (owner, 2026-11-02: blank carousel on real phones): the native driver kept
    // stale transforms on the re-keyed cards after each advance, leaving the center card off-screen.
    // On the JS thread every render recomputes the transforms from the real value, so the resting
    // state (drag = 0, center card in place) can never diverge from what the screen shows.
    const settle = () => Animated.spring(drag, { toValue: 0, speed: 18, bounciness: 4, useNativeDriver: false }).start();
    const slide = (move: 1 | -1) => {
      const { count, step: size, busy } = live;
      if (busy) return;
      if (count < 2 || !size) return settle();
      live.busy = true;
      Animated.timing(drag, { toValue: -DIR * size * move, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
        live.busy = false;
        if (!finished) return;
        // Zero the offset in the same tick as the index change: the new center paints in place, no gap frame.
        drag.setValue(0);
        setIndex((current) => (current + move + count) % count);
      });
    };
    const pan = PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderGrant: () => {
        drag.stopAnimation();
        setTouched(true);
      },
      onPanResponderMove: (_event, gesture) => drag.setValue(gesture.dx),
      onPanResponderRelease: (_event, gesture) => {
        // Dragging toward the reading start brings the next card in (rightward in Arabic).
        const forward = DIR === -1 ? gesture.dx > 0 : gesture.dx < 0;
        const far = Math.abs(gesture.dx) > live.step * 0.22 || Math.abs(gesture.vx) > 0.35;
        if (far) slide(forward ? 1 : -1);
        else settle();
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: settle,
    });
    const sync = (count: number, size: number) => {
      live.count = count;
      live.step = size;
    };
    return { slide, pan, sync };
  });

  useEffect(() => pager.sync(items.length, step), [pager, items.length, step]);

  // The finished slide already shows the new card in place; the new index takes over from zero offset.
  useLayoutEffect(() => {
    drag.setValue(0);
  }, [index, drag]);

  useEffect(() => {
    if (touched || items.length < 2 || !width) return;
    const timer = setInterval(() => pager.slide(1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [touched, items.length, width, pager]);

  if (!items.length) return null;
  const count = items.length;
  const current = index % count;
  const offsets = !width ? [0] : count > 2 ? [-1, 0, 1] : count === 2 ? [0, 1] : [0];
  const open = (item: NewsItem) => router.push(`/news/${item.id}` as Href);

  return (
    <FadeInView delay={200}>
      <SectionHeader icon="newspaper-outline" title={t('home.newsDoor')} subtitle={t('home.newsDoorSub')} cta={t('home.newsAll')} onPress={() => router.push('/news' as Href)} />
      <MarketsStrip />
      <View style={styles.pager} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} {...pager.pan.panHandlers}>
        {offsets.map((offset) => {
          const item = items[(current + offset + count) % count] as NewsItem;
          const translateX = offset === 0 ? drag : Animated.add(drag, DIR * offset * step);
          return (
            <Animated.View key={item.id} style={[offset !== 0 && styles.side, cardWidth ? { width: cardWidth } : null, { transform: [{ translateX }] }]}>
              <NewsSlide item={item} onPress={offset === 0 ? () => open(item) : () => pager.slide(offset > 0 ? 1 : -1)} />
            </Animated.View>
          );
        })}
      </View>
      <View style={styles.dots}>
        {items.map((entry, dot) => (
          <Pressable
            key={entry.id}
            hitSlop={6}
            onPress={() => {
              setTouched(true);
              setIndex(dot);
            }}
            accessibilityRole="button"
            accessibilityLabel={entry.title}
          >
            <View style={[styles.dot, dot === current && styles.dotOn]} />
          </Pressable>
        ))}
      </View>
      <NumberOfDayCard />
    </FadeInView>
  );
}

/** M182c «رقم اليوم»: the day's biggest money figure, golden under the carousel; a tap opens its story. */
function NumberOfDayCard() {
  const router = useRouter();
  const number = useNumberOfDay().data?.number ?? null;
  if (!number) return null;
  return (
    <PressScale
      onPress={() => router.push(`/news/${number.item.id}` as Href)}
      glow
      glowRadius={radii.lg}
      accessibilityRole="button"
      accessibilityLabel={`${t('news.numberOfDay')}: ${number.text}`}
      wrapStyle={styles.numberWrap}
    >
      <GlassCard golden style={styles.numberCard}>
        {/* Owner (2026-11-02, «خلي الرقم اكبر شئ وراه خلفية مميزة»): the figure is the hero — huge, dark ink on the lit gold slab. */}
        <View style={styles.numberSide}>
          <Text style={styles.numberEyebrow}>{t('news.numberOfDay')}</Text>
          <Text style={styles.numberValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{number.text}</Text>
        </View>
        <View style={styles.numberTexts}>
          <Text style={[styles.numberTitle, textDir(number.item.title)]} numberOfLines={2}>{number.item.title}</Text>
          <Text style={styles.numberSource} numberOfLines={1}>{number.item.source.name}</Text>
        </View>
      </GlassCard>
    </PressScale>
  );
}

function NewsSlide({ item, onPress }: { item: NewsItem; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={item.title}>
      <GlassCard style={styles.card}>
        {item.image ? (
          <Image source={{ uri: sized(item.image, 480) }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imageFallback]}>
            <Ionicons name="newspaper-outline" size={36} color={colors.gold} />
          </View>
        )}
        <View style={styles.body}>
          <View style={styles.meta}>
            {isBreaking(item.publishedAt) ? <BreakingPill /> : null}
            <View style={styles.sourcePill}>
              <Text style={styles.source} numberOfLines={1}>{item.source.name}</Text>
            </View>
            <Text style={styles.time} numberOfLines={1}>{formatRelativeTime(item.publishedAt)}</Text>
          </View>
          <Text style={[styles.title, textDir(item.title)]} numberOfLines={2}>{item.title}</Text>
          <Text style={[styles.snippet, item.snippet ? textDir(item.snippet) : null]} numberOfLines={2}>{item.snippet ?? ''}</Text>
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  pager: { overflow: 'hidden' },
  side: { position: 'absolute', top: 0, start: 0 },
  card: { padding: 0, overflow: 'hidden' },
  image: { width: '100%', height: 150, backgroundColor: colors.surfaceElevated },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, gap: spacing.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sourcePill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.borderGoldSoft, maxWidth: '60%' },
  source: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.goldLight },
  time: { ...typography.caption, color: colors.textMuted, flex: 1, textAlign: textStart },
  // Two reserved lines each: every card in the pager keeps one height.
  title: { ...typography.subtitle, fontSize: 17, lineHeight: 27, minHeight: 54, color: colors.textPrimary, textAlign: textStart },
  snippet: { ...typography.body, fontSize: 14, lineHeight: 22, minHeight: 44, color: colors.textSecondary, textAlign: textStart },
  numberWrap: { marginTop: spacing.sm },
  numberCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  numberSide: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    minWidth: 112,
    maxWidth: 160,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGold,
  },
  numberEyebrow: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldInk },
  numberValue: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 46, color: colors.goldInk },
  numberTexts: { flex: 1, gap: 2 },
  numberTitle: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.textPrimary, textAlign: textStart },
  numberSource: { ...typography.caption, fontSize: 11, color: colors.textMuted, textAlign: textStart },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderGoldSoft },
  dotOn: { width: 18, backgroundColor: colors.gold },
});
