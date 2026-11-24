import { useEffect, useState } from 'react';
import { Image } from 'react-native';

import { launchStart, useAppImages, usePhotoSet } from '@/api/images';
import { FadeInView } from '@/components/motion';
import { RotatingBanner } from '@/components/RotatingBanner';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, radii, shadows } from '@/theme/tokens';

/** The height until the picture is measured (the banner's old fixed height). */
const DEFAULT_HEIGHT = 150;
/** M130b (owner: «متبقاش مقصوصة»): the box follows the photo's own shape within these bounds, like RotatingBanner. */
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 320;

/**
 * M81 extension: a wide banner the owner fills from the dashboard («صور التطبيق» → بانرات الشاشات).
 * Renders nothing while the slot is empty, so screens carry it at no cost until a photo exists.
 */
export function SlotBanner({ slot }: { slot: string }) {
  const uri = sized(useAppImages().data?.images[slot], 360);
  // The picture's natural shape sizes the box, so a wide visual with text or a logo shows WHOLE instead of
  // cover-cropped; a very tall photo is capped (it would swallow the page) and keeps the cover crop.
  const [width, setWidth] = useState(0);
  const [shape, setShape] = useState<{ uri: string; ratio: number } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (alive && w > 0 && h > 0) setShape({ uri, ratio: w / h });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  if (!uri) return null;
  const fitted = width > 0 && shape?.uri === uri ? width / shape.ratio : null;
  const height = fitted ? Math.round(Math.min(Math.max(fitted, MIN_HEIGHT), MAX_HEIGHT)) : DEFAULT_HEIGHT;
  return (
    <FadeInView offset={8}>
      <Image
        source={{ uri }}
        style={[styles.banner, { height }]}
        resizeMode="cover"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityIgnoresInvertColors
      />
    </FadeInView>
  );
}

/**
 * M270: a screen's own moving banner — the dashboard photo set `set`, opening on a different picture every
 * launch. While the set is empty (or on an older server) the screen's single banner slot stands in.
 */
export function SetBanner({ set, slot }: { set: string; slot: string }) {
  const urls = usePhotoSet(set);
  if (!urls.length) return <SlotBanner slot={slot} />;
  return (
    <FadeInView offset={8}>
      <RotatingBanner urls={urls} steady startAt={launchStart(urls.length)} style={styles.set} />
    </FadeInView>
  );
}

const styles = themedStyles(() => ({
  set: { boxShadow: shadows.lift },
  banner: {
    width: '100%',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surfaceElevated,
    boxShadow: shadows.lift,
  },
}));
