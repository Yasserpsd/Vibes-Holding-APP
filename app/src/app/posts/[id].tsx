import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { eventOf, pollsApi, usePost, type Poll, type PostEvent } from '@/api/posts';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { audienceBadge } from '@/components/PostsBlock';
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

  const isPoll = post?.kind === 'poll';
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: event ? t('posts.event') : isPoll ? t('poll.badge') : t('nav.post') }} />
      {!post ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
          <View style={styles.meta}>
            <View style={styles.badge}>
              <Ionicons name={event ? 'calendar' : isPoll ? 'stats-chart' : 'megaphone-outline'} size={14} color={colors.black} />
              <Text style={styles.badgeText}>{event ? t('posts.event') : isPoll ? t('poll.badge') : t('nav.posts')}</Text>
            </View>
            {audienceBadge(post) ? (
              <View style={styles.badge}>
                <Ionicons name="person" size={14} color={colors.black} />
                <Text style={styles.badgeText}>{audienceBadge(post)}</Text>
              </View>
            ) : null}
            {post.publishedAt ? <Text style={styles.time}>{formatRelativeTime(post.publishedAt)}</Text> : null}
          </View>
          <Text style={styles.title}>{post.title}</Text>
          {event ? <EventCard event={event} /> : null}
          {post.body ? <Text style={styles.body}>{post.body}</Text> : null}
          {post.kind === 'poll' && post.poll ? <PollCard postId={post.id} initial={post.poll} /> : null}
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

/**
 * M31: the poll — tap an option to vote (members only), change it until the poll closes.
 * Counts and bars appear once the server sends them: after the member's vote, or after closing,
 * and only when the poll shows its results.
 */
function PollCard({ postId, initial }: { postId: string; initial: Poll }) {
  const { me } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [poll, setPoll] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = !poll.closed;
  const showCounts = poll.totalVotes !== null;

  const vote = async (optionId: string) => {
    if (!open || busyId || optionId === poll.myVote) return;
    setBusyId(optionId);
    setError(null);
    try {
      const result = await pollsApi.vote(postId, optionId);
      setPoll(result.poll);
      // The list card shows the voted state too.
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.setQueryData(['post', postId], (current: { post: { poll?: Poll | null } } | undefined) => (current ? { post: { ...current.post, poll: result.poll } } : current));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.poll}>
      {poll.options.map((option) => {
        const mine = option.id === poll.myVote;
        const votes = option.votes ?? 0;
        const share = showCounts && (poll.totalVotes ?? 0) > 0 ? votes / (poll.totalVotes as number) : 0;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected: mine, disabled: !open }}
            onPress={() => (me ? void vote(option.id) : null)}
            style={({ pressed }) => [styles.option, mine && styles.optionMine, pressed && open && styles.pressed]}
          >
            {showCounts ? <View style={[styles.optionFill, { width: `${Math.round(share * 100)}%` }]} /> : null}
            <View style={styles.optionRow}>
              <Ionicons name={mine ? 'checkmark-circle' : open ? 'ellipse-outline' : 'remove-circle-outline'} size={20} color={mine ? colors.gold : colors.textMuted} />
              <Text style={[styles.optionLabel, mine && styles.optionLabelMine]}>{option.label}</Text>
              {showCounts ? <Text style={styles.optionVotes}>{busyId === option.id ? '…' : `${Math.round(share * 100)}%`}</Text> : busyId === option.id ? <Text style={styles.optionVotes}>…</Text> : null}
            </View>
          </Pressable>
        );
      })}

      {!me ? (
        <>
          <Notice tone="warning" text={t('poll.signIn')} />
          <AppButton label={t('card.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
        </>
      ) : null}
      {error ? <Notice tone="warning" text={error} /> : null}

      <Text style={styles.pollMeta}>
        {[
          showCounts ? t('poll.total', { count: poll.totalVotes ?? 0 }) : null,
          poll.closed ? t('poll.closed') : poll.closesAt ? t('poll.closesAt', { date: formatEventDate(poll.closesAt) }) : null,
          me && poll.myVote && !showCounts ? t('poll.votedHidden') : null,
          me && poll.myVote && open ? t('poll.changeHint') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
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
  poll: { gap: spacing.sm },
  option: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  optionMine: { borderColor: colors.gold },
  optionFill: { position: 'absolute', top: 0, bottom: 0, start: 0, backgroundColor: colors.goldDark, opacity: 0.28 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
  optionLabel: { ...typography.body, flex: 1, color: colors.textPrimary, textAlign: textStart },
  optionLabelMine: { fontFamily: fonts.semiBold, color: colors.goldLight },
  optionVotes: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.goldLight, writingDirection: 'ltr' },
  pollMeta: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
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
