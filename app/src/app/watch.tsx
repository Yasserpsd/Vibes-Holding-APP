import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { loadVideo, loadWebView, youtubeIdOf } from '@/lib/player';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type VideoModule = typeof import('expo-video');

/**
 * M19 («أي فيديو يتم فتحه داخل التطبيق… مش محتاج تطلع برا الأبلكيشن أبدًا»): one player screen.
 * YouTube plays in YouTube's own embedded player (its terms) inside a WebView; an uploaded post
 * video plays in expo-video. On a binary without the native modules the screen offers the in-app
 * browser instead — lib/player.ts normally keeps old binaries away from here altogether.
 */
export default function WatchScreen() {
  const params = useLocalSearchParams<{ url?: string; yt?: string; title?: string; poster?: string }>();
  const url = typeof params.url === 'string' ? params.url : '';
  const youtubeId = typeof params.yt === 'string' && params.yt ? params.yt : url ? youtubeIdOf(url) : null;
  const title = typeof params.title === 'string' ? params.title : '';

  const webview = useMemo(() => loadWebView(), []);
  const video = useMemo(() => loadVideo(), []);

  const embedUrl = youtubeId
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`
    : null;

  let player = null;
  if (embedUrl && webview) {
    const WebView = webview.WebView;
    player = (
      <WebView
        source={{ uri: embedUrl }}
        style={styles.web}
        containerStyle={styles.webContainer}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        startInLoadingState
      />
    );
  } else if (!youtubeId && url && video) {
    player = <NativePlayer module={video} url={url} />;
  }

  return (
    <View style={styles.page}>
      <Stack.Screen options={title ? { title } : undefined} />
      <View style={styles.playerBox}>
        {player ?? (
          <View style={styles.fallbackBox}>
            <Text style={styles.fallbackText}>{t('watch.unavailable')}</Text>
          </View>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.below}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {youtubeId ? (
          <AppButton label={t('watch.openYoutube')} variant="outline" icon="logo-youtube" onPress={() => void openLink(url || `https://www.youtube.com/watch?v=${youtubeId}`)} />
        ) : url && !player ? (
          <AppButton label={t('watch.openBrowser')} variant="outline" icon="open-outline" onPress={() => void openLink(url)} />
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Mounted only when the expo-video native module exists in this binary (hooks stay unconditional inside). */
function NativePlayer({ module: video, url }: { module: VideoModule; url: string }) {
  const player = video.useVideoPlayer(url, (instance) => {
    instance.play();
  });
  const VideoView = video.VideoView;
  // Fullscreen is on by default in the native controls; nothing else is configured here.
  return <VideoView style={styles.media} player={player} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.black },
  playerBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.black },
  web: { flex: 1, backgroundColor: colors.black },
  webContainer: { backgroundColor: colors.black },
  media: { width: '100%', height: '100%' },
  fallbackBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radii.lg, margin: spacing.md },
  fallbackText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  below: { padding: spacing.md, gap: spacing.md },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
});
