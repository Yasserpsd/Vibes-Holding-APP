import { ScrollView, StyleSheet, View } from 'react-native';

import { useVideos, type Video } from '@/api/videos';
import { useAdvisorScreen, useAskAdvisor } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { VideoCard } from '@/components/VideoCard';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { spacing } from '@/theme/tokens';

/** The club's YouTube library: curated picks first, then every upload, newest first. */
export default function VideosScreen() {
  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useVideos();
  const first = data?.pages[0];
  const askAdvisor = useAskAdvisor();
  // The floating button asks about the library; each card asks about its own video.
  useAdvisorScreen({ type: 'screen', id: 'videos', title: first?.title ?? t('nav.videos') });
  const askAbout = (video: Video) => askAdvisor({ type: 'video', id: video.id, title: video.title });

  if (!first) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const items = data.pages.flatMap((page) => page.items);

  return (
    <Screen title={first.title} subtitle={first.intro}>
      {first.featured.length ? (
        <>
          <SectionHeader title={first.featuredTitle} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {first.featured.map((video) => (
              <VideoCard key={video.id} video={video} width={240} onPress={() => void openLink(video.url)} onAsk={() => askAbout(video)} />
            ))}
          </ScrollView>
        </>
      ) : null}

      <SectionHeader title={t('videos.all')} subtitle={first.total ? t('videos.count', { count: formatNumber(first.total) }) : null} />
      {items.length ? (
        <View style={styles.list}>
          {items.map((video) => (
            <VideoCard key={video.id} video={video} onPress={() => void openLink(video.url)} onAsk={() => askAbout(video)} />
          ))}
        </View>
      ) : (
        <StateView empty emptyText={t('videos.empty')} />
      )}
      {hasNextPage ? <AppButton label={isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')} variant="outline" icon="chevron-down" onPress={() => void fetchNextPage()} /> : null}
      <AppButton label={t('videos.channel')} variant="outline" icon="logo-youtube" onPress={() => void openLink(first.channelUrl)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  list: { gap: spacing.md },
});
