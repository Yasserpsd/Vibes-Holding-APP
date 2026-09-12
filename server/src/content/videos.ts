import type { KV } from '../store.js';

/** Video library page copy plus the curated picks shown first. Editable server content. */
export type FeaturedVideo = { id: string; label: string };

export type VideosContent = {
  title: string;
  intro: string;
  channelUrl: string;
  featuredTitle: string;
  featured: FeaturedVideo[];
  version: number;
  updatedAt: string;
};

export const VIDEOS_CONTENT_KEY = 'content:videos';

// Curated picks from docs/PROJECT_BRIEF.md section 5.4; the channel feed fills in the titles and the rest.
export const VIDEOS_SEED: VideosContent = {
  title: 'مكتبة الفيديو',
  intro: 'كل فيديوهات قناة نادي المستثمرين على يوتيوب: قصة النادي، الملتقيات، وشركات المنظومة.',
  channelUrl: 'https://www.youtube.com/@investorscl/videos',
  featuredTitle: 'ابدأ من هنا',
  featured: [
    { id: 'CnWMWS_nDpM', label: 'قصة نادي المستثمرين' },
    { id: 'KUzcLImZc-c', label: 'أكثر من 11,000 عضو' },
    { id: '3hvxhZL-gsM', label: 'كيف يعمل النادي' },
    { id: 'TzeJOrO4nMI', label: 'فئات النادي' },
    { id: 'ReJljicbEJc', label: 'ملتقى «5 دقائق»' },
    { id: 'xpxKMnj_Nzk', label: 'اصنع ملتقاك' },
    { id: 'vLI-G989nIk', label: 'تطبيق سكة' },
    { id: 'XERenNWNziA', label: 'جولة في مقر النادي' },
  ],
  version: 1,
  updatedAt: '2026-09-12T00:00:00.000Z',
};

export async function ensureVideosSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<VideosContent>(VIDEOS_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= VIDEOS_SEED.version) return false;
  await kv.set(VIDEOS_CONTENT_KEY, VIDEOS_SEED);
  return true;
}

export async function getVideosContent(kv: KV): Promise<VideosContent> {
  return (await kv.get<VideosContent>(VIDEOS_CONTENT_KEY)) ?? VIDEOS_SEED;
}
