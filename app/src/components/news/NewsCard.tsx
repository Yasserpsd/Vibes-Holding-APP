import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { NewsItem } from '@/api/news';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { isRTL } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

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
    <PressScale onPress={onPress} style={[styles.card, compact && styles.compact]}>
      <View style={styles.meta}>
        <Text style={styles.source} numberOfLines={1}>
          {item.source.name}
        </Text>
        <Text style={styles.dot}>·</Text>
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
        {!compact && item.image ? <Image source={{ uri: item.image }} style={styles.image} resizeMode="cover" /> : null}
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
          <Pressable onPress={() => void openLink(item.url)} accessibilityRole="link" hitSlop={8} style={({ pressed }) => [styles.readLink, pressed && styles.pressed]}>
            <Ionicons name="open-outline" size={14} color={colors.goldLight} />
            <Text style={styles.readText} numberOfLines={1}>
              {t('news.readSource')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  compact: { width: 260, paddingVertical: spacing.sm + 4 },
  pressed: { opacity: 0.8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  source: { ...typography.caption, color: colors.goldLight, flexShrink: 1 },
  dot: { ...typography.caption, color: colors.textMuted },
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
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.black },
  body: { flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, gap: spacing.xs },
  title: { ...typography.subtitle, color: colors.textPrimary },
  snippet: { ...typography.caption, color: colors.textSecondary },
  latin: { textAlign: 'left', writingDirection: 'ltr' },
  image: { width: 88, height: 88, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
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
