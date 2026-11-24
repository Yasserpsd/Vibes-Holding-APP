import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { getServicesContent } from './services.js';

/**
 * M81 «صور التطبيق»: the owner's REAL imagery, employed in context — HQ photos on the HQ screen,
 * the studio photos on the podcast service, and so on. The slots are code-defined (like the values
 * editor's rule: adding rows stays code-side); the owner fills each slot from the dashboard with an
 * upload, and the app receives the urls inside the content it already reads (hq photos, service
 * images). Nothing is bundled in the binary; everything stays server-driven.
 *
 * M270 (owner, 2026-11-25: «عايزك تزود اوي الصور… وزعها علي كامل التطبيق… صور طول الوقت متجددة… وشوية ونضيف
 * صور جديدة» + «يبقي كله انجليزي في النسخة الانجليزي»): three more families of slots — the home's moving
 * banners, the membership's banner and benefit photos, the photo of each home door card — and an ENGLISH
 * picture beside every slot that carries lettering. The English app reads the English picture where one
 * was uploaded and the slot's own picture otherwise, so a photo with no words is uploaded once.
 */
export type ImageSlot = {
  key: string;
  label: string;
  group: string;
  url: string | null;
  /** M270: the same slot's picture for the English app (null = the English app shows `url`). */
  urlEn: string | null;
  /** M270: the slot's pictures usually carry words, so the dashboard offers the English upload beside it. */
  bilingual: boolean;
};

export const IMAGES_KEY = 'content:images';

/**
 * The HQ gallery: up to this many photos, shown in slot order on the HQ screen.
 * M270 (owner, 2026-11-25: «استخدم كله… استخدم اكبر كمية ممكنة»): twelve, so the new hall photographs join his own six.
 */
const HQ_SLOTS = 12;

/**
 * M105 (owner, 2026-10-19): every service page carries an auto-rotating banner — up to this many photos.
 * M270: twelve (it was six), so new posters are ADDED to a service whose six were already his.
 */
const SERVICE_SLOTS = 12;

/** One document: `<slot>` → the picture, `en:<slot>` → the English app's picture of the same slot. */
type StoredImages = Record<string, string>;
const EN = 'en:';

const stored = async (kv: KV): Promise<StoredImages> => (await kv.get<StoredImages>(IMAGES_KEY)) ?? {};

/** What one language's app sees: every slot's own picture, and for English its English picture on top. */
function seenIn(saved: StoredImages, lang: AppLang): StoredImages {
  const view: StoredImages = {};
  for (const [key, url] of Object.entries(saved)) if (!key.startsWith(EN)) view[key] = url;
  if (lang === 'en') for (const [key, url] of Object.entries(saved)) if (key.startsWith(EN)) view[key.slice(EN.length)] = url;
  return view;
}

const hqKeys = (): string[] => Array.from({ length: HQ_SLOTS }, (_, index) => `hq.${index + 1}`);

/** M121: the owner's photo on the premium «فرصة Vibes Ventures» home card — the golden emblem wash stands in while empty. */
const OPPORTUNITY_SLOT = { key: 'golden.opportunity', label: 'صورة فرصة Vibes Ventures', group: 'الفرصة الذهبية (كارت الرئيسية)' };

/** Screen banners (M81 extension, owner 2026-10-18): a wide image slot per key screen — shown only when filled. */
const BANNER_SLOTS: { key: string; label: string }[] = [
  { key: 'home.banner', label: 'بانر الرئيسية (تحت المقدمة)' },
  { key: 'golden.banner', label: 'بانر الشركات الذهبية' },
  { key: 'membership.banner', label: 'بانر العضوية' },
  { key: 'about.banner', label: 'بانر عن النادي' },
  // M270: the meetups and the agenda screens open on a picture too.
  { key: 'meetups.banner', label: 'بانر الملتقيات' },
  { key: 'agenda.banner', label: 'بانر أجندة النادي' },
];

