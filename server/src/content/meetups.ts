import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import type { PortalKey } from './home.js';
import { MEETUPS_EN } from './en/meetups.js';

/**
 * M119 (owner, 2026-10-21): the five club meetups from vibesholding.com/mup as their own app
 * section — each opens on its video, then the pitch, then its registration form (forms module,
 * keys `meetup-*`). Editable server content; the order and the one-line pitch differ per persona.
 */
export type MeetupFeature = { title: string; text: string };

export type Meetup = {
  key: string;
  /** The big index the site shows («01»…«05»). */
  number: string;
  /** «ملتقى» for the five, «مبادرة» for اصنع ملتقاك. */
  badge: string;
  title: string;
  /** A short Latin or Arabic tag under the title (the site's «S-Event»); empty = none. */
  tagline: string;
  description: string;
  features: MeetupFeature[];
  /** A YouTube watch URL; empty until the owner sends the film (the app shows the emblem hero instead). */
  videoUrl: string;
  /** The registration form rendered under the description (forms content, access signedIn). */
  formKey: string;
  cta: string;
};

/** How the section speaks to one persona: its opening line and which meetups lead. */
export type MeetupsPersonaVariant = {
  intro: string;
  /** Meetup keys first in this persona's list; the rest follow in catalog order. */
  order: string[];
};

export type MeetupsContent = {
  title: string;
  subtitle: string;
  personas: Partial<Record<PortalKey | 'guest', MeetupsPersonaVariant>>;
  meetups: Meetup[];
  version: number;
  updatedAt: string;
};

export const MEETUPS_CONTENT_KEY = 'content:meetups';

