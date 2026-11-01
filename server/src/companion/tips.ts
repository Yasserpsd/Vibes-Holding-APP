import type { AppLang } from '../lang.js';

/**
 * M176 (owner, 2026-11-01): «اقتراح يوصل لكل شخص بإسمه حسب شخصيته وحسب ما تعرفه… يومي… بيع لكل
 * الخدمات الموجودة في النادي». Every member gets ONE suggestion a day, addressed by his first name,
 * picked by persona and membership and rotated per member (two members rarely get the same one on
 * the same day). Built from the club's real benefits — no AI cost at send time, no promised returns.
 * The same tips fill «مقترح لك» rows in the notifications tab for the last days.
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
      member: { title: '{name}، كود {deal} مفعّل لك', body: 'خصم {percent}% يُطبَّق تلقائيًا هذا الشهر على الورش والخدمات داخل التطبيق — بدون أن تكتب شيئًا.' },
    },
    en: {
      member: { title: '{name}, code {deal} is on for you', body: '{percent}% off, applied automatically this month to workshops and services in the app — nothing to type.' },
    },
  },
  {
    key: 'famous',
    route: '/service/famous',
    ar: {
      member: { title: '{name}، قصتك تستحق أن تُروى', body: 'انضم إلى «شخصية ومسيرة» بدون رسوم بعضويتك السنوية، ودع أعضاء النادي يتعرّفون على مسيرتك.' },
      guest: { title: '{name}، قصتك تستحق أن تُروى', body: '«شخصية ومسيرة» تعرّف أعضاء النادي بمسيرتك — بدون رسوم مع العضوية السنوية.' },
    },
    en: {
      member: { title: '{name}, your story deserves the spotlight', body: 'Join «Profile & Journey» at no charge with your annual membership and let the members meet you.' },
      guest: { title: '{name}, your story deserves the spotlight', body: '«Profile & Journey» introduces you to the club members — at no charge with the annual membership.' },
    },
  },
  {
    key: 'credit',
    route: '/projects',
    personas: ['investor', 'neutral'],
    only: 'member',
    ar: { member: { title: '{name}، رصيدك في بنك المشاريع ينتظرك', body: 'استخدم رصيدك لفتح تفاصيل مشروع يناسب اهتماماتك والتواصل مع مؤسسه مباشرة.' } },
    en: { member: { title: '{name}, your Projects Bank credit is waiting', body: 'Use your credit to unlock a project that fits your interests and reach its founder directly.' } },
  },
  {
    key: 'project',
    route: '/projects',
    personas: ['investor', 'neutral'],
    needs: ['project', 'sector'],
    ar: {
      member: { title: '{name}، مشروع مرشّح لك اليوم', body: '«{project}» في قطاع {sector} — افتحه برصيدك في بنك المشاريع واسألني عنه قبل أن تقرر.' },
      guest: { title: '{name}، مشروع مرشّح لك اليوم', body: '«{project}» في قطاع {sector} — تصفّحه في بنك المشاريع واسألني عنه.' },
    },
    en: {
      member: { title: '{name}, a project picked for you today', body: '«{project}» in {sector} — unlock it with your Projects Bank credit and ask me about it first.' },
      guest: { title: '{name}, a project picked for you today', body: '«{project}» in {sector} — browse it in the Projects Bank and ask me about it.' },
    },
  },
  {
    key: 'meeting-room',
    route: '/service/meeting-room',
    ar: {
      member: { title: '{name}، قاعة اجتماعات فاخرة لك', body: 'قاعة الاجتماعات في مقر النادي بدون رسوم طوال عضويتك — اطلب مني وأحجزها لك في الوقت الذي تختاره.' },
      guest: { title: '{name}، اجتماعك القادم في مقر النادي', body: 'قاعة اجتماعات فاخرة بدون رسوم طوال مدة العضوية السنوية — وأنا أحجزها لك متى أردت.' },
    },
    en: {
      member: { title: '{name}, a premium meeting room for you', body: 'The HQ meeting room is yours at no charge for your whole membership — ask me and I will book it for you.' },
      guest: { title: '{name}, host your next meeting at the HQ', body: 'A premium meeting room at no charge for the whole annual membership — I book it whenever you want.' },
    },
  },
  {
    key: 'meetup',
    route: '/service/meetup',
    ar: {
      member: { title: '{name}، اصنع ملتقاك على مسرح النادي', body: 'خصم 50% لك على «اصنع ملتقاك» — ملتقى باسمك على مسرح النادي يجمع جمهورك وشركاءك.' },
      guest: { title: '{name}، اصنع ملتقاك على مسرح النادي', body: 'ملتقى باسمك على مسرح النادي — وأعضاء النادي يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, host your meetup on the club stage', body: '50% off «Build Your Meetup» for you — an event in your name on the club stage.' },
      guest: { title: '{name}, host your meetup on the club stage', body: 'An event in your name on the club stage — members get 50% off.' },
    },
  },
  {
    key: 'pitch-deck',
    route: '/service/pitch-deck',
    personas: ['entrepreneur', 'neutral'],
    ar: {
      member: { title: '{name}، قوِّ موقفك أمام المستثمرين', body: 'خصم 50% لك على تصميم Pitch Deck احترافي يعرض مشروعك بثقة ووضوح.' },
      guest: { title: '{name}، قوِّ موقفك أمام المستثمرين', body: 'Pitch Deck احترافي يعرض مشروعك بثقة — وأعضاء النادي يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, stand stronger before investors', body: '50% off a professional Pitch Deck that presents your project with confidence.' },
      guest: { title: '{name}, stand stronger before investors', body: 'A professional Pitch Deck for your project — members get 50% off.' },
    },
  },
  {
    key: 'momentum',
    route: '/service/momentum',
    ar: {
      member: { title: '{name}، موقعك الإلكتروني مع مومنتوم', body: 'مومنتوم تصمّم وتنفّذ موقعك وتطبيقك وتسويقك — بخصم 50% لك كعضو في النادي.' },
      guest: { title: '{name}، موقعك الإلكتروني مع مومنتوم', body: 'مومنتوم تصمّم وتنفّذ خدمات المنظومة كلها: المواقع والتطبيقات والتسويق — بخصم 50% للأعضاء.' },
    },
    en: {
      member: { title: '{name}, your website with Momentum', body: 'Momentum designs and builds your website, app and marketing — 50% off for you as a member.' },
      guest: { title: '{name}, your website with Momentum', body: 'Momentum builds websites, apps and marketing for the whole ecosystem — 50% off for members.' },
    },
  },
  {
    key: 'studio',
    route: '/service/studio',
    ar: {
      member: { title: '{name}، سجّل حلقتك في بودكاست الملتقى', body: 'خصم 50% لك على حجز استديو البودكاست، بلا حد للاستخدام.' },
      guest: { title: '{name}، صوتك يستحق منصة', body: 'استديو بودكاست الملتقى مجهّز لتسجيل حلقتك — والأعضاء يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, record your episode at the podcast studio', body: '50% off booking the podcast studio, with no usage limit.' },
      guest: { title: '{name}, your voice deserves a stage', body: 'The podcast studio is ready for your episode — members get 50% off.' },
    },
  },
  {
    key: 'theater',
    route: '/service/theater',
    ar: {
      member: { title: '{name}، مسرح النادي لفعاليتك', body: 'خصم 50% لك على حجز مسرح النادي لفعاليتك أو إطلاق مشروعك القادم.' },
      guest: { title: '{name}، مسرح النادي لفعاليتك', body: 'أطلق فعاليتك من مسرح النادي — والأعضاء يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, the club theater for your event', body: '50% off booking the club theater for your event or your next launch.' },
      guest: { title: '{name}, the club theater for your event', body: 'Launch your event from the club theater — members get 50% off.' },
    },
  },
  {
    key: 'workshop',
    route: '/service/workshop',
    ar: {
      member: { title: '{name}، مقعدك في ورشة هذا الشهر', body: 'احجز ورشة العمل القادمة بخصم 50% لأعضاء النادي — مقاعدها محدودة.' },
      guest: { title: '{name}، مقعدك في ورشة هذا الشهر', body: 'ورش عملية مع خبراء — احجز مقعدك الآن، والأعضاء يحصلون على خصم 50%.' },
    },
    en: {
      member: { title: '{name}, your seat at this month\'s workshop', body: 'Book the next workshop at 50% off for members — seats are limited.' },
      guest: { title: '{name}, your seat at this month\'s workshop', body: 'Hands-on workshops with experts — book now; members get 50% off.' },
    },
  },
  {
    key: 'repost',
    route: '/service/repost',
    personas: ['entrepreneur'],
    only: 'member',
    ar: { member: { title: '{name}، أبرز مشروعك هذا الشهر', body: 'إبراز مشروعك على منصات النادي مرة كل شهر ضمن عضويتك — لا تفوّت مرة هذا الشهر.' } },
    en: { member: { title: '{name}, feature your project this month', body: 'Your project on the club platforms once a month with your membership — don\'t miss this month\'s.' } },
  },
  {
    key: 'success-partners',
    route: '/service/success-partners',
    personas: ['entrepreneur'],
    ar: {
      member: { title: '{name}، اعرض مشروعك على المستثمرين', body: 'سجّل مشروعك في «شركاء النجاح» — أولوية لأعضاء النادي في التقييم والعرض.' },
      guest: { title: '{name}، اعرض مشروعك على المستثمرين', body: 'سجّل مشروعك في «شركاء النجاح» ليُعرض على أعضاء النادي بعد التقييم.' },
    },
    en: {
      member: { title: '{name}, put your project before investors', body: 'Register in «Success Partners» — members get priority in review and showcase.' },
      guest: { title: '{name}, put your project before investors', body: 'Register in «Success Partners» to be shown to the club members after review.' },
    },
  },
  {
    key: 'consultation',
    route: '/advisor',
    ar: {
      member: { title: '{name}، استشارتك اليوم بدون رسوم', body: 'اسألني عن أي قرار في مشروعك أو استثمارك — أنا مستشارك داخل النادي طوال اليوم.' },
      guest: { title: '{name}، مستشارك معك', body: 'اسألني عن خطوتك القادمة في الاستثمار أو ريادة الأعمال — وأرشّح لك ما يناسبك في النادي.' },
    },
    en: {
      member: { title: '{name}, your consultation today, at no charge', body: 'Ask me about any decision in your project or investment — I am your advisor inside the club.' },
      guest: { title: '{name}, your advisor is here', body: 'Ask me about your next step in investing or entrepreneurship — I will point you to what fits.' },
    },
  },
  {
    key: 'membership',
    route: '/membership',
    only: 'guest',
    ar: { guest: { title: '{name}، كل هذا ضمن عضوية واحدة', body: 'قاعة اجتماعات بدون رسوم، خصم 50% على خدمات النادي، ورصيد في بنك المشاريع — اشترك من داخل التطبيق.' }, member: { title: '', body: '' } },
    en: { guest: { title: '{name}, all of this in one membership', body: 'A meeting room at no charge, 50% off club services and Projects Bank credit — subscribe inside the app.' }, member: { title: '', body: '' } },
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

/** First word of a display name; empty names read naturally without it. */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * The member's tip for one day. `seed` spreads members over the pool (the contact id), so the
 * rotation walks every service over the days without two members marching in step.
 */
export function tipFor(audience: TipAudience & { name: string; lang: AppLang; seed: number }, day: number, context: Record<string, string | null>): Tip | null {
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
