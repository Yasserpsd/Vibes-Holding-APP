import type { Me } from '../auth/service.js';
import type { KV } from '../store.js';

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
  /** Opens a web page (registration form, service page) in the in-app browser. */
  | { type: 'link'; url: string; label: string }
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
};

export type ServicesContent = {
  title: string;
  intro: string;
  groups: { key: ServiceGroupKey; title: string }[];
  lockedText: string;
  lockedGuestText: string;
  lockedExpiredText: string;
  services: Service[];
  version: number;
  updatedAt: string;
};

/** A service as the app receives it: locked services carry no action. */
export type PublicService = Omit<Service, 'action'> & { locked: boolean; action: ServiceAction | null };

export const SERVICES_CONTENT_KEY = 'content:services';

/** The only management number and the studio number (docs/PROJECT_BRIEF.md section 1). */
export const MANAGEMENT_WHATSAPP = '+966558318777';
export const STUDIO_WHATSAPP = '+966538461110';

const management = (message: string, fields: ServiceField[] = []): ServiceAction => ({ type: 'whatsapp', phone: MANAGEMENT_WHATSAPP, message, fields });
const studio = (message: string, fields: ServiceField[] = []): ServiceAction => ({ type: 'whatsapp', phone: STUDIO_WHATSAPP, message, fields });

