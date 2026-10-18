import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FadeInView, usePulse } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { loadVideo, loadWebView, youtubeIdOf } from '@/lib/player';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type VideoModule = typeof import('expo-video');

/**
 * M19 («أي فيديو يتم فتحه داخل التطبيق… مش محتاج تطلع برا الأبلكيشن أبدًا»): one player screen.
 * YouTube plays in YouTube's own embedded player (its terms) inside a WebView; an uploaded post
 * video plays in expo-video. On a binary without the native modules the screen shows the
 * update message — nothing here ever opens outside the app (M93, owner).
 */
export default function WatchScreen() {
  const params = useLocalSearchParams<{ url?: string; yt?: string; title?: string; poster?: string }>();
  const url = typeof params.url === 'string' ? params.url : '';
  const youtubeId = typeof params.yt === 'string' && params.yt ? params.yt : url ? youtubeIdOf(url) : null;
  const title = typeof params.title === 'string' ? params.title : '';

  const webview = useMemo(() => loadWebView(), []);
  const video = useMemo(() => loadVideo(), []);

  // Error 153: YouTube rejects an embed URL loaded directly (no Referer). The embed must sit in an
  // iframe inside a page with a real origin — baseUrl supplies it (M93).
  const embedHtml = youtubeId
    ? `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head>` +
      `<body><iframe src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1" ` +
      `allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></body></html>`
    : null;

  let player = null;
  if (embedHtml && webview) {
    const WebView = webview.WebView;
    player = (
      <WebView
        source={{ html: embedHtml, baseUrl: 'https://www.vcmem.com' }}
        style={styles.web}
        containerStyle={styles.webContainer}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        startInLoadingState
        renderLoading={() => <LoadingGhost />}
        // «مش عايز أي حد يخرج من الأبلكيشن نهائي»: intent/vnd.youtube links would open the
        // YouTube app and YouTube site pages (watch, channel) would replace the player; both
        // are blocked — the embed and anything it needs (consent, static) load freely.
        onShouldStartLoadWithRequest={(request) =>
          /^(https?:|about:blank)/.test(request.url) &&
          !/youtube\.com\/(watch|channel\/|results|@)|youtu\.be\//.test(request.url)
        }
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
        {title ? (
          <FadeInView delay={40}>
            <Text style={styles.title}>{title}</Text>
          </FadeInView>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** V2: a breathing ghost slab over the player while the embed loads — no bare spinner. */
function LoadingGhost() {
  const pulse = usePulse(0.35, 0.8);
  return (
    <View style={styles.ghostWrap}>
      <Animated.View style={[styles.ghost, { opacity: pulse }]} />
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
  ghostWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, padding: spacing.md, backgroundColor: colors.black },
  ghost: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  fallbackBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radii.lg, margin: spacing.md },
  fallbackText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  below: { padding: spacing.md, gap: spacing.md },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
});
