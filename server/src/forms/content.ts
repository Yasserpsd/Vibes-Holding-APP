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
  /** Who may submit: the web form is public; a workshop seat needs the account. */
  access: 'everyone' | 'signedIn';
  /** One submission per account (409 after the first); public forms stay repeatable. */
  once: boolean;
  open: boolean;
  closedText: string;
  submitLabel: string;
  successText: string;
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
        'سجّل مشروعك في برنامج شركاء النجاح: تراجع لجنة متخصصة تسجيلك، ولا يُعرض المشروع على المستثمرين في بنك المشاريع إلا بعد اعتماده. الأعضاء المشتركون يحصلون على أولوية في التقديم والعرض.',
      access: 'everyone',
      once: false,
      open: true,
      closedText: 'التسجيل في البرنامج متوقف حاليًا. تابع إعلانات النادي أو راسل الإدارة.',
      submitLabel: 'إرسال الطلب',
      successText:
        'استلمنا تسجيل مشروعك في شركاء النجاح، وستراجعه لجنة البرنامج وتتواصل معك الإدارة. إن كان لديك ملخص جدوى أو ملفات إضافية فسيُطلب منك إرسالها عند التواصل.',
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
            'قبلت أن تحصل فايبز القابضة على نسبة 10% كملكية رسمية في نشاطك في حال إتمام أي شراكة مع أعضاء النادي، وفق بنود وضوابط اتفاقية برنامج شركاء النجاح.',
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
  ],
  version: 1,
  updatedAt: '2026-10-04T00:00:00.000Z',
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
