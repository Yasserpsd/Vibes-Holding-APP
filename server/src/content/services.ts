import type { Me } from '../auth/service.js';
import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import { SERVICES_EN } from './en/services.js';

/**
 * Services catalogue. Every service is server content (the dashboard edits it later).
 * Member-only services are listed for everyone but locked (dimmed) for guests and
 * accounts without an active membership; the server strips their action (CLAUDE.md rule 2 spirit:
 * the app never decides access on its own).
 */
export type ServiceField = {
  key: string;
  label: string;
  /** Choice chips when present; otherwise a short text field. */
  options?: string[];
  placeholder?: string;
};

export type ServiceAction =
  /** Hands the request over to a WhatsApp number with a prefilled message plus the filled fields. */
  | { type: 'whatsapp'; phone: string; message: string; fields: ServiceField[] }
  /** Paid in-app through Paymob (real-world services only, CLAUDE.md rule 3): the member fills the fields, then pays the amount for their account (SAR). */
  | { type: 'paymob'; message: string; fields: ServiceField[]; amount: number; memberAmount: number | null; currency: 'SAR' }
  /** Opens a web page (registration form, service page) in the in-app browser. */
  | { type: 'link'; url: string; label: string }
  /** Opens a native in-app registration form (M16, server/src/forms). */
  | { type: 'form'; formKey: string; label: string }
  /** M73: opens an in-app screen by its route (e.g. the «شخصية ومسيرة» application). */
  | { type: 'route'; path: string; label: string }
  /** Opens the advisor tab with a suggested first message. */
  | { type: 'advisor'; prompt: string }
  /** In-app flows. */
  | { type: 'hq' }
  | { type: 'projects' };

export type ServiceGroupKey = 'entrepreneur' | 'member' | 'discount';

export type Service = {
  key: string;
  title: string;
  summary: string;
  detail: string | null;
  icon: string;
  group: ServiceGroupKey;
  /** List price of a real-world service; never a membership price. */
  priceLabel: string | null;
  memberLabel: string | null;
  access: 'everyone' | 'member';
  action: ServiceAction;
  infoUrl: string | null;
  order: number;
  /** M74: the imperative call to action on the service card («سجّل», «احجز»…); an older stored row has none. */
  cta?: string;
  /** M81: the owner's photo for this service (filled from the image slots at read time, never stored here). */
  imageUrl?: string | null;
  /** M130 (owner, 2026-10-26): the service's own film, a YouTube watch URL; empty = none (edited from «القيم والأسعار»). */
  videoUrl?: string;
};

export type ServicesContent = {
  title: string;
  intro: string;
  groups: { key: ServiceGroupKey; title: string }[];
  lockedText: string;
  lockedGuestText: string;
  lockedExpiredText: string;
  /**
   * Owner (2026-10-25): the membership upsell on paid services for non-members — a different
   * persuasion line every time («بوب اب تطلع كل مرة بوصف مختلف»), all dashboard-editable.
   */
  upsell: { title: string; variants: string[] };
  services: Service[];
  version: number;
  updatedAt: string;
};

/** What this account pays for a Paymob service: the member price when the membership is active. */
export type ServicePrice = { amount: number; currency: string; memberPrice: boolean };

/** A service as the app receives it: locked services carry no action. */
export type PublicService = Omit<Service, 'action'> & {
  locked: boolean;
  action: ServiceAction | null;
  price: ServicePrice | null;
  /** M109b «وفّر … ريال بعضويتك»: list price minus member price, for every priced service with a member cut. */
  savingsSar: number | null;
};

export const SERVICES_CONTENT_KEY = 'content:services';

/** The only management number and the studio number (docs/PROJECT_BRIEF.md section 1). */
export const MANAGEMENT_WHATSAPP = '+966551623111';
export const STUDIO_WHATSAPP = '+966538461110';

const management = (message: string, fields: ServiceField[] = []): ServiceAction => ({ type: 'whatsapp', phone: MANAGEMENT_WHATSAPP, message, fields });
const studio = (message: string, fields: ServiceField[] = []): ServiceAction => ({ type: 'whatsapp', phone: STUDIO_WHATSAPP, message, fields });
const paid = (amount: number, memberAmount: number | null, message: string, fields: ServiceField[] = []): ServiceAction => ({ type: 'paymob', message, fields, amount, memberAmount, currency: 'SAR' });