// The texts come from vibesholding.com/mup (read 2026-10-21), brand-corrected per rule: the brand
// is written «Vibes Ventures» even inside Arabic copy, and no valuation claims outside the brief's
// disclaimer. اليوم المفتوح has no film yet — the owner sends it later and edits the URL in.
export const MEETUPS_SEED: MeetupsContent = {
  title: 'ملتقيات نادي المستثمرين',
  subtitle: 'خمس تجارب نوعية صُمّمت لتفتح أبواب الشراكة، وتُقصّر المسافة بين الفكرة والفرصة.',
  personas: {
    guest: {
      intro: 'احضر الملتقيات وتعرّف على مجتمع النادي عن قرب — لكل ملتقى طابعه وجمهوره.',
      order: ['open-day', 'five-minutes', 'private-pitch', 'elite-challenge', 'your-own'],
    },
    neutral: {
      intro: 'احضر الملتقيات وتعرّف على المجتمع عن قرب قبل أن تختار وجهتك.',
      order: ['open-day', 'five-minutes', 'private-pitch', 'elite-challenge', 'your-own'],
    },
    entrepreneur: {
      intro: 'منصتك أمام أعضاء النادي: اعرض مشروعك في الملتقى الأنسب له.',
      order: ['five-minutes', 'elite-challenge', 'your-own', 'open-day', 'private-pitch'],
    },
    investor: {
      intro: 'ملتقيات تجمعك بأصحاب المشاريع المعتمدة وجهًا لوجه — اختر ملتقاك القادم.',
      order: ['private-pitch', 'elite-challenge', 'five-minutes', 'open-day', 'your-own'],
    },
  },
  meetups: [
    {
      key: 'five-minutes',
      number: '01',
      badge: 'ملتقى',
      title: '5 دقائق',
      tagline: '',
      description:
        'مساحة زمنية لا تتعدى 5 دقائق تمنح روّاد الأعمال فرصة استثنائية لعرض أكبر عدد من مشاريعهم المعتمدة والمدرجة في بنك المشاريع، في ملتقى يحضره نخبة مختارة من أعضاء نادي المستثمرين ضمن تجربة منظمة باحترافية، مدعومة بمؤقّت زمني وجرس تنبيهي لضمان انسيابية العروض واحترام وقت الجميع.',
      features: [
        { title: '12 رائد أعمال في كل ملتقى', text: 'ساعة كاملة من المشاريع المعتمدة من بنك المشاريع' },
        { title: '5 دقائق لكل متحدث', text: 'الفكرة القوية لا تحتاج إطالة… الوقت يساوي مال' },
        { title: 'فرص شراكة', text: 'خمس دقائق قد تكون بداية شراكة تغيّر كل شيء' },
      ],
      videoUrl: 'https://www.youtube.com/watch?v=Cyelv-klNyw',
      formKey: 'meetup-five-minutes',
      cta: 'سجّل الآن',
    },
    {
      key: 'private-pitch',
      number: '02',
      badge: 'ملتقى',
      title: 'الطرح الخاص',
      tagline: 'S-Event',
      description:
        'ملتقى نوعي يجمع نخبة مختارة من المستثمرين لحضور واستكشاف فرص الشراكة الواعدة في شركات أسستها أو ساهمت Vibes Ventures في تأسيسها. تعتمد الفكرة على تسليط الضوء في كل ملتقى على طرح شركة واحدة فقط، ليتم التركيز عليها وعدم التشتيت، ولتأخذ حقها من النقاش ومراجعة عرضها التقديمي (Pitch Deck) قبل الحسم.',
      features: [
        { title: 'طرح خاص منفرد لكل شركة', text: 'تركيز كامل على شركة واحدة يمنح الحضور رؤية عميقة' },
        { title: 'شراكات استراتيجية', text: 'بيئة شفافة ومباشرة لعقد شراكات موثوقة' },
        { title: 'فرص نمو', text: 'شركات من منظومة Vibes Ventures حققت نموًا مثبتًا' },
      ],
      videoUrl: 'https://www.youtube.com/watch?v=_Ht_9Yv1Y7c',
      formKey: 'meetup-private-pitch',
      cta: 'سجّل حضورك',
    },
    {
      key: 'elite-challenge',
      number: '03',
      badge: 'ملتقى',
      title: 'تحدي النخبة',
      tagline: '',
      description:
        'ملتقى مستوحى من فكرة برنامج «شارك تانك» في الشكل، ويختلف معه في المضمون: تبدأ الشراكات المميزة بمواجهة مباشرة بين مستثمرين يتنافسون على حسم الدخول في شراكات نوعية مع روّاد أعمال يطرحون مشاريع معتمدة ومدرجة في بنك المشاريع.',
      features: [
        { title: 'مشاريع معتمدة', text: 'مشاريع مدروسة ومدرجة رسميًا في بنك المشاريع' },
        { title: 'مستثمرون جادون', text: 'نخبة من المستثمرين الباحثين عن فرص شراكة نوعية' },
        { title: 'مواجهة مباشرة', text: 'تنافس حقيقي على حسم الدخول في شراكات نوعية' },
      ],
      videoUrl: 'https://www.youtube.com/watch?v=mvk42AbZFDI',
      formKey: 'meetup-elite-challenge',
      cta: 'انضم الآن',
    },
    {
      key: 'open-day',
      number: '04',
      badge: 'ملتقى',
      title: 'اليوم المفتوح',
      tagline: '',
      description:
        'مساحة حرّة بلا قيود — لا أجندة مسبقة ولا حدود للحوار. المنصة مفتوحة بالكامل لجميع أعضاء نادي المستثمرين في ملتقى يهدف إلى جمع الأعضاء للتعارف فيما بينهم وتبادل بطاقات الأعمال (Networking) والتفاعل والنقاش بحرّية تامة. تسلّم المايكروفون وتحدّث عن تجاربك وقصص نجاحك وتعثّراتك… فكل تجربة تحمل قيمة، وكل قصة قد تكون بداية فرصة جديدة لغيرك من الحضور.',
      features: [
        { title: 'حوار مفتوح', text: 'مساحة حرة بلا أجندة مسبقة أو قيود على الموضوعات' },
        { title: 'تجارب حقيقية', text: 'قصص نجاح وتعثّرات يشاركها الأعضاء بشفافية' },
        { title: 'بيئة احترافية', text: 'بيئة تحترم كل رأي وتُثمّن كل تجربة بدون استثناء' },
      ],
      videoUrl: '',
      formKey: 'meetup-open-day',
      cta: 'انضم الآن',
    },
    {
      key: 'your-own',
      number: '05',
      badge: 'مبادرة',
      title: 'اصنع ملتقاك الخاص',
      tagline: '',
      description:
        'قد لا يحوز مشروعك على قبول منصة شركاء النجاح وأنت ترى أنه مميز ويستحق أن يُشاهد — لذلك أوجدنا لك إمكانية أن تقيم ملتقاك الخاص لتصل إلى أكبر عدد من الأعضاء المهتمين بحضوره على منصة النادي. سواء كنت ترغب في طرح مشروعك الخاص، إقامة ورشة عمل، تدشين منتج جديد، جذب مهتمين بفكرتك، أو البحث عن شركاء — هذه فرصتك لتصنع ملتقاك بالشكل الذي يليق بك.',
      features: [
        { title: 'ملتقاك هو الحدث', text: 'ملتقى مخصص بالكامل لك ولما تقدّمه' },
        { title: 'نحن نجلبهم إليك', text: 'نتولى دعوة واستقطاب الحضور من المهتمين بطرحك' },
        { title: 'إدارة احترافية', text: 'بالتعاون مع نادي المستثمرين بالرياض وأعضاء النادي خارج الرياض (أونلاين)' },
      ],
      videoUrl: 'https://www.youtube.com/watch?v=xpxKMnj_Nzk',
      formKey: 'meetup-your-own',
      cta: 'اصنع ملتقاك الآن',
    },
  ],
  version: 1,
  updatedAt: '2026-10-21T00:00:00.000Z',
};

export async function ensureMeetupsSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<MeetupsContent>(MEETUPS_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= MEETUPS_SEED.version) return false;
  await kv.set(MEETUPS_CONTENT_KEY, MEETUPS_SEED);
  return true;
}

/** The block as the app of one language reads it (see content/edits.ts). */
export async function getMeetupsContent(kv: KV, lang: AppLang = 'ar'): Promise<MeetupsContent> {
  return localizeBlock(kv, 'meetups', (await kv.get<MeetupsContent>(MEETUPS_CONTENT_KEY)) ?? MEETUPS_SEED, MEETUPS_EN, lang);
}
