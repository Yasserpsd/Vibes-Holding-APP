import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { eventOf, pollsApi, usePost, type Poll, type PostEvent } from '@/api/posts';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, GrowBar, PopIn, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { audienceBadge } from '@/components/PostsBlock';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatEventDate, formatRelativeTime } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { playVideo } from '@/lib/player';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

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
            <PopIn style={styles.badge}>
              <Ionicons name={event ? 'calendar' : isPoll ? 'stats-chart' : 'megaphone-outline'} size={14} color={colors.goldInk} />
              <Text style={styles.badgeText}>{event ? t('posts.event') : isPoll ? t('poll.badge') : t('nav.posts')}</Text>
            </PopIn>
            {audienceBadge(post) ? (
              <PopIn delay={80} style={styles.badge}>
                <Ionicons name="person" size={14} color={colors.goldInk} />
                <Text style={styles.badgeText}>{audienceBadge(post)}</Text>
              </PopIn>
            ) : null}
            {post.publishedAt ? <Text style={styles.time}>{formatRelativeTime(post.publishedAt)}</Text> : null}
          </View>
          <FadeInView delay={entranceDelay(1)}>
            <Text style={styles.title}>{post.title}</Text>
          </FadeInView>
          {event ? (
            <FadeInView delay={entranceDelay(2)}>
              <EventCard event={event} />
            </FadeInView>
          ) : null}
          {post.body ? (
            <FadeInView delay={entranceDelay(3)}>
              <Text style={styles.body}>{post.body}</Text>
            </FadeInView>
          ) : null}
          {post.kind === 'poll' && post.poll ? (
            <FadeInView delay={entranceDelay(4)}>
              <PollCard postId={post.id} initial={post.poll} />
            </FadeInView>
          ) : null}
          {post.youtubeId ? (
            <FadeInView delay={entranceDelay(5)}>
              <VideoTile url={`https://www.youtube.com/watch?v=${post.youtubeId}`} poster={`https://img.youtube.com/vi/${post.youtubeId}/hqdefault.jpg`} posterFit="cover" label={t('posts.playYoutube')} title={post.title} />
            </FadeInView>
          ) : null}
          {/* M19: the uploaded video plays in the in-app player (expo-video); old binaries keep the in-app browser. */}
          {post.video?.url ? (
            <FadeInView delay={entranceDelay(5)}>
              <VideoTile url={post.video.url} poster={post.video.poster || null} posterFit="contain" label={t('posts.playVideo')} title={post.title} />
            </FadeInView>
          ) : null}
          {post.images.map((uri, index) => (
            <FadeInView key={uri} delay={entranceDelay(6 + index)}>
              <Image source={{ uri }} style={styles.image} resizeMode="contain" />
            </FadeInView>
          ))}
          {post.links.map((link, index) => (
            <FadeInView key={`${link.label}:${link.url}`} delay={entranceDelay(7 + index)}>
              <AppButton label={link.label} variant="outline" icon="open-outline" onPress={() => void openLink(link.url)} />
            </FadeInView>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * M31: the poll — a member marks his choice, then confirms it, and the vote is FINAL (the owner's
 * rule: «لو اخترت اختيار مينفعش اغيره»). Counts and bars appear once the server sends them: after
 * the member's vote, or after closing, and only when the poll shows its results.
 */
function PollCard({ postId, initial }: { postId: string; initial: Poll }) {
  const { me } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [poll, setPoll] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showCounts = poll.totalVotes !== null;
  // Choosing is open only before the member's one final vote and before the close.
  const canChoose = Boolean(me) && !poll.closed && poll.myVote === null;

  const confirm = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await pollsApi.vote(postId, selected);
      setPoll(result.poll);
      setSelected(null);
      // The list card shows the voted state too.
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.setQueryData(['post', postId], (current: { post: { poll?: Poll | null } } | undefined) => (current ? { post: { ...current.post, poll: result.poll } } : current));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.poll}>
      {poll.options.map((option, index) => {
        const mine = option.id === poll.myVote;
        const picked = canChoose && option.id === selected;
        const votes = option.votes ?? 0;
        const share = showCounts && (poll.totalVotes ?? 0) > 0 ? votes / (poll.totalVotes as number) : 0;
        return (
          <PressScale
            key={option.id}
            disabled={!canChoose}
            onPress={() => setSelected(option.id)}
            accessibilityLabel={option.label}
            accessibilityState={{ selected: mine || picked, disabled: !canChoose }}
            glow={canChoose}
            glowRadius={radii.lg}
            style={[styles.option, (mine || picked) && styles.optionMine]}
          >
            <View style={styles.optionRow}>
              {mine ? (
                <PopIn>
                  <Ionicons name="checkmark-circle" size={20} color={colors.gold} />
                </PopIn>
              ) : (
                <Ionicons name={picked ? 'radio-button-on' : poll.closed ? 'remove-circle-outline' : 'ellipse-outline'} size={20} color={picked ? colors.gold : colors.textMuted} />
              )}
              <Text style={[styles.optionLabel, (mine || picked) && styles.optionLabelMine]}>{option.label}</Text>
              {showCounts ? <Text style={styles.optionVotes}>{`${Math.round(share * 100)}%`}</Text> : null}
            </View>
            {showCounts ? (
              <View style={styles.optionBar}>
                <GrowBar percent={share * 100} height={6} delay={entranceDelay(index)} />
              </View>
            ) : null}
          </PressScale>
        );
      })}

      {canChoose && selected ? (
        <FadeInView offset={8} duration={260}>
          <AppButton label={busy ? t('poll.confirming') : t('poll.confirm')} icon="checkmark-circle-outline" loading={busy} onPress={() => void confirm()} />
        </FadeInView>
      ) : null}
      {!me ? (
        <>
          <Notice tone="warning" text={t('poll.signIn')} />
          <AppButton label={t('card.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
        </>
      ) : null}
      {error ? <Notice tone="warning" text={error} /> : null}

      <Text style={styles.pollMeta}>
        {[
          canChoose ? t('poll.finalHint') : null,
          me && poll.myVote !== null ? t('poll.votedFinal') : null,
          showCounts ? t('poll.total', { count: poll.totalVotes ?? 0 }) : null,
          me && poll.myVote !== null && !showCounts ? t('poll.votedHidden') : null,
          poll.closed ? t('poll.closed') : poll.closesAt ? t('poll.closesAt', { date: formatEventDate(poll.closesAt) }) : null,
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
    <GlassCard golden style={styles.event}>
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
    </GlassCard>
  );
}

/** A video as a tappable tile: its poster (a plain dark tile without one) under a glowing play mark; plays in-app (M19). */
function VideoTile({ url, poster, posterFit, label, title }: { url: string; poster: string | null; posterFit: 'cover' | 'contain'; label: string; title?: string }) {
  const router = useRouter();
  return (
    <PressScale accessibilityLabel={label} onPress={() => playVideo(router, { url, title: title ?? label, poster })} glow glowRadius={radii.lg} style={styles.video}>
      {poster ? <Image source={{ uri: poster }} style={styles.videoImage} resizeMode={posterFit} /> : <View style={styles.videoImage} />}
      <View style={styles.play}>
        <Ionicons name="play" size={28} color={colors.goldInk} />
      </View>
    </PressScale>
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
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.goldInk },
  time: { ...typography.caption, color: colors.textMuted },
  title: { ...typography.title, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary },
  poll: { gap: spacing.sm },
  option: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    experimental_backgroundImage: gradients.surface,
    overflow: 'hidden',
  },
  optionMine: { borderColor: colors.borderGold, boxShadow: shadows.glowGoldFaint },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
  optionBar: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm + 2 },
  optionLabel: { ...typography.body, flex: 1, color: colors.textPrimary, textAlign: textStart },
  optionLabelMine: { fontFamily: fonts.semiBold, color: colors.goldLight },
  optionVotes: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.goldLight, writingDirection: 'ltr' },
  pollMeta: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  event: { gap: spacing.md, padding: spacing.md },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  eventRowBorder: { paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderGoldSoft },
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
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGold,
  },
});