// Initial content from docs/PROJECT_BRIEF.md sections 4.1, 5 and 5.2. The dashboard edits it later.
export const SERVICES_SEED: ServicesContent = {
  title: 'خدمات النادي',
  intro: 'خدمات رواد الأعمال متاحة للجميع، ومزايا المنظومة وخصوماتها للأعضاء المشتركين.',
  groups: [
    { key: 'entrepreneur', title: 'خدمات رواد الأعمال' },
    { key: 'member', title: 'مزايا الأعضاء المشتركين' },
    { key: 'discount', title: 'خصومات المنظومة' },
  ],
  lockedText: 'هذه الخدمة للأعضاء المشتركين. فعّل عضويتك السنوية لاستخدامها.',
  lockedGuestText: 'هذه الخدمة للأعضاء المشتركين. سجّل الدخول وفعّل عضويتك السنوية لاستخدامها.',
  lockedExpiredText: 'انتهت عضويتك. جدّد عضويتك السنوية لاستخدام هذه الخدمة.',
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
      memberLabel: 'خصم 50% للأعضاء',
      access: 'everyone',
      action: management('أرغب في طلب خدمة «اصنع ملتقاك».', [
        { key: 'topic', label: 'موضوع الملتقى', placeholder: 'مثال: فرص الشراكة في قطاع التجزئة' },
        { key: 'date', label: 'الموعد المفضل', placeholder: 'مثال: النصف الثاني من أكتوبر' },
      ]),
      infoUrl: 'https://vibesholding.com/urmeet/',
      order: 1,
    },
    {
      key: 'success-partners',
      title: 'شركاء النجاح',
      summary: 'سجّل مشروعك ليُراجع من لجنة متخصصة، ويُدرج في بنك المشاريع إن اعتُمد.',
      detail:
        'برنامج شركاء النجاح هو مصدر المشاريع المميزة في المنظومة. بعد التسجيل تراجع لجنة متخصصة مشروعك، ولا يُعرض على المستثمرين في بنك المشاريع إلا بعد اعتماده. الأعضاء المشتركون يحصلون على أولوية في التقديم والعرض.',
      icon: 'ribbon',
      group: 'entrepreneur',
      priceLabel: null,
      memberLabel: 'أولوية للأعضاء',
      access: 'everyone',
      action: { type: 'link', url: 'https://pvspaces.com/sp/', label: 'سجّل مشروعك' },
      infoUrl: null,
      order: 2,
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
      action: management('أرغب في طلب خدمة تصميم Pitch Deck لمشروعي.', [
        { key: 'project', label: 'اسم المشروع' },
        { key: 'stage', label: 'مرحلة المشروع', options: ['فكرة', 'نموذج أولي', 'مشروع قائم', 'توسّع'] },
      ]),
      infoUrl: null,
      order: 3,
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
      action: management('أرغب في التسجيل في ورشة «مشروعك من الفكرة إلى التنفيذ».', [
        { key: 'mode', label: 'طريقة الحضور', options: ['حضوريًا في الرياض', 'عبر الإنترنت'] },
      ]),
      infoUrl: 'https://vcmem.com/workshop/',
      order: 4,
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
      order: 5,
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
      order: 6,
    },
    {
      key: 'theater',
      title: 'مسرح النادي وقاعة الاجتماعات',
      summary: 'مسرح النادي وقاعة الاجتماعات (8 أشخاص مع Zoom) في مقر النادي بخصم 50% للأعضاء.',
      detail: null,
      icon: 'film',
      group: 'member',
      priceLabel: null,
      memberLabel: 'خصم 50% للأعضاء',
      access: 'member',
      action: management('أرغب في حجز مسرح النادي أو قاعة الاجتماعات.', [
        { key: 'space', label: 'المكان', options: ['مسرح النادي', 'قاعة الاجتماعات'] },
        { key: 'time', label: 'الموعد المفضل' },
      ]),
      infoUrl: null,
      order: 7,
    },
    {
      key: 'consultation',
      title: 'استشارة أونلاين مع خبراء النادي',
      summary: 'جلسة استشارية عبر الإنترنت مع خبراء النادي بدون رسوم للأعضاء المشتركين.',
      detail: null,
      icon: 'chatbubbles',
      group: 'member',
      priceLabel: null,
      memberLabel: 'بدون رسوم للأعضاء',
      access: 'member',
      action: management('أرغب في حجز استشارة أونلاين مع خبراء النادي.', [{ key: 'topic', label: 'موضوع الاستشارة' }]),
      infoUrl: null,
      order: 8,
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
      action: management('أرغب في الظهور في لقاء «شخصية ومسيرة».'),
      infoUrl: null,
      order: 9,
    },
    {
      key: 'repost',
      title: 'نشر مشروعك على منصات النادي',
      summary: 'نشر مشروعك 3 مرات شهريًا على قروبات النادي ومنصاته والتطبيق.',
      detail: null,
      icon: 'megaphone',
      group: 'member',
      priceLabel: null,
      memberLabel: '3 مرات شهريًا للأعضاء',
      access: 'member',
      action: management('أرغب في نشر مشروعي على منصات النادي.', [{ key: 'project', label: 'اسم المشروع أو رابطه في بنك المشاريع' }]),
      infoUrl: null,
      order: 10,
    },
    {
      key: 'credit',
      title: 'رصيد بنك المشاريع',
      summary: 'رصيد بقيمة 3,750 ريال يعادل فتح بيانات 5 مشاريع كاملة تختارها بنفسك.',
      detail: null,
      icon: 'wallet',
      group: 'member',
      priceLabel: null,
      memberLabel: 'ضمن العضوية',
      access: 'member',
      action: { type: 'projects' },
      infoUrl: null,
      order: 11,
    },
    {
      key: 'groups',
      title: 'قروبات النادي',
      summary: 'الانضمام إلى قروبات أعضاء النادي والتواصل المباشر مع المستثمرين ورواد الأعمال.',
      detail: null,
      icon: 'people-circle',
      group: 'member',
      priceLabel: null,
      memberLabel: 'للأعضاء المشتركين',
      access: 'member',
      action: management('أرغب في الانضمام إلى قروبات النادي.'),
      infoUrl: null,
      order: 12,
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
      action: management('أرغب في الاستفادة من خصم الأعضاء على خدمات مومنتوم.', [
        { key: 'service', label: 'الخدمة', options: ['موقع إلكتروني', 'تطبيق', 'تسويق إلكتروني', 'إعلانات مؤثرين'] },
      ]),
      infoUrl: 'https://momentummix.com/',
      order: 13,
    },
    {
      key: 'franchise',
      title: 'حقيبة الامتياز',
      summary: 'حقيبة الامتياز من تمكين الامتياز لتوسيع علامتك التجارية بخصم 50% للأعضاء.',
      detail: null,
      icon: 'storefront',
      group: 'discount',
      priceLabel: null,
      memberLabel: 'خصم 50% للأعضاء',
      access: 'member',
      action: management('أرغب في الاستفادة من خصم الأعضاء على حقيبة الامتياز.', [{ key: 'brand', label: 'العلامة التجارية' }]),
      infoUrl: 'https://franchment.com/',
      order: 14,
    },
    {
      key: 'manfaz',
      title: 'كود خصم منتجات «منفذ»',
      summary: 'كود خصم حتى 20% على منتجات «منفذ» من الصفقات السريعة للتجارة.',
      detail: null,
      icon: 'pricetag',
      group: 'discount',
      priceLabel: null,
      memberLabel: 'حتى 20% للأعضاء',
      access: 'member',
      action: management('أرغب في الحصول على كود خصم منتجات «منفذ».'),
      infoUrl: null,
      order: 15,
    },
  ],
  version: 1,
  updatedAt: '2026-09-12T00:00:00.000Z',
};

/** Writes the seed when no services content exists yet, or when the stored seed is older than this one. */
export async function ensureServicesSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<ServicesContent>(SERVICES_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= SERVICES_SEED.version) return false;
  await kv.set(SERVICES_CONTENT_KEY, SERVICES_SEED);
  return true;
}

export async function getServicesContent(kv: KV): Promise<ServicesContent> {
  return (await kv.get<ServicesContent>(SERVICES_CONTENT_KEY)) ?? SERVICES_SEED;
}

export function isActiveMember(me: Me | null): boolean {
  return me?.membership.status === 'active';
}

/** Locks member-only services for guests and accounts without an active membership; locked services lose their action. */
export function toPublicService(service: Service, me: Me | null): PublicService {
  const locked = service.access === 'member' && !isActiveMember(me);
  const { action, ...rest } = service;
  return { ...rest, locked, action: locked ? null : action };
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
    services,
    updatedAt: content.updatedAt,
  };
}
