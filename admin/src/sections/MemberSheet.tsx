import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api, newRequestId } from '../api';
import { formatCents, formatDateTime, formatDay, formatDays, formatLooseDate, formatNumber, formatProjects } from '../format';
import type { Account, GrantAction, MemberDetail, MemberEvent, ProjectRef } from '../types';
import { Async, Chips, ErrorCard, Field, Intent, messageOf, Pill, sessionOver, Sheet, useLoad, useShell } from '../ui';
import { dailyLeft, memberLeft, personaLabel, StatePill, WaPill } from './Members';
import { LinkedProject, ProjectPicker, projectName } from './SuccessPartners';

type ActionKind = GrantAction | 'pb' | 'publisher' | 'unpublisher' | 'honorary' | 'unhonorary' | 'partner' | 'partnerProject' | 'unpartner' | 'delete';
/** What the owner filled in, frozen for the confirm step together with the id that makes the write idempotent. */
type Draft = { kind: ActionKind; amount: number; note: string; requestId: string; tellMember: boolean; project: ProjectRef | null };

/** M275: the two actions that name a Projects Bank project. */
const picksProject = (kind: ActionKind): boolean => kind === 'partner' || kind === 'partnerProject';

const ACTIONS: Record<ActionKind, { button: string; title: string; danger?: boolean }> = {
  activate: { button: 'تفعيل العضوية', title: 'تفعيل العضوية' },
  extend: { button: 'تمديد العضوية', title: 'تمديد العضوية' },
  revoke: { button: 'إلغاء العضوية', title: 'إلغاء العضوية', danger: true },
  pb: { button: 'إضافة رصيد بنك المشاريع', title: 'تعديل رصيد بنك المشاريع' },
  // M205: only for official partners in the founding contract of a Vibes Ventures company — the administration gives it and takes it back, nobody else.
  honorary: { button: 'منح العضوية الشرفية', title: 'منح العضوية الشرفية' },
  unhonorary: { button: 'سحب العضوية الشرفية', title: 'سحب العضوية الشرفية', danger: true },
  // M271: given by the administration for 360 days, never sold.
  partner: { button: 'منح عضوية شركاء النجاح', title: 'منح عضوية شركاء النجاح' },
  // M275: the button reads «تغيير المشروع» once there is one.
  partnerProject: { button: 'ربط بمشروع', title: 'مشروع شريك النجاح' },
  unpartner: { button: 'سحب عضوية شركاء النجاح', title: 'سحب عضوية شركاء النجاح', danger: true },
  delete: { button: 'حذف الحساب', title: 'حذف الحساب نهائيًا', danger: true },
  publisher: { button: 'ترقية إلى موديريتور', title: 'صلاحية النشر (موديريتور)' },
  unpublisher: { button: 'سحب صلاحية الموديريتور', title: 'سحب صلاحية الموديريتور', danger: true },
};

const EVENT_KINDS: Record<string, string> = { registered: 'تسجيل', verified: 'تأكيد البريد', activated: 'تفعيل عضوية', renewed: 'تجديد عضوية', revoked: 'إلغاء عضوية', honorary: 'منح العضوية الشرفية', honorary_revoked: 'سحب العضوية الشرفية', partner: 'منح عضوية شركاء النجاح', partner_revoked: 'سحب عضوية شركاء النجاح', role: 'تغيير صلاحية', deleted: 'حذف الحساب' };
const EVENT_SOURCES: Record<string, string> = { paymob: 'بيموب', store: 'المتجر', admin: 'الإدارة', list: 'قائمة', manual: 'يدوي', app: 'التطبيق' };

/** A membership the hub gives no end for: its flag says so, and so does a member with no days-left figure. */
const openEnded = (account: Account): boolean => account.state === 'member' && (Boolean(account.never_expires) || account.member_left === null);

/** M216: the emptied row the hub keeps after a deletion, so payments still point somewhere. */
const deletedAccount = (account: Account): boolean => account.name === 'حساب محذوف' && !account.email;
/** The typed word that unlocks the final button: a deletion cannot be undone. */
const DELETE_WORD = 'حذف';

function actionsFor(account: Account): ActionKind[] {
  if (deletedAccount(account)) return [];
  const list = membershipActions(account);
  // M216: any account can go, pending or lead too, except a manager's (the server and the hub refuse it as well).
  if (account.role !== 'admin') list.push('delete');
  return list;
}

