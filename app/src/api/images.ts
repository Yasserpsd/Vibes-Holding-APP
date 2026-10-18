import { useQuery } from '@tanstack/react-query';

import { apiGet } from './client';

// Mirrors server/src/content/images.ts banners (M81 extension): slot key → uploaded image url, filled slots only.
export type AppImages = Record<string, string>;

/** The owner-filled screen banners; public content, same for every viewer. */
export function useAppImages() {
  return useQuery({
    queryKey: ['images'],
    queryFn: () => apiGet<{ images: AppImages }>('/api/images'),
    staleTime: 5 * 60_000,
  });
}
