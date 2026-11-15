import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Image, Text, View } from 'react-native';

import { eventOf, useLatestPosts, type Post } from '@/api/posts';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { PaperCard } from '@/components/paper';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { markParagraphs, textStart } from '@/i18n/direction';
import { formatEventDate, formatRelativeTime } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { isPostUnread, markAllPostsRead, useReadPosts } from '@/lib/readPosts';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';
import { withoutMediaLines } from '@/components/StructuredText';

export const HOME_POSTS_LIMIT = 3;

/**
 * The server opens a member's plain message with a greeting line of its own — «الأستاذ/ ناصر،», «Dear Nasser,»,
 * «Dear member,» — followed by a blank line (server/src/posts/routes.ts: `greeting` + `personal`). A short preview
 * spent itself on it: the home card showed the greeting and «…», none of the message's own words (final emulator
 * pass, 2026-11-16). The preview starts at the message's own first words; the message screen keeps the greeting.
 */
const GREETING_LINE = /^\s*(?:الأستاذ\/ [^\n]{1,80}،|Dear [^\n]{1,80},)[ \t]*\r?\n\s*/u;

/** The words a card or a row previews: no greeting line, no media lines. */
export function postPreview(body: string): string {
  return withoutMediaLines(body.replace(GREETING_LINE, ''));
}

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
    <FadeInView delay={140}>
      <View style={styles.block}>
        <SectionHeader icon="newspaper-outline" title={t('nav.posts')} cta={t('common.viewAll')} onPress={() => router.push('/posts' as Href)} />
        {posts.map((post, index) => (
          <FadeInView key={post.id} delay={entranceDelay(index, 70)}>
            <PostCard post={post} />
          </FadeInView>
        ))}
      </View>
    </FadeInView>
  );
}

/**
 * M242: «تعليم الكل كمقروء» — a small text button that exists only while something is unread (the inbox tab, the
 * messages list). `ids` are the unread messages it marks.
 */
export function MarkAllReadButton({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <PressScale onPress={() => markAllPostsRead(ids)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('inbox.markAllRead')} wrapStyle={styles.markAllWrap} style={styles.markAll}>
      <Ionicons name="checkmark-done" size={14} color={colors.goldText} />
      <Text style={styles.markAllText} numberOfLines={1}>
        {t('inbox.markAllRead')}
      </Text>
    </PressScale>
  );
}

/** M29: a targeted message is marked for its reader; the feed already holds only what he may read. */
export function audienceBadge(post: Pick<Post, 'audience'>): string | null {
  if (post.audience === 'member') return t('posts.forYou');
  if (post.audience === 'persona') return t('posts.forYourCategory');
  return null;
}

/**
 * One post as a tappable card (home block and the posts list). A PINNED management message reads as a
 * paper sheet pinned to the desk (M85f, owner pick 2026-10-18); the rest keep the dark glass card.
 */