function membershipActions(account: Account): ActionKind[] {
  // The hub refuses every grant and role change until the e-mail is confirmed: offering one ends in an error and a failed row in the audit log.
  if (account.state === 'lead' || account.state === 'pending') return [];
  // A membership with no end date has nothing to extend: the hub would start a dated period from today and so put an end to it.
  // M205: an honorary member has no days to add or cancel — only the honorary membership itself can be taken back.
  // M271: nor are there days to change under a Success Partners membership; one given membership at a time.
  const list: ActionKind[] = account.honorary
    ? ['pb', 'unhonorary']
    : account.partner
      ? ['pb', 'partnerProject', 'unpartner']
      : account.state !== 'member'
        ? ['activate', 'partner', 'honorary']
        : openEnded(account)
          ? ['pb', 'partner', 'honorary', 'revoke']
          : ['extend', 'pb', 'partner', 'honorary', 'revoke'];
  if (account.role === 'publisher') list.push('unpublisher');
  else if (account.role !== 'admin') list.push('publisher');
  return list;
}

const PREFILLED_NOTES: Partial<Record<ActionKind, string>> = {
  honorary: 'منح العضوية الشرفية: شريك رسمي في عقد تأسيس إحدى شركات Vibes Ventures',
  unhonorary: 'سحب العضوية الشرفية',
  partner: 'منح عضوية شركاء النجاح لمدة 360 يومًا',
  partnerProject: 'ربط شريك النجاح بمشروع',
  unpartner: 'سحب عضوية شركاء النجاح',
};

/** One sentence that says exactly what the confirm button will do. */
function summary(draft: Draft, name: string): string {
  switch (draft.kind) {
    case 'activate':
      return `ستُفعَّل عضوية «${name}» لمدة ${formatDays(draft.amount)} تبدأ من الآن.`;
    case 'extend':
      return `تُمدَّد عضوية «${name}» بمقدار ${formatDays(draft.amount, 'يومين')}، ولا تضيع الأيام المتبقية.`;
    case 'revoke':
      return `ستُلغى عضوية «${name}» الآن، ويفقد مزايا الأعضاء في التطبيق والمواقع.`;
    case 'pb':
      return draft.amount > 0 ? `يزيد رصيد «${name}» في بنك المشاريع بمقدار ${formatProjects(draft.amount, 'مشروعين')}.` : `ينقص رصيد «${name}» في بنك المشاريع بمقدار ${formatProjects(-draft.amount, 'مشروعين')}.`;
    case 'honorary':
      return `تُمنح «${name}» العضوية الشرفية: عضوية كاملة مفتوحة بلا تجديد، ويصله إشعار بذلك على واتساب وداخل التطبيق، ويصل الإدارة بريد بالإجراء. تُمنح فقط لمن هو شريك رسمي في عقد تأسيس إحدى شركات Vibes Ventures.`;
    case 'unhonorary':
      return `تُسحب العضوية الشرفية من «${name}» الآن. إن كان له اشتراك مدفوع سارٍ يبقى عضوًا حتى نهايته، وإلا يفقد مزايا الأعضاء. يصله إشعار على واتساب بأن العضوية الشرفية مخصّصة للشركاء الرسميين في عقود تأسيس شركات Vibes Ventures، ويصل الإدارة بريد بالإجراء.`;
    case 'partner':
      return `تُمنح «${name}» عضوية شركاء النجاح لمدة 360 يومًا تبدأ من الآن، بمزايا العضوية السارية، ويصله إشعار داخل التطبيق وعلى واتساب، ويصل الإدارة بريد بالإجراء. إن كان له اشتراك مدفوع تبقى أيامه محفوظة.`;
    case 'partnerProject':
      return `يُربط شريك النجاح «${name}» بالمشروع المختار، ولا يتغير شيء في عضويته ولا يصله إشعار.`;
    case 'unpartner':
      return `تُسحب عضوية شركاء النجاح من «${name}» الآن. إن كان له اشتراك مدفوع سارٍ يبقى عضوًا حتى نهايته، وإلا يفقد مزايا الأعضاء. يصله إشعار داخل التطبيق وبالبريد، ويصل الإدارة بريد بالإجراء.`;
    case 'delete':
      return `سيُحذف حساب «${name}» نهائيًا الآن: تُمسح بياناته ومحادثاته وعضويته، وتُغلق جلساته على جميع الأجهزة، ويفقد ما فتحه في بنك المشاريع. لا يمكن التراجع عن ذلك، وتبقى الفواتير وسجلات الدفع محفوظة.`;
    case 'publisher':
      return `سيصبح «${name}» موديريتور: يدخل اللوحة وينشر «رسائل الإدارة» فقط، بلا أي تحكم آخر.`;
    case 'unpublisher':
      return `ستُسحب صلاحية الموديريتور من «${name}» ويعود عضوًا عاديًا.`;
  }
}

