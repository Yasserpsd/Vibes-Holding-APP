import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Video } from '@/api/videos';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  video: Video;
  onPress: () => void;
  /** Fixed width for horizontal strips. */
  width?: number;
  /** Opens the advisor with this video as the context; the card shows «اسأل المستشار» when set. */
  onAsk?: () => void;
};

/** A YouTube video: thumbnail with a play mark, the title and its short friendly line. */
export function VideoCard({ video, onPress, width, onAsk }: Props) {
  return (
    <PressScale onPress={onPress} style={[styles.card, width ? { width } : null]}>
      <View style={styles.thumbBox}>
        <Image source={{ uri: video.thumbnail }} style={styles.thumb} resizeMode="cover" accessibilityLabel={video.title} />
        <View style={styles.play}>
          <Ionicons name="play" size={22} color={colors.black} />
        </View>
      </View>
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={2}>
          {video.title}
        </Text>
        {video.blurb ? (
          <Text style={styles.blurb} numberOfLines={2}>
            {video.blurb}
          </Text>
        ) : null}
        {video.publishedAt ? <Text style={styles.date}>{formatArabicDate(video.publishedAt)}</Text> : null}
        {onAsk ? (
          <Pressable onPress={onAsk} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('videos.askAbout', { title: video.title })} style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
            <Ionicons name="sparkles-outline" size={14} color={colors.gold} />
            <Text style={styles.askText}>{t('advisor.ask')}</Text>
          </Pressable>
        ) : null}
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  thumbBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  thumb: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  play: { width: 48, height: 48, borderRadius: radii.pill, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', opacity: 0.95 },
  texts: { padding: spacing.md, gap: 4 },
  title: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  blurb: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  date: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  ask: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.xs, paddingVertical: 4, paddingHorizontal: spacing.sm + 2, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.goldDark },
  askText: { ...typography.caption, fontFamily: fonts.medium, color: colors.gold },
});
