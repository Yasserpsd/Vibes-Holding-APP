import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api, newRequestId } from '../api';
import { formatCents, formatDateTime, formatDay, formatDays, formatLooseDate, formatNumber, formatProjects } from '../format';
import type { Account, GrantAction, MemberDetail, MemberEvent } from '../types';
import { Async, Chips, ErrorCard, Field, Intent, messageOf, Pill, sessionOver, Sheet, useLoad, useShell } from '../ui';
import { dailyLeft, memberLeft, StatePill } from './Members';

type ActionKind = GrantAction | 'pb' | 'publisher' | 'unpublisher';
/** What the owner filled in, frozen for the confirm step together with the id that makes the write idempotent. */
type Draft = { kind: ActionKind; amount: number; note: string; requestId: string };

const ACTIONS: Record<ActionKind, { button: string; title: string; danger?: boolean }> = {
  activate: { button: 'تفعيل العضوية', title: 'تفعيل العضوية' },
  extend: { button: 'تمديد العضوية', title: 'تمديد العضوية' },
  revoke: { button: 'إلغاء العضوية', title: 'إلغاء العضوية', danger: true },
  pb: { button: 'إضافة رصيد بنك المشاريع', title: 'تعديل رصيد بنك المشاريع' },
  publisher: { button: 'جعله ناشرًا', title: 'صلاحية النشر' },
  unpublisher: { button: 'سحب صلاحية النشر', title: 'سحب صلاحية النشر', danger: true },
};

const EVENT_KINDS: Record<string, string> = { registered: 'تسجيل', verified: 'تأكيد البريد', activated: 'تفعيل عضوية', renewed: 'تجديد عضوية', revoked: 'إلغاء عضوية', role: 'تغيير صلاحية', deleted: 'حذف الحساب' };
const EVENT_SOURCES: Record<string, string> = { paymob: 'بيموب', store: 'المتجر', admin: 'الإدارة', list: 'قائمة', manual: 'يدوي', app: 'التطبيق' };

/** A membership the hub gives no end for: its flag says so, and so does a member with no days-left figure. */
const openEnded = (account: Account): boolean => account.state === 'member' && (Boolean(account.never_expires) || account.member_left === null);

function actionsFor(account: Account): ActionKind[] {
  // The hub refuses every grant and role change until the e-mail is confirmed: offering one ends in an error and a failed row in the audit log.
  if (account.state === 'lead' || account.state === 'pending') return [];
  // A membership with no end date has nothing to extend: the hub would start a dated period from today and so put an end to it.
  const list: ActionKind[] = account.state !== 'member' ? ['activate'] : openEnded(account) ? ['pb', 'revoke'] : ['extend', 'pb', 'revoke'];
  if (account.role === 'publisher') list.push('unpublisher');
  else if (account.role !== 'admin') list.push('publisher');
  return list;
}

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
    case 'publisher':
      return `سيصبح «${name}» ناشرًا: يستطيع نشر المحتوى باسم النادي.`;
    case 'unpublisher':
      return `ستُسحب صلاحية النشر من «${name}» ويعود عضوًا عاديًا.`;
  }
}

function run(contactId: number, draft: Draft) {
  const meta = { note: draft.note, requestId: draft.requestId };
  if (draft.kind === 'pb') return api.pbGrant(contactId, { amount: draft.amount, ...meta });
  if (draft.kind === 'publisher' || draft.kind === 'unpublisher') return api.setRole(contactId, { role: draft.kind === 'publisher' ? 'publisher' : 'member', ...meta });
  return api.grant(contactId, { action: draft.kind, days: draft.kind === 'revoke' ? null : draft.amount, ...meta });
}

/** Step one: the numbers and the required note. Step two: the sentence and «تأكيد». Nothing is sent before the second tap. */
function ActionPanel({ kind, account, onDone, onCancel }: { kind: ActionKind; account: Account; onDone: (text: string) => void; onCancel: () => void }) {
  const { signOut } = useShell();
  const days = kind === 'activate' || kind === 'extend';
  const [amount, setAmount] = useState(days ? '365' : kind === 'pb' ? '1' : '');
  // A phone's numeric keypad has no minus key: taking «رصيد» away is a choice, not a typed sign.
  const [direction, setDirection] = useState<'add' | 'cut'>('add');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = account.name || account.email || `حساب رقم ${account.id}`;

  function review(event: FormEvent) {
    event.preventDefault();
    const typed = days || kind === 'pb' ? Number(amount) : 0;
    const value = kind === 'pb' && direction === 'cut' ? -typed : typed;
    if (days && (!Number.isInteger(typed) || typed < 1 || typed > 3650)) return setError('اكتب عدد الأيام من 1 إلى 3650.');
    if (kind === 'pb' && (!Number.isInteger(typed) || typed < 1 || typed > 50)) return setError('اكتب عدد المشاريع من 1 إلى 50.');
    if (note.trim().length < 3) return setError('اكتب ملاحظة توضّح سبب الإجراء: تُحفظ في سجل الإجراءات.');
    setError(null);
    setDraft({ kind, amount: value, note: note.trim(), requestId: newRequestId() });
  }

  async function confirm() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await run(account.id, draft);
      onDone(result.already ? 'سبق تنفيذ هذا الإجراء، ولم يتكرر.' : 'تم تنفيذ الإجراء وحُفظ في السجل.');
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
        <p className="muted">الملاحظة: {draft.note}</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="actions">
          <button className={ACTIONS[kind].danger ? 'danger solid' : 'primary'} type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'جارٍ التنفيذ…' : 'تأكيد التنفيذ'}</button>
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
      <label>
        ملاحظة (مطلوبة)
        <textarea rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="سبب الإجراء، مثال: دفع بتحويل بنكي" required />
      </label>
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
          <ul className="list">
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

