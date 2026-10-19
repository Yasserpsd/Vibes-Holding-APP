import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet } from 'react-native';

import { useHq } from '@/api/hq';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { colors, radii, shadows, spacing } from '@/theme/tokens';

const PHOTO_WIDTH = 240;
const PHOTO_HEIGHT = 140;

/**
 * «جولة في النادي» (owner, 2026-10-18, in the golden block's old spot): the REAL HQ photos the owner
 * uploads into the M81 slots, as a wide cinematic strip that opens the HQ screen. Renders nothing
 * until at least one photo is filled, so the home loses nothing on an empty dashboard.
 */
export function ClubTourStrip() {
  const router = useRouter();
  const photos = useHq().data?.photos ?? [];
  if (photos.length === 0) return null;
  const open = () => router.push('/hq' as Href);
  return (
    <FadeInView delay={220}>
      <SectionHeader icon="business-outline" title={t('home.tourTitle')} subtitle={t('home.tourSubtitle')} cta={t('home.tourCta')} onPress={open} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        snapToInterval={PHOTO_WIDTH + spacing.sm}
        decelerationRate="fast"
      >
        {photos.map((url, index) => (
          <FadeInView key={url} delay={entranceDelay(index)}>
            <PressScale onPress={open} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={t('home.tourTitle')}>
              <Image source={{ uri: url }} style={styles.photo} resizeMode="cover" />
            </PressScale>
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  photo: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surfaceElevated,
    boxShadow: shadows.lift,
  },
});