// Initial content from docs/PROJECT_BRIEF.md sections 4.1, 5 and 5.2. The dashboard edits it later.
export const SERVICES_SEED: ServicesContent = {
  title: 'خدمات النادي',
  intro: 'خدمات رواد الأعمال متاحة للجميع، ومزايا المنظومة وخصوماتها للأعضاء المشتركين.',
  groups: [
    { key: 'entrepreneur', title: 'خدمات رواد الأعمال' },
    { key: 'member', title: 'مزايا الأعضاء المشتركين' },
    { key: 'discount', title: 'خصومات المنظومة' },
  ],
  // M109f: the owner's upsell sentence on every member-only feature.
  lockedText: 'هذه الميزة حصرية لأعضاء نادي المستثمرين. انضم الآن للاستفادة من جميع مزايا العضوية.',
  lockedGuestText: 'هذه الميزة حصرية لأعضاء نادي المستثمرين. انضم الآن للاستفادة من جميع مزايا العضوية.',
  lockedExpiredText: 'انتهت عضويتك. جدّد عضويتك السنوية لاستخدام هذه الخدمة.',
  upsell: {
    title: 'وفّر 50% بعضويتك',
    variants: [
      'لماذا تدفع المبلغ كاملًا؟ اشترك في العضوية السنوية واحصل على خصم 50% على هذه الخدمة — وعلى كل خدمات النادي طوال عام كامل.',
      'بحسبة بسيطة: خصم 50% على خدمة واحدة قد يغطي قيمة عضويتك كلها، ويبقى لك عام كامل من المزايا.',
      'الأعضاء يدفعون النصف. الخدمة نفسها، الجودة نفسها، نصف السعر — والعضوية تفتح لك باقي المزايا أيضًا.',
      'قيمة عضويتك تستردها من أول خدمة: خصم 50% هنا، وخصومات الشركاء، ورصيد بنك المشاريع — كلها بانتظارك.',
      'قبل أن تدفع: عضويتك السنوية تخفض هذا المبلغ إلى النصف فورًا، وتبقى معك عامًا كاملًا لكل خدمات النادي.',
      'قرار ذكي: بدل أن تدفع المبلغ كاملًا مرة واحدة، اشترك واحصل على خصم 50% هنا وعلى كل خدمة قادمة.',
      'هذه الخدمة بنصف السعر للأعضاء. فعّل عضويتك الآن وادفع النصف فقط — ومعها مزايا النادي كلها.',
      'أعضاء النادي لا يدفعون السعر الكامل. انضم إليهم اليوم واحصل على خصم 50% على هذه الخدمة فورًا.',
    ],
  },
  services: [
    {
      key: 'meetup',
      title: 'اصنع ملتقاك',
      summary: 'ملتقى باسمك وبحضور مستثمري النادي ورواد أعماله، ننظّمه لك من الفكرة إلى المنصة.',
      detail:
        'تختار موضوع الملتقى وجمهوره، ويتولى فريق النادي التنظيم والدعوات والإخراج في مقر النادي بالرياض أو عبر الإنترنت. الأعضاء المشتركون يحصلون على خصم 50%.',
      icon: 'people',
      group: 'entrepreneur',
      priceLabel: '30,000 ريال',
      memberLabel: '15,000 ريال للأعضاء',
      access: 'everyone',
      action: paid(30000, 15000, 'طلب خدمة «اصنع ملتقاك»', [
        { key: 'topic', label: 'موضوع الملتقى', placeholder: 'مثال: فرص الشراكة في قطاع التجزئة' },
        { key: 'date', label: 'الموعد المفضل', placeholder: 'مثال: النصف الثاني من أكتوبر' },
      ]),
      infoUrl: 'https://vibesholding.com/urmeet/',
      // The owner's own «اصنع ملتقاك» film (same pick as the meetups section); he swaps it from «القيم والأسعار».
      videoUrl: 'https://www.youtube.com/watch?v=xpxKMnj_Nzk',
      order: 1,
      cta: 'اطلب ملتقاك',
    },
    // M100 (owner, 2026-10-18): the club's operating-rights offering, copy from vibesholding.com/operating-rights/.
    {
      key: 'operating-rights',
      title: 'حقوق تشغيل نادي المستثمرين',
      summary: 'شغّل علامة «نادي المستثمرين» حصريًا في مدينتك أو بلدك، بذات منهجية العمل المعتمدة في مقر النادي بالرياض.',
      detail:
        'إذا كنت تدير حاضنة أعمال أو مسرّعة مشاريع، أو تمتلك مساحة مكتبية فاخرة، فحقوق التشغيل تتيح لك تشغيل كافة عناصر منظومة Vibes Ventures ضمن نطاق جغرافي حصري محدد، وبذات الآلية ومنهجية العمل المعتمدة في مقر نادي المستثمرين بمدينة الرياض.\nكمشغّل حصري تحصل على: آلية موحدة لنسخ التجربة وتطبيقها محليًا في منطقتك، وعرض المشاريع التابعة لك على بنك المشاريع، واقتسام نسبة 50% من قيم العضوية والنسب التي يحصل عليها النادي عند اعتماد أي مشروع مقدم من جهتك، و50% من رسوم عضوية الانتساب، وأحقية استخدام العلامة التجارية «نادي المستثمرين» داخل المدينة المستهدفة، والعديد من المميزات الأخرى الموضحة في حقوق التشغيل.\nالنموذج مصمم للحاضنات والمسرعات ومالكي المساحات المكتبية الفاخرة والصناديق الاستثمارية والجهات الاستشارية ومكاتب تطوير الأعمال، وللشركات والأفراد ذوي الخبرة الراغبين في تمثيل النادي داخل مدنهم أو دولهم.\nيتطلب الحصول على حقوق التشغيل تقديم ضمان بنكي، وتتواصل معك الإدارة لاستكمال المعايير والتفاصيل.',
      icon: 'key',
      group: 'entrepreneur',
      priceLabel: null,
      memberLabel: null,
      access: 'everyone',
      action: management('أرغب في الحصول على حقوق تشغيل علامة «نادي المستثمرين».', [
        { key: 'city', label: 'الدولة والمدينة المستهدفة' },
        {
          key: 'population',
          label: 'عدد سكان المدينة',
          options: ['من 100 ألف إلى 250 ألف', 'من 250 ألف إلى 500 ألف', 'من 500 ألف إلى مليون', 'من مليون إلى 2 مليون', '2 مليون فما فوق'],
        },
        {
          key: 'entity',
          label: 'جهتك',
          options: ['حاضنة أعمال', 'مسرعة أعمال', 'مساحات مكتبية', 'صندوق استثماري', 'جهة استشارية', 'مكتب تطوير أعمال', 'شركة', 'فرد خبير'],
        },
        { key: 'about', label: 'نبذة عنك وعن عملك', placeholder: 'خبراتك ولماذا تسعى لحقوق التشغيل' },
      ]),
      infoUrl: 'https://vibesholding.com/operating-rights/',
      videoUrl: '',
      order: 2,
      cta: 'اطلب حقوق التشغيل',
    },
    {
      key: 'success-partners',
      title: 'شركاء النجاح',
      summary: 'سجّل مشروعك ليُراجع من لجنة متخصصة، ويُدرج في بنك المشاريع إن اعتُمد.',
      detail:
        'برنامج شركاء النجاح هو مصدر المشاريع المميزة في المنظومة. بعد التسجيل تراجع لجنة متخصصة مشروعك ويُقيَّم خلال 10 أيام عمل، وبعد استيفاء معايير القبول يُحال إلى بنك المشاريع ويُعرض على أعضاء النادي. الأعضاء المشتركون يحصلون على أولوية في التقديم والعرض.',
      icon: 'ribbon',
      group: 'entrepreneur',
      priceLabel: null,
      memberLabel: 'أولوية للأعضاء',
      access: 'everyone',
      action: { type: 'form', formKey: 'success-partners', label: 'سجّل مشروعك' },
      infoUrl: null,
      videoUrl: '',
      order: 3,
      cta: 'سجّل مشروعك',
    },
    {
      key: 'pitch-deck',
      title: 'تصميم Pitch Deck',
      summary: 'عرض تقديمي احترافي لمشروعك يعدّه فريق PV لحاضنات ومسرعات الأعمال.',
      detail: 'يشمل صياغة قصة المشروع، النموذج المالي المختصر، وتصميم الشرائح بهوية احترافية جاهزة للعرض على المستثمرين.',
      icon: 'easel',
      group: 'entrepreneur',
      priceLabel: '5,000 ريال',
      memberLabel: '2,500 ريال للأعضاء',
      access: 'everyone',
      action: paid(5000, 2500, 'طلب خدمة تصميم Pitch Deck', [
        { key: 'project', label: 'اسم المشروع' },
        { key: 'stage', label: 'مرحلة المشروع', options: ['فكرة', 'نموذج أولي', 'مشروع قائم', 'توسّع'] },
      ]),
      infoUrl: null,
      videoUrl: '',
      order: 4,
      cta: 'اطلب تصميمك',
    },
    // M83 (owner, 2026-10-17): «لرائد الأعمال يقدر ينشر تطبيقه علي جوجل وiOS بدون رسوم اهم حاجه يكون معاه عضوية».
    {
      key: 'app-publish',
      title: 'انشر تطبيقك على Android و iOS',
      summary: 'النادي ينشر تطبيقك على Google Play وApp Store بدون رسوم — ميزة حصرية للأعضاء المشتركين.',
      detail: 'املأ بيانات تطبيقك وتتواصل معك الإدارة لاستلام الملفات وإتمام النشر على Android و iOS. الشرط الوحيد عضوية سنوية سارية.',
      icon: 'cloud-upload',
      group: 'entrepreneur',
      priceLabel: null,
      memberLabel: 'بدون رسوم للأعضاء',
      access: 'member',
      action: { type: 'form', formKey: 'app-publish', label: 'املأ بيانات تطبيقك' },
      infoUrl: null,
      videoUrl: '',
      order: 5,
      cta: 'انشر تطبيقك',
    },
    {
      key: 'workshop',
      title: 'ورش العمل',
      summary: 'ورشة «مشروعك من الفكرة إلى التنفيذ»: من 17 إلى 19 أكتوبر 2026 في مقر النادي وعبر الإنترنت.',
      detail: 'ثلاثة أيام عملية تنقل مشروعك من الفكرة إلى خطة تنفيذ واضحة، بحضور خبراء النادي.',
      icon: 'school',
      group: 'entrepreneur',
      priceLabel: '290 ريالًا بدلًا من 1,200',
      memberLabel: 'خصم 50% للأعضاء',
      access: 'everyone',
      action: { type: 'form', formKey: 'workshop', label: 'سجّل في الورشة' },
      infoUrl: 'https://vcmem.com/workshop/',
      videoUrl: '',
      order: 6,
      cta: 'سجّل في الورشة',
    },
    {
      key: 'studio',
      title: 'بودكاست الملتقى: حجز الاستديو',
      summary: 'باقات الاستديو (الأساسية، المتقدمة، الكاملة، المسرح، التصوير الخارجي) بخصم 50% للأعضاء، والحجز عبر واتساب الاستديو.',
      detail: 'اختر الباقة والوقت المفضل، وسيتواصل معك فريق الاستديو على واتساب لتأكيد الحجز والتفاصيل.',
      icon: 'mic',
      group: 'member',
      priceLabel: null,
      memberLabel: 'خصم 50% للأعضاء بلا حد للاستخدام',
      access: 'member',
      action: studio('أرغب في حجز استديو بودكاست الملتقى.', [
        { key: 'package', label: 'الباقة', options: ['الأساسية', 'المتقدمة', 'الكاملة', 'المسرح', 'التصوير الخارجي', 'إضافات'] },
        { key: 'time', label: 'الوقت المفضل', placeholder: 'مثال: الثلاثاء 4 عصرًا' },
      ]),
      infoUrl: 'https://almoltaqapodcast.com/studio/',
      videoUrl: '',
      order: 7,
      cta: 'احجز الاستديو',
    },
    {
      key: 'hq-visit',
      title: 'زيارة مقر النادي',
      summary: 'احجز موعد زيارتك لمقر النادي بالرياض، وبعد تأكيد الإدارة يصلك باركود الدخول لموعدك.',
      detail: null,
      icon: 'business',
      group: 'member',
      priceLabel: null,
      memberLabel: 'للأعضاء المشتركين',
      access: 'member',
      action: { type: 'hq' },
      infoUrl: null,
      // The HQ tour film (docs/PROJECT_BRIEF.md 5.3) — the owner swaps it from «القيم والأسعار».
      videoUrl: 'https://www.youtube.com/watch?v=XERenNWNziA',
      order: 8,
      cta: 'احجز زيارتك',
    },
    // M107 (owner, 2026-10-20): the meeting room became its own in-app booking — بدون رسوم طوال مدة العضوية.
    {
      key: 'meeting-room',
      title: 'حجز قاعة الاجتماعات',
      summary: 'قاعة اجتماعات لـ8 أشخاص مجهّزة باشتراك Zoom في مقر النادي بالرياض — بدون رسوم طوال مدة العضوية.',
      detail: 'احجز موعدك من التطبيق واختر الغرض «حجز قاعة الاجتماعات»، وبعد تأكيد الإدارة يصلك باركود الدخول لموعدك.',
      icon: 'people-circle',
      group: 'member',
      priceLabel: null,
      memberLabel: 'بدون رسوم طوال مدة العضوية',
      access: 'member',
      action: { type: 'hq' },
      infoUrl: null,
      videoUrl: '',
      order: 9,
      cta: 'احجز القاعة',
    },
    {
      key: 'theater',
      title: 'مسرح النادي',
      summary: 'مسرح يتسع لـ80 شخصًا في مقر النادي لفعالياتك وعروضك، بخصم 50% للأعضاء.',
      detail: null,
      icon: 'film',
      group: 'member',
      priceLabel: null,
      memberLabel: 'خصم 50% للأعضاء',
      access: 'member',
      // Owner (2026-10-21): theatre bookings go straight to the podcast/stage number, like the studio.
      action: studio('أرغب في حجز مسرح النادي.', [{ key: 'time', label: 'الموعد المفضل' }]),
      infoUrl: null,
      videoUrl: '',
      order: 10,
      cta: 'احجز المسرح',
    },
    {
      key: 'consultation',
      title: 'استشارة أونلاين مع مستشار ذكي',
      summary: 'جلسة استشارية عبر الإنترنت مع مستشار ذكي مدعوم بالذكاء الاصطناعي، بدون رسوم إضافية للأعضاء المشتركين.',
      detail: 'يساعدك على فهم فكرتك وتحديد خطواتك التالية، برصيد استخدام يومي متجدد على مدار الساعة.',
      icon: 'chatbubbles',
      group: 'member',
      priceLabel: null,
      memberLabel: 'بدون رسوم للأعضاء',
      access: 'member',
      action: { type: 'advisor', prompt: 'أرغب في استشارة أونلاين: لديّ فكرة وأحتاج من يساعدني على فهمها وتحديد خطواتي التالية.' },
      infoUrl: null,
      videoUrl: '',
      order: 11,
      cta: 'ابدأ استشارتك',
    },
    {
      key: 'famous',
      title: 'شخصية ومسيرة',
      summary: 'ظهورك في لقاء «شخصية ومسيرة» على منصات النادي بدون رسوم للأعضاء المشتركين.',
      detail: null,
      icon: 'star',
      group: 'member',
      priceLabel: null,
      memberLabel: 'بدون رسوم للأعضاء',
      access: 'member',
      // M73: «قدّم من هنا» opens the M11 application (apply → committee review → published).
      action: { type: 'route', path: '/people/apply', label: 'قدّم من هنا' },
      infoUrl: null,
      videoUrl: '',
      order: 12,
      cta: 'قدّم من هنا',
    },
    {
      key: 'repost',
      title: 'إبراز مشروعك على منصات النادي',
      summary: 'إعادة إبراز مشروعك مرة كل شهر لكافة أعضاء النادي على منصات النادي والتطبيق.',
      detail: null,
      icon: 'megaphone',
      group: 'member',
      priceLabel: null,
      memberLabel: 'مرة كل شهر للأعضاء',
      access: 'member',
      action: management('أرغب في نشر مشروعي على منصات النادي.', [{ key: 'project', label: 'اسم المشروع أو رابطه في بنك المشاريع' }]),
      infoUrl: null,
      videoUrl: '',
      order: 13,
      cta: 'اطلب الإبراز',
    },
    {
      key: 'credit',
      title: 'رصيد بنك المشاريع',
      summary: 'رصيد بقيمة 2,500 ريال يفتح لك بيانات 5 مشاريع حقيقية كاملة تنتقيها بنفسك.',
      detail: null,
      icon: 'wallet',
      group: 'member',
      priceLabel: null,
      memberLabel: 'ضمن العضوية',
      access: 'member',
      action: { type: 'projects' },
      infoUrl: null,
      videoUrl: '',
      order: 14,
      cta: 'استخدم رصيدك',
    },
    {
      key: 'momentum',
      title: 'مومنتوم: المواقع والتطبيقات والتسويق',
      summary: 'تصميم المواقع والتطبيقات، باقات التسويق الإلكتروني وإعلانات المؤثرين بخصم 50% للأعضاء.',
      detail: null,
      icon: 'globe',
      group: 'discount',
      priceLabel: null,
      memberLabel: 'خصم 50% للأعضاء',
      access: 'member',
      // Owner (2026-10-21): momentum requests go to the same stage/podcast number.
      action: studio('أرغب في الاستفادة من خصم الأعضاء على خدمات مومنتوم.', [
        { key: 'service', label: 'الخدمة', options: ['موقع إلكتروني', 'تطبيق', 'تسويق إلكتروني', 'إعلانات مؤثرين'] },
      ]),
      infoUrl: 'https://momentummix.com/',
      videoUrl: '',
      order: 15,
      cta: 'اطلب الخدمة',
    },
    // M107 (owner, 2026-10-20): «حقيبة الامتياز» and «كود خصم منتجات منفذ» removed for good.
  ],
  // v15 (owner, 2026-10-26): «انشر تطبيقك على Android و iOS» replaces «على المتجرين».
  // v16 (owner, 2026-10-26): every service carries its own film (`videoUrl`, dashboard-edited; «اصنع ملتقاك» seeded).
  version: 16,
  updatedAt: '2026-10-26T12:00:00.000Z',
};

