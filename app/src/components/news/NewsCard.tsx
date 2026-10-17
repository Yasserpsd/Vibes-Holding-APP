import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import type { NewsItem } from '@/api/news';
import { GlassCard } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { isRTL } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  item: NewsItem;
  onPress: () => void;
  /** Compact cards sit in the horizontal decisions strip. */
  compact?: boolean;
};

/** A news item exactly as the source published it: title, snippet, outlet and time, plus the link to the original page. */
export function NewsCard({ item, onPress, compact = false }: Props) {
  // An English item inside the Arabic layout reads from the left; in the English layout it needs nothing.
  const latin = item.lang === 'en' && isRTL();
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl}>
      <GlassCard radius={radii.xl} style={[styles.card, compact && styles.compact]}>
        <View style={styles.meta}>
          <Text style={styles.source} numberOfLines={1}>
            {item.source.name}
          </Text>
          <Text style={styles.time}>{formatRelativeTime(item.publishedAt)}</Text>
          {item.decision ? (
            <View style={styles.badge}>
              <Ionicons name="ribbon-outline" size={11} color={colors.black} />
              <Text style={styles.badgeText}>{t('news.decisionBadge')}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.body}>
          <View style={styles.text}>
            <Text style={[styles.title, latin && styles.latin]} numberOfLines={compact ? 3 : 3}>
              {item.title}
            </Text>
            {!compact && item.snippet ? (
              <Text style={[styles.snippet, latin && styles.latin]} numberOfLines={2}>
                {item.snippet}
              </Text>
            ) : null}
          </View>
          {/* Owner (2026-10-17): every item shows a visual — the source's picture, else a branded placeholder. */}
          {!compact ? item.image ? <FadingImage uri={item.image} /> : <ImageFallback /> : null}
        </View>
        {!compact ? (
          <View style={styles.footer}>
            <View style={styles.tags}>
              {item.topics.slice(0, 2).map((topic) => (
                <Text key={topic.key} style={styles.tag} numberOfLines={1}>
                  {topic.label}
                </Text>
              ))}
            </View>
            <PressScale onPress={() => void openLink(item.url)} accessibilityRole="link" hitSlop={8} style={styles.readLink}>
              <Ionicons name="open-outline" size={14} color={colors.goldLight} />
              <Text style={styles.readText} numberOfLines={1}>
                {t('news.readSource')}
              </Text>
            </PressScale>
          </View>
        ) : null}
      </GlassCard>
    </PressScale>
  );
}

/** No picture from the source: a quiet golden newspaper block keeps the card visual. */
function ImageFallback() {
  return (
    <View style={[styles.image, styles.imageFallback]}>
      <Ionicons name="newspaper-outline" size={30} color={colors.goldDark} />
    </View>
  );
}

/** The source's picture fades in once it arrives, instead of popping over the placeholder block. */
function FadingImage({ uri }: { uri: string }) {
  const [reveal] = useState(() => new Animated.Value(0));
  return (
    <View style={styles.image}>
      <Animated.Image
        source={{ uri }}
        resizeMode="cover"
        style={[styles.imageFill, { opacity: reveal }]}
        onLoad={() => Animated.timing(reveal, { toValue: 1, duration: 360, useNativeDriver: true }).start()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  compact: { width: 260, paddingVertical: spacing.sm + 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  source: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.medium,
    color: colors.goldLight,
    flexShrink: 1,
    paddingVertical: 1,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.goldSoft,
  },
  time: { ...typography.caption, color: colors.textMuted },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginStart: 'auto',
    paddingVertical: 1,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.black },
  body: { flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, gap: spacing.xs },
  title: { ...typography.subtitle, color: colors.textPrimary },
  snippet: { ...typography.caption, color: colors.textSecondary },
  latin: { textAlign: 'left', writingDirection: 'ltr' },
  image: { width: 92, height: 92, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
  imageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldFaint, borderWidth: 1, borderColor: colors.borderGoldSoft },
  imageFill: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tags: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.textSecondary,
    paddingVertical: 1,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  readLink: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  readText: { ...typography.caption, color: colors.goldLight, flexShrink: 0 },
});
