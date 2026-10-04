import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useVideos, type Video } from '@/api/videos';
import { useAdvisorScreen, useAskAdvisor } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { VideoCard } from '@/components/VideoCard';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { playVideo } from '@/lib/player';
import { spacing } from '@/theme/tokens';

// The featured strip's card width; the snap interval adds the gap so every swipe lands on a card.
const STRIP_CARD_WIDTH = 240;

/** The club's YouTube library: curated picks first, then every upload, newest first; videos play in-app (M19). */
export default function VideosScreen() {
  const router = useRouter();
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            snapToInterval={STRIP_CARD_WIDTH + spacing.sm}
            decelerationRate="fast"
          >
            {first.featured.map((video, index) => (
              <FadeInView key={video.id} delay={entranceDelay(index, 80)}>
                <VideoCard video={video} width={STRIP_CARD_WIDTH} onPress={() => playVideo(router, { url: video.url, title: video.title, poster: video.thumbnail })} onAsk={() => askAbout(video)} />
              </FadeInView>
            ))}
          </ScrollView>
        </>
      ) : null}

      <SectionHeader title={t('videos.all')} subtitle={first.total ? t('videos.count', { count: formatNumber(first.total) }) : null} />
      {items.length ? (
        <View style={styles.list}>
          {items.map((video, index) => (
            <FadeInView key={video.id} delay={entranceDelay(index)}>
              <VideoCard video={video} onPress={() => playVideo(router, { url: video.url, title: video.title, poster: video.thumbnail })} onAsk={() => askAbout(video)} />
            </FadeInView>
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
