import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, View } from 'react-native';

import { useHq } from '@/api/hq';
import { HqHoursCard } from '@/components/HqHoursCard';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, radii, shadows, spacing } from '@/theme/tokens';

const PHOTO_WIDTH = 240;
const PHOTO_HEIGHT = 140;

/**
 * «جولة في النادي» (owner, 2026-10-18, in the golden block's old spot): the REAL HQ photos the owner
 * uploads into the M81 slots, as a wide cinematic strip that opens the HQ screen. Renders nothing
 * until at least one photo is filled, so the home loses nothing on an empty dashboard.
 * Owner's TestFlight pass (2026-11-22: «يكون في زي شكل المكاتب والمكان ويكون مكتوب ان ليك حجز 24 ساعة ويكون تحت»):
 * the booking-hours card left the top of the home and sits HERE, under the pictures of the offices — the place
 * first, then what the membership gives in it. Without photos the card still shows on its own.
 */
export function ClubTourStrip() {
  const router = useRouter();
  const { data } = useHq();
  const photos = data?.photos ?? [];
  const hours = (data?.content.walletHours ?? 0) > 0;
  if (photos.length === 0) return hours ? <HqHoursCard compact /> : null;
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
              <Image source={{ uri: sized(url, PHOTO_WIDTH) }} style={styles.photo} resizeMode="cover" resizeMethod="resize" />
            </PressScale>
          </FadeInView>
        ))}
      </ScrollView>
      {hours ? (
        <View style={styles.hours}>
          <HqHoursCard compact />
        </View>
      ) : null}
    </FadeInView>
  );
}

const styles = themedStyles(() => ({
  // The same distance under the section's description as every other home strip (emulator review item 25).
  strip: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  hours: { marginTop: spacing.sm },
  photo: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surfaceElevated,
    boxShadow: shadows.lift,
  },
}));
