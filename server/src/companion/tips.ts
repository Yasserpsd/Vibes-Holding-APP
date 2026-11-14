import { isArabic } from '../content/i18n.js';
import type { AppLang } from '../lang.js';

/**
 * M176 (owner, 2026-11-01): «اقتراح يوصل لكل شخص بإسمه حسب شخصيته وحسب ما تعرفه… يومي… بيع لكل
 * الخدمات الموجودة في النادي». Every member gets ONE suggestion a day, addressed by his first name,
 * picked by persona and membership and rotated per member (two members rarely get the same one on
 * the same day). Built from the club's real benefits — no AI cost at send time, no promised returns.
 * The same tips fill «مقترح لك» rows in the notifications tab for the last days.
 *
 * Owner (2026-11-02, «طور اكتر طريقة تعامل المستشار مع الشخص في الرسايل»): the advisor writes like a
 * person who thought of you today — he opens with the member, offers to do the work himself («أرتّب
 * لك», «أحجز لك»), and invites a reply, instead of reciting the service. Same rules as ever: no
 * «مجاني», «رصيد» and «الشراكات», no promised returns.
 */

export type TipAudience = { persona: string | null; member: boolean };

type TipCopy = { title: string; body: string };

type TipDef = {
  key: string;
  /** Where a tap goes in the app. */
  route: string;
  /** Personas this tip fits; empty = everyone. */
  personas?: string[];
  /** `member` = only annual members, `guest` = only non-members, absent = both (each with its own words). */
  only?: 'member' | 'guest';
  /** Placeholders the copy needs from the day's context ({project}, {deal}…); skipped when missing. */
  needs?: string[];
  ar: { member: TipCopy; guest?: TipCopy };
  en: { member: TipCopy; guest?: TipCopy };
};

