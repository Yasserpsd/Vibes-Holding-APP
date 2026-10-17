import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Image, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAgenda } from '@/api/agenda';
import { useNewsFeed } from '@/api/news';
import { usePeople } from '@/api/people';
import { useLatestPosts } from '@/api/posts';
import { useProjectsList } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PopIn, PressScale, SkeletonCards } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { t, type StringKey } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { countNew, markSeen, useSeenMarks } from '@/lib/seen';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M75 «الإشعارات» (owner): ONE fixed center for every persona — admin messages, workshops and
 * events, the news itself, new bank projects and new «شخصية ومسيرة» profiles, merged newest
 * first. Opening the tab clears its badge; every row leads to the real thing.
 */
type InboxItem = {
  id: string;
  kind: 'post' | 'event' | 'news' | 'project' | 'person';
  title: string;
  subtitle: string | null;
  time: string | null;
  image: string | null;
  route: Href;
};

const KIND_META: Record<InboxItem['kind'], { icon: IoniconName; label: StringKey }> = {
  post: { icon: 'megaphone-outline', label: 'inbox.kind.post' },
  event: { icon: 'calendar-outline', label: 'inbox.kind.event' },
  news: { icon: 'newspaper-outline', label: 'inbox.kind.news' },
  project: { icon: 'briefcase-outline', label: 'inbox.kind.project' },
  person: { icon: 'sparkles-outline', label: 'inbox.kind.person' },
};

export default function InboxScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const posts = useLatestPosts(10);
  const agenda = useAgenda();
  const news = useNewsFeed(undefined, status === 'signedIn' ? `inbox:${me?.id ?? 'me'}` : 'inbox:guest');
  const projects = useProjectsList({ q: '', sort: 'latest' });
  const people = usePeople();
  const seen = useSeenMarks();
  useAdvisorScreen({ type: 'screen', id: 'news', title: t('tabs.inbox') }, true);

  // Entering the center is the acknowledgement: the tab badge resets here.
  useFocusEffect(
    useCallback(() => {
      markSeen('inbox');
    }, []),
  );

  const items = useMemo<InboxItem[]>(() => {
    const out: InboxItem[] = [];
    for (const post of posts.data?.posts ?? []) {
      out.push({ id: `post:${post.id}`, kind: 'post', title: post.title, subtitle: post.body || null, time: post.publishedAt, image: post.images[0] ?? null, route: `/posts/${post.id}` as Href });
    }
    for (const event of (agenda.data?.events ?? []).filter((entry) => !entry.past).slice(0, 6)) {
      out.push({ id: `event:${event.id}`, kind: 'event', title: event.title, subtitle: event.blurb || null, time: `${event.date}T${event.time || '09:00'}:00+03:00`, image: null, route: `/agenda/${event.id}` as Href });
    }
    for (const item of (news.data?.pages[0]?.items ?? []).slice(0, 8)) {
      out.push({ id: `news:${item.id}`, kind: 'news', title: item.title, subtitle: item.source.name, time: item.publishedAt, image: item.image, route: { pathname: '/news/[id]', params: { id: item.id } } });
    }
    for (const project of (projects.data?.pages[0]?.items ?? []).slice(0, 6)) {
      out.push({ id: `project:${project.id}`, kind: 'project', title: project.title, subtitle: project.sector?.name ?? null, time: project.modifiedAt, image: project.image, route: { pathname: '/project/[id]', params: { id: String(project.id) } } });
    }
    for (const person of (people.data?.people ?? []).slice(0, 4)) {
      out.push({ id: `person:${person.id}`, kind: 'person', title: person.name, subtitle: person.title || null, time: null, image: person.photo, route: { pathname: '/people/[id]', params: { id: String(person.id) } } });
    }
    // Events sort by WHEN they happen (soonest of the upcoming first), everything else by newest.
    const events = out.filter((item) => item.kind === 'event');
    const rest = out.filter((item) => item.kind !== 'event').sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
    return [...events.slice(0, 2), ...rest, ...events.slice(2)];
  }, [posts.data, agenda.data, news.data, projects.data, people.data]);

  const loading = posts.isLoading && agenda.isLoading && news.isPending;
  const unreadPosts = countNew((posts.data?.posts ?? []).map((post) => post.publishedAt), seen.posts);

  const onRefresh = async () => {
    await Promise.all([posts.refetch(), agenda.refetch(), news.refetch(), projects.refetch(), people.refetch()]);
  };

  return (
    <Screen
      aboveTabBar
      title={t('tabs.inbox')}
      subtitle={t('inbox.subtitle')}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}
    >
      {/* M75c (owner): the unread count sits right beside «رسائل الإدارة». */}
      <FadeInView>
        <SectionHeader title={t('nav.posts')} badge={unreadPosts} cta={t('common.viewAll')} onPress={() => router.push('/posts' as Href)} />
      </FadeInView>
      {loading ? (
        <SkeletonCards count={5} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t('inbox.empty')}</Text>
      ) : (
        items.map((item, index) => (
          <FadeInView key={item.id} delay={entranceDelay(Math.min(index, 8), 60)}>
            <InboxRow item={item} fresh={Boolean(item.time && Date.parse(item.time) > seen.inbox)} onPress={() => router.push(item.route)} />
          </FadeInView>
        ))
      )}
      <FadeInView delay={200}>
        <PressScale onPress={() => router.push('/news' as Href)} glow glowRadius={radii.lg}>
          <GlassCard style={styles.allNews}>
            <Ionicons name="newspaper-outline" size={20} color={colors.gold} />
            <Text style={styles.allNewsText}>{t('inbox.allNews')}</Text>
            <Ionicons name={chevronForward()} size={18} color={colors.textMuted} />
          </GlassCard>
        </PressScale>
      </FadeInView>
    </Screen>
  );
}

function InboxRow({ item, fresh, onPress }: { item: InboxItem; fresh: boolean; onPress: () => void }) {
  const meta = KIND_META[item.kind];
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={item.title}>
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
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        {item.image ? <Image source={{ uri: item.image }} style={styles.thumb} resizeMode="cover" /> : null}
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
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
  kind: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  freshDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.goldNeon, boxShadow: shadows.glowGoldFaint },
  time: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginStart: 'auto' },
  title: { ...typography.body, fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 23, color: colors.textPrimary, textAlign: textStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  thumb: { width: 54, height: 54, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  allNews: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginTop: spacing.sm },
  allNewsText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
});
