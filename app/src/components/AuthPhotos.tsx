import { View, useWindowDimensions } from 'react-native';

import { useHq } from '@/api/hq';
import { usePhotoSet } from '@/api/images';
import { FadingPhotos } from '@/components/FadingPhotos';
import { themedStyles } from '@/theme/styles';
import { colors } from '@/theme/tokens';

/**
 * M270 (owner, 2026-11-25: «وعايزين صور في صفحة الدخول برده كل شئ يكون في صور»): the pictures of the entry
 * screens — the dashboard set `auth.photo`, or the HQ gallery while that set is empty. Empty on a server with
 * neither, and the screens then keep their plain look.
 */
export function useAuthPhotos(): string[] {
  const own = usePhotoSet('auth.photo');
  const hq = useHq().data?.photos;
  return own.length ? own : (hq ?? []);
}

/** `#RRGGBB` with an alpha, for a fade that ends exactly on a theme colour. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const part = (at: number) => parseInt(value.slice(at, at + 2), 16);
  return `rgba(${part(0)}, ${part(2)}, ${part(4)}, ${alpha})`;
}

/** How much of the window the gate's photograph takes, from the top edge down. */
const HERO_SHARE = 0.56;

/**
 * The gate's photograph: it fills the top of the screen edge to edge, changes on its own, and melts into the
 * screen's own background before the buttons start — so the words under it stay on the theme's colours and read
 * the same in the dark and the light theme. Absolutely placed: the gate lays its content over it.
 */
export function AuthHero({ photos }: { photos: string[] }) {
  const { height, width } = useWindowDimensions();
  return (
    <View style={[styles.hero, { height: Math.round(height * HERO_SHARE) }]} pointerEvents="none">
      <FadingPhotos urls={photos} points={width} />
      <View style={[styles.fill, { experimental_backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0.06) 26%, ${withAlpha(colors.black, 0)} 42%, ${withAlpha(colors.black, 0.86)} 80%, ${colors.black} 100%)` }]} />
    </View>
  );
}

const styles = themedStyles(() => ({
  hero: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.black },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
}));
