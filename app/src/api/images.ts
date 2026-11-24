import { useQuery } from '@tanstack/react-query';

import { apiGet } from './client';

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

// One draw per app launch: every open starts each rotating set on a different picture, and the
// choice holds while the app stays open so nothing flickers between renders.
const LAUNCH_DRAW = Math.random();

/** M270 (owner: «صور طول الوقت متجددة»): where a set of `count` pictures starts on this launch. */
export function launchStart(count: number): number {
  return count > 0 ? Math.floor(LAUNCH_DRAW * count) % count : 0;
}
