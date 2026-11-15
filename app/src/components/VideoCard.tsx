import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Animated, Text, View } from 'react-native';

import type { Video } from '@/api/videos';
import { GlassCard } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { useInlinePlayback, YouTubePlayer } from '@/components/YouTubeEmbed';
import { t } from '@/i18n';
import { markParagraphs, textDir, textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { loadWebView, youtubeIdOf } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  video: Video;
  /** Opens the watch screen: for a narrow strip card, a video that is not on YouTube, or a binary without the WebView module. */
  onPress: () => void;
  /** Fixed width for horizontal strips; the card then stretches to the strip's tallest card. */
  width?: number;
  /** Opens the advisor with this video as the context; the card shows «اسأل المستشار» when set. */
  onAsk?: () => void;
};

/** A YouTube video: thumbnail with a breathing golden play mark, the title and its short friendly line. */
export function VideoCard({ video, onPress, width, onAsk }: Props) {
  // The thumbnail fades in once it arrives instead of popping over the dark surface.
  const [thumbOpacity] = useState(() => new Animated.Value(0));
  const strip = width !== undefined;
  // Owner (2026-11-15: «يفضل في نفس الصفحة ويفتحلي الفيديو، ميودنيش لصفحة تانية»): a YouTube video plays inside its own card —
  // but only in a full-width card. Inside a narrow strip card YouTube's own title, logo and controls pile on top of
  // each other (emulator, 2026-11-15), so a strip card opens the watch screen as before.
  const webview = useMemo(() => loadWebView(), []);
  const youtubeId = youtubeIdOf(video.url);
  const inline = useInlinePlayback();
  const playsHere = Boolean(youtubeId && webview) && !strip;
  const player = playsHere && youtubeId && webview && inline.playing ? <YouTubePlayer youtubeId={youtubeId} webview={webview} /> : null;
  return (
    // While the video plays the card stops taking presses, so every touch on the picture reaches the player's own controls.
    <PressScale onPress={playsHere ? inline.start : onPress} disabled={player !== null} wrapStyle={strip ? [styles.fill, { width }] : null} style={strip ? styles.fill : null}>
      <GlassCard style={strip ? styles.fill : undefined}>
        <View style={styles.thumbBox}>
          {player ?? (
            <>
              <Animated.Image
                resizeMethod="resize"
                source={{ uri: sized(video.thumbnail, width ?? 340) }}
                style={[styles.thumb, { opacity: thumbOpacity }]}
                resizeMode="cover"
                accessibilityLabel={video.title}
                onLoad={() => Animated.timing(thumbOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start()}
              />
              {/* Static golden glow: a pulse loop per card is too many loops on strip screens. */}
              <View style={styles.play}>
                <Ionicons name="play" size={22} color={colors.goldInk} />
              </View>
            </>
          )}
        </View>
        <View style={[styles.texts, strip && styles.fill]}>
          <Text style={[styles.title, strip && styles.titleStrip, textDir(video.title)]} numberOfLines={2}>
            {markParagraphs(video.title)}
          </Text>
          {video.blurb ? (
            <Text style={[styles.blurb, textDir(video.blurb)]} numberOfLines={2}>
              {markParagraphs(video.blurb)}
            </Text>
          ) : null}
          {video.publishedAt ? <Text style={styles.date}>{formatArabicDate(video.publishedAt)}</Text> : null}
          {onAsk ? (
            <PressScale
              onPress={onAsk}
              hitSlop={10}
              accessibilityLabel={t('videos.askAbout', { title: video.title })}
              wrapStyle={[styles.askWrap, strip && styles.askWrapStrip]}
              style={styles.ask}
            >
              <Ionicons name="sparkles-outline" size={14} color={colors.goldText} />
              <Text style={styles.askText}>{t('advisor.ask')}</Text>
            </PressScale>
          ) : null}
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  // Clipped: the inline player fills this box edge to edge.
  thumbBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
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
  fill: { flex: 1 },
  texts: { padding: spacing.md, gap: 4 },
  title: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  // Strip cards keep two title lines so the blurbs and dates line up across the row.
  titleStrip: { minHeight: typography.body.lineHeight * 2 },
  blurb: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  date: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  askWrap: { alignSelf: 'flex-start', marginTop: spacing.xs },
  askWrapStrip: { marginTop: 'auto' },
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
  askText: { ...typography.caption, fontFamily: fonts.medium, color: colors.goldText },
}));
