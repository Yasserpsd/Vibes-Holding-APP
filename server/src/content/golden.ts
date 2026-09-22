import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import { GOLDEN_EN } from './en/golden.js';

/** Golden projects portal: the umbrella plus ten companies. Editable server content. */
export type GoldenCompany = {
  code: string;
  name: string;
  tagline: string | null;
  valuationSarMillions: number | null;
  offerUrl: string;
  logoUrl: string;
  order: number;
};

export type GoldenContent = {
  title: string;
  intro: string;
  portfolioValueSarMillions: number;
  disclaimer: string;
  umbrella: GoldenCompany;
  companies: GoldenCompany[];
  updatedAt: string;
};

export const GOLDEN_CONTENT_KEY = 'content:golden';

const LOGO_BASE = 'https://vibesholding.com/wp-content/uploads/2026/08/';
const logo = (file: string): string => LOGO_BASE + encodeURIComponent(file);

const company = (
  code: string,
  name: string,
  valuationSarMillions: number | null,
  offerUrl: string,
  logoFile: string,
  order: number,
  tagline: string | null = null,
): GoldenCompany => ({ code, name, tagline, valuationSarMillions, offerUrl, logoUrl: logo(logoFile), order });

// Initial content from docs/PROJECT_BRIEF.md section 5.1. The dashboard edits it later.
export const GOLDEN_SEED: GoldenContent = {
  title: 'المشاريع الذهبية',
  intro: 'الشركات التي تحمل علامة V تحت مظلة فايبز القابضة.',
  portfolioValueSarMillions: 161,
  disclaimer: 'المعلومات تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد',
  umbrella: company('V', 'فايبز القابضة', null, 'https://vibesholding.com/offer/', 'فايبز-القابضة.png', 0),
  companies: [
    company('01', 'وديني', 31, 'https://wdeny.com/offer/', 'Wdeny-logo-png.webp', 1),
    company(
      '02',
      'شركة المجتمع الافتراضي',
      30,
      'https://vcmem.com/offer/',
      'لوجو-المجتمع-الافتراضي.png',
      2,
      'المشغّل الرسمي لنادي المستثمرين',
    ),
    company('03', 'PV لحاضنات ومسرعات الأعمال', 20, 'https://pvspaces.com/offer/', 'PV.png', 3),
    company('04', 'سكة', 15, 'https://sekaride.com/offer/', 'Seka.webp', 4),
    company('05', 'الملتقى', 15, 'https://almoltaqapodcast.com/offer/', 'Al-Moltaqa.webp', 5),
    company('06', 'القضمة السريعة', 10, 'https://qbarabia.com/offer/', 'القضمة-السريعة.png', 6),
    company('07', 'الصفقات السريعة للتجارة', 10, 'https://qdtco.com/offer/', 'الصفقات-السريعة-للتجارة.webp', 7),
    company('08', 'مومنتوم', 10, 'https://momentummix.com/offer', 'مومنتوم-scaled.png', 8),
    company('09', 'الصفقات السريعة للاستثمار', 10, 'https://qdealsi.com/', 'الصفقات-السريعة-للاستثمار.png', 9),
    company('10', 'تمكين الامتياز', 10, 'https://franchment.com/offer', 'تمكين-الامتياز.png', 10),
  ],
  updatedAt: '2026-09-11T00:00:00.000Z',
};

/** Writes the seed when no golden content exists yet. Returns true when it wrote. */
export async function ensureGoldenSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<GoldenContent>(GOLDEN_CONTENT_KEY);
  if (existing) return false;
  await kv.set(GOLDEN_CONTENT_KEY, GOLDEN_SEED);
  return true;
}

/** The block as the app of one language reads it: the stored Arabic block, the English translation for `en`, and the owner's edits (see edits.ts). */
export async function getGoldenContent(kv: KV, lang: AppLang = 'ar'): Promise<GoldenContent> {
  return localizeBlock(kv, 'golden', (await kv.get<GoldenContent>(GOLDEN_CONTENT_KEY)) ?? GOLDEN_SEED, GOLDEN_EN, lang);
}
