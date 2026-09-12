import { ScrollView, StyleSheet, View } from 'react-native';

import { useVideos } from '@/api/videos';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { VideoCard } from '@/components/VideoCard';
import { formatNumber } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { spacing } from '@/theme/tokens';

/** The club's YouTube library: curated picks first, then every upload, newest first. */
export default function VideosScreen() {
  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useVideos();
  const first = data?.pages[0];

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
              <VideoCard key={video.id} video={video} width={240} onPress={() => void openLink(video.url)} />
            ))}
          </ScrollView>
        </>
      ) : null}

      <SectionHeader title="كل الفيديوهات" subtitle={first.total ? `${formatNumber(first.total)} فيديو` : null} />
      {items.length ? (
        <View style={styles.list}>
          {items.map((video) => (
            <VideoCard key={video.id} video={video} onPress={() => void openLink(video.url)} />
          ))}
        </View>
      ) : (
        <StateView empty emptyText="لم تصل فيديوهات القناة بعد، حاول لاحقًا." />
      )}
      {hasNextPage ? <AppButton label={isFetchingNextPage ? 'جارٍ التحميل…' : 'تحميل المزيد'} variant="outline" icon="chevron-down" onPress={() => void fetchNextPage()} /> : null}
      <AppButton label="قناة النادي على يوتيوب" variant="outline" icon="logo-youtube" onPress={() => void openLink(first.channelUrl)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  list: { gap: spacing.md },
});
