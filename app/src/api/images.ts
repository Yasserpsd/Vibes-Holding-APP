import { useQuery } from '@tanstack/react-query';

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

/** M270: the pictures of one photo set in slot order; empty until the owner fills it (or on an older server). */
export function usePhotoSet(key: string): string[] {
  return useAppImages().data?.sets?.[key] ?? NONE;
}

/**
 * M270 (owner, 2026-11-25, on the gate's photograph: «عايز كله يكون كده… كل الصفحات تكون بنفس الأفكار»): the
 * pictures a page may open on — the dashboard set `page.photo`, then the membership photographs, then the HQ
 * gallery. Empty on a server with none, and the pages keep their plain heading.
 */
export function usePagePhotos(): string[] {
  const sets = useAppImages().data?.sets;
  const hq = useHq().data?.photos;
  const own = sets?.['page.photo'] ?? sets?.['membership.photo'];
  return own?.length ? own : (hq ?? NONE);
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
