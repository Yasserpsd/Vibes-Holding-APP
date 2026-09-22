import { DAY_MS } from '../riyadh.js';
import type { MockChat } from './mockChat.js';
import type { HubEventKind, HubFeedEvent } from './types.js';

/**
 * Data of the in-memory hub behind the bridge v2 ops (docs/BRIDGE_V2.md 1.2 to 1.4): contacts, member
 * events, payments, tickets, leads, the mail queue, site knowledge and the public cards of `publish`.
 * `seedDemo()` fills a believable club (about 40 contacts over the last 60 days) so the dashboard can be
 * checked locally. Every name, phone and e-mail here is invented.
 */
export type MockRole = 'member' | 'admin' | 'publisher';

export type MockContact = {
  id: number;
  name: string;
  phone: string;
  phoneNorm: string;
  email: string;
  passHash: string;
  verified: boolean;
  jobTitle: string;
  persona: string;
  bio: string;
  company: string;
  city: string;
  website: string;
  social: string;
  avatar: string;
  isMember: boolean;
  memberDays: number;
  memberStartedAt: number | null;
  resetPending: boolean;
  role: MockRole;
  createdAt: number;
  verifiedAt: number | null;
  lastAt: number | null;
  lastLoginAt: number | null;
  /** Host of the site the contact was last seen on. */
  site: string;
  memo: string;
  notes: string;
  /** M32: the contact whose invite code this account registered with (0 = none), as the plugin stores it. */
  referredBy: number;
};

export type MockEvent = { id: number; contactId: number; kind: HubEventKind; days: number; source: string; ref: string; actorId: number; note: string; at: number };
export type MockPayment = { id: number; txnId: string; orderId: string; amountCents: number; currency: string; success: boolean; action: string; contactId: number; note: string; at: number };
export type MockTicket = { id: number; ref: string; contactId: number; eventTitle: string; eventDate: string; eventPlace: string; source: string; checkedIn: boolean; at: number };
export type MockLead = { id: number; contactId: number; site: string; ltype: string; reason: string; company: string; notes: string; status: string; at: number };
export type MockMail = { id: number; toEmail: string; subject: string; kind: string; status: 'pending' | 'sent' | 'failed'; attempts: number; at: number; sentAt: number | null };
export type MockKnowledge = { id: number; host: string; site: string; url: string; title: string; kind: string; excerpt: string; at: number };
export type MockCard = { key: string; kind: 'post' | 'event'; title: string; excerpt: string; url: string; image: string; event: HubFeedEvent | null; at: number };

export type MockState = {
  contacts: Map<number, MockContact>;
  events: MockEvent[];
  payments: MockPayment[];
  tickets: MockTicket[];
  leads: MockLead[];
  mail: MockMail[];
  knowledge: MockKnowledge[];
  cards: Map<string, MockCard>;
  counters: Record<string, number>;
};

export const MOCK_SITES: Record<string, string> = {
  'vcmem.com': 'نادي المستثمرين',
  'vibesholding.com': 'فايبز القابضة',
  app: 'تطبيق نادي المستثمرين',
};
/** Web prices exist on the hub's side only; the app server must keep them away from the app (rule 3). */
export const MOCK_MEMBERSHIP_CENTS = 190_000;
const WORKSHOP_CENTS = 15_000;

export function newMockState(): MockState {
  return { contacts: new Map(), events: [], payments: [], tickets: [], leads: [], mail: [], knowledge: [], cards: new Map(), counters: {} };
}

export function nextId(state: MockState, table: string): number {
  state.counters[table] = (state.counters[table] ?? 0) + 1;
  return state.counters[table];
}