const TIPS: TipDef[] = [
  {
    key: 'deal',
    route: '/services',
    needs: ['deal', 'percent'],
    ar: {
      member: { title: '{name}، كود {deal} مفعّل لك', body: 'جهّزت لك خصم {percent}% هذا الشهر — يُطبَّق تلقائيًا على الورش والخدمات داخل التطبيق دون أن تكتب شيئًا. استفد منه قبل نهاية الشهر، وأنا هنا إن احترت بين الخيارات.' },
    },
    en: {
      member: { title: '{name}, code {deal} is on for you', body: 'I set up {percent}% off for you this month — applied automatically to workshops and services in the app, nothing to type. Use it before the month ends; I am here if you want help choosing.' },
    },
  },
  {
    key: 'famous',
    route: '/service/famous',
    ar: {
      member: { title: '{name}، قصتك تستحق أن تُروى', body: 'أرى أن مسيرتك تستحق أن يعرفها أعضاء النادي. «شخصية ومسيرة» متاحة لك بدون رسوم بعضويتك — قل لي متى تحب أن نبدأ وأرافقك خطوة بخطوة.' },
      guest: { title: '{name}، قصتك تستحق أن تُروى', body: '«شخصية ومسيرة» تعرّف أعضاء النادي بمسيرتك، بدون رسوم مع العضوية السنوية — اسألني عنها وأشرح لك كيف تبدأ.' },
    },
    en: {
      member: { title: '{name}, your story deserves the spotlight', body: 'Your journey deserves to be known by the members. «Profile & Journey» is yours at no charge with your membership — tell me when you want to start and I will walk you through it.' },
      guest: { title: '{name}, your story deserves the spotlight', body: '«Profile & Journey» introduces you to the club members, at no charge with the annual membership — ask me and I will show you how to start.' },
    },
  },
  {
    key: 'credit',
    route: '/projects',
    personas: ['investor', 'neutral'],
    only: 'member',
    ar: { member: { title: '{name}، رصيدك في بنك المشاريع ينتظرك', body: 'رصيدك يفتح لك تفاصيل المشاريع والتواصل مع مؤسسيها مباشرة. أخبرني بما يهمك — قطاعًا أو فكرة — وأرشّح لك اليوم ما يناسبك.' } },
    en: { member: { title: '{name}, your Projects Bank credit is waiting', body: 'Your credit unlocks project details and direct contact with their founders. Tell me what interests you — a sector or an idea — and I will pick the right one for you today.' } },
  },
  {
    key: 'project',
    route: '/projects',
    personas: ['investor', 'neutral'],
    needs: ['project', 'sector'],
    ar: {
      member: { title: '{name}، مشروع مرشّح لك اليوم', body: 'وقع اختياري اليوم على «{project}» في قطاع {sector}. افتحه برصيدك في بنك المشاريع، وأنا معك إن أردت رأيًا قبل أن تقرر.' },
      guest: { title: '{name}، مشروع مرشّح لك اليوم', body: 'وقع اختياري اليوم على «{project}» في قطاع {sector}. تصفّحه في بنك المشاريع، وحدّثني إن أحببت أن أخبرك المزيد عنه.' },
    },
    en: {
      member: { title: '{name}, a project picked for you today', body: 'Today I picked «{project}» in {sector} for you. Unlock it with your Projects Bank credit — and I am here if you want a second opinion before you decide.' },
      guest: { title: '{name}, a project picked for you today', body: 'Today I picked «{project}» in {sector}. Browse it in the Projects Bank, and talk to me if you want to hear more about it.' },
    },
  },
  {
    key: 'meeting-room',
    route: '/service/meeting-room',
    ar: {
      member: { title: '{name}، قاعة اجتماعات فاخرة لك', body: 'اجتماعك القادم يستحق مكانًا يليق به. قاعة الاجتماعات في مقر النادي جاهزة لك بدون رسوم طوال عضويتك — قل لي الموعد الذي يناسبك وأرتّب لك الحجز كاملًا.' },
      guest: { title: '{name}، اجتماعك القادم في مقر النادي', body: 'اجتماعك القادم يستحق مكانًا يليق به: قاعة فاخرة بدون رسوم طوال مدة العضوية السنوية — وأنا أتولى الحجز عنك متى أردت.' },
    },
    en: {
      member: { title: '{name}, a premium meeting room for you', body: 'Your next meeting deserves the right room. The HQ meeting room is yours at no charge for your whole membership — tell me the time that suits you and I will arrange the booking.' },
      guest: { title: '{name}, host your next meeting at the HQ', body: 'Your next meeting deserves the right room: a premium hall at no charge for the whole annual membership — and I handle the booking whenever you want.' },
    },
  },
  {
    key: 'meetup',
    route: '/service/meetup',
    ar: {
      member: { title: '{name}، اصنع ملتقاك على مسرح النادي', body: 'تخيّل ملتقى باسمك على مسرح النادي يجمع جمهورك وشركاءك — وخصمك 50% جاهز. أخبرني بفكرتك وأمشي معك فيها من البداية.' },
      guest: { title: '{name}، اصنع ملتقاك على مسرح النادي', body: 'تخيّل ملتقى باسمك على مسرح النادي يجمع جمهورك وشركاءك — وأعضاء النادي يحصلون على خصم 50%. أخبرني بفكرتك وأدلّك على الخطوات.' },
    },
    en: {
      member: { title: '{name}, host your meetup on the club stage', body: 'Picture a meetup in your name on the club stage, with your audience and partners — and your 50% discount is ready. Tell me your idea and I will walk it with you from the start.' },
      guest: { title: '{name}, host your meetup on the club stage', body: 'Picture a meetup in your name on the club stage, with your audience and partners — members get 50% off. Tell me your idea and I will show you the steps.' },
    },
  },
  {
    key: 'pitch-deck',
    route: '/service/pitch-deck',
    personas: ['entrepreneur', 'neutral'],
    ar: {
      member: { title: '{name}، قوِّ موقفك أمام المستثمرين', body: 'عرض تقديمي قوي يصنع فرقًا حقيقيًا أمام المستثمرين. فريقنا يصمّم لك Pitch Deck احترافيًا بخصمك 50% — أرسل لي فكرة مشروعك وأدلّك على الخطوة الأولى.' },
      guest: { title: '{name}، قوِّ موقفك أمام المستثمرين', body: 'عرض تقديمي قوي يصنع فرقًا حقيقيًا أمام المستثمرين — وأعضاء النادي يحصلون على خصم 50% على تصميمه. أرسل لي فكرة مشروعك وأدلّك على الخطوة الأولى.' },
    },
    en: {
      member: { title: '{name}, stand stronger before investors', body: 'A strong deck makes a real difference before investors. Our team designs your professional Pitch Deck at your 50% discount — send me your project idea and I will point you to the first step.' },
      guest: { title: '{name}, stand stronger before investors', body: 'A strong deck makes a real difference before investors — and members get 50% off its design. Send me your project idea and I will point you to the first step.' },
    },
  },
  {
    key: 'momentum',
    route: '/service/momentum',
    ar: {
      // Owner (2026-11-02): Momentum is open to everyone, its marketing packages are built on request,
      // and the member discount covers every Momentum service.
      member: { title: '{name}، مومنتوم تبني حضورك الرقمي', body: 'موقع، تطبيق، أو باقة تسويق تُصمَّم حسب طلبك — وخصمك 50% كعضو يشمل جميع خدمات مومنتوم. اطلبها من التطبيق ويتواصل معك الفريق مباشرة.' },
      guest: { title: '{name}، مومنتوم تبني حضورك الرقمي', body: 'موقع، تطبيق، أو باقة تسويق تُصمَّم حسب طلبك — مومنتوم متاحة للجميع، وأعضاء النادي يحصلون على خصم 50% على جميع خدماتها.' },
    },
    en: {
      member: { title: '{name}, Momentum builds your digital presence', body: 'A website, an app, or a marketing package built on your request — and your 50% member discount covers every Momentum service. Request it in the app and the team reaches you directly.' },
      guest: { title: '{name}, Momentum builds your digital presence', body: 'A website, an app, or a marketing package built on your request — Momentum is open to everyone, and members get 50% off every service.' },
    },
  },
  {
    key: 'studio',
    route: '/service/studio',
    ar: {
      member: { title: '{name}، سجّل حلقتك في بودكاست الملتقى', body: 'حلقتك القادمة تستحق صوتًا وصورة باحتراف. الاستديو محجوز لك بخصم 50% وبلا حد للاستخدام — قل لي الموعد وأرتّبه لك.' },
      guest: { title: '{name}، صوتك يستحق منصة', body: 'حلقتك القادمة تستحق صوتًا وصورة باحتراف. استديو بودكاست الملتقى جاهز لتسجيلها — وأعضاء النادي يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, record your episode at the podcast studio', body: 'Your next episode deserves professional sound and picture. The studio is yours at 50% off with no usage limit — tell me the time and I will arrange it.' },
      guest: { title: '{name}, your voice deserves a stage', body: 'Your next episode deserves professional sound and picture. The podcast studio is ready — and members get 50% off.' },
    },
  },
  {
    key: 'theater',
    route: '/service/theater',
    ar: {
      member: { title: '{name}، مسرح النادي لفعاليتك', body: 'إطلاق مشروعك أو فعاليتك من مسرح النادي يمنحها حضورًا مختلفًا — وخصمك 50% جاهز. أخبرني بالفكرة وأرتّب لك التفاصيل.' },
      guest: { title: '{name}، مسرح النادي لفعاليتك', body: 'إطلاق فعاليتك من مسرح النادي يمنحها حضورًا مختلفًا أمام جمهور يفهم ما تبني — وأعضاء النادي يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, the club theater for your event', body: 'Launching your project or event from the club theater gives it a different presence — and your 50% discount is ready. Tell me the idea and I will arrange the details.' },
      guest: { title: '{name}, the club theater for your event', body: 'Launching your event from the club theater gives it a different presence, before an audience that gets what you are building — members get 50% off.' },
    },
  },
  {
    key: 'workshop',
    route: '/service/workshop',
    ar: {
      member: { title: '{name}، مقعدك في ورشة هذا الشهر', body: 'ورشة هذا الشهر مقاعدها محدودة، وخصمك 50% كعضو جاهز. أخبرني إن أحببت أن أحجز لك مقعدك قبل أن تكتمل.' },
      guest: { title: '{name}، مقعدك في ورشة هذا الشهر', body: 'ورش عملية مع خبراء يشاركونك تجاربهم — احجز مقعدك مبكرًا، وأعضاء النادي يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, your seat at this month\'s workshop', body: 'Seats at this month\'s workshop are limited, and your 50% member discount is ready. Tell me if you want me to hold your seat before it fills up.' },
      guest: { title: '{name}, your seat at this month\'s workshop', body: 'Hands-on workshops with experts who share their experience — book early; members get 50% off.' },
    },
  },
  {
    key: 'repost',
    route: '/service/repost',
    personas: ['entrepreneur'],
    only: 'member',
    ar: { member: { title: '{name}، أبرز مشروعك هذا الشهر', body: 'من حقك هذا الشهر إبراز مشروعك على منصات النادي ضمن عضويتك — لم تستخدمه بعد؟ قل لي وأجهّز لك الظهور.' } },
    en: { member: { title: '{name}, feature your project this month', body: 'This month\'s feature of your project on the club platforms is part of your membership — haven\'t used it yet? Tell me and I will set it up.' } },
  },
  {
    key: 'success-partners',
    route: '/service/success-partners',
    personas: ['entrepreneur'],
    ar: {
      member: { title: '{name}، اعرض مشروعك على المستثمرين', body: 'مشروعك جاهز ليراه المستثمرون؟ سجّله في «شركاء النجاح» — لك أولوية في التقييم والعرض كعضو، وأنا أرافقك في كل خطوة.' },
      guest: { title: '{name}، اعرض مشروعك على المستثمرين', body: 'مشروعك جاهز ليراه المستثمرون؟ سجّله في «شركاء النجاح» ليُعرض على أعضاء النادي بعد التقييم — وأنا أرافقك في خطوات التسجيل.' },
    },
    en: {
      member: { title: '{name}, put your project before investors', body: 'Is your project ready to be seen? Register it in «Success Partners» — you get member priority in review and showcase, and I will be with you at every step.' },
      guest: { title: '{name}, put your project before investors', body: 'Is your project ready to be seen? Register it in «Success Partners» to be shown to the members after review — and I will walk you through the registration.' },
    },
  },
  {
    key: 'consultation',
    route: '/advisor',
    ar: {
      member: { title: '{name}، استشارتك اليوم بدون رسوم', body: 'كيف تسير أمورك هذه الأيام؟ أنا هنا طوال اليوم لأي قرار في مشروعك أو استثمارك — اكتب لي وأجيبك فورًا، بدون رسوم.' },
      guest: { title: '{name}، مستشارك معك', body: 'كيف تسير أمورك هذه الأيام؟ حدّثني عن خطوتك القادمة في الاستثمار أو ريادة الأعمال، وأرشّح لك ما يناسبك في النادي.' },
    },
    en: {
      member: { title: '{name}, your consultation today, at no charge', body: 'How are things going these days? I am here all day for any decision in your project or investment — write to me and I will answer right away, at no charge.' },
      guest: { title: '{name}, your advisor is here', body: 'How are things going these days? Tell me about your next step in investing or entrepreneurship, and I will point you to what fits in the club.' },
    },
  },
  {
    key: 'membership',
    route: '/membership',
    only: 'guest',
    ar: { guest: { title: '{name}، كل هذا ضمن عضوية واحدة', body: 'قاعة اجتماعات بدون رسوم، خصم 50% على خدمات النادي وخدمات مومنتوم، ورصيد في بنك المشاريع — كلها بعضوية واحدة من داخل التطبيق. اسألني عن أي تفصيلة قبل أن تقرر.' }, member: { title: '', body: '' } },
    en: { guest: { title: '{name}, all of this in one membership', body: 'A meeting room at no charge, 50% off club and Momentum services, and Projects Bank credit — all in one membership, inside the app. Ask me anything before you decide.' }, member: { title: '', body: '' } },
  },
];

