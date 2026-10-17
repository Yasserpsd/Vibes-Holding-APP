import type { KV } from '../store.js';
import { getServicesContent } from './services.js';

/**
 * M81 «صور التطبيق»: the owner's REAL imagery, employed in context — HQ photos on the HQ screen,
 * the studio photos on the podcast service, and so on. The slots are code-defined (like the values
 * editor's rule: adding rows stays code-side); the owner fills each slot from the dashboard with an
 * upload, and the app receives the urls inside the content it already reads (hq photos, service
 * images). Nothing is bundled in the binary; everything stays server-driven.
 */
export type ImageSlot = { key: string; label: string; group: string; url: string | null };

export const IMAGES_KEY = 'content:images';

/** The HQ gallery: up to this many photos, shown in slot order on the HQ screen. */
const HQ_SLOTS = 6;

type StoredImages = Record<string, string>;

const stored = async (kv: KV): Promise<StoredImages> => (await kv.get<StoredImages>(IMAGES_KEY)) ?? {};

const hqKeys = (): string[] => Array.from({ length: HQ_SLOTS }, (_, index) => `hq.${index + 1}`);

/** The catalog the dashboard shows: every slot, labeled in the owner's words, filled or empty. */
export async function imageSlots(kv: KV): Promise<ImageSlot[]> {
  const [saved, services] = await Promise.all([stored(kv), getServicesContent(kv)]);
  const slots: ImageSlot[] = hqKeys().map((key, index) => ({
    key,
    label: `صورة المقر ${index + 1}`,
    group: 'مقر النادي (معرض الصور)',
    url: saved[key] ?? null,
  }));
  for (const service of [...services.services].sort((a, b) => a.order - b.order)) {
    const key = `service.${service.key}`;
    slots.push({ key, label: service.title, group: 'الخدمات (صورة أعلى صفحة الخدمة)', url: saved[key] ?? null });
  }
  return slots;
}

/** Saves one slot (`url: null` clears it). Refuses a key outside the catalog. */
export async function saveImage(kv: KV, key: string, url: string | null): Promise<ImageSlot | null> {
  const slots = await imageSlots(kv);
  const slot = slots.find((entry) => entry.key === key);
  if (!slot) return null;
  const saved = await stored(kv);
  if (url) saved[key] = url;
  else delete saved[key];
  await kv.set(IMAGES_KEY, saved);
  return { ...slot, url };
}

/** The HQ gallery in slot order — only the filled slots. */
export async function hqPhotos(kv: KV): Promise<string[]> {
  const saved = await stored(kv);
  return hqKeys()
    .map((key) => saved[key])
    .filter((url): url is string => Boolean(url));
}

/** service key → uploaded image url, for overlaying onto the public services. */
export async function serviceImages(kv: KV): Promise<Record<string, string>> {
  const saved = await stored(kv);
  const byService: Record<string, string> = {};
  for (const [key, url] of Object.entries(saved)) {
    if (key.startsWith('service.')) byService[key.slice('service.'.length)] = url;
  }
  return byService;
}
