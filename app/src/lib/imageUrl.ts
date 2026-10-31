import { PixelRatio } from 'react-native';

/** The widths the server encodes (server/src/media/images.ts); anything else is rounded up to one of them. */
const WIDTHS = [160, 320, 480, 640, 960] as const;

/**
 * M169: a picture of ours (`/media/posts/…`) is asked for at the width it is drawn — the server answers a
 * small WebP cached for a year instead of the uploaded original. `points` is the drawn width in layout points;
 * the device's pixel density is applied here and capped at 960 px (the owner prefers tiny over pristine).
 * Any other URL (YouTube thumbnails, Projects Bank pictures, partner logos) passes through untouched.
 */
export function sized(uri: string, points: number): string;
export function sized(uri: string | null | undefined, points: number): string | undefined;
export function sized(uri: string | null | undefined, points: number): string | undefined {
  if (!uri) return undefined;
  if (!uri.includes('/media/posts/') || uri.includes('?')) return uri;
  const pixels = Math.max(1, points) * PixelRatio.get();
  const width = WIDTHS.find((candidate) => candidate >= pixels) ?? 960;
  return `${uri}?w=${width}`;
}
