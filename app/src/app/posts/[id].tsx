import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { eventOf, usePost, type PostEvent } from '@/api/posts';
import { useAdvisorScreen, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatEventDate, formatRelativeTime } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** One «رسائل الإدارة» post or event: text, the event's date and place, images, a YouTube or uploaded video and link buttons, all opened in-app. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePost(id);
  const post = query.data?.post;
  const event = post ? eventOf(post) : null;
  // The floating «اسأل المستشار» button carries this post (or event) as the context.
  useAdvisorScreen(post ? { type: 'post', id: post.id, title: post.title, event: Boolean(event) } : null);
  // Keeps the last link button clear of that floating button.
  const clearance = useAskAdvisorClearance();

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: event ? t('posts.event') : t('nav.post') }} />
      {!post ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
          <View style={styles.meta}>
            <View style={styles.badge}>
              <Ionicons name={event ? 'calendar' : 'megaphone-outline'} size={14} color={colors.black} />
              <Text style={styles.badgeText}>{event ? t('posts.event') : t('nav.posts')}</Text>
            </View>
            {post.publishedAt ? <Text style={styles.time}>{formatRelativeTime(post.publishedAt)}</Text> : null}
          </View>
          <Text style={styles.title}>{post.title}</Text>
          {event ? <EventCard event={event} /> : null}
          {post.body ? <Text style={styles.body}>{post.body}</Text> : null}
          {post.youtubeId ? (
            <VideoTile url={`https://www.youtube.com/watch?v=${post.youtubeId}`} poster={`https://img.youtube.com/vi/${post.youtubeId}/hqdefault.jpg`} posterFit="cover" label={t('posts.playYoutube')} />
          ) : null}
          {/* Uploaded video: no native player (the change ships over the air), the in-app browser plays the file. */}
          {post.video?.url ? <VideoTile url={post.video.url} poster={post.video.poster || null} posterFit="contain" label={t('posts.playVideo')} /> : null}
          {post.images.map((uri) => (
            <Image key={uri} source={{ uri }} style={styles.image} resizeMode="contain" />
          ))}
          {post.links.map((link) => (
            <AppButton key={`${link.label}:${link.url}`} label={link.label} variant="outline" icon="open-outline" onPress={() => void openLink(link.url)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** When and where the event happens, and the link for attending online (opened in-app). */
function EventCard({ event }: { event: PostEvent }) {
  const onlineUrl = event.onlineUrl;
  return (
    <View style={styles.event}>
      <View style={styles.eventRow}>
        <Ionicons name="calendar-outline" size={20} color={colors.gold} />
        <View style={styles.eventTexts}>
          <Text style={styles.eventLabel}>{t('posts.when')}</Text>
          <Text style={styles.eventValue}>{formatEventDate(event.date)}</Text>
        </View>
      </View>
      {event.place ? (
        <View style={[styles.eventRow, styles.eventRowBorder]}>
          <Ionicons name="location-outline" size={20} color={colors.gold} />
          <View style={styles.eventTexts}>
            <Text style={styles.eventLabel}>{t('posts.where')}</Text>
            <Text style={styles.eventValue}>{event.place}</Text>
          </View>
        </View>
      ) : null}
      {onlineUrl ? <AppButton label={t('posts.onlineLink')} icon="videocam-outline" onPress={() => void openLink(onlineUrl)} /> : null}
    </View>
  );
}

/** A video as a tappable tile: its poster (a plain dark tile without one) under a play mark; opens in-app. */
function VideoTile({ url, poster, posterFit, label }: { url: string; poster: string | null; posterFit: 'cover' | 'contain'; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => void openLink(url)}
      style={({ pressed }) => [styles.video, pressed && styles.pressed]}
    >
      {poster ? <Image source={{ uri: poster }} style={styles.videoImage} resizeMode={posterFit} /> : <View style={styles.videoImage} />}
      <View style={styles.play}>
        <Ionicons name="play" size={28} color={colors.black} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  // Padding sits on a View: Android measures a padded Text too narrow and truncates it.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.black },
  time: { ...typography.caption, color: colors.textMuted },
  title: { ...typography.title, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary },
  event: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  eventRowBorder: { paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  eventTexts: { flex: 1 },
  eventLabel: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  eventValue: { ...typography.body, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: textStart },
  // `contain`: a flyer or a logo keeps its text; the box colour fills the sides.
  image: { width: '100%', height: 240, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
  video: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
  videoImage: { width: '100%', height: 200 },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: 72,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  pressed: { opacity: 0.85 },
});
