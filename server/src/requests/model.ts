import type { AgendaEvent, AgendaRegistration } from '../agenda/service.js';
import type { ScheduledDeletion } from '../auth/deletion.js';
import type { PersonaChangeRequest } from '../auth/personaRequests.js';
import type { CardPrintRequest } from '../card/service.js';
import type { FormSubmission } from '../forms/service.js';
import type { PublicVisit, Visit } from '../hq/service.js';
import type { AppLang } from '../lang.js';
import type { PublicPayment } from '../payments/service.js';
import type { Profile } from '../profiles/service.js';
import type { WorkshopRegistration } from '../workshops/service.js';

/**
 * M138 «متابعة طلباتي»: ONE shape for every operation a member starts in the app — a card delivery
 * request, an HQ booking, a service request, a workshop or event registration, a form, a golden
 * interest, a persona or «شخصية ومسيرة» application, a scheduled deletion, a payment. The stores
 * keep their own rows; these mappers read them into the timeline the app shows, the receipt mail
 * the member gets and the push that follows every status change.
 */
export type RequestKind = 'card' | 'hq' | 'service' | 'workshop' | 'form' | 'golden' | 'agenda' | 'persona' | 'profile' | 'deletion' | 'payment';
export type RequestStatus = 'pending' | 'in_progress' | 'done' | 'rejected' | 'cancelled';
export type RequestRow = { label: string; labelEn: string; value: string };

export type MemberRequest = {
  kind: RequestKind;
  id: string;
  contactId: number;
  title: string;
  titleEn: string;
  status: RequestStatus;
  /** The short number the member quotes («طلب رقم …»): the invoice number for a payment, else 8 characters of the id. */
  number: string;
  createdAt: string;
  updatedAt: string | null;
  rows: RequestRow[];
  /** The administration's note on a decision, shown to the member as it was written. */
  note: string | null;
  /** The in-app route that shows this request (the push lands there); null = the timeline itself. */
  screen: string | null;
  /** A paid service: the amount and the invoice number; the card delivery: `noFee`. */
  amountSar: number | null;
  invoiceNo: number | null;
  noFee: boolean;
};

/** Where the mail goes and in which language. */
export type Recipient = { email: string; name: string; lang?: AppLang | null; contactEmail?: string | null };

export const KIND_LABEL: Record<RequestKind, { ar: string; en: string }> = {
  card: { ar: 'توصيل كارت العضوية', en: 'Membership card delivery' },
  hq: { ar: 'حجز في مقر النادي', en: 'HQ booking' },
  service: { ar: 'طلب خدمة', en: 'Service request' },
  workshop: { ar: 'التسجيل في ورشة', en: 'Workshop registration' },
  form: { ar: 'نموذج تسجيل', en: 'Registration form' },
  golden: { ar: 'اهتمام بفرصة شراكة', en: 'Partnership interest' },
  agenda: { ar: 'حضور فعالية', en: 'Event attendance' },
  persona: { ar: 'تغيير الفئة', en: 'Category change' },
  profile: { ar: 'شخصية ومسيرة', en: 'Member profile' },
  deletion: { ar: 'حذف الحساب', en: 'Account deletion' },
  payment: { ar: 'دفع خدمة', en: 'Service payment' },
};

