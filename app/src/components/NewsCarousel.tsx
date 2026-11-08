import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { themedStyles } from '@/theme/styles';
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
// M187 (owner, 2026-11-03: «تهنيج… والصورة اللي فاتت تكون ظاهرة»): every card stays mounted with its
// image loaded once, and each card's place is computed from one ever-moving position (in cards), so a
// slide never re-keys a card, never resets an offset and never re-renders the section — only the dots.
export function NewsCarousel() {
  const router = useRouter();
  const feed = useHomeNews();
  const items = useMemo(() => (feed.data?.items ?? []).slice(0, SLIDES), [feed.data]);
  const [width, setWidth] = useState(0);
  const [touched, setTouched] = useState(false);
  const [position] = useState(() => new Animated.Value(0));
  const touch = useCallback(() => setTouched(true), []);
  const cardWidth = width ? width - PEEK : 0;
  const step = cardWidth + GAP;
  // The pager's handlers are created once; they read the live count and step from `live`.
  const [pager] = useState(() => {
    const live = { count: 0, step: 0, at: 0, now: 0, base: 0, onIndex: (_index: number) => {}, onTouch: () => {} };
    const wrap = (value: number) => ((Math.round(value) % live.count) + live.count) % live.count;
    // JS-driven on purpose (owner, 2026-11-02: blank carousel on real phones with the native driver).
    const go = (target: number) => {
      live.at = target;
      if (live.count) live.onIndex(wrap(target));
      Animated.timing(position, { toValue: target, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    };
    position.addListener(({ value }) => {
      live.now = value;
    });
    // Signed distance from the current card to item `slot`, the short way round.
    const offsetOf = (slot: number) => {
      const half = Math.floor(live.count / 2);
      return ((((slot - wrap(live.at) + half) % live.count) + live.count) % live.count) - half;
    };
    const pan = PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderGrant: () => {
        position.stopAnimation();
        live.base = live.now;
        live.onTouch();
      },
      // Dragging toward the reading start brings the next card in (rightward in Arabic).
      onPanResponderMove: (_event, gesture) => {
        if (live.step) position.setValue(live.base - (DIR * gesture.dx) / live.step);
      },
      onPanResponderRelease: (_event, gesture) => {
        const forward = DIR === -1 ? gesture.dx > 0 : gesture.dx < 0;
        const far = live.count > 1 && (Math.abs(gesture.dx) > live.step * 0.22 || Math.abs(gesture.vx) > 0.35);
        go(far ? (forward ? Math.floor(live.now) + 1 : Math.ceil(live.now) - 1) : Math.round(live.now));
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => go(Math.round(live.now)),
    });
    return {
      pan,
      sync: (count: number, size: number) => {
        live.count = count;
        live.step = size;
      },
      next: () => go(Math.round(live.at) + 1),
      jump: (slot: number) => go(Math.round(live.at) + offsetOf(slot)),
      // A tap on the center card opens it (true); a tap on a peeking card slides it in.
      tap: (slot: number) => {
        const offset = offsetOf(slot);
        if (offset === 0) return true;
        go(Math.round(live.at) + offset);
        return false;
      },
      listen: (onIndex: (index: number) => void, onTouch: () => void) => {
        live.onIndex = onIndex;
        live.onTouch = onTouch;
        if (live.count) onIndex(wrap(live.at));
      },
    };
  });

  useEffect(() => pager.sync(items.length, step), [pager, items.length, step]);

  useEffect(() => {
    if (touched || items.length < 2 || !width) return;
    const timer = setInterval(pager.next, ROTATE_MS);
    return () => clearInterval(timer);
  }, [touched, items.length, width, pager]);

  // Card `slot` sits (slot − position) cards away, folded into [−half, count − half) so the fold stays off-screen.
  const translates = useMemo(() => {
    const count = items.length;
    const half = Math.floor(count / 2);
    return items.map((_item, slot) =>
      Animated.multiply(Animated.subtract(Animated.modulo(Animated.add(Animated.multiply(position, -1), slot + half + count * 1000), count || 1), half), DIR * step),
    );
  }, [items, position, step]);

  if (!items.length) return null;
  const shown = width ? items : items.slice(0, 1);

  return (
    <FadeInView delay={200}>
      <SectionHeader icon="newspaper-outline" title={t('home.newsDoor')} subtitle={t('home.newsDoorSub')} cta={t('home.newsAll')} onPress={() => router.push('/news' as Href)} />
      <MarketsStrip />
      <View style={styles.pager} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} {...pager.pan.panHandlers}>
        {shown.map((item, slot) => (
          <CarouselCard key={item.id} item={item} slot={slot} cardWidth={cardWidth} translateX={width ? translates[slot] : undefined} pager={pager} />
        ))}
      </View>
      <CarouselDots items={items} pager={pager} onTouch={touch} />
      <NumberOfDayCard />
    </FadeInView>
  );
}