export function PostCard({ post }: { post: Post }) {
  const router = useRouter();
  const thumbnail = thumbnailOf(post);
  const event = eventOf(post);
  const targeted = audienceBadge(post);
  const paper = post.pinned;
  // M242: unread until the member opens it — a gold dot and a heavier title.
  const read = useReadPosts();
  const unread = isPostUnread(post, read);
  // The message's own first words (the server's greeting line is skipped, see postPreview).
  const preview = post.body ? postPreview(post.body) : '';
  const body = (
    <View style={[styles.texts, thumbnail && !paper ? styles.textsPadded : null]}>
          {targeted ? (
            <View style={styles.audience}>
              <View style={styles.audienceBadge}>
                <Ionicons name="person" size={12} color={colors.goldInk} />
                <Text style={styles.audienceBadgeText}>{targeted}</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.titleRow}>
            {unread ? <View style={[styles.unreadDot, paper && styles.unreadDotPaper]} /> : null}
            <Text style={[styles.title, paper && styles.titlePaper, unread && styles.titleUnread]} numberOfLines={2}>
              {markParagraphs(post.title)}
            </Text>
          </View>
          {event ? (
            <View style={styles.event}>
              <View style={styles.eventBadge}>
                <Ionicons name="calendar" size={12} color={colors.goldInk} />
                <Text style={styles.eventBadgeText}>{t('posts.eventBadge')}</Text>
              </View>
              <Text style={[styles.eventWhen, paper && styles.eventWhenPaper]} numberOfLines={1}>
                {formatEventDate(event.date)}
              </Text>
            </View>
          ) : null}
          {post.kind === 'poll' ? (
            <View style={styles.event}>
              <View style={styles.eventBadge}>
                <Ionicons name="stats-chart" size={12} color={colors.goldInk} />
                <Text style={styles.eventBadgeText}>{t('poll.badge')}</Text>
              </View>
              <Text style={[styles.eventWhen, paper && styles.eventWhenPaper]} numberOfLines={1}>
                {post.poll?.closed ? t('poll.closedShort') : post.poll?.myVote ? t('poll.votedShort') : t('poll.openShort')}
              </Text>
            </View>
          ) : null}
          {event && (event.place || event.onlineUrl) ? (
            <View style={styles.eventPlace}>
              <Ionicons name={event.place ? 'location-outline' : 'videocam-outline'} size={14} color={paper ? colors.paperGold : colors.goldLightText} />
              <Text style={[styles.eventPlaceText, paper && styles.inkSoftPaper]} numberOfLines={1}>
                {markParagraphs(event.place ? (event.onlineUrl ? t('posts.placeAndOnline', { place: event.place }) : event.place) : t('posts.online'))}
              </Text>
            </View>
          ) : null}
          {preview ? (
            <Text style={[styles.body, paper && styles.inkSoftPaper]} numberOfLines={2}>
              {markParagraphs(preview)}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            {post.publishedAt ? <Text style={[styles.time, paper && styles.timePaper]}>{formatRelativeTime(post.publishedAt)}</Text> : null}
            {post.youtubeId || post.video?.url ? <Ionicons name="play-circle-outline" size={16} color={paper ? colors.paperGold : colors.goldLightText} /> : null}
          </View>
        </View>
  );
  return (
    <PressScale
      onPress={() => router.push(`/posts/${post.id}` as Href)}
      glow
      glowRadius={paper ? radii.xl : radii.lg}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${t('inbox.unread')}: ${post.title}` : post.title}
    >
      {paper ? (
        // The golden pin head and the hair of tilt come from PaperCard itself.
        <PaperCard pinned style={styles.paperCard}>
          {thumbnail ? <Image source={{ uri: sized(thumbnail, 360) }} style={styles.paperBanner} resizeMode="cover" accessibilityLabel={post.title} /> : null}
          {body}
        </PaperCard>
      ) : (
        // M76 (owner): a post WITH media leads with a big banner image — visual cards, not a wall of text.
        <GlassCard radius={radii.lg} style={[styles.card, thumbnail ? styles.cardMedia : null]}>
          {thumbnail ? <Image source={{ uri: sized(thumbnail, 360) }} style={styles.banner} resizeMode="cover" accessibilityLabel={post.title} /> : null}
          {body}
        </GlassCard>
      )}
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  block: { gap: spacing.sm },
  // Padding sits on a View: Android measures a padded Text too narrow and truncates it.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  // M76: the media card — the banner on top, full-bleed, texts padded underneath.
  cardMedia: { flexDirection: 'column', alignItems: 'stretch', padding: 0, gap: 0, overflow: 'hidden' },
  banner: { width: '100%', height: 160, backgroundColor: colors.surfaceElevated },
  textsPadded: { padding: spacing.md },
  // M85f: the pinned management message as a paper sheet — ivory card, ink text, photo inside the sheet.
  paperCard: { padding: spacing.md, gap: spacing.sm },
  paperBanner: { width: '100%', height: 150, borderRadius: radii.md, backgroundColor: colors.paperBorder },
  titlePaper: { color: colors.paperInk },
  inkSoftPaper: { color: colors.paperInkSoft },
  timePaper: { color: colors.paperMuted },
  eventWhenPaper: { color: colors.paperGold },
  texts: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { ...typography.body, flex: 1, color: colors.textPrimary, textAlign: textStart },
  // M242: the unread mark — a lit gold dot before a semi-bold title (ink-gold on the paper sheet).
  titleUnread: { fontFamily: fonts.semiBold },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.goldNeon, boxShadow: shadows.glowGoldFaint },
  unreadDotPaper: { backgroundColor: colors.paperGold, boxShadow: undefined },
  markAllWrap: { alignSelf: 'flex-end' },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  markAllText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 19, color: colors.goldText },
  body: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  event: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  eventBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.gold },
  eventBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldInk },
  audience: { flexDirection: 'row' },
  audienceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.goldLight },
  audienceBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldInk },
  eventWhen: { ...typography.caption, fontFamily: fonts.medium, color: colors.goldLightText, flexShrink: 1 },
  eventPlace: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  eventPlaceText: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { ...typography.caption, color: colors.textMuted },
}));
