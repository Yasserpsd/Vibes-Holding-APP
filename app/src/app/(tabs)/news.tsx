import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, RefreshControl, Text, useWindowDimensions, View } from 'react-native';

import { cardImageOf, useAgenda } from '@/api/agenda';
import { usePeople } from '@/api/people';
import { useLatestPosts } from '@/api/posts';
import { companionApi } from '@/api/push';
import { useProjectsList } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PopIn, PressScale, SkeletonCards } from '@/components/motion';
import { fitWords } from '@/components/news/NewsCard';
import { MarkAllReadButton, postPreview } from '@/components/PostsBlock';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { t, type StringKey } from '@/i18n';
import { markParagraphs, textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { sized } from '@/lib/imageUrl';
import { isPostUnread, useReadPosts, useUnreadPosts } from '@/lib/readPosts';
import { markSeen, useSeenMarks } from '@/lib/seen';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

// M214 (owner, 2026-11-07: «لازم كل خبر معاه صورة جنبه»): no row without a picture — the club emblem stands in.
const clubEmblem = require('../../../assets/images/club-emblem.png');

/**
 * M75 «الإشعارات» (owner): ONE fixed center for every persona — admin messages, workshops and
 * events, new bank projects and new «شخصية ومسيرة» profiles, merged newest first. Opening the
 * tab clears its badge; every row leads to the real thing. M173 (owner: «الإشعارات توديني على كل
 * الإشعارات مش على الأخبار خالص»): the news left this center — its door sits on the home.
 */
type InboxItem = {
  id: string;
  kind: 'post' | 'event' | 'project' | 'person' | 'tip';
  title: string;
  subtitle: string | null;
  time: string | null;
  image: string | null;
  route: Href;
  /** M242: a management message the member has not opened yet (always false for the other kinds). */
  unread?: boolean;
};

const KIND_META: Record<InboxItem['kind'], { icon: IoniconName; label: StringKey }> = {
  post: { icon: 'megaphone-outline', label: 'inbox.kind.post' },
  event: { icon: 'calendar-outline', label: 'inbox.kind.event' },
  project: { icon: 'briefcase-outline', label: 'inbox.kind.project' },
  person: { icon: 'sparkles-outline', label: 'inbox.kind.person' },
  tip: { icon: 'bulb-outline', label: 'inbox.kind.tip' },
};

export default function InboxScreen() {
  const router = useRouter();
  const posts = useLatestPosts(10);
  const agenda = useAgenda();
  const projects = useProjectsList({ q: '', sort: 'latest' });
  const people = usePeople();
  const seen = useSeenMarks();
  // M242: which management messages were opened on this device, and the ones still unread (newest first).
  const read = useReadPosts();
  const unread = useUnreadPosts();
  // M176 (owner): the advisor's personal daily suggestion, by name — today's leads the tab, the earlier ones stay as rows.
  const { status, me } = useAuth();
  const tips = useQuery({ queryKey: ['companion', 'tips', me?.id ?? 0], queryFn: companionApi.tips, enabled: status === 'signedIn', staleTime: 30 * 60_000 });
  const todayTip = tips.data?.tips[0] ?? null;
  useAdvisorScreen({ type: 'screen', id: 'news', title: t('tabs.inbox') }, true);

  // Entering the center acknowledges the fresh events, projects and profiles (their dots reset here).
  // M242: a management message is different — it stays unread, and the tab stays lit, until it is opened.
  useFocusEffect(
    useCallback(() => {
      markSeen('inbox');
    }, []),
  );

  const items = useMemo<InboxItem[]>(() => {
    const out: InboxItem[] = [];
    for (const post of posts.data?.posts ?? []) {
      out.push({ id: `post:${post.id}`, kind: 'post', title: post.title, subtitle: postPreview(post.body) || null, time: post.publishedAt, image: post.images[0] ?? null, route: `/posts/${post.id}` as Href, unread: isPostUnread(post, read) });
    }
    for (const event of (agenda.data?.events ?? []).filter((entry) => !entry.past).slice(0, 6)) {
      out.push({ id: `event:${event.id}`, kind: 'event', title: event.title, subtitle: event.blurb || null, time: `${event.date}T${event.time || '09:00'}:00+03:00`, image: cardImageOf(event), route: `/agenda/${event.id}` as Href });
    }
    // M167 (owner): the finished events stay reachable here too, last, marked «انتهت».
    const finished: InboxItem[] = (agenda.data?.events ?? [])
      .filter((entry) => entry.past)
      .slice(0, 3)
      .map((event) => ({ id: `event:${event.id}`, kind: 'event', title: event.title, subtitle: t('agenda.ended'), time: `${event.date}T${event.time || '09:00'}:00+03:00`, image: cardImageOf(event), route: `/agenda/${event.id}` as Href }));
    for (const project of (projects.data?.pages[0]?.items ?? []).slice(0, 6)) {
      out.push({ id: `project:${project.id}`, kind: 'project', title: project.title, subtitle: project.sector?.name ?? null, time: project.modifiedAt, image: project.image, route: { pathname: '/project/[id]', params: { id: String(project.id) } } });
    }
    for (const person of (people.data?.people ?? []).slice(0, 4)) {
      out.push({ id: `person:${person.id}`, kind: 'person', title: person.name, subtitle: person.title || null, time: null, image: person.photo, route: { pathname: '/people/[id]', params: { id: String(person.id) } } });
    }
    for (const tip of (tips.data?.tips ?? []).slice(1)) {
      out.push({ id: tip.id, kind: 'tip', title: tip.title, subtitle: tip.body, time: `${tip.day}T11:00:00+03:00`, image: tip.image ?? null, route: tip.route as Href });
    }
    // Events sort by WHEN they happen (soonest of the upcoming first), everything else by newest.
    const events = out.filter((item) => item.kind === 'event');
    const rest = out.filter((item) => item.kind !== 'event').sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
    return [...events.slice(0, 2), ...rest, ...events.slice(2), ...finished];
  }, [posts.data, agenda.data, projects.data, people.data, tips.data, read]);

  const loading = posts.isLoading && agenda.isLoading;
  // Every source failed and nothing is cached: say so instead of «nothing new yet».
  const failed = items.length === 0 && posts.isError && agenda.isError && projects.isError && people.isError;

  // The spinner stays until every list has answered (a controlled `refreshing={false}` snapped it shut at once).
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // The day's suggestion is for signed-in members only: a guest's pull must not call its endpoint.
      await Promise.all([posts.refetch(), agenda.refetch(), projects.refetch(), people.refetch(), status === 'signedIn' ? tips.refetch() : undefined]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      aboveTabBar
      title={t('tabs.inbox')}
      subtitle={t('inbox.subtitle')}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}
    >
      {/* M75c (owner): the unread count sits right beside «رسائل الإدارة». */}
      <FadeInView>
        <SectionHeader title={t('nav.posts')} badge={unread.length} cta={t('common.viewAll')} onPress={() => router.push('/posts' as Href)} />
        {/* M242: the count is now the messages not opened yet; «تعليم الكل كمقروء» shows only while there is one. */}
        <MarkAllReadButton ids={unread.map((post) => post.id)} />
      </FadeInView>
      {loading ? (
        <SkeletonCards count={5} />
      ) : failed ? (
        <StateView error={posts.error} onRetry={() => void onRefresh()} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t('inbox.empty')}</Text>
      ) : (
        items.map((item, index) => (
          <FadeInView key={item.id} delay={entranceDelay(Math.min(index, 8), 60)}>
            {/* A management message is lit while it is unread; the other kinds while they are newer than the last visit. */}
            <InboxRow item={item} fresh={item.kind === 'post' ? Boolean(item.unread) : Boolean(item.time && Date.parse(item.time) > seen.inbox)} onPress={() => router.push(item.route)} />
          </FadeInView>
        ))
      )}
      {/* M232 (owner): «بريد وارد» opens on the management's messages; the day's suggestion comes after them. */}
      {todayTip ? (
        <PopIn>
          <PressScale onPress={() => router.push(todayTip.route as Href)} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={todayTip.title}>
            <GlassCard golden style={styles.tipCard}>
              {/* M214: the day's suggestion opens on the picture of what it offers. */}
              <Image source={todayTip.image ? { uri: sized(todayTip.image, 340) } : clubEmblem} style={[styles.tipImage, !todayTip.image && styles.tipImageEmblem]} resizeMode={todayTip.image ? 'cover' : 'contain'} accessibilityIgnoresInvertColors />
              <View style={styles.tipHead}>
                <Ionicons name="bulb" size={18} color={colors.goldLightText} />
                <Text style={styles.tipEyebrow}>{t('inbox.tipToday')}</Text>
              </View>
              <Text style={styles.tipTitle}>{todayTip.title}</Text>
              <Text style={styles.tipBody}>{todayTip.body}</Text>
            </GlassCard>
          </PressScale>
        </PopIn>
      ) : null}
    </Screen>
  );
}