type Slide = ReturnType<typeof Animated.multiply>;
type Pager = { tap: (slot: number) => boolean; jump: (slot: number) => void; listen: (onIndex: (index: number) => void, onTouch: () => void) => void };

/** One card of the strip: mounted once per item, so its image never reloads or lingers on the wrong story. */
const CarouselCard = memo(function CarouselCard({ item, slot, cardWidth, translateX, pager }: { item: NewsItem; slot: number; cardWidth: number; translateX?: Slide; pager: Pager }) {
  const router = useRouter();
  return (
    // Every card shares one height: the first stays in flow and gives the strip its size.
    <Animated.View style={[slot !== 0 && styles.side, cardWidth ? { width: cardWidth } : null, translateX ? { transform: [{ translateX }] } : null]}>
      <NewsSlide item={item} onPress={() => (pager.tap(slot) ? router.push(`/news/${item.id}` as Href) : undefined)} />
    </Animated.View>
  );
});

/** The dots hold the only state a slide changes, so the rest of the section never re-renders mid-flight. */
function CarouselDots({ items, pager, onTouch }: { items: NewsItem[]; pager: Pager; onTouch: () => void }) {
  const [index, setIndex] = useState(0);
  useEffect(() => pager.listen(setIndex, onTouch), [pager, onTouch]);
  const current = index % items.length;
  return (
    <View style={styles.dots}>
      {items.map((entry, dot) => (
        <Pressable
          key={entry.id}
          hitSlop={6}
          onPress={() => {
            onTouch();
            pager.jump(dot);
          }}
          accessibilityRole="button"
          accessibilityLabel={entry.title}
        >
          <View style={[styles.dot, dot === current && styles.dotOn]} />
        </Pressable>
      ))}
    </View>
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
      {/* Owner (2026-11-08, «الرقم نفسه يكون مميز أكتر ومعاه صورة شيك»): the story's own photo fills the card
          under a dark shade, the figure glows in gold on top of it, the headline and source sit beneath. */}
      <View style={styles.numberCard}>
        {number.item.image ? <Image source={{ uri: sized(number.item.image, 640) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={[StyleSheet.absoluteFill, number.item.image ? styles.numberShade : styles.numberPlain]} />
        <View style={styles.numberPill}>
          <Ionicons name="sparkles" size={12} color={colors.goldInk} />
          <Text style={styles.numberEyebrow}>{t('news.numberOfDay')}</Text>
        </View>
        <Text style={styles.numberValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{number.text}</Text>
        <Text style={[styles.numberTitle, textDir(number.item.title)]} numberOfLines={2}>{number.item.title}</Text>
        <Text style={styles.numberSource} numberOfLines={1}>{number.item.source.name}</Text>
      </View>
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

const styles = themedStyles(() => ({
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
  numberCard: {
    minHeight: 176,
    justifyContent: 'flex-end',
    gap: 2,
    padding: spacing.md,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: '#0E0E14',
    boxShadow: shadows.glowGold,
  },
  // The photo stays readable under the gold figure: light at the top, near-black where the text sits.
  numberShade: { experimental_backgroundImage: 'linear-gradient(180deg, rgba(8, 8, 12, 0.22) 0%, rgba(8, 8, 12, 0.6) 45%, rgba(8, 8, 12, 0.92) 100%)' },
  // No photo: a golden dusk over the dark slab, so the card still reads as a photo card.
  numberPlain: { experimental_backgroundImage: 'linear-gradient(135deg, rgba(217, 168, 60, 0.38) 0%, rgba(14, 14, 20, 1) 62%)' },
  numberPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
  },
  numberEyebrow: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldInk },
  numberValue: {
    fontFamily: fonts.bold,
    fontSize: 46,
    lineHeight: 60,
    color: colors.onPhotoGold,
    textAlign: textStart,
    textShadowColor: 'rgba(255, 216, 101, 0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  numberTitle: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22, color: colors.onPhoto, textAlign: textStart },
  numberSource: { ...typography.caption, fontSize: 11, color: colors.onPhotoSoft, textAlign: textStart },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderGoldSoft },
  dotOn: { width: 18, backgroundColor: colors.gold },
}));