export type Tip = { key: string; title: string; body: string; route: string };

/** A stable daily index, Riyadh calendar. */
export const tipDayIndex = (now: number): number => Math.floor((now + 3 * 3_600_000) / 86_400_000);

function fits(tip: TipDef, audience: TipAudience, context: Record<string, string | null>): boolean {
  if (tip.only === 'member' && !audience.member) return false;
  if (tip.only === 'guest' && audience.member) return false;
  if (tip.personas?.length && audience.persona && !tip.personas.includes(audience.persona)) return false;
  return (tip.needs ?? []).every((key) => context[key] != null);
}

const NAME_PREFIX = /^(عبد|عبدال|أبو|ابو|أم|ام|abdul|abdel|abd|abu|umm)$/i;

/** First word of a display name; empty names read naturally without it. M232: a compound first name («عبد الله», «أبو بكر») stays whole. */
export function firstName(name: string | null | undefined): string {
  const [first = '', second] = (name ?? '').trim().split(/\s+/);
  return second && NAME_PREFIX.test(first) ? `${first} ${second}` : first;
}

/**
 * The member's tip for one day. `seed` spreads members over the pool (the contact id), so the
 * rotation walks every service over the days without two members marching in step.
 */
export function tipFor(audience: TipAudience & { name: string; lang: AppLang; seed: number }, day: number, context: Record<string, string | null>): Tip | null {
  // M239 (owner, 2026-11-14): English copy never prints an Arabic word. A context value or name still in Arabic is
  // dropped, so a tip that needs it leaves the pool and one without the name loses it.
  if (audience.lang === 'en') {
    context = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, value != null && isArabic(value) ? null : value]));
    if (isArabic(audience.name)) audience = { ...audience, name: '' };
  }
  const pool = TIPS.filter((tip) => fits(tip, audience, context));
  if (!pool.length) return null;
  const tip = pool[(day + audience.seed) % pool.length] as TipDef;
  const copies = tip[audience.lang === 'en' ? 'en' : 'ar'];
  const copy = audience.member ? copies.member : (copies.guest ?? copies.member);
  const values: Record<string, string | null> = { ...context, name: audience.name };
  const fill = (text: string): string =>
    text.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => values[key] ?? match).replace(/^،\s*|^,\s*/u, '').trim();
  // No name known: «محمد، …» becomes a clean sentence instead of a dangling comma.
  const bare = audience.name ? fill(copy.title) : fill(copy.title.replace(/^\{name\}[،,]\s*/u, ''));
  const title = bare.charAt(0).toUpperCase() + bare.slice(1);
  return { key: tip.key, title, body: fill(copy.body), route: tip.route };
}