function InboxRow({ item, fresh, onPress }: { item: InboxItem; fresh: boolean; onPress: () => void }) {
  const meta = KIND_META[item.kind];
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={item.unread ? `${t('inbox.unread')}: ${item.title}` : item.title}>
      <GlassCard radius={radii.lg} style={styles.row}>
        {/* M84e: the type icon pops into its box as the row enters. */}
        <PopIn delay={100}>
          <View style={[styles.iconBox, fresh && styles.iconBoxFresh]}>
            <Ionicons name={meta.icon} size={20} color={fresh ? colors.goldInk : colors.gold} />
          </View>
        </PopIn>
        <View style={styles.texts}>
          <View style={styles.kindRow}>
            <Text style={styles.kind}>{t(meta.label)}</Text>
            {fresh ? <View style={styles.freshDot} /> : null}
            {item.time ? <Text style={styles.time}>{formatRelativeTime(item.time)}</Text> : null}
          </View>
          <Text style={[styles.title, item.unread && styles.titleUnread]} numberOfLines={2}>
            {markParagraphs(item.title)}
          </Text>
          {item.subtitle ? <OneLine text={item.subtitle} /> : null}
        </View>
        <InboxThumb uri={item.image} />
      </GlassCard>
    </PressScale>
  );
}

/** The row's second line, cut at the end of a word so Android never clips the ellipsis to «..» (see `fitWords`). */
function OneLine({ text }: { text: string }) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  return (
    <Text style={styles.subtitle} numberOfLines={1} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}>
      {markParagraphs(fitWords(text, width, typography.caption.fontSize, fontScale))}
    </Text>
  );
}

