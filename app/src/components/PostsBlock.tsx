import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { eventOf, useLatestPosts, type Post } from '@/api/posts';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { formatEventDate, formatRelativeTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

export const HOME_POSTS_LIMIT = 3;

/** First image of the post, else the YouTube thumbnail, else the uploaded video's poster, else nothing. */
function thumbnailOf(post: Post): string | null {
  if (post.images[0]) return post.images[0];
  if (post.youtubeId) return `https://img.youtube.com/vi/${post.youtubeId}/hqdefault.jpg`;
  return post.video?.poster || null;
}

/**
 * «رسائل الإدارة» on the home: the newest posts from the club's management. Renders nothing while
 * loading, when there is no post, or when the request fails, so the home never breaks because of it.
 */
export function PostsBlock() {
  const router = useRouter();
  const posts = useLatestPosts(HOME_POSTS_LIMIT).data?.posts ?? [];
  if (posts.length === 0) return null;

  return (
    <View style={styles.block}>
      <SectionHeader title={t('nav.posts')} cta={t('common.viewAll')} onPress={() => router.push('/posts' as Href)} />
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </View>
  );
}

/** One post as a tappable card (home block and the posts list). */
export function PostCard({ post }: { post: Post }) {
  const router = useRouter();
  const thumbnail = thumbnailOf(post);
  const event = eventOf(post);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/posts/${post.id}` as Href)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.texts}>
        <View style={styles.titleRow}>
          {post.pinned ? <Ionicons name="pin" size={14} color={colors.gold} /> : null}
          <Text style={styles.title} numberOfLines={2}>
            {post.title}
          </Text>
        </View>
        {event ? (
          <View style={styles.event}>
            <View style={styles.eventBadge}>
              <Ionicons name="calendar" size={12} color={colors.black} />
              <Text style={styles.eventBadgeText}>{t('posts.eventBadge')}</Text>
            </View>
            <Text style={styles.eventWhen} numberOfLines={1}>
              {formatEventDate(event.date)}
            </Text>
          </View>
        ) : null}
        {event && (event.place || event.onlineUrl) ? (
          <View style={styles.eventPlace}>
            <Ionicons name={event.place ? 'location-outline' : 'videocam-outline'} size={14} color={colors.goldLight} />
            <Text style={styles.eventPlaceText} numberOfLines={1}>
              {event.place ? (event.onlineUrl ? t('posts.placeAndOnline', { place: event.place }) : event.place) : t('posts.online')}
            </Text>
          </View>
        ) : null}
        {post.body ? (
          <Text style={styles.body} numberOfLines={2}>
            {post.body}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          {post.publishedAt ? <Text style={styles.time}>{formatRelativeTime(post.publishedAt)}</Text> : null}
          {post.youtubeId || post.video?.url ? <Ionicons name="play-circle-outline" size={16} color={colors.goldLight} /> : null}
        </View>
      </View>
      {thumbnail ? <Image source={{ uri: thumbnail }} style={styles.thumbnail} resizeMode="cover" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  // Padding sits on a View: Android measures a padded Text too narrow and truncates it.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  texts: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { ...typography.body, flex: 1, color: colors.textPrimary },
  body: { ...typography.caption, color: colors.textSecondary },
  event: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  eventBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.gold },
  eventBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.black },
  eventWhen: { ...typography.caption, fontFamily: fonts.medium, color: colors.goldLight, flexShrink: 1 },
  eventPlace: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  eventPlaceText: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { ...typography.caption, color: colors.textMuted },
  thumbnail: { width: 72, height: 72, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
});
