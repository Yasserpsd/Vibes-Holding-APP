import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from '../content/edits.js';
import { FORMS_EN } from '../content/en/forms.js';

/**
 * M16: the registration forms of the websites, native in the app. Each definition is server
 * content (the owner edits every text from «محتوى التطبيق»); the app draws the fields and sends
 * the answers back, the server validates, keeps the submission for the dashboard and mails the
 * management. Field answers are plain strings; an `agree` field arrives as '1' when ticked.
 */
export type FormFieldType = 'text' | 'textarea' | 'select' | 'agree';

export type FormFieldDef = {
  key: string;
  label: string;
  type: FormFieldType;
  /** select: the choices. */
  options?: string[];
  placeholder?: string;
  required: boolean;
  /** agree: a page the member can read before ticking. */
  url?: string | null;
  /** Latin input (e-mail, phone, links) is typed left-to-right in both languages. */
  latin?: boolean;
  /** The app fills the field from the signed-in account; the member can still edit it. */
  prefill?: 'firstName' | 'lastName' | 'phone' | 'email';
};

export type FormDef = {
  key: string;
  title: string;
  intro: string;
  /** Who may submit: the web form is public; a workshop seat needs the account; M73 «شخصية ومسيرة» needs an ACTIVE membership. */
  access: 'everyone' | 'signedIn' | 'member';
  /** One submission per account (409 after the first); public forms stay repeatable. */
  once: boolean;
  open: boolean;
  closedText: string;
  submitLabel: string;
  successText: string;
  /**
   * Owner (2026-10-25): shown to a NON-MEMBER as a popup right after a successful submission —
   * «لن يُنشر مشروعك… إلا بالاشتراك» with the subscribe button. Empty/absent = no popup.
   */
  memberNudge?: string;
  /**
   * M170 (owner, 2026-10-31): shown to a signed-in NON-MEMBER above the form, before he fills it —
   * the page stays open to everyone, the project waits for the membership. Empty/absent = nothing.
   */
  nonMemberNotice?: string;
  fields: FormFieldDef[];
  order: number;
};

export type FormsContent = { forms: FormDef[]; version: number; updatedAt: string };

export const FORMS_CONTENT_KEY = 'content:forms';