/** The row's picture; the club emblem stands in when there is none or it fails to load. */
function InboxThumb({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={[styles.thumb, styles.thumbEmblem]}>
        <Image source={clubEmblem} style={styles.emblem} resizeMode="contain" />
      </View>
    );
  }
  return <Image source={{ uri: sized(uri, 54) }} style={styles.thumb} resizeMode="cover" onError={() => setFailed(true)} />;
}

const styles = themedStyles(() => ({
  // M176: today's personal suggestion — golden, on top of the tab.
  tipCard: { gap: spacing.xs, padding: spacing.md, boxShadow: shadows.glowGoldFaint },
  tipImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.md, backgroundColor: colors.surfaceElevated, marginBottom: spacing.xs },
  tipImageEmblem: { aspectRatio: 16 / 7 },
  tipHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tipEyebrow: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldLightText, textAlign: textStart },
  tipTitle: { ...typography.subtitle, fontSize: 17, lineHeight: 27, color: colors.textPrimary, textAlign: textStart },
  tipBody: { ...typography.body, fontSize: 15, lineHeight: 24, color: colors.textSecondary, textAlign: textStart },
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm + 4 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
  },
  iconBoxFresh: { backgroundColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  texts: { flex: 1, gap: 2 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kind: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.goldLightText },
  freshDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.goldNeon, boxShadow: shadows.glowGoldFaint },
  time: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginStart: 'auto' },
  title: { ...typography.body, fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 23, color: colors.textPrimary, textAlign: textStart },
  // M242: every title here is already semi-bold, so an unread management message goes one step heavier.
  titleUnread: { fontFamily: fonts.bold },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  thumb: { width: 54, height: 54, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  thumbEmblem: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  emblem: { width: 36, height: 36 },
}));
