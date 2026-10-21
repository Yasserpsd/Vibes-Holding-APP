import { useMemo, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { usePulse } from '@/components/motion';
import { t } from '@/i18n';
import { loadWebView, youtubeIdOf } from '@/lib/player';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M119: the watch-screen YouTube embed as an inline 16:9 block (same M93 recipe — the iframe
 * sits in a page with a real origin via baseUrl or YouTube answers error 153). The video loads
 * only after a tap on its thumbnail, so a meetup page opens light; a binary without WebView
 * shows the thumbnail and the update note instead.
 */
export function YouTubeEmbed({ url, title }: { url: string; title: string }) {
  const webview = useMemo(() => loadWebView(), []);
  const [playing, setPlaying] = useState(false);
  const youtubeId = youtubeIdOf(url);
  if (!youtubeId) return null;

  if (!playing || !webview) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        style={styles.box}
        onPress={() => (webview ? setPlaying(true) : undefined)}
      >
        <Image source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={styles.scrim} />
        {webview ? (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={30} color={colors.black} />
          </View>
        ) : (
          <Text style={styles.unavailable}>{t('watch.unavailable')}</Text>
        )}
      </Pressable>
    );
  }

  const WebView = webview.WebView;
  const embedHtml =
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head>` +
    `<body><iframe src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1" ` +
    `allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></body></html>`;

  return (
    <View style={styles.box}>
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
        // M93: nothing leaves the app — the YouTube app intent and YouTube site pages stay blocked.
        onShouldStartLoadWithRequest={(request) =>
          /^(https?:|about:blank)/.test(request.url) &&
          !/youtube\.com\/(watch|channel\/|results|@)|youtu\.be\//.test(request.url)
        }
      />
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

const styles = StyleSheet.create({
  box: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.black,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.25)' },
  playBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    // The play triangle reads centred when nudged a little forward.
    paddingStart: 4,
  },
  unavailable: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', padding: spacing.md },
  web: { flex: 1, backgroundColor: colors.black },
  webContainer: { backgroundColor: colors.black, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  ghostWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: spacing.md, backgroundColor: colors.black },
  ghost: { flex: 1, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
});
