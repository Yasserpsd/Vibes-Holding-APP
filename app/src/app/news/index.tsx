import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDecisions, useNewsFeed, useNewsPrefs, useNewsTopics, type NewsItem } from '@/api/news';
import { useAuth } from '@/auth/AuthProvider';
import { ASK_ADVISOR_CLEARANCE, useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { Chip } from '@/components/Chip';
import { QuietBackdrop } from '@/components/QuietBackdrop';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { NewsCard, PageFooter } from '@/components/news/NewsCard';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { chevronForward, isRTL, textStart } from '@/i18n/direction';
import { formatNewsCount } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

// The decisions strip snaps card by card: the compact NewsCard width (260) plus the strip gap.
const STRIP_SNAP = 260 + spacing.sm;

// One stable component: an inline arrow would remount every separator on each render.
const Separator = () => <View style={styles.separator} />;

export default function NewsListScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const signedIn = status === 'signedIn';
  const [topic, setTopic] = useState<string | undefined>();

  const topics = useNewsTopics();
  const prefs = useNewsPrefs(signedIn);
  const interests = useMemo(() => (signedIn ? (prefs.data?.topics ?? []) : []), [signedIn, prefs.data]);
  // A login or a change of interests re-ranks the feed.
  const who = signedIn ? `${me?.id ?? 'me'}:${interests.join(',')}` : 'guest';
  const feed = useNewsFeed(topic, who);
  const decisions = useDecisions(8);
  useAdvisorScreen({ type: 'screen', id: 'news', title: t('news.title') });

  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const personalized = feed.data?.pages[0]?.personalized ?? false;
  const decisionItems = decisions.data?.pages[0]?.items ?? [];
  const chips = useMemo(() => {
    const all = topics.data?.topics ?? [];
    const chosen = new Set(interests);
    // M61: sports leads the row (owner: «الناس تحب الأخبار الرياضية»), then the member's interests, then the rest.
    const sports = all.filter((item) => item.key === 'sports');
    const rest = all.filter((item) => item.key !== 'sports');
    return [...sports, ...rest.filter((item) => chosen.has(item.key)), ...rest.filter((item) => !chosen.has(item.key))];
  }, [topics.data, interests]);
  const askForInterests = signedIn && prefs.data !== undefined && !prefs.data.saved;

  const openItem = (item: NewsItem) => router.push({ pathname: '/news/[id]', params: { id: item.id } });
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const header = (
    <View style={styles.header}>
      <FadeInView delay={entranceDelay(0)}>
        <View style={styles.titleRow}>
          {/* This page has no native header (it draws its own title), so the way back sits beside the title:
              the arrow points to the start side, like the native header's on the other pages. */}
          <View style={styles.titleLead}>
            <PressScale onPress={goBack} accessibilityLabel={t('persona.back')} wrapStyle={styles.backWrap} style={styles.back}>
              <Ionicons name={isRTL() ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.goldText} />
            </PressScale>
            <Text style={styles.title}>{t('news.title')}</Text>
          </View>
          {signedIn ? (
            <PressScale onPress={() => router.push('/news/interests')} style={styles.headerLink} hitSlop={8}>
              <Ionicons name="options-outline" size={16} color={colors.goldText} />
              <Text style={styles.headerLinkText}>{t('news.interestsLink')}</Text>
            </PressScale>
          ) : null}
        </View>
      </FadeInView>

      <FadeInView delay={entranceDelay(1)} style={styles.block}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>{topics.data?.decisionsTitle ?? t('news.decisionsTitle')}</Text>
          {decisionItems.length > 0 ? (
            <PressScale onPress={() => router.push('/news/decisions')} accessibilityRole="link" hitSlop={8}>
              <Text style={styles.sectionLink}>{t('news.viewAll')}</Text>
            </PressScale>
          ) : null}
        </View>
        {decisionItems.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            snapToInterval={STRIP_SNAP}
            decelerationRate="fast"
          >
            {decisionItems.map((item) => (
              <NewsCard key={item.id} item={item} compact onPress={() => openItem(item)} />
            ))}
          </ScrollView>
        ) : decisions.isError ? (
          // A failed load must not read as «no decisions»: say it and let the member retry with a tap.
          <PressScale onPress={() => void decisions.refetch()} accessibilityRole="button" style={styles.sectionRetry}>
            <Ionicons name="refresh" size={14} color={colors.goldLightText} />
            <Text style={styles.sectionLink}>{t('errors.generic')} · {t('common.retry')}</Text>
          </PressScale>
        ) : (
          <Text style={styles.sectionEmpty}>{decisions.isPending ? t('news.decisionsLoading') : t('news.decisionsEmpty')}</Text>
        )}
      </FadeInView>

      {askForInterests ? (
        <FadeInView delay={entranceDelay(2)}>
          <PressScale onPress={() => router.push('/news/interests')} glow glowRadius={radii.lg}>
            <GlassCard golden style={styles.banner}>
              <Ionicons name="sparkles-outline" size={20} color={colors.gold} />
              <Text style={styles.bannerText}>{t('news.pickInterests')}</Text>
              <Ionicons name={chevronForward()} size={18} color={colors.textMuted} />
            </GlassCard>
          </PressScale>
        </FadeInView>
      ) : null}

      <FadeInView delay={entranceDelay(3)}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('news.all')} selected={!topic} onPress={() => setTopic(undefined)} />
          {chips.map((item) => (
            <Chip key={item.key} label={item.label} selected={topic === item.key} onPress={() => setTopic(topic === item.key ? undefined : item.key)} />
          ))}
        </ScrollView>
      </FadeInView>
      <FadeInView delay={entranceDelay(4)}>
        {/* Icons pass: the feed's size rides the ranking line as a small golden pill. */}
        <View style={styles.countRow}>
          <Text style={styles.count}>{personalized ? t('news.rankedForYou') : t('news.latest')}</Text>
          {(feed.data?.pages[0]?.total ?? 0) > 0 ? (
            <View style={styles.countPill}>
              <Ionicons name="newspaper-outline" size={13} color={colors.goldText} />
              <Text style={styles.countPillText}>{formatNewsCount(feed.data?.pages[0]?.total ?? 0)}</Text>
            </View>
          ) : null}
        </View>
      </FadeInView>
    </View>
  );

  return (
    // The top inset is the page's own: with no native header above it, the title sat under the status bar.
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Stack.Screen options={{ title: t('news.title') }} />
      <QuietBackdrop />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <FadeInView delay={entranceDelay(index)}>
            <NewsCard item={item} onPress={() => openItem(item)} />
          </FadeInView>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <StateView
            loading={feed.isPending}
            error={feed.error}
            onRetry={() => feed.refetch()}
            empty={!feed.isPending && !feed.error}
            emptyText={t('news.emptyTopic')}
          />
        }
        ListFooterComponent={<PageFooter loading={feed.isFetchingNextPage} failed={feed.isFetchNextPageError} onRetry={() => void feed.fetchNextPage()} />}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => {
              void feed.refetch();
              void decisions.refetch();
            }}
            tintColor={colors.gold}
            colors={[colors.gold]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Separator}
      />
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  safeArea: { flex: 1, backgroundColor: colors.black },
  // The bottom padding keeps the last card clear of the floating «اسأل المستشار» button.
  listContent: { paddingHorizontal: spacing.md, paddingBottom: ASK_ADVISOR_CLEARANCE },
  header: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.sm },
  block: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleLead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  // A 44 pt target; pulled 10 pt toward the edge so the arrow itself lines up with the cards below.
  backWrap: { marginStart: -10 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.gold },
  // 44 pt tall: the link text alone is about 20.
  headerLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  headerLinkText: { ...typography.caption, color: colors.goldLightText },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary },
  sectionLink: { ...typography.caption, color: colors.goldLightText },
  sectionRetry: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  sectionEmpty: { ...typography.caption, color: colors.textMuted },
  strip: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  // The card chrome (border, surface, glow) comes from the golden GlassCard.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
  },
  bannerText: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: textStart },
  chips: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: { ...typography.caption, color: colors.textMuted, flex: 1 },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
  },
  countPillText: { ...typography.caption, fontSize: 11, lineHeight: 16, fontFamily: fonts.medium, color: colors.goldLightText },
  separator: { height: spacing.sm },
}));
