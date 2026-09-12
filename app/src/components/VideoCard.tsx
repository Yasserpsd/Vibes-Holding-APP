import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Video } from '@/api/videos';
import { formatArabicDate } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  video: Video;
  onPress: () => void;
  /** Fixed width for horizontal strips. */
  width?: number;
};

/** A YouTube video: thumbnail with a play mark, the title and its short friendly line. */
export function VideoCard({ video, onPress, width }: Props) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, width ? { width } : null, pressed && styles.pressed]}>
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
      </View>
    </Pressable>
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
  title: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: 'right' },
  blurb: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  date: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
});