// The شركاء النجاح fields are the web form's own (pvspaces.com/sp/, read 2026-10-04), with the
// file upload replaced by an optional link: the binary has no file picker (see the M11 note), so
// the management asks for the files when it calls back. The workshop form keeps only what the web
// flow asks beyond the account itself (the web page registers a hub account; in-app the member is
// already signed in, rule 2).
export const FORMS_SEED: FormsContent = {
  forms: [
    {
      key: 'success-partners',
      title: 'التسجيل في شركاء النجاح',
      intro:
        'سجّل مشروعك في برنامج شركاء النجاح بدون رسوم: تراجع لجنة متخصصة تسجيلك، ولا يُنشر المشروع في بنك المشاريع ولا يُعرض على الشركاء المحتملين إلا بعضوية سنوية مفعّلة.',
      access: 'everyone',
      once: false,
      open: true,
      closedText: 'التسجيل في البرنامج متوقف حاليًا. تابع إعلانات النادي أو راسل الإدارة.',
      submitLabel: 'إرسال الطلب',
      successText:
        'استلمنا تسجيل مشروعك في شركاء النجاح، وستراجعه لجنة البرنامج وتتواصل معك الإدارة. إن كان لديك ملخص جدوى أو ملفات إضافية فسيُطلب منك إرسالها عند التواصل.',
      memberNudge:
        'انتبه: لن يُنشر مشروعك في بنك المشاريع ولن يُعرض على أي من الشركاء المحتملين إلا بعد اشتراكك في العضوية السنوية. فعّل عضويتك الآن ليدخل مشروعك دائرة العرض على مستثمري النادي.',
      nonMemberNotice:
        'يبدو أنك غير عضو مفعّل بعضوية سنوية: سيُراجَع تسجيلك بدون رسوم، لكن لن يُنشر مشروعك ولن يُعرض في بنك المشاريع على الشركاء المحتملين إلا بعد تفعيل العضوية السنوية.',
      fields: [
        { key: 'firstName', label: 'الاسم الأول', type: 'text', required: true, prefill: 'firstName' },
        { key: 'lastName', label: 'الاسم الأخير', type: 'text', required: true, prefill: 'lastName' },
        { key: 'country', label: 'الدولة', type: 'text', required: true, placeholder: 'مثال: السعودية' },
        { key: 'city', label: 'المدينة', type: 'text', required: true },
        { key: 'whatsapp', label: 'رقم واتساب', type: 'text', required: true, latin: true, prefill: 'phone' },
        { key: 'email', label: 'البريد الإلكتروني', type: 'text', required: true, latin: true, prefill: 'email' },
        { key: 'company', label: 'اسم الشركة', type: 'text', required: true },
        {
          key: 'stage',
          label: 'ما المرحلة التي تصف مشروعك؟',
          type: 'select',
          required: true,
          options: ['لدي منتج أولي', 'بدأت بتحقيق دخل', 'في مرحلة التوسع', 'أخرى'],
        },
        {
          key: 'sector',
          label: 'القطاع',
          type: 'select',
          required: true,
          options: [
            'التكنولوجيا والبرمجيات',
            'الصحة والتكنولوجيا الحيوية',
            'التعليم والتدريب',
            'الطاقة والاستدامة',
            'الخدمات المالية والتكنولوجيا المالية',
            'التجارة والتجزئة',
            'الاستشارات والتطوير الإداري',
            'السياحة والضيافة',
            'الخدمات اللوجستية والنقل',
            'الترفيه والإعلام',
            'الصناعة والتصنيع المتقدم',
            'العقار والتطوير العمراني',
            'الأمن السيبراني وحلول البيانات',
            'الغذاء والمشروبات',
            'أخرى',
          ],
        },
        { key: 'summary', label: 'وصف موجز للشركة أو الفكرة أو الشراكة المقترحة', type: 'textarea', required: true },
        { key: 'deck', label: 'هل لديك ملخص جدوى (Pitch Deck، ملف PDF، فيديو، وثائق، صور ونحوها)؟', type: 'select', required: true, options: ['نعم', 'لا'] },
        {
          key: 'deckLink',
          label: 'رابط الملف إن وُجد (اختياري)',
          type: 'text',
          required: false,
          latin: true,
          placeholder: 'https://…',
        },
        { key: 'website', label: 'الموقع الإلكتروني لشركتك أو مشروعك (اختياري)', type: 'text', required: false, latin: true },
        {
          key: 'ownership',
          label:
            'قبلت أن تحصل Vibes Ventures على نسبة 10% كملكية رسمية في نشاطك في حال إتمام أي شراكة مع أعضاء النادي، وفق بنود وضوابط اتفاقية برنامج شركاء النجاح.',
          type: 'agree',
          required: true,
          url: 'https://vibesholding.com/sp/',
        },
        {
          key: 'nda',
          label: 'اطلعت على اتفاقية عدم الإفصاح (NDA) وقرأت جميع بنودها، وأوافق عليها وألتزم بكافة الشروط والأحكام الواردة فيها.',
          type: 'agree',
          required: true,
          url: null,
        },
      ],
      order: 1,
    },
    {
      key: 'workshop',
      title: 'التسجيل في ورشة العمل',
      intro:
        'ورشة «مشروعك من الفكرة إلى التنفيذ»: ثلاثة أيام عملية من 17 إلى 19 أكتوبر 2026 في مقر النادي بالرياض وعبر الإنترنت. بعد التسجيل تتواصل معك الإدارة لإتمام الرسوم وتأكيد مقعدك.',
      access: 'signedIn',
      once: true,
      open: true,
      closedText: 'التسجيل في الورشة الحالية مغلق. تابع إعلانات النادي للورشة القادمة.',
      submitLabel: 'تسجيل',
      successText: 'استلمنا تسجيلك في الورشة، وستتواصل معك الإدارة لتأكيد مقعدك وإتمام الرسوم.',
      fields: [
        { key: 'city', label: 'المدينة', type: 'text', required: true },
        { key: 'mode', label: 'طريقة الحضور', type: 'select', required: true, options: ['حضوريًا في مقر النادي بالرياض', 'عبر الإنترنت'] },
        { key: 'bio', label: 'نبذة مختصرة عنك وعن نشاطك', type: 'textarea', required: true },
        { key: 'terms', label: 'أوافق على الشروط والأحكام الخاصة بالورشة.', type: 'agree', required: true, url: 'https://vcmem.com/workshop/' },
      ],
      order: 2,
    },
    // M73 note: the «شخصية ومسيرة» application lives in the M11 profiles pipeline (/people/apply:
    // apply → committee review → published as it is), NOT here — a forms inbox would have made the
    // admin retype every approved profile. The 'member' access level stays available for later forms.
    // M83 (owner, 2026-10-17): the club publishes the entrepreneur's app on both stores — the one
    // condition is an active annual membership, so this is the first 'member' form.
    {
      key: 'app-publish',
      title: 'نشر تطبيقك على Android و iOS',
      intro:
        'بعضويتك السنوية ينشر النادي تطبيقك على Google Play وApp Store بدون رسوم. املأ بيانات تطبيقك وستتواصل معك الإدارة لاستلام الملفات وإتمام النشر.',
      access: 'member',
      once: false,
      open: true,
      closedText: 'استقبال طلبات النشر متوقف حاليًا. تابع إعلانات النادي أو راسل الإدارة.',
      submitLabel: 'أرسل طلب النشر',
      successText: 'استلمنا طلب نشر تطبيقك، وستتواصل معك الإدارة لاستلام الملفات وحسابات المتاجر وإتمام النشر.',
      fields: [
        { key: 'appName', label: 'اسم التطبيق', type: 'text', required: true },
        { key: 'summary', label: 'وصف مختصر للتطبيق وما يقدمه', type: 'textarea', required: true },
        { key: 'platforms', label: 'المنصات المطلوبة', type: 'select', required: true, options: ['Android وiOS معًا', 'Android فقط', 'iOS فقط'] },
        { key: 'status', label: 'حالة التطبيق', type: 'select', required: true, options: ['جاهز للنشر', 'قيد التطوير', 'فكرة أحتاج تطويرها أولًا'] },
        { key: 'link', label: 'رابط تجريبي أو موقع التطبيق (اختياري)', type: 'text', required: false, latin: true },
        { key: 'whatsapp', label: 'رقم واتساب للتواصل', type: 'text', required: true, latin: true, prefill: 'phone' },
        { key: 'ownership', label: 'أقرّ بأنني مالك التطبيق أو مفوَّض رسميًا بنشره.', type: 'agree', required: true },
      ],
      order: 3,
    },
    // M119 (owner, 2026-10-21): one registration form per club meetup (vibesholding.com/mup).
    // The app renders each under its meetup page (content/meetups.ts); repeat registrations stay
    // open because every meetup recurs.
    {
      key: 'meetup-five-minutes',
      title: 'التسجيل في ملتقى «5 دقائق»',
      intro: 'سجّل حضورك أو قدّم مشروعك في ملتقى «5 دقائق»، وستتواصل معك الإدارة لتأكيد التفاصيل وموعد الملتقى القادم.',
      access: 'signedIn',
      once: false,
      open: true,
      closedText: 'التسجيل في الملتقى مغلق حاليًا. تابع إعلانات النادي للملتقى القادم.',
      submitLabel: 'سجّل الآن',
      successText: 'استلمنا تسجيلك في ملتقى «5 دقائق»، وستتواصل معك الإدارة لتأكيد التفاصيل والموعد.',
      fields: [
        {
          key: 'role',
          label: 'صفة مشاركتك',
          type: 'select',
          required: true,
          options: ['أعرض مشروعي كرائد أعمال', 'أحضر كمستثمر', 'أحضر للتعرّف على التجربة'],
        },
        { key: 'project', label: 'اسم مشروعك في بنك المشاريع (لمن يعرض مشروعه)', type: 'text', required: false },
        { key: 'mode', label: 'طريقة الحضور', type: 'select', required: true, options: ['حضوريًا في مقر النادي بالرياض', 'عبر الإنترنت'] },
        { key: 'whatsapp', label: 'رقم واتساب للتواصل', type: 'text', required: true, latin: true, prefill: 'phone' },
        { key: 'notes', label: 'ملاحظات إضافية (اختياري)', type: 'textarea', required: false },
      ],
      order: 4,
    },
    {
      key: 'meetup-private-pitch',
      title: 'التسجيل في ملتقى «الطرح الخاص»',
      intro: 'سجّل حضورك في ملتقى «الطرح الخاص» (S-Event)، وستتواصل معك الإدارة بتفاصيل الطرح القادم وموعده.',
      access: 'signedIn',
      once: false,
      open: true,
      closedText: 'التسجيل في الملتقى مغلق حاليًا. تابع إعلانات النادي للطرح القادم.',
      submitLabel: 'سجّل حضورك',
      successText: 'استلمنا تسجيلك في ملتقى «الطرح الخاص»، وستتواصل معك الإدارة بتفاصيل الطرح القادم.',
      fields: [
        { key: 'mode', label: 'طريقة الحضور', type: 'select', required: true, options: ['حضوريًا في مقر النادي بالرياض', 'عبر الإنترنت'] },
        { key: 'whatsapp', label: 'رقم واتساب للتواصل', type: 'text', required: true, latin: true, prefill: 'phone' },
        { key: 'bio', label: 'نبذة مختصرة عنك وعن اهتمامك', type: 'textarea', required: true },
      ],
      order: 5,
    },
    {
      key: 'meetup-elite-challenge',
      title: 'التسجيل في ملتقى «تحدي النخبة»',
      intro: 'انضم إلى ملتقى «تحدي النخبة»: مستثمرون يتنافسون على شراكات نوعية مع مشاريع معتمدة من بنك المشاريع.',
      access: 'signedIn',
      once: false,
      open: true,
      closedText: 'التسجيل في الملتقى مغلق حاليًا. تابع إعلانات النادي للملتقى القادم.',
      submitLabel: 'انضم الآن',
      successText: 'استلمنا تسجيلك في ملتقى «تحدي النخبة»، وستتواصل معك الإدارة لتأكيد التفاصيل والموعد.',
      fields: [
        {
          key: 'side',
          label: 'صفة مشاركتك',
          type: 'select',
          required: true,
          options: ['أنضم كمستثمر', 'أرشّح مشروعي للعرض'],
        },
        { key: 'project', label: 'اسم مشروعك في بنك المشاريع (لمن يرشّح مشروعه)', type: 'text', required: false },
        { key: 'mode', label: 'طريقة الحضور', type: 'select', required: true, options: ['حضوريًا في مقر النادي بالرياض', 'عبر الإنترنت'] },
        { key: 'whatsapp', label: 'رقم واتساب للتواصل', type: 'text', required: true, latin: true, prefill: 'phone' },
        { key: 'bio', label: 'نبذة مختصرة عنك', type: 'textarea', required: true },
      ],
      order: 6,
    },
    {
      key: 'meetup-open-day',
      title: 'التسجيل في ملتقى «اليوم المفتوح»',
      intro: 'انضم إلى «اليوم المفتوح»: مساحة حرة للتعارف وتبادل التجارب بين أعضاء النادي بلا أجندة مسبقة.',
      access: 'signedIn',
      once: false,
      open: true,
      closedText: 'التسجيل في الملتقى مغلق حاليًا. تابع إعلانات النادي لليوم المفتوح القادم.',
      submitLabel: 'انضم الآن',
      successText: 'استلمنا تسجيلك في «اليوم المفتوح»، وستتواصل معك الإدارة بالموعد والتفاصيل.',
      fields: [
        { key: 'mode', label: 'طريقة الحضور', type: 'select', required: true, options: ['حضوريًا في مقر النادي بالرياض', 'عبر الإنترنت'] },
        { key: 'whatsapp', label: 'رقم واتساب للتواصل', type: 'text', required: true, latin: true, prefill: 'phone' },
        { key: 'topic', label: 'موضوع أو تجربة تودّ الحديث عنها (اختياري)', type: 'textarea', required: false },
      ],
      order: 7,
    },
    {
      key: 'meetup-your-own',
      title: 'اصنع ملتقاك الخاص',
      intro: 'احكِ لنا عن ملتقاك: نتولى دعوة المهتمين وإدارة الملتقى باحترافية في مقر النادي وعبر الإنترنت، وستتواصل معك الإدارة بالتفاصيل والترتيبات.',
      access: 'signedIn',
      once: false,
      open: true,
      closedText: 'استقبال طلبات الملتقيات الخاصة متوقف حاليًا. راسل الإدارة أو تابع إعلانات النادي.',
      submitLabel: 'اصنع ملتقاك الآن',
      successText: 'استلمنا طلب ملتقاك الخاص، وستتواصل معك الإدارة لتفاصيل الترتيبات والموعد.',
      fields: [
        {
          key: 'goal',
          label: 'هدف ملتقاك',
          type: 'select',
          required: true,
          options: ['طرح مشروعي الخاص', 'إقامة ورشة عمل', 'تدشين منتج جديد', 'جذب مهتمين بفكرتي', 'البحث عن شركاء', 'أخرى'],
        },
        { key: 'idea', label: 'احكِ لنا عن فكرة ملتقاك', type: 'textarea', required: true },
        { key: 'audience', label: 'الجمهور الذي تريد الوصول إليه', type: 'text', required: true },
        { key: 'whatsapp', label: 'رقم واتساب للتواصل', type: 'text', required: true, latin: true, prefill: 'phone' },
      ],
      order: 8,
    },
  ],
  // v7 (owner, 2026-10-26): «نشر تطبيقك على Android و iOS» replaces «على المتجرين».
  // v8 (M170, 2026-10-31): the non-member notice above the شركاء النجاح form.
  version: 8,
  updatedAt: '2026-10-31T00:00:00.000Z',
};

/** Writes the seed when no forms content exists yet, or when the stored seed is older than this one. */
export async function ensureFormsSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<FormsContent>(FORMS_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= FORMS_SEED.version) return false;
  await kv.set(FORMS_CONTENT_KEY, FORMS_SEED);
  return true;
}

/** The block as the app of one language reads it (see content/edits.ts). */
export async function getFormsContent(kv: KV, lang: AppLang = 'ar'): Promise<FormsContent> {
  return localizeBlock(kv, 'forms', (await kv.get<FormsContent>(FORMS_CONTENT_KEY)) ?? FORMS_SEED, FORMS_EN, lang);
}