export function blankContact(id: number, now: number): MockContact {
  return {
    id,
    name: '',
    phone: '',
    phoneNorm: '',
    email: '',
    passHash: '',
    verified: false,
    jobTitle: '',
    persona: '',
    bio: '',
    company: '',
    city: '',
    website: '',
    social: '',
    avatar: '',
    isMember: false,
    memberDays: 360,
    memberStartedAt: null,
    resetPending: false,
    // Tester rule of the mock: an account made through the app's sign-up is a hub admin once verified.
    role: 'admin',
    createdAt: now,
    verifiedAt: null,
    lastAt: null,
    lastLoginAt: null,
    site: 'app',
    memo: '',
    notes: '',
    referredBy: 0,
  };
}

const NAMES = [
  'عبدالله القحطاني', 'سارة العتيبي', 'محمد الشهري', 'نورة الدوسري', 'فهد المطيري', 'ريم الحربي', 'خالد الغامدي', 'هند الزهراني',
  'سلطان العنزي', 'لمى السبيعي', 'تركي البقمي', 'جواهر الشمري', 'ماجد العمري', 'دانة القرني', 'يوسف الرشيدي', 'أمل الجهني',
  'بندر السهلي', 'شهد المالكي', 'نايف العصيمي', 'غادة الخالدي', 'راكان الفيفي', 'منيرة التميمي', 'سعود البلوي', 'العنود الحازمي',
  'مشعل الثبيتي', 'روان اليامي', 'عبدالعزيز النفيعي', 'بشاير الرويلي', 'زياد الصاعدي', 'تهاني العوفي', 'حمد الهاجري', 'وعد المري',
  'أنس باوزير', 'لجين بخاري', 'طلال فقيه', 'مها عسيري', 'وليد نجار', 'رزان خياط', 'هشام زمزمي', 'أسيل حلواني',
];
const CITIES = ['الرياض', 'جدة', 'الدمام', 'الخبر', 'مكة المكرمة', 'المدينة المنورة', 'أبها', 'بريدة'];
const COMPANIES = ['', 'مؤسسة الأفق التجارية', 'شركة نماء التقنية', '', 'مجموعة الريادة', 'متجر لمسة', '', 'شركة مسار اللوجستية'];
const JOBS = ['رائد أعمال', 'مستثمر', 'مدير تطوير أعمال', 'مهندس برمجيات', 'مستشار مالي', 'صاحب متجر إلكتروني', 'مدير تسويق', 'طالب دراسات عليا'];
const PERSONA_KEYS = ['entrepreneur', 'investor', 'neutral'];
const LEAD_TYPES = ['membership', 'service', 'partner', 'contact', 'cooperation'];
const LEAD_REASONS: Record<string, string> = {
  membership: 'يسأل عن مزايا العضوية السنوية وطريقة تفعيلها',
  service: 'يطلب تفاصيل خدمة «اصنع ملتقاك» وحجز المسرح',
  partner: 'يبحث عن شريك لمشروع قائم في قطاع الأغذية',
  contact: 'يريد التواصل مع إدارة النادي',
  cooperation: 'يعرض تعاونًا إعلاميًا مع بودكاست الملتقى',
};
const QUESTIONS = [
  'ما هو بنك المشاريع وكيف أستفيد منه؟',
  'كيف أعرض مشروعي على المستثمرين؟',
  'ما مزايا العضوية السنوية؟',
  'متى موعد ملتقى «5 دقائق» القادم؟',
  'أبحث عن شريك في قطاع التقنية، من أين أبدأ؟',
  'هل يمكن حجز قاعة الاجتماعات هذا الأسبوع؟',
  'أريد التحدث مع الإدارة بخصوص شراكة',
];
const ANSWERS = [
  'بنك المشاريع يجمع مشاريع حقيقية تبحث عن شراكات، وتفتح بيانات التواصل مع المؤسس برصيد عضويتك.',
  'ارفع مشروعك عبر «شركاء النجاح» ويُنشر خلال 3 أيام كحد أقصى بعد المراجعة.',
  'العضوية تفتح لك الملتقيات والمقر ورصيد بنك المشاريع وخصومات المنظومة لعام كامل.',
  'الملتقى القادم يُعلن في التطبيق وفي قروبات النادي، وللأعضاء أولوية الحضور.',
  'ابدأ بتصفية المشاريع حسب القطاع ثم افتح المشروع الأقرب لاهتمامك.',
  'نعم، الحجز متاح للأعضاء بخصم 50% من شاشة الخدمات.',
  'حوّلت طلبك إلى فريق النادي وسيتواصلون معك هنا قريبًا.',
];
const PAGES = ['https://vcmem.com/', 'https://vcmem.com/membership/', 'https://vibesholding.com/projects/', 'app://advisor', 'app://projects'];