/** Writes the seed when no services content exists yet, or when the stored seed is older than this one. */
export async function ensureServicesSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<ServicesContent>(SERVICES_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= SERVICES_SEED.version) return false;
  await kv.set(SERVICES_CONTENT_KEY, SERVICES_SEED);
  return true;
}

/** The block as the app of one language reads it: the stored Arabic block, the English translation for `en`, and the owner's edits (see edits.ts). */
export async function getServicesContent(kv: KV, lang: AppLang = 'ar'): Promise<ServicesContent> {
  return localizeBlock(kv, 'services', (await kv.get<ServicesContent>(SERVICES_CONTENT_KEY)) ?? SERVICES_SEED, SERVICES_EN, lang);
}

export function isActiveMember(me: Me | null): boolean {
  return me?.membership.status === 'active';
}

/** Locks member-only services for guests and accounts without an active membership; locked services lose their action. */
/** The price this account pays for a Paymob service (member price with an active membership); null for other actions. */
export function priceFor(service: Service, me: Me | null): ServicePrice | null {
  if (service.action.type !== 'paymob') return null;
  const memberPrice = isActiveMember(me) && service.action.memberAmount !== null;
  return { amount: memberPrice ? (service.action.memberAmount as number) : service.action.amount, currency: service.action.currency, memberPrice };
}

