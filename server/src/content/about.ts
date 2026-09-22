import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import { ABOUT_EN } from './en/about.js';

/** «عنّا»: the club, the operator and the فايبز القابضة ecosystem. Editable server content. */
export type AboutSection = {
  key: string;
  title: string;
  paragraphs: string[];
  bullets: string[];
  /** Optional web page opened in the in-app browser. */
  url: string | null;
  urlLabel: string | null;
  logoUrl: string | null;
};

export type AboutContent = {
  title: string;
  intro: string;
  logoUrl: string;
  sections: AboutSection[];
  ecosystem: { title: string; intro: string; companies: { name: string; role: string; url: string }[] };
  contact: { title: string; management: string; studio: string; email: string; websites: { label: string; url: string }[] };
  legal: { operator: string; cr: string; vat: string; address: string; trademark: string };
  version: number;
  updatedAt: string;
};

export const ABOUT_CONTENT_KEY = 'content:about';

// Written from the official sites (vcmem.com and vibesholding.com) on 2026-09-12 and from
// docs/PROJECT_BRIEF.md section 1. No membership prices, no promised returns. The dashboard edits it later.
export const ABOUT_SEED: AboutContent = {
  title: 'عنّا',
  intro: 'نادي المستثمرين مجتمعٌ راقٍ يؤمن بأن الفكر ثروة: يجمع المستثمرين ورواد الأعمال لبناء علاقات وشراكات عبر ملتقيات دورية في الرياض وعبر الإنترنت.',
  logoUrl: 'https://vcmem.com/wp-content/uploads/2025/11/لوجو-نادي-المستثمرين-جوولد-شفاف.png',
  sections: [
    {
      key: 'club',
      title: 'نادي المستثمرين',
      paragraphs: [
        'نادي المستثمرين® علامة تجارية مملوكة لفايبز القابضة، ويضم أكثر من 11,000 عضو من المستثمرين ورواد الأعمال والمهتمين بعالم الأعمال في المملكة.',
        'يجمع النادي ثلاث فئات: المستثمرون الباحثون عن فرص شراكة واعدة، ورواد الأعمال أصحاب المشاريع المميزة، والأعضاء المحايدون الذين يتابعون الفرص ويحددون توجههم لاحقًا.',
        'عضوية سنوية واحدة هي المسار الوحيد للانضمام إلى النادي، وتفتح لصاحبها كل مزايا النادي لعام كامل.',
      ],
      bullets: [],
      url: 'https://vcmem.com/',
      urlLabel: 'موقع النادي',
      logoUrl: null,
    },
    {
      key: 'how',
      title: 'كيف يعمل النادي',
      paragraphs: ['مسار المشاريع في النادي ثلاثي: التأهيل، ثم العرض على المستثمرين، ثم اللقاء المباشر.'],
      bullets: [
        'شركاء النجاح: يبدأ المشروع بالتسجيل، وتراجعه لجنة متخصصة قبل اعتماده.',
        'بنك المشاريع: المشاريع المعتمدة تُعرض على المستثمرين، مع إمكانية التواصل المباشر مع المؤسسين للأعضاء.',
        'ملتقى «5 دقائق»: عرض المشروع أمام المستثمرين مباشرة في ملتقيات النادي، حضوريًا في الرياض أو عبر الإنترنت.',
        'مقر النادي في الرياض: مكاتب، مسرح، قاعة اجتماعات وكوفي شوب، والدخول للأعضاء المشتركين بالحجز المسبق.',
      ],
      url: null,
      urlLabel: null,
      logoUrl: null,
    },
    {
      key: 'operator',
      title: 'شركة المجتمع الافتراضي للاستثمار',
      paragraphs: [
        'المشغّل الرسمي لنادي المستثمرين وناشر هذا التطبيق. شركة سعودية مقرها الرياض، حي العليا، وتعمل بترخيص من الجهات المختصة في المملكة.',
        'تدير الشركة منصة النادي وملتقياته وحساب العضو الموحّد الذي يعمل على كل مواقع المنظومة وفي التطبيق.',
      ],
      bullets: [],
      url: 'https://vcmem.com/',
      urlLabel: 'vcmem.com',
      logoUrl: 'https://vibesholding.com/wp-content/uploads/2026/08/لوجو-المجتمع-الافتراضي.png',
    },
    {
      key: 'vibes',
      title: 'فايبز القابضة',
      paragraphs: [
        'شركة ذبذبات للاستثمار القابضة (فايبز القابضة) هي الشركة الأم للمنظومة ومالكة علامة نادي المستثمرين®. تأسست في صيف 2022 برؤية غير تقليدية، وبنت نموذج عمل تشاركيًا يجمع بين الشركة وأعضاء النادي.',
        'المؤسس: م. سالم المسرحي. المقر: برج الجوهرة، شارع الأمير محمد بن عبدالعزيز (التحلية)، حي العليا، الرياض.',
      ],
      bullets: [
        'شركات المنظومة مطروحة بشكل دائم للشراكة وفق التقييم.',
        'المنظومة مبنية لتعمل بنظام مؤسسي لا يتأثر بوجود أو غياب المؤسسين والمدراء.',
      ],
      url: 'https://vibesholding.com/',
      urlLabel: 'vibesholding.com',
      logoUrl: 'https://vibesholding.com/wp-content/uploads/2026/08/فايبز-القابضة.png',
    },
  ],
  ecosystem: {
    title: 'شركات المنظومة',
    intro: 'الشركات التي تحمل علامة V تحت مظلة فايبز القابضة، وتقدّم خدماتها لأعضاء النادي بمزايا خاصة.',
    companies: [
      { name: 'المجتمع الافتراضي', role: 'المشغّل الرسمي لنادي المستثمرين', url: 'https://vcmem.com/' },
      { name: 'PV لحاضنات ومسرعات الأعمال', role: 'حاضنة أعمال: بيئة متكاملة من الفكرة إلى السوق', url: 'https://pvspaces.com/' },
      { name: 'وديني', role: 'تطبيق يجمع خدمات التوصيل بمقارنة ذكية', url: 'https://wdeny.com/' },
      { name: 'سكة', role: 'النقل المدرسي التشاركي', url: 'https://sekaride.com/' },
      { name: 'الملتقى', role: 'منصة إنتاج واستضافة البودكاست', url: 'https://almoltaqapodcast.com/' },
      { name: 'القضمة السريعة', role: 'شراكة متخصصة لقطاع المطاعم والكافيهات', url: 'https://qbarabia.com/' },
      { name: 'الصفقات السريعة للتجارة', role: 'منظومة البيع الرقمي ومنتجات «منفذ»', url: 'https://qdtco.com/' },
      { name: 'الصفقات السريعة للاستثمار', role: 'وصول سريع للمستثمرين المناسبين', url: 'https://qdealsi.com/' },
      { name: 'مومنتوم', role: 'التسويق الرقمي وتصميم المواقع والتطبيقات', url: 'https://momentummix.com/' },
      { name: 'تمكين الامتياز', role: 'توسيع العلامات التجارية عبر الامتياز', url: 'https://franchment.com/' },
    ],
  },
  contact: {
    title: 'تواصل معنا',
    management: '+966558318777',
    studio: '+966538461110',
    email: 'info@vcmem.com',
    websites: [
      { label: 'نادي المستثمرين', url: 'https://vcmem.com/' },
      { label: 'فايبز القابضة', url: 'https://vibesholding.com/' },
    ],
  },
  legal: {
    operator: 'شركة المجتمع الافتراضي للاستثمار',
    cr: '2050179051',
    vat: '311933896300003',
    address: 'الرياض، حي العليا',
    trademark: 'نادي المستثمرين® علامة تجارية مسجلة لفايبز القابضة (شركة ذبذبات للاستثمار القابضة).',
  },
  version: 1,
  updatedAt: '2026-09-12T00:00:00.000Z',
};

export async function ensureAboutSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<AboutContent>(ABOUT_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= ABOUT_SEED.version) return false;
  await kv.set(ABOUT_CONTENT_KEY, ABOUT_SEED);
  return true;
}

/** The block as the app of one language reads it: the stored Arabic block, the English translation for `en`, and the owner's edits (see edits.ts). */
export async function getAboutContent(kv: KV, lang: AppLang = 'ar'): Promise<AboutContent> {
  return localizeBlock(kv, 'about', (await kv.get<AboutContent>(ABOUT_CONTENT_KEY)) ?? ABOUT_SEED, ABOUT_EN, lang);
}
