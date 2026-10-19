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

/** M105 (owner, 2026-10-19): every service page carries an auto-rotating banner — up to this many photos. */
const SERVICE_SLOTS = 6;

type StoredImages = Record<string, string>;

const stored = async (kv: KV): Promise<StoredImages> => (await kv.get<StoredImages>(IMAGES_KEY)) ?? {};

const hqKeys = (): string[] => Array.from({ length: HQ_SLOTS }, (_, index) => `hq.${index + 1}`);

/** Screen banners (M81 extension, owner 2026-10-18): a wide image slot per key screen — shown only when filled. */
const BANNER_SLOTS: { key: string; label: string }[] = [
  { key: 'home.banner', label: 'بانر الرئيسية (تحت المقدمة)' },
  { key: 'golden.banner', label: 'بانر الشركات الذهبية' },
  { key: 'membership.banner', label: 'بانر العضوية' },
  { key: 'about.banner', label: 'بانر عن النادي' },
];

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
    // M105: slot 1 keeps its historic key (older uploads stay); slots 2..N extend the rotating banner.
    for (let index = 1; index <= SERVICE_SLOTS; index += 1) {
      const key = index === 1 ? `service.${service.key}` : `service.${service.key}.${index}`;
      slots.push({
        key,
        label: index === 1 ? service.title : `${service.title} — صورة ${index}`,
        group: 'الخدمات (بانر متحرك أعلى صفحة الخدمة)',
        url: saved[key] ?? null,
      });
    }
  }
  for (const banner of BANNER_SLOTS) {
    slots.push({ ...banner, group: 'بانرات الشاشات (تظهر فقط عند رفع صورة)', url: saved[banner.key] ?? null });
  }
  return slots;
}

/** The filled screen banners, key → url, served publicly at `GET /api/images`. */
export async function bannerImages(kv: KV): Promise<Record<string, string>> {
  const saved = await stored(kv);
  const banners: Record<string, string> = {};
  for (const banner of BANNER_SLOTS) {
    const url = saved[banner.key];
    if (url) banners[banner.key] = url;
  }
  return banners;
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

/** service key → uploaded image url (the banner's FIRST photo), for overlaying onto the public services. */
export async function serviceImages(kv: KV): Promise<Record<string, string>> {
  const galleries = await serviceGalleries(kv);
  const byService: Record<string, string> = {};
  for (const [key, urls] of Object.entries(galleries)) {
    const first = urls[0];
    if (first) byService[key] = first;
  }
  return byService;
}

/** M105: service key → every uploaded banner photo in slot order (filled slots only). */
export async function serviceGalleries(kv: KV): Promise<Record<string, string[]>> {
  const saved = await stored(kv);
  const byService: Record<string, string[]> = {};
  for (const [key, url] of Object.entries(saved)) {
    if (!key.startsWith('service.')) continue;
    const rest = key.slice('service.'.length);
    const match = /^(.+?)\.(\d+)$/.exec(rest);
    const service = match ? (match[1] as string) : rest;
    const order = match ? Number(match[2]) : 1;
    (byService[service] ??= []).push(`${String(order).padStart(2, '0')}:${url}`);
  }
  const out: Record<string, string[]> = {};
  for (const [service, tagged] of Object.entries(byService)) {
    out[service] = tagged.sort().map((entry) => entry.slice(entry.indexOf(':') + 1));
  }
  return out;
}