/**
 * M270: the home's moving banners. A banner is a finished advertisement that opens a screen, so each slot is
 * named by the screen it opens — the owner drops a picture in «يفتح العضوية» and the tap is already right,
 * with no link to type. The app plays the filled slots round-robin (the first of each door, then the second…).
 */
const SLIDE_DOORS: { key: string; label: string; route: string; slots: number }[] = [
  { key: 'membership', label: 'يفتح العضوية', route: '/membership', slots: 3 },
  { key: 'partners', label: 'يفتح شركاء النجاح', route: '/service/success-partners', slots: 2 },
  { key: 'meetups', label: 'يفتح الملتقيات', route: '/meetups', slots: 2 },
  { key: 'agenda', label: 'يفتح أجندة النادي', route: '/agenda', slots: 2 },
  { key: 'services', label: 'يفتح خدمات النادي', route: '/services', slots: 2 },
  { key: 'hq', label: 'يفتح مقر النادي', route: '/hq', slots: 2 },
];
const SLIDE_GROUP = 'بنرات الرئيسية المتحركة (كل خانة تفتح شاشتها)';

/** M270: photo sets the app reads whole, in slot order — `<set>.<n>`. */
const PHOTO_SETS: { key: string; label: string; group: string; slots: number; bilingual: boolean }[] = [
  { key: 'membership.slide', label: 'بانر العضوية المتحرك', group: 'العضوية (بانر متحرك أعلى صفحة العضوية)', slots: 4, bilingual: true },
  { key: 'membership.photo', label: 'صورة مزايا العضوية', group: 'مزايا العضوية (صورة أعلى كل كارت في الرئيسية)', slots: 8, bilingual: false },
  { key: 'home.card.success-partners', label: 'كارت شركاء النجاح', group: 'كروت الرئيسية (صورة الكارت)', slots: 4, bilingual: false },
  { key: 'home.card.app-publish', label: 'كارت انشر تطبيقك', group: 'كروت الرئيسية (صورة الكارت)', slots: 2, bilingual: false },
  // Owner (2026-11-25: «وعايزين صور في صفحة الدخول برده»): the gate's photograph and the strip over the sign-in form.
  { key: 'auth.photo', label: 'صورة شاشات الدخول', group: 'شاشات الدخول (أعلى شاشة البداية وتسجيل الدخول)', slots: 6, bilingual: false },
];

export type HomeSlide = { url: string; route: string };
export type AppImages = { images: Record<string, string>; slides: HomeSlide[]; sets: Record<string, string[]> };

/** The catalog the dashboard shows: every slot, labeled in the owner's words, filled or empty. */
export async function imageSlots(kv: KV): Promise<ImageSlot[]> {
  const [saved, services] = await Promise.all([stored(kv), getServicesContent(kv)]);
  const slots: ImageSlot[] = [];
  const add = (key: string, label: string, group: string, bilingual: boolean) =>
    slots.push({ key, label, group, url: saved[key] ?? null, urlEn: saved[EN + key] ?? null, bilingual });

  hqKeys().forEach((key, index) => add(key, `صورة المقر ${index + 1}`, 'مقر النادي (معرض الصور)', false));
  for (const door of SLIDE_DOORS) {
    for (let index = 1; index <= door.slots; index += 1) add(`home.slide.${door.key}.${index}`, `بنر ${door.label} — ${index}`, SLIDE_GROUP, true);
  }
  for (const set of PHOTO_SETS) {
    for (let index = 1; index <= set.slots; index += 1) add(`${set.key}.${index}`, `${set.label} — ${index}`, set.group, set.bilingual);
  }
  for (const service of [...services.services].sort((a, b) => a.order - b.order)) {
    // M105: slot 1 keeps its historic key (older uploads stay); slots 2..N extend the rotating banner.
    for (let index = 1; index <= SERVICE_SLOTS; index += 1) {
      const key = index === 1 ? `service.${service.key}` : `service.${service.key}.${index}`;
      add(key, index === 1 ? service.title : `${service.title} — صورة ${index}`, 'الخدمات (بانر متحرك أعلى صفحة الخدمة)', true);
    }
  }
  for (const banner of BANNER_SLOTS) add(banner.key, banner.label, 'بانرات الشاشات (تظهر فقط عند رفع صورة)', true);
  add(OPPORTUNITY_SLOT.key, OPPORTUNITY_SLOT.label, OPPORTUNITY_SLOT.group, false);
  return slots;
}