export const STATUS_LABEL: Record<RequestStatus, { ar: string; en: string }> = {
  pending: { ar: 'قيد المراجعة', en: 'Under review' },
  in_progress: { ar: 'جارٍ التنفيذ', en: 'In progress' },
  done: { ar: 'تم', en: 'Done' },
  rejected: { ar: 'مرفوض', en: 'Declined' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
};

export const REQUEST_STATUSES: RequestStatus[] = ['pending', 'in_progress', 'done', 'rejected', 'cancelled'];

export function requestNumber(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function kindLabel(kind: RequestKind, lang: AppLang): string {
  return KIND_LABEL[kind][lang === 'en' ? 'en' : 'ar'];
}

export function statusLabel(status: RequestStatus, lang: AppLang): string {
  return STATUS_LABEL[status][lang === 'en' ? 'en' : 'ar'];
}

const row = (label: string, labelEn: string, value: string | null | undefined): RequestRow[] => {
  const text = (value ?? '').toString().trim();
  return text ? [{ label, labelEn, value: text }] : [];
};

type Base = Omit<MemberRequest, 'rows' | 'note' | 'screen' | 'amountSar' | 'invoiceNo' | 'noFee' | 'number' | 'updatedAt'> &
  Partial<Pick<MemberRequest, 'rows' | 'note' | 'screen' | 'amountSar' | 'invoiceNo' | 'noFee' | 'number' | 'updatedAt'>>;

function build(base: Base): MemberRequest {
  return {
    rows: [],
    note: null,
    screen: null,
    amountSar: null,
    invoiceNo: null,
    noFee: false,
    number: requestNumber(base.id),
    updatedAt: null,
    ...base,
  };
}

export function fromCard(request: CardPrintRequest): MemberRequest {
  return build({
    kind: 'card',
    id: request.id,
    contactId: request.contactId,
    // M162: pickup at the HQ or delivery to the address.
    title: request.method === 'pickup' ? 'استلام كارت العضوية المطبوع من المقر' : 'توصيل كارت العضوية المطبوع',
    titleEn: request.method === 'pickup' ? 'Printed membership card pickup at the HQ' : 'Printed membership card delivery',
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.doneAt,
    rows: [
      ...row('رقم العضوية', 'Membership no.', request.cardNumber),
      ...row('المدينة', 'City', request.city),
      ...row('العنوان', 'Address', request.address),
      ...row('ملاحظتك', 'Your note', request.note),
    ],
    note: request.adminNote ?? null,
    screen: '/card',
    noFee: true,
  });
}

const VISIT_STATUS: Record<Visit['status'], RequestStatus> = { pending: 'pending', confirmed: 'done', rejected: 'rejected', cancelled: 'cancelled' };

export function fromVisit(visit: Pick<Visit, 'id' | 'contactId' | 'date' | 'time' | 'purpose' | 'note' | 'status' | 'createdAt' | 'decidedAt' | 'adminNote' | 'space' | 'hours'>, endTime: string): MemberRequest {
  const booking = Boolean(visit.space);
  return build({
    kind: 'hq',
    id: visit.id,
    contactId: visit.contactId,
    title: booking ? (visit.space === 'meeting' ? 'حجز قاعة الاجتماعات' : 'حجز مكتب خاص') : 'زيارة مقر النادي',
    titleEn: booking ? (visit.space === 'meeting' ? 'Meeting room booking' : 'Private office booking') : 'HQ visit',
    status: VISIT_STATUS[visit.status],
    createdAt: visit.createdAt,
    updatedAt: visit.decidedAt,
    rows: [
      ...row('اليوم', 'Day', visit.date),
      ...row('الوقت', 'Time', `${visit.time} – ${endTime}`),
      ...row('الغرض', 'Purpose', visit.purpose),
      ...(booking ? row('المدة', 'Duration', `${visit.hours ?? 1} h`) : []),
      ...row('ملاحظتك', 'Your note', visit.note),
    ],
    note: visit.adminNote,
    screen: visit.status === 'confirmed' ? `/hq/pass/${visit.id}` : '/hq',
  });
}

export function fromPublicVisit(visit: PublicVisit, contactId: number): MemberRequest {
  return fromVisit({ ...visit, contactId, space: visit.space, hours: visit.hours }, visit.endTime);
}

export function formStatus(submission: Pick<FormSubmission, 'handled' | 'status'>): RequestStatus {
  return submission.status ?? (submission.handled ? 'done' : 'pending');
}

export function fromForm(submission: FormSubmission): MemberRequest {
  return build({
    kind: 'form',
    id: submission.id,
    contactId: submission.contactId ?? 0,
    title: submission.formTitle,
    titleEn: submission.formTitle,
    status: formStatus(submission),
    createdAt: submission.createdAt,
    updatedAt: submission.handledAt,
    rows: submission.answers.filter((answer) => answer.value.trim()).map((answer) => ({ label: answer.label, labelEn: answer.label, value: answer.value.trim() })),
    note: submission.adminNote ?? null,
    screen: `/form/${submission.formKey}`,
  });
}

export function fromWorkshop(registration: WorkshopRegistration): MemberRequest {
  return build({
    kind: 'workshop',
    id: registration.id,
    contactId: registration.contactId,
    title: registration.workshopTitle,
    titleEn: registration.workshopTitle,
    status: registration.status ?? 'pending',
    createdAt: registration.createdAt,
    updatedAt: registration.decidedAt ?? null,
    rows: row('ملاحظتك', 'Your note', registration.note),
    note: registration.adminNote ?? null,
    screen: '/workshops',
  });
}

export function fromAgenda(registration: AgendaRegistration, event: Pick<AgendaEvent, 'id' | 'title' | 'date' | 'time' | 'place' | 'en'> | null): MemberRequest {
  const title = event?.title ?? 'فعالية من أجندة النادي';
  return build({
    kind: 'agenda',
    id: registration.id,
    contactId: registration.contactId,
    title,
    titleEn: event?.en?.title ?? title,
    status: registration.paid ? 'done' : 'pending',
    createdAt: registration.createdAt,
    updatedAt: registration.confirmedAt,
    rows: [
      ...row('اليوم', 'Day', event?.date),
      ...row('الوقت', 'Time', event?.time),
      ...row('الحضور', 'Attendance', registration.attendance === 'hq' ? 'في المقر' : 'أونلاين'),
      ...(event?.place ? row('المكان', 'Place', event.place) : []),
    ],
    screen: event ? `/agenda/${event.id}` : '/agenda',
    amountSar: registration.amountSar ?? null,
  });
}

const PERSONA_WORD: Record<string, { ar: string; en: string }> = {
  neutral: { ar: 'محايد', en: 'Neutral' },
  entrepreneur: { ar: 'رائد أعمال', en: 'Entrepreneur' },
  investor: { ar: 'مستثمر', en: 'Investor' },
};
const DECISION: Record<PersonaChangeRequest['status'], RequestStatus> = { pending: 'pending', approved: 'done', rejected: 'rejected' };

export function fromPersona(request: PersonaChangeRequest): MemberRequest {
  const to = PERSONA_WORD[request.to] ?? { ar: request.to, en: request.to };
  return build({
    kind: 'persona',
    id: request.id,
    contactId: request.contactId,
    title: `تغيير الفئة إلى «${to.ar}»`,
    titleEn: `Category change to “${to.en}”`,
    status: DECISION[request.status],
    createdAt: request.createdAt,
    updatedAt: request.decidedAt,
    rows: row('سببك', 'Your reason', request.note),
    note: request.adminNote,
    screen: '/persona',
  });
}

export function fromProfile(profile: Profile): MemberRequest {
  const status: RequestStatus = profile.draft ? 'pending' : DECISION[profile.status];
  return build({
    kind: 'profile',
    id: profile.id,
    contactId: profile.contactId ?? 0,
    title: 'ملفك في «شخصية ومسيرة»',
    titleEn: 'Your “Profile & Journey” page',
    status,
    createdAt: profile.createdAt,
    updatedAt: profile.decidedAt,
    note: profile.note || null,
    screen: '/people/apply',
  });
}

export function fromDeletion(request: ScheduledDeletion): MemberRequest {
  return build({
    kind: 'deletion',
    id: `deletion-${request.contactId}`,
    contactId: request.contactId,
    title: 'حذف الحساب (مجدول)',
    titleEn: 'Account deletion (scheduled)',
    status: 'in_progress',
    createdAt: request.requestedAt,
    rows: [...row('يُنفَّذ في', 'Executes on', request.dueAt.slice(0, 10)), ...row('سببك', 'Your reason', request.reason)],
    screen: '/delete-account',
  });
}

const PAYMENT_STATUS: Record<PublicPayment['status'], RequestStatus> = { created: 'pending', paid: 'done', failed: 'rejected' };

export function fromPayment(payment: PublicPayment, contactId: number): MemberRequest {
  return build({
    kind: 'payment',
    id: payment.id,
    contactId,
    title: payment.serviceTitle,
    titleEn: payment.serviceTitle,
    status: PAYMENT_STATUS[payment.status],
    number: payment.invoiceNo ? String(payment.invoiceNo) : requestNumber(payment.id),
    createdAt: payment.createdAt,
    updatedAt: payment.paidAt ?? payment.failedAt,
    rows: payment.answers.filter((answer) => answer.key !== 'discount' && answer.value.trim()).map((answer) => ({ label: answer.label, labelEn: answer.label, value: answer.value.trim() })),
    note: payment.failureReason,
    screen: `/payment/${payment.id}`,
    amountSar: payment.amount,
    invoiceNo: payment.invoiceNo ?? null,
  });
}

/** M138: the operations that had no store of their own until now (a service request, a golden interest). */
export type LedgerEntry = {
  id: string;
  kind: 'service' | 'golden';
  contactId: number;
  name: string;
  phone: string;
  email: string;
  lang: AppLang;
  title: string;
  /** The golden company's code / the service key. */
  ref: string;
  rows: RequestRow[];
  status: RequestStatus;
  createdAt: string;
  updatedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
};

export function fromLedger(entry: LedgerEntry): MemberRequest {
  return build({
    kind: entry.kind,
    id: entry.id,
    contactId: entry.contactId,
    title: entry.title,
    titleEn: entry.title,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    rows: entry.rows,
    note: entry.adminNote,
    screen: entry.kind === 'golden' ? `/golden/${entry.ref}` : `/service/${entry.ref}`,
  });
}
