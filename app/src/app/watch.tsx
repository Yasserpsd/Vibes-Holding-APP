import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { FadeInView, usePulse } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { linkParam, loadVideo, loadWebView, youtubeIdOf } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type VideoModule = typeof import('expo-video');

/**
 * M19 («أي فيديو يتم فتحه داخل التطبيق… مش محتاج تطلع برا الأبلكيشن أبدًا»): one player screen.
 * YouTube plays in YouTube's own embedded player (its terms) inside a WebView; an uploaded post
 * video plays in expo-video. On a binary without the native modules the screen shows the
 * update message — nothing here ever opens outside the app (M93, owner).
 */
export default function WatchScreen() {
  const params = useLocalSearchParams<{ url?: string; yt?: string; title?: string; poster?: string }>();
  const url = linkParam(params.url);
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
  }
  // The uploaded-video player brings its own box and control bar (M192).
  const native = !player && !youtubeId && url && video ? <NativePlayer module={video} url={url} /> : null;

  return (
    <View style={styles.page}>
      <Stack.Screen options={title ? { title } : undefined} />
      {native ?? (
        <View style={styles.playerBox}>
          {player ?? (
            <View style={styles.fallbackBox}>
              <Text style={styles.fallbackText}>{t('watch.unavailable')}</Text>
            </View>
          )}
        </View>
      )}
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

type Player = ReturnType<VideoModule['useVideoPlayer']>;

/** The player object is native and mutable by design; these setters keep the React compiler's hook rules happy. */
function seekTo(player: Player, seconds: number): void {
  player.currentTime = seconds;
}
function tickEvery(player: Player, seconds: number): void {
  player.timeUpdateEventInterval = seconds;
}

/** A Bunny HLS rendition the member can pin (M192); `uri` null = adaptive («تلقائي»). */
type Rendition = { label: string; uri: string | null };

/** The renditions a signed `…/playlist.m3u8` lists, highest first; they share its signed directory. */
async function renditionsOf(url: string): Promise<Rendition[]> {
  if (!/\/playlist\.m3u8$/.test(url)) return [];
  const response = await fetch(url);
  if (!response.ok) return [];
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const lines = (await response.text()).split(/\r?\n/);
  const found: { height: number; uri: string }[] = [];
  lines.forEach((line, index) => {
    const height = /RESOLUTION=\d+x(\d+)/.exec(line)?.[1];
    const next = lines[index + 1]?.trim();
    if (height && next && !next.startsWith('#')) found.push({ height: Number(height), uri: base + next });
  });
  return found.sort((x, y) => y.height - x.height).map((entry) => ({ label: `${entry.height}p`, uri: entry.uri }));
}

/**
 * Mounted only when the expo-video native module exists in this binary (hooks stay unconditional inside).
 * M192 (owner: «شريط اقدر اقدم منه وارجع واقدر اخلي الشاشة كاملة … اغير كوالتي»): a bar under the
 * picture — 10 seconds back/forward, the quality (adaptive or one fixed rendition) and fullscreen.
 */
function NativePlayer({ module: video, url }: { module: VideoModule; url: string }) {
  const player = video.useVideoPlayer(url, (instance) => {
    instance.play();
  });
  const VideoView = video.VideoView;
  const screen = useWindowDimensions();
  const [wide, setWide] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [renditions, setRenditions] = useState<Rendition[]>([]);
  const [quality, setQuality] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState({ at: 0, total: 0 });

  // The JS scrubber's clock: twice a second, independent of the native controls.
  useEffect(() => {
    tickEvery(player, 0.5);
    const sub = player.addListener('timeUpdate', ({ currentTime }) => setTime({ at: currentTime, total: player.duration || 0 }));
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    return () => {
      sub.remove();
      playingSub.remove();
    };
  }, [player]);

  useEffect(() => {
    let alive = true;
    renditionsOf(url)
      .then((list) => {
        if (alive) setRenditions(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);

  const choose = async (rendition: Rendition) => {
    setPicking(false);
    const next = rendition.uri ? rendition.label : null;
    if (next === quality) return;
    const at = player.currentTime;
    setQuality(next);
    // The new source starts at 0: jump back to the same second once it can play.
    const ready = player.addListener('statusChange', ({ status }) => {
      if (status !== 'readyToPlay') return;
      ready.remove();
      seekTo(player, at);
      player.play();
    });
    await player.replaceAsync(rendition.uri ?? url).catch(() => ready.remove());
  };

  const seek = (seconds: number) => {
    seekTo(player, seconds);
    setTime((now) => ({ ...now, at: seconds }));
  };

  // M192 (owner: «لما ندوس ملئ الشاشة الموبايل يقلب لوحده … ولما اقفل يرجع طبيعي»): the app is
  // portrait-locked in its binary, so «ملء الشاشة» turns the picture itself sideways over the whole
  // screen — the member just tilts the phone; closing it brings the normal page back.
  const controls = (
    <>
      <Scrubber at={time.at} total={time.total} onSeek={seek} />
      <View style={styles.bar}>
        <BarButton icon="play-back" label="10-" hint={t('watch.back10')} onPress={() => player.seekBy(-10)} />
        <BarButton icon={playing ? 'pause' : 'play'} label={playing ? t('watch.pause') : t('watch.play')} hint={playing ? t('watch.pause') : t('watch.play')} onPress={() => (playing ? player.pause() : player.play())} />
        <BarButton icon="play-forward" label="10+" hint={t('watch.forward10')} onPress={() => player.seekBy(10)} />
        {renditions.length > 0 ? (
          <BarButton icon="options-outline" label={quality ?? t('watch.auto')} hint={t('watch.quality')} active={picking} onPress={() => setPicking((open) => !open)} />
        ) : null}
        <BarButton
          icon={wide ? 'contract-outline' : 'expand-outline'}
          label={wide ? t('watch.exitFullscreen') : t('watch.fullscreen')}
          hint={wide ? t('watch.exitFullscreen') : t('watch.fullscreen')}
          onPress={() => {
            setPicking(false);
            setWide((on) => !on);
          }}
        />
      </View>
      {picking ? (
        <View style={styles.qualities}>
          {[{ label: t('watch.auto'), uri: null }, ...renditions].map((rendition) => {
            const on = (rendition.uri ? rendition.label : null) === quality;
            return (
              <Pressable key={rendition.label} onPress={() => void choose(rendition)} style={[styles.quality, on && styles.qualityOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.qualityText, on && styles.qualityTextOn]}>{rendition.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </>
  );

  return (
    <>
      <View style={styles.playerBox}>{wide ? null : <VideoView style={styles.media} player={player} contentFit="contain" nativeControls />}</View>
      {wide ? null : controls}
      <Modal visible={wide} animationType="fade" supportedOrientations={['portrait']} statusBarTranslucent onRequestClose={() => setWide(false)}>
        <StatusBar hidden />
        <View style={styles.wideStage}>
          <View style={{ width: screen.height, height: screen.width, transform: [{ rotate: '90deg' }] }}>
            <VideoView style={styles.media} player={player} contentFit="contain" nativeControls={false} />
            {/* A tap on the picture hides or shows the controls, so a long lecture plays clean. */}
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setChrome((on) => !on)} accessibilityRole="button" accessibilityLabel={t('watch.fullscreen')} />
            {chrome ? <View style={styles.wideControls}>{controls}</View> : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

function BarButton({ icon, label, hint, active = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; hint: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.barButton, (pressed || active) && styles.barButtonOn]} accessibilityRole="button" accessibilityLabel={hint} hitSlop={6}>
      <Ionicons name={icon} size={20} color={colors.goldLight} />
      <Text style={styles.barLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** «اجري لنقطة معينة»: tap or drag anywhere on the line to jump there; the times sit at both ends. */
function Scrubber({ at, total, onSeek }: { at: number; total: number; onSeek: (seconds: number) => void }) {
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const fractionOf = (x: number) => Math.min(1, Math.max(0, x / width));
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => total > 0,
        onMoveShouldSetPanResponder: () => total > 0,
        onPanResponderGrant: (event) => setDrag(fractionOf(event.nativeEvent.locationX)),
        onPanResponderMove: (event) => setDrag(fractionOf(event.nativeEvent.locationX)),
        onPanResponderRelease: (event) => {
          onSeek(fractionOf(event.nativeEvent.locationX) * total);
          setDrag(null);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the line or the length changes
    [width, total, onSeek],
  );
  const shown = drag ?? (total > 0 ? at / total : 0);
  return (
    <View style={styles.scrub}>
      <Text style={styles.scrubTime}>{clock(drag !== null ? drag * total : at)}</Text>
      <View style={styles.scrubTrack} onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))} {...responder.panHandlers}>
        <View style={styles.scrubRail} pointerEvents="none">
          <View style={[styles.scrubFill, { width: `${shown * 100}%` }]} />
        </View>
        <View style={[styles.scrubKnob, { left: shown * width - 9 }]} pointerEvents="none" />
      </View>
      <Text style={styles.scrubTime}>{clock(total)}</Text>
    </View>
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

const styles = themedStyles(() => ({
  page: { flex: 1, backgroundColor: colors.black },
  playerBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.black },
  web: { flex: 1, backgroundColor: colors.black },
  webContainer: { backgroundColor: colors.black },
  media: { width: '100%', height: '100%' },
  // Media controls keep the universal left-to-right order (back on the left, time running rightwards) even in Arabic.
  scrub: { direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surface },
  scrubTime: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 17, color: colors.textSecondary, minWidth: 52, textAlign: 'center' },
  scrubTrack: { flex: 1, height: 36, justifyContent: 'center' },
  scrubRail: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  scrubFill: { height: 4, backgroundColor: colors.gold },
  scrubKnob: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: colors.goldLight, top: 9 },
  bar: { direction: 'ltr', flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border },
  barButton: { alignItems: 'center', gap: 2, minWidth: 64, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radii.md },
  barButtonOn: { backgroundColor: colors.surfaceElevated },
  barLabel: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  qualities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface },
  quality: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderGold },
  qualityOn: { backgroundColor: colors.gold },
  qualityText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.goldLight },
  qualityTextOn: { color: colors.black },
  wideStage: { flex: 1, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  // Landscape edges hold the notch and the home bar: keep the controls clear of both.
  wideControls: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 44, paddingBottom: spacing.sm, backgroundColor: 'rgba(7, 7, 8, 0.82)' },
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
}));
