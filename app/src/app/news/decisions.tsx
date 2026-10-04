import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useDecisions } from '@/api/news';
import { entranceDelay, FadeInView } from '@/components/motion';
import { NewsCard } from '@/components/news/NewsCard';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { colors, spacing, typography } from '@/theme/tokens';

/** The fixed section, the same for everyone: official decisions, laws and regulations, newest first. */
export default function DecisionsScreen() {
  const router = useRouter();
  const list = useDecisions();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <FadeInView delay={entranceDelay(index)}>
            <NewsCard item={item} onPress={() => router.push({ pathname: '/news/[id]', params: { id: item.id } })} />
          </FadeInView>
        )}
        ListHeaderComponent={
          <FadeInView offset={10}>
            <Text style={styles.intro}>{t('news.decisionsIntro')}</Text>
          </FadeInView>
        }
        ListEmptyComponent={
          <StateView loading={list.isPending} error={list.error} onRetry={() => list.refetch()} empty={!list.isPending && !list.error} emptyText={t('news.decisionsEmptyList')} />
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.gold} style={styles.footer} /> : null}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => list.refetch()}
            tintColor={colors.gold}
            colors={[colors.gold]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  intro: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  separator: { height: spacing.sm },
  footer: { paddingVertical: spacing.md },
});