function run(contactId: number, draft: Draft) {
  const meta = { note: draft.note, requestId: draft.requestId };
  if (draft.kind === 'delete') return api.deleteAccount(contactId, { tellMember: draft.tellMember, ...meta });
  if (draft.kind === 'pb') return api.pbGrant(contactId, { amount: draft.amount, ...meta });
  if (draft.kind === 'honorary' || draft.kind === 'unhonorary') return api.honorary(contactId, { on: draft.kind === 'honorary', ...meta });
  if (draft.kind === 'partnerProject') return api.setPartnerProject(contactId, { projectId: draft.project?.id ?? 0, ...meta });
  if (draft.kind === 'partner' || draft.kind === 'unpartner') return api.partner(contactId, { on: draft.kind === 'partner', ...(draft.project ? { projectId: draft.project.id } : {}), ...meta });
  if (draft.kind === 'publisher' || draft.kind === 'unpublisher') return api.setRole(contactId, { role: draft.kind === 'publisher' ? 'publisher' : 'member', ...meta });
  return api.grant(contactId, { action: draft.kind, days: draft.kind === 'revoke' ? null : draft.amount, ...meta });
}

/** Step one: the numbers and the required note. Step two: the sentence and «تأكيد». Nothing is sent before the second tap. */
function ActionPanel({ kind, account, current, onDone, onCancel }: { kind: ActionKind; account: Account; current: ProjectRef | null; onDone: (text: string) => void; onCancel: () => void }) {
  const { signOut } = useShell();
  const days = kind === 'activate' || kind === 'extend';
  const [amount, setAmount] = useState(days ? '365' : kind === 'pb' ? '1' : '');
  // A phone's numeric keypad has no minus key: taking «رصيد» away is a choice, not a typed sign.
  const [direction, setDirection] = useState<'add' | 'cut'>('add');
  // M215 + M271: the honorary and Success Partners actions come with their note written; it stays editable. The same
  // sentences live in server dashboard/service.ts.
  const [note, setNote] = useState(PREFILLED_NOTES[kind] ?? '');
  const [draft, setDraft] = useState<Draft | null>(null);
  // M216: an active member is told by default; a spam or test account is not.
  const [tellMember, setTellMember] = useState(account.state === 'member');
  const [word, setWord] = useState('');
  const [project, setProject] = useState<ProjectRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = account.name || account.email || `حساب رقم ${account.id}`;

  function review(event: FormEvent) {
    event.preventDefault();
    const typed = days || kind === 'pb' ? Number(amount) : 0;
    const value = kind === 'pb' && direction === 'cut' ? -typed : typed;
    if (days && (!Number.isInteger(typed) || typed < 1 || typed > 3650)) return setError('اكتب عدد الأيام من 1 إلى 3650.');
    if (kind === 'pb' && (!Number.isInteger(typed) || typed < 1 || typed > 50)) return setError('اكتب عدد المشاريع من 1 إلى 50.');
    if (picksProject(kind) && !project) return setError('اختر المشروع المرتبط بشريك النجاح أولًا: لا تُمنح العضوية بدون مشروع.');
    if (note.trim().length < 3) return setError('اكتب ملاحظة توضّح سبب الإجراء: تُحفظ في سجل الإجراءات.');
    setError(null);
    setWord('');
    setDraft({ kind, amount: value, note: note.trim(), requestId: newRequestId(), tellMember: kind === 'delete' && tellMember, project: picksProject(kind) ? project : null });
  }

  async function confirm() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await run(account.id, draft);
      onDone(result.already ? 'سبق تنفيذ هذا الإجراء، ولم يتكرر.' : kind === 'delete' ? 'حُذف الحساب وأُغلقت جلساته، وحُفظ الإجراء في السجل.' : 'تم تنفيذ الإجراء وحُفظ في السجل.');
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      setError(messageOf(failure));
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <div className={ACTIONS[kind].danger ? 'confirm danger' : 'confirm'} role="group" aria-label="تأكيد الإجراء">
        <h3>تأكيد: {ACTIONS[kind].title}</h3>
        <p>{summary(draft, name)}</p>
        {draft.project ? <p className="pp-chosen">{`المشروع المختار: ${projectName(draft.project)}`}</p> : null}
        {draft.project && current ? <p className="muted">{`يصبح المشروع السابق متاحًا لشريك آخر: ${projectName(current)}`}</p> : null}
        {draft.kind === 'unpartner' && current ? <p className="muted">{`يصبح مشروعه متاحًا لشريك آخر: ${projectName(current)}`}</p> : null}
        <p className="muted">الملاحظة: {draft.note}</p>
        {kind === 'delete' ? (
          <>
            {account.state === 'member' && !account.honorary ? <p className="warn">هذا العضو له عضوية سارية. الاشتراك عبر Apple أو Google لا يتوقف بالحذف، ويلغيه صاحبه من المتجر، ولا يُرد المبلغ تلقائيًا.</p> : null}
            <p className="muted">{draft.tellMember ? 'يصل صاحب الحساب إشعار بالبريد.' : 'لن يصل صاحب الحساب أي إشعار.'}</p>
            <label>
              اكتب كلمة «{DELETE_WORD}» للتأكيد
              <input value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" />
            </label>
          </>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="actions">
          <button className={ACTIONS[kind].danger ? 'danger solid' : 'primary'} type="button" disabled={busy || (kind === 'delete' && word.trim() !== DELETE_WORD)} onClick={() => void confirm()}>{busy ? 'جارٍ التنفيذ…' : 'تأكيد التنفيذ'}</button>
          <button type="button" disabled={busy} onClick={() => setDraft(null)}>رجوع للتعديل</button>
        </div>
      </div>
    );
  }

  return (
    <form className="confirm" onSubmit={review}>
      <h3>{ACTIONS[kind].title}</h3>
      {days ? (
        <>
          <Chips label="مدة جاهزة" options={[{ value: '30', label: '30 يومًا' }, { value: '90', label: '90 يومًا' }, { value: '365', label: 'سنة' }]} value={amount} onChange={setAmount} />
          <label>
            عدد الأيام
            <input inputMode="numeric" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))} required />
          </label>
        </>
      ) : null}
      {kind === 'pb' ? (
        <>
          <Chips label="نوع التعديل" options={[{ value: 'add', label: 'إضافة رصيد' }, { value: 'cut', label: 'خصم رصيد' }]} value={direction} onChange={setDirection} />
          <label>
            عدد المشاريع
            <input inputMode="numeric" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))} required />
            <span className="muted hint">الرصيد يُحسب بالمشاريع لا بالريال، ولا ينزل عن المشاريع التي فتحها العضو.</span>
          </label>
        </>
      ) : null}
      {picksProject(kind) ? <ProjectPicker value={project} current={current} onPick={(next) => { setProject(next); setError(null); }} /> : null}
      <label>
        ملاحظة (مطلوبة)
        <textarea rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder={kind === 'delete' ? 'سبب الحذف، مثال: مخالفة شروط الاستخدام' : 'سبب الإجراء، مثال: دفع بتحويل بنكي'} required />
      </label>
      {kind === 'delete' ? (
        <label className="check">
          <input type="checkbox" checked={tellMember} onChange={(event) => setTellMember(event.target.checked)} /> إبلاغ صاحب الحساب بالبريد
        </label>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="actions">
        <button className="primary" type="submit">متابعة</button>
        <button type="button" onClick={onCancel}>إلغاء</button>
      </div>
    </form>
  );
}

