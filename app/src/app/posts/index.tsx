import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { usePosts } from '@/api/posts';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { entranceDelay, FadeInView } from '@/components/motion';
import { PostCard } from '@/components/PostsBlock';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { colors, typography } from '@/theme/tokens';

/** Every «رسائل الإدارة» post, pinned first, then newest; older pages load on demand. M29: it is the member's inbox. */
export default function PostsScreen() {
  const query = usePosts();
  const { me } = useAuth();
  const router = useRouter();
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
      {me?.isAdmin ? <AppButton label={t('posts.compose')} icon="send" onPress={() => router.push('/posts/compose' as Href)} /> : null}
      {posts.length === 0 ? <Text style={styles.empty}>{t('posts.empty')}</Text> : null}
      {posts.map((post, index) => (
        <FadeInView key={post.id} delay={entranceDelay(index)}>
          <PostCard post={post} />
        </FadeInView>
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