/** M109b: what the annual membership saves on this service (the agenda's savingsSar, for services). */
export function savingsOf(service: Service): number | null {
  if (service.action.type !== 'paymob' || service.action.memberAmount === null) return null;
  const saved = service.action.amount - service.action.memberAmount;
  return saved > 0 ? saved : null;
}

export function toPublicService(service: Service, me: Me | null): PublicService {
  const locked = service.access === 'member' && !isActiveMember(me);
  const { action, ...rest } = service;
  return { ...rest, locked, action: locked ? null : action, price: locked ? null : priceFor(service, me), savingsSar: savingsOf(service) };
}

export function lockedTextFor(content: ServicesContent, me: Me | null): string {
  if (!me) return content.lockedGuestText;
  if (me.membership.status === 'expired') return content.lockedExpiredText;
  return content.lockedText;
}

/** The services list as the app sees it for this account (or guest). */
export function publicServices(content: ServicesContent, me: Me | null): {
  title: string;
  intro: string;
  groups: { key: ServiceGroupKey; title: string }[];
  lockedText: string;
  isMember: boolean;
  upsell: { title: string; variants: string[] };
  services: PublicService[];
  updatedAt: string;
} {
  const services = [...content.services].sort((a, b) => a.order - b.order).map((service) => toPublicService(service, me));
  return {
    title: content.title,
    intro: content.intro,
    groups: content.groups,
    lockedText: lockedTextFor(content, me),
    isMember: isActiveMember(me),
    // A block stored before v14 carries no upsell yet; the seed's lines answer until the deploy reseeds.
    upsell: content.upsell ?? SERVICES_SEED.upsell,
    services,
    updatedAt: content.updatedAt,
  };
}