function eventText(event: MemberEvent): string {
  const parts = [EVENT_KINDS[event.kind] ?? event.kind];
  if (event.days > 0) parts.push(formatDays(event.days));
  parts.push(EVENT_SOURCES[event.source] ?? event.source);
  if (event.actor_name) parts.push(`بواسطة ${event.actor_name}`);
  return parts.filter(Boolean).join(' · ');
}

type Tab = 'payments' | 'tickets' | 'leads' | 'events';

function History({ detail }: { detail: MemberDetail }) {
  const [tab, setTab] = useState<Tab>('events');
  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: 'events', label: 'السجل', count: detail.events.length },
    { value: 'payments', label: 'المدفوعات', count: detail.payments.length },
    { value: 'tickets', label: 'التذاكر', count: detail.tickets.length },
    { value: 'leads', label: 'الطلبات', count: detail.leads.length },
  ];
  const none = <p className="muted">لا يوجد شيء هنا بعد.</p>;
  return (
    <section className="sheet-block">
      <Chips label="سجل الحساب" options={tabs} value={tab} onChange={setTab} />
      {tab === 'events' ? (
        detail.events.length === 0 ? none : (
          <ul className="list timeline">
            {detail.events.map((event) => (
              <li key={event.id} className="entry">
                <strong>{eventText(event)}</strong>
                {event.note && event.note !== 'backfill' ? <span>{event.note}</span> : null}
                <span className="muted hint">{formatDateTime(event.created_at)}{event.note === 'backfill' ? ' · من بيانات سابقة' : ''}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === 'payments' ? (
        detail.payments.length === 0 ? none : (
          <ul className="list">
            {detail.payments.map((payment) => (
              <li key={payment.id} className="entry">
                <span className="row">
                  <strong className="num">{formatCents(payment.amount_cents, payment.currency)}</strong>
                  <Pill tone={payment.success ? 'ok' : 'danger'}>{payment.success ? 'ناجحة' : 'فاشلة'}</Pill>
                </span>
                <span>{payment.action || 'دفع'}{payment.note ? ` · ${payment.note}` : ''}</span>
                <span className="muted hint">{formatDateTime(payment.created_at)} · عملية <bdi dir="ltr">{payment.txn_id || '—'}</bdi></span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === 'tickets' ? (
        detail.tickets.length === 0 ? none : (
          <ul className="list">
            {detail.tickets.map((ticket) => (
              <li key={ticket.id} className="entry">
                <span className="row">
                  <strong>{ticket.event_title}</strong>
                  <Pill tone={ticket.checked_in ? 'ok' : 'muted'}>{ticket.checked_in ? 'حضر' : 'لم يحضر بعد'}</Pill>
                </span>
                <span>{[formatLooseDate(ticket.event_date), ticket.event_place].filter(Boolean).join(' · ')}</span>
                <span className="muted hint">تذكرة <bdi dir="ltr">{ticket.ref}</bdi> · {formatDateTime(ticket.created_at)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === 'leads' ? (
        detail.leads.length === 0 ? none : (
          <ul className="list">
            {detail.leads.map((lead) => (
              <li key={lead.id} className="entry">
                <span className="row">
                  <strong>{lead.reason || lead.ltype}</strong>
                  <Intent score={lead.intent} label={lead.intent_label} />
                </span>
                {lead.notes ? <span>{lead.notes}</span> : null}
                <span className="muted hint">{lead.site} · {formatDateTime(lead.created_at)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

/**
 * How the last write went, said inside the sheet where the owner tapped: a notice on the page would sit under the
 * sheet. Focus lands on it, so a screen reader reads it and Tab carries on from here, not from behind the sheet.
 */
function Done({ text }: { text: string }) {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => line.current?.focus(), [text]);
  return <p className="done" role="status" tabIndex={-1} ref={line}>{text}</p>;
}

/**
 * M204 (owner, 2026-11-06): WhatsApp is the only channel for the sign-in code. A member the code cannot reach writes
 * to the support line; after checking him there, the admin vouches for the number here and the account signs in
 * without the code from then on.
 */
function PhoneWaiver({ contactId, phone, waiver, onStart, onChanged }: { contactId: number; phone: string; waiver: { by: string; at: string } | null; onStart: () => void; onChanged: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (on: boolean) => {
    const question = on
      ? `تأكيد الرقم ${phone} يدويًا؟ بعدها يدخل هذا العضو بدون رمز واتساب. افعلها فقط بعد أن يراسل الدعم من الرقم نفسه.`
      : 'إلغاء التأكيد اليدوي؟ سيُطلب من العضو رمز واتساب عند كل دخول جديد.';
    if (busy || !window.confirm(question)) return;
    onStart();
    setBusy(true);
    setError(null);
    try {
      await api.phoneWaiver(contactId, on);
      onChanged(on ? 'تم تأكيد الرقم يدويًا: يدخل العضو بدون رمز واتساب.' : 'أُلغي التأكيد اليدوي للرقم.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر الحفظ الآن');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sheet-block">
      <h3>رمز واتساب عند الدخول</h3>
      <p className="muted hint">
        {waiver ? `الرقم مؤكَّد يدويًا من ${waiver.by} في ${formatDateTime(waiver.at)}: يدخل العضو بدون رمز واتساب.` : 'إذا لم يصل الرمز إلى العضو وراسل الدعم على واتساب من الرقم نفسه، أكّد رقمه من هنا ليدخل بدون رمز.'}
      </p>
      {error ? <p className="muted hint" role="alert">{error}</p> : null}
      <div className="actions">
        <button type="button" className={waiver ? 'danger' : undefined} disabled={busy} onClick={() => void run(!waiver)}>
          {waiver ? 'إلغاء التأكيد اليدوي' : 'تأكيد الرقم يدويًا'}
        </button>
      </div>
    </section>
  );
}

/**
 * M274 (owner, 2026-11-25: «اقدر اي عضو لما افتح ارسله رسالة علي الخاص فورا هنا ووصله تذكير علي واتس اب… ويكون فيها
 * اسمه»): a private message to this member, from his own sheet. It is a management message addressed to him alone —
 * it opens with his name in his inbox, his devices hear the notification, and WhatsApp tells him by name that a
 * message waits for him (M235). Its follow-up (opened or not) sits with the other messages in «أدوات التواصل».
 */
function PrivateMessage({ account, open, setOpen }: { account: Account; open: boolean; setOpen: (open: boolean) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const name = account.name || `حساب رقم ${account.id}`;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!title.trim() || !body.trim()) return setError('اكتب عنوان الرسالة ونصها.');
    const channels = account.phone ? 'مع إشعار التطبيق، وتنبيه على واتساب باسمه بأن له إشعارًا جديدًا في بريد الوارد.' : 'مع إشعار التطبيق. لا يوجد رقم جوال، فلن يصله تنبيه واتساب.';
    if (!window.confirm(`إرسال هذه الرسالة إلى ${name} وحده؟ تصله في «بريد وارد» باسمه ${channels}`)) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await api.createPost({ title: title.trim(), body: body.trim(), links: [], cover: null, images: [], video: null, videoFile: null, status: 'published', pinned: false, kind: 'post', event: null, poll: null, audience: { type: 'member', contactId: account.id, name: account.name } });
      setOpen(false);
      setTitle('');
      setBody('');
      setSent(`أُرسلت الرسالة الخاصة إلى ${name}. متابعتها (فتحها أم لا) في «أدوات التواصل».`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر الإرسال الآن');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sheet-block">
      <h3>رسالة خاصة</h3>
      {sent ? <Done text={sent} /> : null}
      {account.honorary ? (
        <p className="muted hint">صاحب العضوية الشرفية لا تصله رسائل الإدارة ولا إشعاراتها.</p>
      ) : open ? (
        <form className="stack" onSubmit={(event) => void send(event)}>
          <label>
            العنوان
            <input value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            نص الرسالة
            <textarea value={body} rows={5} maxLength={6000} onChange={(event) => setBody(event.target.value)} />
          </label>
          <p className="muted hint">تبدأ الرسالة باسمه تلقائيًا («الأستاذ/ …»)، فلا تكتب الاسم بنفسك.</p>
          {error ? <p className="muted hint" role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>{busy ? 'جارٍ الإرسال…' : 'إرسال الآن'}</button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>إلغاء</button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button type="button" onClick={() => { setOpen(true); setSent(null); }}>كتابة رسالة خاصة</button>
        </div>
      )}
    </section>
  );
}

/** M279: the sensitive actions wait closed at the bottom of the sheet; the rest sit in the membership card. */
const SENSITIVE: ActionKind[] = ['publisher', 'unpublisher', 'delete'];
const PERSONA_ICON: Record<string, string> = { entrepreneur: '🚀', investor: '💼', neutral: '✦' };

/** Whole days since a moment, never below zero. */
const daysSince = (iso: string | null | undefined): number | null => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : null);
const agoText = (days: number | null): string => (days === null ? '—' : days === 0 ? 'اليوم' : days === 1 ? 'أمس' : `منذ ${formatDays(days, 'يومين')}`);

/** Digits for wa.me: «05…» (Saudi) gains 966, «00…» loses its zeros; anything else is taken as international already. */
function waDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  return digits;
}

function Body({ detail, done, onStart, onChanged }: { detail: MemberDetail; done: string | null; onStart: () => void; onChanged: (text: string) => void }) {
  const { openThread } = useShell();
  const [action, setAction] = useState<ActionKind | null>(null);
  const [writing, setWriting] = useState(false);
  const [copied, setCopied] = useState(false);
  const messageBlock = useRef<HTMLDivElement>(null);
  const { account, pb } = detail;
  const everMember = account.state === 'member' || account.state === 'expired';
  const allowed = actionsFor(account);
  // A reload can change what the account allows: a panel left open for an action that no longer applies closes.
  const open = action !== null && allowed.includes(action) ? action : null;
  const inbox = account.state === 'member' || account.state === 'unpaid' || account.state === 'expired';
  const lastSeen = daysSince(account.last_login_at);
  const since = daysSince(account.created_at);
  const persona = personaLabel(account.persona);

  const buttons = (kinds: ActionKind[]) =>
    open && kinds.includes(open) ? (
      <ActionPanel
        key={open}
        kind={open}
        account={account}
        current={detail.partnerProject ?? null}
        onCancel={() => setAction(null)}
        onDone={(text) => {
          setAction(null);
          onChanged(text);
        }}
      />
    ) : kinds.length > 0 ? (
      <div className="actions">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className={ACTIONS[kind].danger ? 'danger' : kind === 'activate' || kind === 'extend' ? 'primary' : undefined}
            onClick={() => {
              onStart();
              setAction(kind);
            }}
          >
            {kind === 'partnerProject' && detail.partnerProject ? 'تغيير المشروع' : ACTIONS[kind].button}
          </button>
        ))}
      </div>
    ) : null;
  const mainActions = allowed.filter((kind) => !SENSITIVE.includes(kind));
  const sensitiveActions = allowed.filter((kind) => SENSITIVE.includes(kind));
  const showWaiver = Boolean(account.phone) && detail.phoneWaiver !== undefined;

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(account.phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('انسخ الرقم:', account.phone);
    }
  };

  return (
    <div className="stack member-sheet">
      {/* M279 (owner: «الشكل بتاع لما بفتح اي عضو ده محتاج تعديل كبير»): who this is at a glance, and how to reach him in one tap. */}
      <section className="member-hero">
        <div className="hero-top">
          <span className="persona-badge" aria-hidden="true">{PERSONA_ICON[account.persona] ?? '✦'}</span>
          <div className="hero-name">
            <strong dir="auto">{account.name || account.email || `حساب رقم ${account.id}`}</strong>
            <span className="muted">
              {[account.job_title, account.company, account.city].filter(Boolean).join(' · ') || (persona ?? 'بدون فئة')}
              {since !== null ? ` · ${since === 0 ? 'انضم اليوم' : `عضو منذ ${formatDays(since, 'يومين')}`}` : ''}
            </span>
          </div>
        </div>
        <div className="pills">
          {persona ? <Pill tone="gold">{persona}</Pill> : null}
          <StatePill account={account} />
          <WaPill account={account} />
          <Intent score={account.intent} label={account.intent_label} />
        </div>
        {/* M116 (owner): the member's interests, right where he reads who this is. */}
        {detail.interests?.length ? <div className="pills">{detail.interests.map((label) => <Pill key={label} tone="muted">{label}</Pill>)}</div> : null}
        <div className="quick-actions">
          {account.phone ? <a className="quick" href={`https://wa.me/${waDigits(account.phone)}`} target="_blank" rel="noreferrer"><span aria-hidden="true">💬</span>واتساب</a> : null}
          {account.phone ? <a className="quick" href={`tel:${account.phone}`}><span aria-hidden="true">📞</span>اتصال</a> : null}
          {account.email ? <a className="quick" href={`mailto:${account.email}`}><span aria-hidden="true">✉️</span>بريد</a> : null}
          {inbox && !account.honorary ? (
            <button type="button" className="quick" onClick={() => { setWriting(true); window.setTimeout(() => messageBlock.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }}>
              <span aria-hidden="true">📨</span>رسالة خاصة
            </button>
          ) : null}
          {account.msg_count > 0 ? <button type="button" className="quick" onClick={() => openThread(account.id)}><span aria-hidden="true">🤖</span>المستشار</button> : null}
          {account.phone ? <button type="button" className="quick" onClick={() => void copyPhone()}><span aria-hidden="true">{copied ? '✓' : '⧉'}</span>{copied ? 'نُسخ' : 'نسخ الرقم'}</button> : null}
        </div>
      </section>

      <div className="member-tiles">
        <div className="member-tile"><span className="muted">آخر دخول</span><b>{agoText(lastSeen)}</b></div>
        <div className="member-tile"><span className="muted">رصيد بنك المشاريع</span><b>{pb ? formatNumber(pb.left) : '—'}</b></div>
        <div className="member-tile"><span className="muted">رسائل المستشار</span><b>{formatNumber(account.msg_count)}</b></div>
        <div className="member-tile"><span className="muted">مشاريع فتحها</span><b>{pb ? formatNumber(pb.unlocked.length) : '—'}</b></div>
      </div>

      {done ? <Done text={done} /> : null}

      <section className={everMember ? 'sheet-block member-card on' : 'sheet-block member-card'}>
        <div className="card-head">
          <h3>{account.honorary ? 'العضوية الشرفية' : account.partner ? 'عضوية شركاء النجاح' : 'العضوية السنوية'}</h3>
          <StatePill account={account} />
        </div>
        {account.partner ? <LinkedProject project={detail.partnerProject ?? null} /> : null}
        {everMember ? (
          <dl className="fields">
            {account.honorary ? <Field label="مُنحت في">{account.honorary_since ? formatDay(account.honorary_since) : '—'}</Field> : null}
            {account.partner ? <Field label="مُنحت في">{account.partner_since ? formatDay(account.partner_since) : '—'}</Field> : null}
            <Field label="المتبقي">{account.state === 'expired' ? 'انتهت' : memberLeft(account)}</Field>
            <Field label={account.state === 'expired' ? 'انتهت في' : 'تنتهي في'}>{account.honorary ? 'مفتوحة' : account.partner ? formatDay(account.partner_end ?? '') : account.never_expires ? 'بلا تاريخ انتهاء' : formatDay(account.member_end)}</Field>
            {account.partner && (account.never_expires || (account.member_end && account.member_end > (account.partner_end ?? ''))) ? <Field label="اشتراك مدفوع بعدها حتى">{account.never_expires ? 'بلا تاريخ انتهاء' : formatDay(account.member_end)}</Field> : null}
            {account.state === 'member' ? <Field label="رصيد المستشار اليوم">{dailyLeft(account)}</Field> : null}
            {pb ? <Field label="تفاصيل رصيد بنك المشاريع">{`الأساسي ${formatNumber(pb.credits)} · المضاف ${formatNumber(pb.granted)} · المستخدم ${formatNumber(pb.used)}`}</Field> : null}
          </dl>
        ) : (
          <p className="muted">{account.state === 'lead' ? 'عميل محتمل بلا حساب مؤكد بعد.' : account.state === 'pending' ? 'لم يؤكد بريده بعد.' : 'لم يشترك في العضوية بعد.'}</p>
        )}
        {detail.pbError ? <ErrorCard error={{ code: detail.pbError.code, message: `رصيد بنك المشاريع غير متاح الآن: ${detail.pbError.message}` }} /> : null}
        {account.partner && !detail.partnerProject ? <p className="warn">شريك النجاح هذا غير مرتبط بمشروع: اربطه من «ربط بمشروع».</p> : null}
        {detail.deletionRequest ? (
          <p className="warn">
            طلب العضو حذف حسابه في {formatDay(detail.deletionRequest.requestedAt.slice(0, 10))}، وموعد الحذف {formatDay(detail.deletionRequest.dueAt.slice(0, 10))}.
            {detail.deletionRequest.reason ? ` السبب: ${detail.deletionRequest.reason}` : ''}
          </p>
        ) : null}
        {buttons(mainActions)}
        {account.honorary ? <p className="muted hint">عضوية شرفية: مفتوحة بلا تجديد، ولا تتأثر بأي اشتراك من المتجر.</p> : account.partner ? <p className="muted hint">عضوية شركاء النجاح: 360 يومًا وتنتهي وحدها. أي اشتراك من المتجر تبقى أيامه محفوظة.</p> : openEnded(account) ? <p className="muted hint">عضوية بلا تاريخ انتهاء: لا تحتاج تمديدًا.</p> : null}
        {account.state === 'pending' ? <p className="muted hint">الحساب لم يؤكد بريده بعد. تُتاح الإجراءات هنا بعد تأكيد البريد.</p> : null}
        {account.state === 'lead' ? <p className="muted hint">هذا عميل محتمل بلا حساب مؤكد بعد، فلا تُفعَّل له عضوية من هنا.</p> : null}
      </section>

      {/* M274: only a verified account has an inbox to read it in. */}
      {inbox ? (
        <div ref={messageBlock}>
          <PrivateMessage account={account} open={writing} setOpen={setWriting} />
        </div>
      ) : null}

      <History detail={detail} />

      <section className="sheet-block">
        <h3>البيانات</h3>
        <dl className="fields">
          <Field label="البريد الإلكتروني" ltr>{account.email || '—'}</Field>
          <Field label="الجوال" ltr>{account.phone || '—'}</Field>
          {account.member_type ? <Field label="نوع الحساب">{account.member_type === 'company' ? `🏢 شركة${account.company ? ` — ${account.company}` : ''}` : 'فرد'}</Field> : null}
          {account.job_title || account.company ? <Field label="العمل">{[account.job_title, account.company].filter(Boolean).join(' · ')}</Field> : null}
          {account.city ? <Field label="المدينة">{account.city}</Field> : null}
          <Field label="سجّل في">{formatDateTime(account.created_at)}</Field>
          <Field label="أكّد بريده">{account.verified_at ? formatDateTime(account.verified_at) : 'لم يؤكد بعد'}</Field>
          <Field label="آخر دخول">{account.last_login_at ? formatDateTime(account.last_login_at) : '—'}</Field>
          {detail.sites.length > 0 ? <Field label="المواقع">{detail.sites.join(' · ')}</Field> : null}
        </dl>
      </section>

      {detail.memo || detail.notes ? (
        <section className="sheet-block">
          <h3>ملاحظات الهب</h3>
          {detail.memo ? <p className="prose">{detail.memo}</p> : null}
          {detail.notes ? <p className="prose muted">{detail.notes}</p> : null}
        </section>
      ) : null}

      {showWaiver || sensitiveActions.length > 0 || account.role === 'admin' ? (
        <details className="danger-zone" open={open !== null && SENSITIVE.includes(open) ? true : undefined}>
          <summary>🔒 إجراءات حساسة{sensitiveActions.includes('delete') ? ' — منها حذف الحساب' : ''}</summary>
          <div className="stack">
            {account.phone && detail.phoneWaiver !== undefined ? <PhoneWaiver contactId={account.id} phone={account.phone} waiver={detail.phoneWaiver} onStart={onStart} onChanged={onChanged} /> : null}
            {sensitiveActions.length > 0 ? <section className="sheet-block"><h3>الصلاحيات والحساب</h3>{buttons(sensitiveActions)}</section> : null}
            {account.role === 'admin' ? <p className="muted hint">صلاحية الإدارة تُمنح وتُسحب من صفحة الهب فقط.</p> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** One account in full: who he is, what he has left, what he did, and the four things the owner can do about it. */
export function MemberSheet({ contactId, onClose, onChanged }: { contactId: number; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => api.account(contactId), [contactId]);
  // Kept here, above the loaded part: a write that went through must still say so when the reload after it fails,
  // or the owner reads the error as "it did not work" and does it a second time.
  const [done, setDone] = useState<string | null>(null);
  const name = state.data ? state.data.account.name || state.data.account.email || `حساب رقم ${contactId}` : 'بيانات الحساب';
  return (
    <Sheet title={name} onClose={onClose} wide>
      {done && !state.data ? <Done text={done} /> : null}
      <Async state={state} rows={7}>
        {(detail) => (
          <Body
            detail={detail}
            done={done}
            onStart={() => setDone(null)}
            onChanged={(text) => {
              setDone(text);
              state.reload();
              onChanged();
            }}
          />
        )}
      </Async>
    </Sheet>
  );
}
