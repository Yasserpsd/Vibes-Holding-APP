import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDecisions, useNewsFeed, useNewsPrefs, useNewsTopics, type NewsItem } from '@/api/news';
import { useAuth } from '@/auth/AuthProvider';
import { Chip } from '@/components/Chip';
import { NewsCard } from '@/components/news/NewsCard';
import { StateView } from '@/components/StateView';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const DECISIONS_TITLE = 'قرارات وأنظمة المملكة';

export default function NewsScreen() {
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

  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const personalized = feed.data?.pages[0]?.personalized ?? false;
  const decisionItems = decisions.data?.pages[0]?.items ?? [];
  const chips = useMemo(() => {
    const all = topics.data?.topics ?? [];
    const chosen = new Set(interests);
    return [...all.filter((item) => chosen.has(item.key)), ...all.filter((item) => !chosen.has(item.key))];
  }, [topics.data, interests]);
  const askForInterests = signedIn && prefs.data !== undefined && !prefs.data.saved;

  const openItem = (item: NewsItem) => router.push({ pathname: '/news/[id]', params: { id: item.id } });

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>الأخبار</Text>
        {signedIn ? (
          <Pressable onPress={() => router.push('/news/interests')} style={styles.headerLink} accessibilityRole="button" hitSlop={8}>
            <Ionicons name="options-outline" size={16} color={colors.gold} />
            <Text style={styles.headerLinkText}>اهتماماتي</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{topics.data?.decisionsTitle ?? DECISIONS_TITLE}</Text>
        {decisionItems.length > 0 ? (
          <Pressable onPress={() => router.push('/news/decisions')} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.sectionLink}>عرض الكل</Text>
          </Pressable>
        ) : null}
      </View>
      {decisionItems.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {decisionItems.map((item) => (
            <NewsCard key={item.id} item={item} compact onPress={() => openItem(item)} />
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.sectionEmpty}>{decisions.isPending ? 'جارٍ تحميل القرارات…' : 'لا توجد قرارات جديدة حاليًا.'}</Text>
      )}

      {askForInterests ? (
        <Pressable onPress={() => router.push('/news/interests')} accessibilityRole="button" style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
          <Ionicons name="sparkles-outline" size={20} color={colors.gold} />
          <Text style={styles.bannerText}>اختر اهتماماتك لتُرتَّب الأخبار حسب ما يهمك.</Text>
          <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="الكل" selected={!topic} onPress={() => setTopic(undefined)} />
        {chips.map((item) => (
          <Chip key={item.key} label={item.label} selected={topic === item.key} onPress={() => setTopic(topic === item.key ? undefined : item.key)} />
        ))}
      </ScrollView>
      <Text style={styles.count}>{personalized ? 'مرتّبة حسب اهتماماتك' : 'أحدث أخبار الأعمال من مصادر موثوقة'}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NewsCard item={item} onPress={() => openItem(item)} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <StateView
            loading={feed.isPending}
            error={feed.error}
            onRetry={() => feed.refetch()}
            empty={!feed.isPending && !feed.error}
            emptyText="لا توجد أخبار في هذا الاهتمام حاليًا"
          />
        }
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={colors.gold} style={styles.footer} /> : null}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshing={feed.isRefetching && !feed.isFetchingNextPage}
        onRefresh={() => {
          void feed.refetch();
          void decisions.refetch();
        }}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.black },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  header: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title, color: colors.gold },
  headerLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerLinkText: { ...typography.caption, color: colors.goldLight },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary },
  sectionLink: { ...typography.caption, color: colors.goldLight },
  sectionEmpty: { ...typography.caption, color: colors.textMuted },
  strip: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  bannerText: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: 'right' },
  pressed: { opacity: 0.8 },
  chips: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  count: { ...typography.caption, color: colors.textMuted },
  separator: { height: spacing.sm },
  footer: { paddingVertical: spacing.md },
});
