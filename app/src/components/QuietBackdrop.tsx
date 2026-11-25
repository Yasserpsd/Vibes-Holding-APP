import { usePathname } from 'expo-router';
import { Image, View, useWindowDimensions } from 'react-native';

import { pagePhotoOf, usePagePhotos } from '@/api/images';
import { withAlpha } from '@/components/AuthPhotos';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors } from '@/theme/tokens';

/**
 * M277 (owner, 2026-11-25, on the account page: «في الخلفية يكون في صور… هادية خالص مش مزعجة»; «راجع لو في اي مكان او
 * اي سيكشن بدون صور ظبطها»): the photograph behind a page that has no photo heading of its own. One club picture
 * (each page its own, by its path) under the top half of the screen, dimmed until it is only a mood, and melted into
 * the page's background — the words above it stay on the theme's colours in the dark and the light theme alike.
 * Absolutely placed and never touchable: the page lays its content over it.
 */
export function QuietBackdrop({ pageKey }: { pageKey?: string }) {
  const photos = usePagePhotos();
  const pathname = usePathname();
  const { height } = useWindowDimensions();
  const photo = pagePhotoOf(photos, pageKey ?? pathname);
  if (!photo) return null;
  const fade = `linear-gradient(180deg, ${withAlpha(colors.black, 0.74)} 0%, ${withAlpha(colors.black, 0.82)} 45%, ${withAlpha(colors.black, 0.95)} 78%, ${colors.black} 100%)`;
  return (
    <View style={[styles.wrap, { height: Math.round(height * 0.5) }]} pointerEvents="none">
      <Image source={{ uri: sized(photo, 400) }} style={styles.fill} resizeMode="cover" resizeMethod="resize" accessibilityIgnoresInvertColors />
      <View style={[styles.fill, { experimental_backgroundImage: fade }]} />
    </View>
  );
}

const styles = themedStyles(() => ({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.black },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
}));