/**
 * One letter per seeded contact: A admin, B publisher (member), M member paid on the web, S member through the
 * store, N member from the pre-approval list (never expires), R renewed member, E member expiring soon,
 * X expired, U verified and unpaid, P waiting for the e-mail code, L lead without an account.
 */
const PLAN = 'AMMSUBLPMXUMSLUEPMNULMXUSRLPUMEXULMPUMSU';

/** Small deterministic generator: the demo set is the same on every start. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seedDemo(state: MockState, chat: MockChat, now: number): void {
  const random = mulberry32(20_260_920);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const cycle = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;
  const hours = (count: number): number => Math.round(count * 3_600_000);
  const event = (contactId: number, kind: HubEventKind, at: number, extra: Partial<MockEvent> = {}): void => {
    state.events.push({ id: nextId(state, 'event'), contactId, kind, days: 0, source: 'app', ref: '', actorId: 0, note: '', at, ...extra });
  };
  const mail = (toEmail: string, subject: string, kind: string, at: number, status: MockMail['status'] = 'sent'): void => {
    state.mail.push({ id: nextId(state, 'mail'), toEmail, subject, kind, status, attempts: status === 'pending' ? 0 : status === 'failed' ? 3 : 1, at, sentAt: status === 'sent' ? at + 120_000 : null });
  };

  [...PLAN].forEach((letter, index) => {
    const old = 'EXR'.includes(letter);
    // Accounts spread over the last 60 days; expiring, expired and renewed members joined about a year ago.
    const age = old ? (letter === 'X' ? 380 + index : 340 + (index % 20)) : Math.max(0.1, 59 - index * 1.5 - random());
    const createdAt = now - Math.round(age * DAY_MS) - hours(random() * 6);
    const id = nextId(state, 'contact');
    const contact = blankContact(id, createdAt);
    const phone = `05${String(50_000_000 + index * 104_729).slice(0, 8)}`;
    const account = letter !== 'L';
    Object.assign(contact, {
      name: cycle(NAMES, index),
      phone,
      phoneNorm: `966${phone.slice(1)}`,
      email: account || index % 2 === 0 ? `demo${id}@example.com` : '',
      passHash: account && letter !== 'N' ? 'seeded' : '',
      jobTitle: cycle(JOBS, index),
      persona: cycle(PERSONA_KEYS, index),
      bio: account ? 'عضو تجريبي في بيانات العرض المحلية.' : '',
      company: cycle(COMPANIES, index),
      city: pick(CITIES),
      role: letter === 'A' ? 'admin' : letter === 'B' ? 'publisher' : 'member',
      site: index % 3 === 0 ? 'vibesholding.com' : index % 3 === 1 ? 'vcmem.com' : 'app',
      memo: index % 5 === 0 ? 'مهتم بقطاع التقنية ويبحث عن شراكة تشغيلية.' : '',
    } satisfies Partial<MockContact>);
    state.contacts.set(id, contact);

    if (account && letter !== 'N') event(id, 'registered', createdAt);
    if (letter === 'P') {
      mail(contact.email, 'رمز تفعيل حسابك في نادي المستثمرين', 'verify', createdAt, index % 2 === 0 ? 'sent' : 'pending');
    } else if (account) {
      contact.verified = true;
      contact.verifiedAt = createdAt + hours(0.2 + random());
      contact.lastLoginAt = Math.min(now - hours(1), contact.verifiedAt + Math.round(random() * (now - contact.verifiedAt)));
      event(id, 'verified', contact.verifiedAt);
    }

    if ('BMSNREX'.includes(letter) && contact.verifiedAt !== null) {
      const startedAt = contact.verifiedAt + hours(1 + random() * 60);
      const source = letter === 'S' ? 'store' : letter === 'N' ? 'list' : index % 7 === 0 ? 'admin' : 'paymob';
      contact.isMember = true;
      contact.memberDays = 365;
      contact.memberStartedAt = letter === 'N' ? null : letter === 'E' ? now - (365 - 4 - (index % 3) * 9) * DAY_MS : startedAt;
      const activatedAt = contact.memberStartedAt ?? startedAt;
      event(id, 'activated', activatedAt, { days: 365, source, ref: source === 'paymob' ? `txn-${7000 + id}` : source === 'store' ? `GPA.${3300 + id}` : '' });
      if (source === 'paymob') {
        state.payments.push({ id: nextId(state, 'payment'), txnId: `${7000 + id}`, orderId: `${91_000 + id}`, amountCents: MOCK_MEMBERSHIP_CENTS, currency: 'SAR', success: true, action: 'membership', contactId: id, note: '', at: activatedAt });
      }
      mail(contact.email, 'أهلًا بك في نادي المستثمرين', 'welcome', activatedAt);
      if (letter === 'R') {
        // A renewal before the end keeps the remaining days: the period grows, the start stays.
        contact.memberDays += 365;
        event(id, 'renewed', now - 5 * DAY_MS - hours(3), { days: 365, source: 'store', ref: `GPA.${5500 + id}` });
      }
    }
    if (letter === 'U' && index % 3 === 0) {
      state.payments.push({ id: nextId(state, 'payment'), txnId: `${8000 + id}`, orderId: `${92_000 + id}`, amountCents: MOCK_MEMBERSHIP_CENTS, currency: 'SAR', success: false, action: 'membership', contactId: id, note: 'Declined', at: createdAt + hours(30) });
    }
    if (account && index % 6 === 1) {
      const at = Math.min(now - hours(2), createdAt + hours(50 + random() * 200));
      state.payments.push({ id: nextId(state, 'payment'), txnId: `${9000 + id}`, orderId: `${93_000 + id}`, amountCents: WORKSHOP_CENTS, currency: 'SAR', success: true, action: 'workshop', contactId: id, note: '', at });
      state.tickets.push({ id: nextId(state, 'ticket'), ref: `VC-${4100 + id}`, contactId: id, eventTitle: 'ملتقى «5 دقائق»', eventDate: new Date(now + 9 * DAY_MS).toISOString().slice(0, 10), eventPlace: 'مقر النادي بالرياض', source: 'paymob', checkedIn: false, at });
    }
    if (contact.isMember && index % 4 === 0) {
      state.tickets.push({ id: nextId(state, 'ticket'), ref: `VC-${5200 + id}`, contactId: id, eventTitle: 'أمسية الشراكات الشهرية', eventDate: new Date(now - 6 * DAY_MS).toISOString().slice(0, 10), eventPlace: 'مقر النادي بالرياض', source: 'member', checkedIn: index % 8 === 0, at: now - 12 * DAY_MS });
    }
    if (letter === 'L' || (letter === 'U' && index % 2 === 0)) {
      const ltype = cycle(LEAD_TYPES, index);
      state.leads.push({ id: nextId(state, 'lead'), contactId: id, site: contact.site, ltype, reason: LEAD_REASONS[ltype] ?? '', company: contact.company, notes: '', status: index % 4 === 0 ? 'done' : 'new', at: Math.min(now - hours(1), createdAt + hours(2 + random() * 40)) });
    }

    // Conversations: a few exchanges after the first visit, some of them in the last days.
    if (index % 4 !== 3) {
      const exchanges = 1 + (index % 4);
      const rows: { role: string; content: string; by?: string; at: number; pageUrl?: string }[] = [];
      for (let turn = 0; turn < exchanges; turn += 1) {
        const base = turn === exchanges - 1 && index % 3 === 0 ? now - hours(2 + random() * 40) : createdAt + hours(1 + turn * 26 + random() * 5);
        const at = Math.min(now - hours(0.5), base);
        const topic = (index + turn) % QUESTIONS.length;
        rows.push({ role: 'user', content: cycle(QUESTIONS, topic), at, pageUrl: cycle(PAGES, index + turn) });
        // Two threads wait for an answer and one was taken over by the staff.
        if (turn === exchanges - 1 && (index === 8 || index === 21)) continue;
        if (turn === exchanges - 1 && index === 12) rows.push({ role: 'human', by: 'فريق النادي', content: 'أهلًا بك، معك فريق النادي. نراجع طلبك ونعود إليك اليوم.', at: at + 240_000 });
        else rows.push({ role: 'assistant', content: cycle(ANSWERS, topic), at: at + 9_000 });
      }
      rows.sort((a, b) => a.at - b.at);
      chat.seed(id, rows);
      contact.lastAt = rows.at(-1)?.at ?? null;
    }
  });

  mail('demo2@example.com', 'جديد النادي هذا الأسبوع', 'weekly', now - 2 * DAY_MS);
  mail('demo3@example.com', 'دعوة: أمسية الشراكات الشهرية', 'campaign', now - hours(5), 'pending');
  mail('demo9@example.com', 'دعوة: أمسية الشراكات الشهرية', 'campaign', now - hours(5), 'pending');
  mail('demo12@example.com', 'دعوة: أمسية الشراكات الشهرية', 'campaign', now - hours(6), 'failed');

  const pages: [string, string, string, string, string][] = [
    ['vcmem.com', 'https://vcmem.com/location/', 'مقر نادي المستثمرين بالرياض', 'page', 'المقر مفتوح للأعضاء المشتركين من 10 صباحًا حتى 7 مساءً بعد حجز الموعد.'],
    ['vcmem.com', 'https://vcmem.com/membership/', 'عضوية نادي المستثمرين', 'page', 'العضوية السنوية 1,900 ريال بدلًا من 3,900 ريال لفترة محدودة. اشترك الآن.'],
    ['vcmem.com', 'https://vcmem.com/events/five-minutes/', 'ملتقى «5 دقائق»', 'post', 'خمس دقائق لكل رائد أعمال أمام المستثمرين، حضوريًا في الرياض وعبر الإنترنت.'],
    ['vibesholding.com', 'https://vibesholding.com/project/smart-logistics/', 'منصة لوجستية ذكية', 'project', 'مشروع تقني يربط المتاجر بشركات الشحن ويبحث عن شريك تشغيلي.'],
    ['vibesholding.com', 'https://vibesholding.com/project/cloud-kitchen/', 'مطبخ سحابي', 'project', 'مطبخ سحابي يخدم ثلاث علامات في الرياض ويخطط للتوسع إلى جدة.'],
    ['vibesholding.com', 'https://vibesholding.com/services/pitch-deck/', 'خدمة Pitch Deck', 'service', 'إعداد عرض استثماري احترافي لمشروعك مع مراجعة من خبراء المنظومة.'],
    ['vcmem.com', 'https://vcmem.com/blog/partnership-basics/', 'أساسيات اختيار الشريك', 'post', 'ما الذي تسأل عنه قبل أن تدخل في شراكة؟ خلاصة من أمسيات النادي.'],
    ['vibesholding.com', 'https://vibesholding.com/meeting/', 'المشاريع الذهبية', 'page', 'مشاريع تحمل علامة V من شركات المنظومة. المعلومات تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد.'],
  ];
  pages.forEach(([host, url, title, kind, excerpt], index) => {
    state.knowledge.push({ id: nextId(state, 'knowledge'), host, site: MOCK_SITES[host] ?? host, url, title, kind, excerpt, at: now - (pages.length - index) * 5 * DAY_MS });
  });
}
