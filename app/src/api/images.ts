import { useQuery } from '@tanstack/react-query';
import { Image } from 'react-native';

import { apiGet } from './client';
import { useHq } from './hq';

// Mirrors server/src/content/images.ts banners (M81 extension): slot key → uploaded image url, filled slots only.
export type AppImages = Record<string, string>;

/** M270: one of the home's moving banners — a finished picture and the screen it opens. */
export type HomeSlide = { url: string; route: string };

/**
 * M270: besides the screen banners, the server sends the home's moving banners and the photo sets
 * (`membership.photo`, `membership.slide`, `home.card.<service>`), already in this app's language.
 * An older server sends `images` alone, so both are optional.
 */
type ImagesResponse = { images: AppImages; slides?: HomeSlide[]; sets?: Record<string, string[]> };

/** The owner-filled screen banners; public content, same for every viewer. */
export function useAppImages() {
  return useQuery({
    queryKey: ['images'],
    queryFn: () => apiGet<ImagesResponse>('/api/images'),
    staleTime: 5 * 60_000,
  });
}

const NONE: string[] = [];

/**
 * Owner (2026-11-25, on a sign-in screen that showed no picture: «مش عايز مكان اقرع كده بدون صور لازم كله يكون في
 * صور»): two photographs ship inside the app as stand-ins, so a page is never bare while the server's sets are
 * still loading, are empty, or the phone is offline. The dashboard's pictures replace them as soon as they arrive.
 */
const bundled = (source: number): string[] => {
  const uri = Image.resolveAssetSource(source)?.uri;
  return uri ? [uri] : NONE;
};
/** The hall, wide — behind a page heading. */
export const PAGE_STANDIN = bundled(require('../../assets/images/photo-page.webp'));
/** The investor's seat, upright — behind the gate. */
export const GATE_STANDIN = bundled(require('../../assets/images/photo-gate.webp'));

/**
 * The same set, never empty: the bundled hall photograph stands in until the server's pictures arrive (owner, on a
 * home that drew its cards without pictures against an empty server: «فين الشكل اللي اتفقنا عليه»).
 */
export function usePhotoSetOrStandin(key: string): string[] {
  const own = usePhotoSet(key);
  return own.length ? own : PAGE_STANDIN;
}

/** M270: the pictures of one photo set in slot order; empty until the owner fills it (or on an older server). */
export function usePhotoSet(key: string): string[] {
  return useAppImages().data?.sets?.[key] ?? NONE;
}

/**
 * M270 (owner, 2026-11-25, on the gate's photograph: «عايز كله يكون كده… كل الصفحات تكون بنفس الأفكار»): the
 * pictures a page may open on — the dashboard set `page.photo`, then the membership photographs, then the HQ
 * gallery, and the bundled stand-in when the server has none of them (or has not answered yet).
 */
export function usePagePhotos(): string[] {
  const sets = useAppImages().data?.sets;
  const hq = useHq().data?.photos;
  const own = sets?.['page.photo'] ?? sets?.['membership.photo'];
  if (own?.length) return own;
  return hq?.length ? hq : PAGE_STANDIN;
}

/** The picture of ONE page: a different one per page (by its title), moved on at every launch. */
export function pagePhotoOf(photos: string[], title: string): string | null {
  if (!photos.length) return null;
  let sum = 0;
  for (let index = 0; index < title.length; index += 1) sum += title.charCodeAt(index);
  return photos[(sum + launchStart(photos.length)) % photos.length] ?? null;
}

// One draw per app launch: every open starts each rotating set on a different picture, and the
// choice holds while the app stays open so nothing flickers between renders.
const LAUNCH_DRAW = Math.random();

/** M270 (owner: «صور طول الوقت متجددة»): where a set of `count` pictures starts on this launch. */
export function launchStart(count: number): number {
  return count > 0 ? Math.floor(LAUNCH_DRAW * count) % count : 0;
}
