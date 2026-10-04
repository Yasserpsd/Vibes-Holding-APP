import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import type { Video } from '@/api/videos';
import { GlassCard } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  video: Video;
  onPress: () => void;
  /** Fixed width for horizontal strips. */
  width?: number;
  /** Opens the advisor with this video as the context; the card shows «اسأل المستشار» when set. */
  onAsk?: () => void;
};

/** A YouTube video: thumbnail with a breathing golden play mark, the title and its short friendly line. */
export function VideoCard({ video, onPress, width, onAsk }: Props) {
  // The thumbnail fades in once it arrives instead of popping over the dark surface.
  const [thumbOpacity] = useState(() => new Animated.Value(0));
  return (
    <PressScale onPress={onPress} wrapStyle={width ? { width } : null}>
      <GlassCard>
        <View style={styles.thumbBox}>
          <Animated.Image
            source={{ uri: video.thumbnail }}
            style={[styles.thumb, { opacity: thumbOpacity }]}
            resizeMode="cover"
            accessibilityLabel={video.title}
            onLoad={() => Animated.timing(thumbOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start()}
          />
          {/* Static golden glow: a pulse loop per card is too many loops on strip screens. */}
          <View style={styles.play}>
            <Ionicons name="play" size={22} color={colors.goldInk} />
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
            <PressScale
              onPress={onAsk}
              hitSlop={6}
              accessibilityLabel={t('videos.askAbout', { title: video.title })}
              wrapStyle={styles.askWrap}
              style={styles.ask}
            >
              <Ionicons name="sparkles-outline" size={14} color={colors.gold} />
              <Text style={styles.askText}>{t('advisor.ask')}</Text>
            </PressScale>
          ) : null}
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  thumbBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  thumb: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  play: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGold,
  },
  texts: { padding: spacing.md, gap: 4 },
  title: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  blurb: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  date: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  askWrap: { alignSelf: 'flex-start', marginTop: spacing.xs },
  ask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  askText: { ...typography.caption, fontFamily: fonts.medium, color: colors.gold },
});
