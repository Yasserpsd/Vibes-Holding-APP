import { Image, StyleSheet } from 'react-native';

import { useAppImages } from '@/api/images';
import { FadeInView } from '@/components/motion';
import { colors, radii, shadows } from '@/theme/tokens';

/**
 * M81 extension: a wide banner the owner fills from the dashboard («صور التطبيق» → بانرات الشاشات).
 * Renders nothing while the slot is empty, so screens carry it at no cost until a photo exists.
 */
export function SlotBanner({ slot }: { slot: string }) {
  const url = useAppImages().data?.images[slot];
  if (!url) return null;
  return (
    <FadeInView offset={8}>
      <Image source={{ uri: url }} style={styles.banner} resizeMode="cover" accessibilityIgnoresInvertColors />
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    height: 150,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surfaceElevated,
    boxShadow: shadows.lift,
  },
});
