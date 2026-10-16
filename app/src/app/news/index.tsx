import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDecisions, useNewsFeed, useNewsPrefs, useNewsTopics, type NewsItem } from '@/api/news';
import { useAuth } from '@/auth/AuthProvider';
import { ASK_ADVISOR_CLEARANCE, useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { Chip } from '@/components/Chip';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { NewsCard } from '@/components/news/NewsCard';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

// The decisions strip snaps card by card: the compact NewsCard width (260) plus the strip gap.
const STRIP_SNAP = 260 + spacing.sm;

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

  const header = (
    <View style={styles.header}>
      <FadeInView delay={entranceDelay(0)}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('news.title')}</Text>
          {signedIn ? (
            <PressScale onPress={() => router.push('/news/interests')} style={styles.headerLink} hitSlop={8}>
              <Ionicons name="options-outline" size={16} color={colors.gold} />
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
        <Text style={styles.count}>{personalized ? t('news.rankedForYou') : t('news.latest')}</Text>
      </FadeInView>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <Stack.Screen options={{ title: t('news.title') }} />
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
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={colors.gold} style={styles.footer} /> : null}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.black },
  // The bottom padding keeps the last card clear of the floating «اسأل المستشار» button.
  listContent: { paddingHorizontal: spacing.md, paddingBottom: ASK_ADVISOR_CLEARANCE },
  header: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.sm },
  block: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title, color: colors.gold },
  headerLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerLinkText: { ...typography.caption, color: colors.goldLight },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary },
  sectionLink: { ...typography.caption, color: colors.goldLight },
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
  count: { ...typography.caption, color: colors.textMuted },
  separator: { height: spacing.sm },
  footer: { paddingVertical: spacing.md },
});
