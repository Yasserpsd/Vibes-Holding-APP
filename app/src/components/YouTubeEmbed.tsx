import { useIsFocused } from 'expo-router';
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Animated, AppState, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppButton } from '@/components/AppButton';
import { usePulse } from '@/components/motion';
import { t } from '@/i18n';
import { loadWebView, youtubeIdOf } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** The embed's page is always black, in both themes: video letterboxing never takes the light-mode paper colour. */
export const STAGE_BLACK = '#000000';

/**
 * False while another screen covers this one or, on Android, while the app is in the background. react-native-webview's
 * Android view ignores the host pause (its onHostPause does nothing), so a YouTube embed would keep playing sound
 * behind the lock screen; callers unmount the WebView while this is false.
 */
export function useEmbedLive(): boolean {
  const focused = useIsFocused();
  const [background, setBackground] = useState(() => Platform.OS === 'android' && AppState.currentState === 'background');
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', (state) => setBackground(state === 'background'));
    return () => subscription.remove();
  }, []);
  return focused && !background;
}

// One inline video at a time across the app: the slot belongs to the thumbnail that was tapped last.
let activeSlot: string | null = null;
const slotListeners = new Set<() => void>();
function subscribeSlot(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}
function takeSlot(slot: string | null): void {
  activeSlot = slot;
  slotListeners.forEach((listener) => listener());
}

/**
 * Owner (2026-11-15: «لما افتح فيديو يوتيوب يفضل في نفس الصفحة ويفتحلي الفيديو، ميودنيش لصفحة تانية»): a YouTube video
 * plays where its thumbnail sits. `start` takes the single playback slot, so starting another video stops the one
 * before it; the slot is given back when the screen is covered, the Android app goes to the background or the
 * thumbnail leaves the page — returning never starts sound on its own.
 */
export function useInlinePlayback(): { playing: boolean; start: () => void } {
  const slot = useId();
  const live = useEmbedLive();
  const active = useSyncExternalStore(subscribeSlot, () => activeSlot === slot);
  useEffect(() => {
    if (!live && activeSlot === slot) takeSlot(null);
  }, [live, slot]);
  useEffect(
    () => () => {
      if (activeSlot === slot) takeSlot(null);
    },
    [slot],
  );
  return { playing: active && live, start: () => takeSlot(slot) };
}

/** The video could not load (offline, blocked, an expired link): one line and a retry. Shared by the embed and the uploaded-video player. */
export function EmbedError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{t('watch.failed')}</Text>
      <AppButton label={t('common.retry')} variant="outline" icon="refresh" onPress={onRetry} />
    </View>
  );
}

/**
 * M119: the watch-screen YouTube embed as an inline 16:9 block (same M93 recipe — the iframe
 * sits in a page with a real origin via baseUrl or YouTube answers error 153). The video loads
 * only after a tap on its thumbnail, so a meetup page opens light; a binary without WebView
 * shows the thumbnail and the update note instead.
 */
export function YouTubeEmbed({ url, title }: { url: string; title: string }) {
  const webview = useMemo(() => loadWebView(), []);
  const { playing, start } = useInlinePlayback();
  const youtubeId = youtubeIdOf(url);
  if (!youtubeId) return null;

  if (!playing || !webview) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        style={styles.box}
        onPress={() => (webview ? start() : undefined)}
      >
        <Image source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={styles.scrim} />
        {webview ? (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={30} color={colors.goldInk} />
          </View>
        ) : (
          <Text style={styles.unavailable}>{t('watch.unavailable')}</Text>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.box}>
      <YouTubePlayer youtubeId={youtubeId} webview={webview} />
    </View>
  );
}

type WebViewModule = NonNullable<ReturnType<typeof loadWebView>>;

/**
 * The YouTube player itself, filling its parent box (which must clip: `overflow: 'hidden'`). Same M93 recipe as the
 * watch screen — the iframe sits in a page with a real origin via baseUrl, or YouTube answers error 153.
 */
export function YouTubePlayer({ youtubeId, webview }: { youtubeId: string; webview: WebViewModule }) {
  const [attempt, setAttempt] = useState(0);
  const WebView = webview.WebView;
  const embedHtml =
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head>` +
    `<body><iframe src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1" ` +
    `allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></body></html>`;

  return (
    <WebView
      key={attempt}
      source={{ html: embedHtml, baseUrl: 'https://www.vcmem.com' }}
      style={styles.web}
      containerStyle={styles.webContainer}
      allowsFullscreenVideo
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      setSupportMultipleWindows={false}
      startInLoadingState
      renderLoading={() => <LoadingGhost />}
      renderError={() => <EmbedError onRetry={() => setAttempt((count) => count + 1)} />}
      // M93: nothing leaves the app — the YouTube app intent and YouTube site pages stay blocked.
      onShouldStartLoadWithRequest={(request) =>
        /^(https?:|about:blank)/.test(request.url) &&
        !/youtube\.com\/(watch|channel\/|results|@)|youtu\.be\//.test(request.url)
      }
    />
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

const styles = themedStyles(() => ({
  box: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: STAGE_BLACK,
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
  web: { flex: 1, backgroundColor: STAGE_BLACK },
  webContainer: { backgroundColor: STAGE_BLACK, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  ghostWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: spacing.md, backgroundColor: STAGE_BLACK },
  errorBox: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: STAGE_BLACK },
  errorText: { ...typography.caption, color: colors.onPhotoSoft, textAlign: 'center' },
  ghost: { flex: 1, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
}));