/** M121: the premium opportunity card's photo, or null while the owner has not filled the slot. */
export async function opportunityImage(kv: KV): Promise<string | null> {
  const saved = await stored(kv);
  return saved[OPPORTUNITY_SLOT.key] ?? null;
}

/** The filled screen banners, key → url, in the asking app's language. */
export async function bannerImages(kv: KV, lang: AppLang = 'ar'): Promise<Record<string, string>> {
  return (await appImages(kv, lang)).images;
}

/**
 * Everything `GET /api/images` serves, from one read: the screen banners, the home's moving banners with the
 * screen each opens, and the photo sets — filled slots only, in the asking app's language.
 */
export async function appImages(kv: KV, lang: AppLang = 'ar'): Promise<AppImages> {
  const seen = seenIn(await stored(kv), lang);
  const images: Record<string, string> = {};
  for (const banner of BANNER_SLOTS) {
    const url = seen[banner.key];
    if (url) images[banner.key] = url;
  }
  const slides: HomeSlide[] = [];
  const rounds = Math.max(...SLIDE_DOORS.map((door) => door.slots));
  for (let index = 1; index <= rounds; index += 1) {
    for (const door of SLIDE_DOORS) {
      const url = index <= door.slots ? seen[`home.slide.${door.key}.${index}`] : undefined;
      if (url) slides.push({ url, route: door.route });
    }
  }
  const sets: Record<string, string[]> = {};
  for (const set of PHOTO_SETS) {
    const urls: string[] = [];
    for (let index = 1; index <= set.slots; index += 1) {
      const url = seen[`${set.key}.${index}`];
      if (url) urls.push(url);
    }
    if (urls.length) sets[set.key] = urls;
  }
  return { images, slides, sets };
}

/** Saves one slot (`url: null` clears it) — its own picture, or with `lang: 'en'` its English one. Refuses a key outside the catalog. */
export async function saveImage(kv: KV, key: string, url: string | null, lang: AppLang = 'ar'): Promise<ImageSlot | null> {
  const slots = await imageSlots(kv);
  const slot = slots.find((entry) => entry.key === key);
  if (!slot) return null;
  const saved = await stored(kv);
  const field = lang === 'en' ? EN + key : key;
  if (url) saved[field] = url;
  else delete saved[field];
  await kv.set(IMAGES_KEY, saved);
  return lang === 'en' ? { ...slot, urlEn: url } : { ...slot, url };
}

/** The HQ gallery in slot order — only the filled slots. */
export async function hqPhotos(kv: KV): Promise<string[]> {
  const saved = await stored(kv);
  return hqKeys()
    .map((key) => saved[key])
    .filter((url): url is string => Boolean(url));
}

/** service key → uploaded image url (the banner's FIRST photo), for overlaying onto the public services. */
export async function serviceImages(kv: KV, lang: AppLang = 'ar'): Promise<Record<string, string>> {
  const galleries = await serviceGalleries(kv, lang);
  const byService: Record<string, string> = {};
  for (const [key, urls] of Object.entries(galleries)) {
    const first = urls[0];
    if (first) byService[key] = first;
  }
  return byService;
}

/** M105: service key → every uploaded banner photo in slot order (filled slots only), in the asking app's language. */
export async function serviceGalleries(kv: KV, lang: AppLang = 'ar'): Promise<Record<string, string[]>> {
  const seen = seenIn(await stored(kv), lang);
  const byService: Record<string, string[]> = {};
  for (const [key, url] of Object.entries(seen)) {
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