function Body({ detail, done, onStart, onChanged }: { detail: MemberDetail; done: string | null; onStart: () => void; onChanged: (text: string) => void }) {
  const { openThread } = useShell();
  const [action, setAction] = useState<ActionKind | null>(null);
  const { account, pb } = detail;
  const everMember = account.state === 'member' || account.state === 'expired';
  const allowed = actionsFor(account);
  // A reload can change what the account allows: a panel left open for an action that no longer applies closes.
  const open = action !== null && allowed.includes(action) ? action : null;
  return (
    <div className="stack">
      <section className="sheet-block">
        <div className="pills"><StatePill account={account} /><Intent score={account.intent} label={account.intent_label} /></div>
        <dl className="fields">
          <Field label="البريد الإلكتروني" ltr>{account.email || '—'}</Field>
          <Field label="الجوال" ltr>{account.phone || '—'}</Field>
          {account.job_title || account.company ? <Field label="العمل">{[account.job_title, account.company].filter(Boolean).join(' · ')}</Field> : null}
          {account.city ? <Field label="المدينة">{account.city}</Field> : null}
          <Field label="سجّل في">{formatDateTime(account.created_at)}</Field>
          <Field label="أكّد بريده">{account.verified_at ? formatDateTime(account.verified_at) : 'لم يؤكد بعد'}</Field>
          <Field label="آخر دخول">{account.last_login_at ? formatDateTime(account.last_login_at) : '—'}</Field>
          <Field label="رسائله مع المستشار">{formatNumber(account.msg_count)}</Field>
          {detail.sites.length > 0 ? <Field label="المواقع">{detail.sites.join(' · ')}</Field> : null}
        </dl>
        {account.msg_count > 0 ? <button type="button" onClick={() => openThread(account.id)}>فتح المحادثة</button> : null}
      </section>

      {everMember ? (
        <section className="sheet-block">
          <h3>العضوية السنوية</h3>
          <dl className="fields">
            <Field label="المتبقي">{account.state === 'expired' ? 'انتهت' : memberLeft(account)}</Field>
            <Field label={account.state === 'expired' ? 'انتهت في' : 'تنتهي في'}>{account.never_expires ? 'بلا تاريخ انتهاء' : formatDay(account.member_end)}</Field>
            {account.state === 'member' ? <Field label="رصيد المستشار اليوم">{dailyLeft(account)}</Field> : null}
            <Field label="رصيد بنك المشاريع">{pb ? `المتبقي ${formatProjects(pb.left)}` : '—'}</Field>
            {pb ? <Field label="تفاصيل الرصيد">{`الأساسي ${formatNumber(pb.credits)} · المضاف ${formatNumber(pb.granted)} · المستخدم ${formatNumber(pb.used)}`}</Field> : null}
            {pb ? <Field label="مشاريع فتحها">{formatNumber(pb.unlocked.length)}</Field> : null}
          </dl>
          {detail.pbError ? <ErrorCard error={{ code: detail.pbError.code, message: `رصيد بنك المشاريع غير متاح الآن: ${detail.pbError.message}` }} /> : null}
        </section>
      ) : null}

      <section className="sheet-block">
        <h3>الإجراءات</h3>
        {done ? <Done text={done} /> : null}
        {open ? (
          <ActionPanel
            key={open}
            kind={open}
            account={account}
            onCancel={() => setAction(null)}
            onDone={(text) => {
              setAction(null);
              onChanged(text);
            }}
          />
        ) : allowed.length > 0 ? (
          <div className="actions">
            {allowed.map((kind) => (
              <button
                key={kind}
                type="button"
                className={ACTIONS[kind].danger ? 'danger' : kind === 'activate' || kind === 'extend' ? 'primary' : undefined}
                onClick={() => {
                  onStart();
                  setAction(kind);
                }}
              >
                {ACTIONS[kind].button}
              </button>
            ))}
          </div>
        ) : null}
        {openEnded(account) ? <p className="muted hint">عضوية بلا تاريخ انتهاء: لا تحتاج تمديدًا.</p> : null}
        {account.role === 'admin' ? <p className="muted hint">صلاحية الإدارة تُمنح وتُسحب من صفحة الهب فقط.</p> : null}
        {account.state === 'pending' ? <p className="muted hint">الحساب لم يؤكد بريده بعد. تُتاح الإجراءات هنا بعد تأكيد البريد.</p> : null}
        {account.state === 'lead' ? <p className="muted hint">هذا عميل محتمل بلا حساب مؤكد بعد، فلا تُفعَّل له عضوية من هنا.</p> : null}
      </section>

      {detail.memo || detail.notes ? (
        <section className="sheet-block">
          <h3>ملاحظات الهب</h3>
          {detail.memo ? <p className="prose">{detail.memo}</p> : null}
          {detail.notes ? <p className="prose muted">{detail.notes}</p> : null}
        </section>
      ) : null}

      <History detail={detail} />
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
