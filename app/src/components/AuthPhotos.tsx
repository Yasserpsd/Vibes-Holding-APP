import { View, useWindowDimensions } from 'react-native';

import { useHq } from '@/api/hq';
import { GATE_STANDIN, usePhotoSet } from '@/api/images';
import { FadingPhotos } from '@/components/FadingPhotos';
import { themedStyles } from '@/theme/styles';
import { colors } from '@/theme/tokens';

/**
 * M270 (owner, 2026-11-25: «وعايزين صور في صفحة الدخول برده كل شئ يكون في صور»): the pictures of the entry
 * screens — the dashboard set `auth.photo`, the HQ gallery while that set is empty, and the photograph bundled
 * in the app when the server has neither or has not answered yet: the gate is never bare.
 */
export function useAuthPhotos(): string[] {
  const own = usePhotoSet('auth.photo');
  const hq = useHq().data?.photos;
  if (own.length) return own;
  return hq?.length ? hq : GATE_STANDIN;
}

/** `#RRGGBB` with an alpha, for a fade that ends exactly on a theme colour. */
export function withAlpha(hex: string, alpha: number): string {
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
 *
 * `logoTop` / `logoHeight` (window points) say where the gate's logo sits. The quick-entry gate (M272) is taller than
 * the one the first fade was drawn for, so its logo climbed onto the clear part of the picture. The rule now, seen
 * right on the emulator: the picture fills whatever room is ABOVE the logo and melts behind the logo's upper half,
 * however tall the content is; until the gate has measured itself the first gate's share stands in.
 */
export function AuthHero({ photos, logoTop, logoHeight = 0 }: { photos: string[]; logoTop?: number; logoHeight?: number }) {
  const { height, width } = useWindowDimensions();
  // Measured: the picture ends behind the lower half of the logo. Not yet measured: the share the first gate used.
  const heroHeight = logoTop === undefined ? Math.round(height * HERO_SHARE) : Math.max(Math.round(height * 0.2), Math.round(logoTop + logoHeight * 0.62));
  const clearUntil = logoTop === undefined ? 0.42 : Math.min(0.9, Math.max(0.3, (logoTop - 16) / heroHeight));
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  // A light shade at the very top for the status bar, the picture clear down to the logo, then it melts into the screen.
  const fade = `linear-gradient(180deg, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0.06) ${percent(clearUntil * 0.6)}, ${withAlpha(colors.black, 0.1)} ${percent(clearUntil)}, ${withAlpha(colors.black, 0.86)} ${percent(clearUntil + (1 - clearUntil) * 0.66)}, ${colors.black} 100%)`;
  return (
    <View style={[styles.hero, { height: heroHeight }]} pointerEvents="none">
      <FadingPhotos urls={photos} points={width} />
      <View style={[styles.fill, { experimental_backgroundImage: fade }]} />
    </View>
  );
}

const styles = themedStyles(() => ({
  hero: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.black },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
}));
