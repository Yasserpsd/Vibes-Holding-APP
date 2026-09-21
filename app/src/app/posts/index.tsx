import { Stack } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { usePosts } from '@/api/posts';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { PostCard } from '@/components/PostsBlock';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { colors, typography } from '@/theme/tokens';

/** Every «رسائل الإدارة» post, pinned first, then newest; older pages load on demand. */
export default function PostsScreen() {
  const query = usePosts();
  const [refreshing, setRefreshing] = useState(false);
  useAdvisorScreen({ type: 'screen', id: 'posts', title: t('nav.posts') });
  const posts = query.data?.pages.flatMap((page) => page.posts) ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  if (!query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('nav.posts') }} />
        <StateView loading={query.isPending} error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} />}>
      <Stack.Screen options={{ title: t('nav.posts') }} />
      {posts.length === 0 ? <Text style={styles.empty}>{t('posts.empty')}</Text> : null}
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {query.hasNextPage ? (
        <AppButton
          label={query.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
          variant="outline"
          icon="chevron-down"
          onPress={() => void query.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
