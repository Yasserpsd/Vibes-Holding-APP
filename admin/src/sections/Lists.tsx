import { useEffect, useState } from 'react';

import { api, type CardRequest, type InviteRecord, type InvitesConfig } from '../api';
import { formatDateTime, formatDays, formatLooseDate, formatNumber, formatProjects } from '../format';
import type { AuditEntry, Lead, MailItem, Ticket } from '../types';
import { Async, AsyncPage, Chips, DataTable, Intent, MemberLink, messageOf, Pill, SearchBox, SectionHead, sessionOver, useDebounced, useLoad, useShell, type Tone } from '../ui';

const PER_PAGE = 25;

/** Event tickets issued by the hub, with who came. */
export function Tickets() {
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(text.trim());
  const state = useLoad(() => api.tickets({ q, page, perPage: PER_PAGE }), [q, page]);
  useEffect(() => setPage(1), [q]);
  return (
    <>
      <SectionHead title="التذاكر" hint={state.data ? `عدد التذاكر: ${formatNumber(state.data.total)}` : undefined} onReload={state.reload} busy={state.loading} />
      <div className="filters">
        <SearchBox value={text} onChange={setText} placeholder="ابحث بالاسم أو الفعالية أو رقم التذكرة" />
      </div>
      <AsyncPage state={state} onPage={setPage} rows={8} emptyText={q ? 'لا توجد تذاكر تطابق البحث.' : 'لم تصدر أي تذكرة بعد.'}>
        {(data) => (
          <DataTable<Ticket>
            caption="التذاكر"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'صاحب التذكرة', cell: (row) => <MemberLink id={row.contact_id} name={row.name || row.email || row.phone} /> },
              { key: 'event', label: 'الفعالية', cell: (row) => row.event_title || '—' },
              { key: 'when', label: 'الموعد والمكان', cell: (row) => [formatLooseDate(row.event_date), row.event_place].filter(Boolean).join(' · ') || '—' },
              { key: 'ref', label: 'رقم التذكرة', cell: (row) => <bdi dir="ltr" className="num">{row.ref}</bdi> },
              { key: 'in', label: 'الحضور', cell: (row) => <Pill tone={row.checked_in ? 'ok' : 'muted'}>{row.checked_in ? 'حضر' : 'لم يحضر بعد'}</Pill> },
              { key: 'at', label: 'صدرت', cell: (row) => formatDateTime(row.created_at) },
            ]}
          />
        )}
      </AsyncPage>
    </>
  );
}

/** M30: members asking for the printed membership card, delivered to the door at no charge. */
export function CardRequests() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.cardRequests(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = state.data?.requests.filter((row) => row.status === 'pending').length ?? 0;

  async function markDone(row: CardRequest) {
    if (!window.confirm(`تم تسليم الكارت المطبوع للعضو «${row.name}»؟`)) return;
    setBusyId(row.id);
    try {
      await api.cardRequestDone(row.id);
      notify('ok', 'سُجّل التسليم.');
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <SectionHead title="طلبات الكروت" hint={state.data ? `قيد التنفيذ: ${formatNumber(pending)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">كل طلب هنا اختاره العضو بنفسه من التطبيق: كارت عضويته مطبوعًا يصل إلى عنوانه بدون رسوم. اطبع الكارت، سلّمه، ثم علّم الطلب «تم التسليم».</p>
      <Async state={state} rows={5} empty={() => (state.data?.requests.length ?? 0) === 0} emptyText="لا توجد طلبات طباعة بعد.">
        {() => (
          <DataTable<CardRequest>
            caption="طلبات طباعة كارت العضوية"
            rows={state.data?.requests ?? []}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'العضو', cell: (row) => <MemberLink id={row.contactId} name={row.name || row.email} /> },
              { key: 'number', label: 'رقم العضوية', cell: (row) => <bdi dir="ltr" className="num">{row.cardNumber}</bdi> },
              { key: 'persona', label: 'الفئة', cell: (row) => row.personaLabel || '—' },
              { key: 'to', label: 'التوصيل', cell: (row) => `${row.city} · ${row.address}${row.note ? ` · ${row.note}` : ''}` },
              { key: 'phone', label: 'الجوال', cell: (row) => <bdi dir="ltr" className="num">{row.phone || '—'}</bdi> },
              { key: 'at', label: 'طُلب', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'status',
                label: 'الحالة',
                cell: (row) =>
                  row.status === 'done' ? (
                    <Pill tone="ok">سُلّم {row.doneAt ? formatDateTime(row.doneAt) : ''}</Pill>
                  ) : (
                    <button type="button" disabled={busyId === row.id} onClick={() => void markDone(row)}>تم التسليم</button>
                  ),
              },
            ]}
          />
        )}
      </Async>
    </>
  );
}

/** The invitee's road so far, at a glance. */
function inviteProgress(row: InviteRecord): { label: string; tone: Tone } {
  if (row.activatedAt) return { label: 'عضو بعضوية مفعّلة', tone: 'ok' };
  if (row.verifiedAt) return { label: 'فعّل بريده', tone: 'gold' };
  return { label: 'سجّل، بانتظار تفعيل البريد', tone: 'muted' };
}

/** M32: who registered through whose invite code, and the administration's manual gift per invitee. */
export function Invites() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.invites(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [config, setConfig] = useState<InvitesConfig | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setConfig(state.data?.config ?? null), [state.data]);
  const waiting = state.data?.invites.filter((row) => row.verifiedAt && !row.gift).length ?? 0;

  async function saveConfig() {
    if (!config || saving) return;
    setSaving(true);
    try {
      await api.invitesConfig(config);
      notify('ok', 'حُفظت النصوص.');
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setSaving(false);
    }
  }

  async function markGift(row: InviteRecord) {
    const note = window.prompt(`ما الهدية التي سلّمتها الإدارة للعضو «${row.inviteeName}»؟ (كود خصم، كتاب…)`)?.trim();
    if (!note) return;
    setBusyId(row.id);
    try {
      await api.inviteGift(row.id, note);
      notify('ok', 'سُجّل تسليم الهدية.');
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <SectionHead title="الدعوات" hint={state.data ? `هدايا بانتظار التسليم: ${formatNumber(waiting)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        كل صف هنا تسجيل تحقق منه النظام: كود الدعوة سافر مع التسجيل وخزّنه الهب على الحساب الجديد. العضو الداعي يرشّح فقط؛ الهدية للعضو الجديد
        تحددها وتسلّمها الإدارة بنفسها (كود خصم، كتاب المؤسس…)، ثم تُسجَّل هنا بزر «تم تسليم الهدية».
      </p>
      <Async state={state} rows={5}>
        {(data) => (
          <div className="stack">
            {config ? (
              <form className="card editor" onSubmit={(event) => { event.preventDefault(); void saveConfig(); }}>
                <label>
                  نص الدعوة الذي يشاركه العضو ({'{code}'} يصير رقم عضويته)
                  <textarea rows={3} maxLength={700} value={config.shareText} onChange={(event) => setConfig({ ...config, shareText: event.target.value })} />
                </label>
                <label>
                  نص الهدية الظاهر في شاشة الدعوات
                  <textarea rows={2} maxLength={500} value={config.giftText} onChange={(event) => setConfig({ ...config, giftText: event.target.value })} />
                </label>
                <div>
                  <button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ النصوص'}</button>
                </div>
              </form>
            ) : null}
            {data.invites.length === 0 ? (
              <p className="state-card empty">لم يسجّل أحد بكود دعوة بعد.</p>
            ) : (
              <DataTable<InviteRecord>
                caption="الدعوات"
                rows={data.invites}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'who', label: 'العضو الجديد', cell: (row) => <MemberLink id={row.inviteeId} name={row.inviteeName || row.inviteeEmail} /> },
                  { key: 'phone', label: 'جواله', cell: (row) => (row.inviteePhone ? <bdi dir="ltr" className="num">{row.inviteePhone}</bdi> : '—') },
                  {
                    key: 'from',
                    label: 'بدعوة من',
                    cell: (row) => (
                      <>
                        <MemberLink id={row.inviterId} name={row.inviterName || `حساب رقم ${row.inviterId}`} /> <bdi dir="ltr" className="num">{row.inviterNumber}</bdi>
                      </>
                    ),
                  },
                  { key: 'state', label: 'وصل إلى', cell: (row) => { const progress = inviteProgress(row); return <Pill tone={progress.tone}>{progress.label}</Pill>; } },
                  { key: 'at', label: 'سجّل', cell: (row) => formatDateTime(row.createdAt) },
                  {
                    key: 'gift',
                    label: 'الهدية',
                    cell: (row) =>
                      row.gift ? (
                        <Pill tone="ok">{`سُلّمت: ${row.gift.note}`}</Pill>
                      ) : (
                        <button type="button" disabled={busyId === row.id} onClick={() => void markGift(row)}>تم تسليم الهدية</button>
                      ),
                  },
                ]}
              />
            )}
          </div>
        )}
      </Async>
    </>
  );
}

const LEAD_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'الكل' },
  { value: 'payment', label: 'دفع' },
  { value: 'membership', label: 'عضوية' },
  { value: 'partner', label: 'شراكة' },
  { value: 'service', label: 'خدمة' },
  { value: 'cooperation', label: 'تعاون' },
  { value: 'owner', label: 'صاحب مشروع' },
  { value: 'management', label: 'الإدارة' },
];
const leadType = (ltype: string) => LEAD_TYPES.find((entry) => entry.value === ltype)?.label ?? ltype;
const LEAD_STATUSES: Record<string, { label: string; tone: Tone }> = { new: { label: 'جديد', tone: 'gold' }, done: { label: 'تمت متابعته', tone: 'ok' } };

/** People who asked for something on the websites, the most serious first to the eye: the hub grades each one. */
export function Leads() {
  const [text, setText] = useState('');
  const [ltype, setLtype] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(text.trim());
  const state = useLoad(() => api.leads({ q, ltype, page, perPage: PER_PAGE }), [q, ltype, page]);
  useEffect(() => setPage(1), [q, ltype]);
  return (
    <>
      <SectionHead title="العملاء المحتملون" hint={state.data ? `عدد الطلبات: ${formatNumber(state.data.total)}` : undefined} onReload={state.reload} busy={state.loading} />
      <div className="filters">
        <SearchBox value={text} onChange={setText} placeholder="ابحث بالاسم أو الجوال أو الشركة" />
        <Chips label="نوع الطلب" options={LEAD_TYPES} value={ltype} onChange={setLtype} />
      </div>
      <AsyncPage state={state} onPage={setPage} rows={8} emptyText={q || ltype ? 'لا توجد طلبات تطابق هذا العرض.' : 'لا يوجد عملاء محتملون بعد.'}>
        {(data) => (
          <DataTable<Lead>
            caption="العملاء المحتملون"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'العميل', cell: (row) => <MemberLink id={row.contact_id} name={row.name || row.phone} /> },
              { key: 'intent', label: 'درجة الجدية', cell: (row) => <Intent score={row.intent} label={row.intent_label} /> },
              { key: 'type', label: 'النوع', cell: (row) => leadType(row.ltype) },
              { key: 'reason', label: 'الطلب', cell: (row) => [row.reason, row.company].filter(Boolean).join(' · ') || '—' },
              { key: 'phone', label: 'الجوال', cell: (row) => (row.phone ? <bdi dir="ltr" className="num">{row.phone}</bdi> : '—') },
              { key: 'status', label: 'الحالة', cell: (row) => <Pill tone={LEAD_STATUSES[row.status]?.tone ?? 'muted'}>{LEAD_STATUSES[row.status]?.label ?? (row.status || '—')}</Pill> },
              { key: 'at', label: 'الوقت', cell: (row) => `${formatDateTime(row.created_at)}${row.site ? ` · ${row.site}` : ''}` },
            ]}
          />
        )}
      </AsyncPage>
    </>
  );
}

const MAIL_STATUSES: Record<string, { label: string; tone: Tone }> = { sent: { label: 'أُرسلت', tone: 'ok' }, pending: { label: 'بانتظار الإرسال', tone: 'gold' }, failed: { label: 'فشلت', tone: 'danger' } };

/** The hub's mail queue: the last 50 messages by subject and state, never their text. */
export function Mail() {
  const state = useLoad(() => api.mail(), []);
  return (
    <>
      <SectionHead title="البريد" hint="آخر 50 رسالة أرسلها الهب" onReload={state.reload} busy={state.loading} />
      <Async state={state} rows={8}>
        {(data) => (
          <div className="stack">
            <dl className="strip three card">
              <div><dt>بانتظار الإرسال</dt><dd className="num">{formatNumber(data.stats.pending)}</dd></div>
              <div><dt>أُرسلت</dt><dd className="num">{formatNumber(data.stats.sent)}</dd></div>
              <div><dt>فشلت</dt><dd className={data.stats.failed > 0 ? 'num error' : 'num'}>{formatNumber(data.stats.failed)}</dd></div>
            </dl>
            {data.items.length === 0 ? <p className="state-card empty">لا توجد رسائل في الطابور.</p> : null}
            <DataTable<MailItem>
              caption="رسائل البريد"
              rows={data.items}
              rowKey={(row) => row.id}
              columns={[
                { key: 'to', label: 'إلى', cell: (row) => <bdi dir="ltr">{row.to_email}</bdi> },
                { key: 'subject', label: 'العنوان', cell: (row) => row.subject || '—' },
                { key: 'kind', label: 'النوع', cell: (row) => <bdi dir="ltr">{row.kind || '—'}</bdi> },
                { key: 'status', label: 'الحالة', cell: (row) => <Pill tone={MAIL_STATUSES[row.status]?.tone ?? 'muted'}>{MAIL_STATUSES[row.status]?.label ?? row.status}</Pill> },
                { key: 'tries', label: 'المحاولات', num: true, cell: (row) => formatNumber(row.attempts) },
                { key: 'at', label: 'الوقت', cell: (row) => formatDateTime(row.sent_at ?? row.created_at) },
              ]}
            />
          </div>
        )}
      </Async>
    </>
  );
}

const GRANTS: Record<string, string> = { activate: 'تفعيل عضوية', extend: 'تمديد عضوية', revoke: 'إلغاء عضوية' };

/** What the entry did, in words, from the stored parameters. */
function auditText(entry: AuditEntry): string {
  const { params } = entry;
  if (entry.action === 'grant') {
    const days = typeof params.days === 'number' ? ` · ${formatDays(params.days)}` : '';
    return `${GRANTS[String(params.action)] ?? 'تعديل عضوية'}${days}`;
  }
  if (entry.action === 'role') return params.role === 'publisher' ? 'منح صلاحية النشر' : 'سحب صلاحية النشر';
  if (entry.action === 'pb_grant') {
    const amount = typeof params.amount === 'number' ? params.amount : 0;
    return amount >= 0 ? `زيادة رصيد بنك المشاريع: ${formatProjects(amount)}` : `خصم من رصيد بنك المشاريع: ${formatProjects(-amount)}`;
  }
  return typeof params.excerpt === 'string' && params.excerpt ? `رد على محادثة: «${params.excerpt}»` : 'رد على محادثة';
}

/** Every write made from this dashboard: who, when, what, the note and how it went. Failed attempts are here too. */
export function Audit() {
  const state = useLoad(() => api.audit(200), []);
  return (
    <>
      <SectionHead title="سجل الإجراءات" hint="آخر 200 إجراء من هذه اللوحة، الأحدث أولًا" onReload={state.reload} busy={state.loading} />
      <Async state={state} rows={8} empty={(data) => data.entries.length === 0} emptyText="لم يُنفَّذ أي إجراء من اللوحة بعد.">
        {(data) => (
          <DataTable<AuditEntry>
            caption="سجل الإجراءات"
            rows={data.entries}
            rowKey={(row) => row.id}
            columns={[
              { key: 'what', label: 'الإجراء', cell: (row) => auditText(row) },
              { key: 'whom', label: 'على حساب', cell: (row) => <MemberLink id={row.contactId} name={`حساب رقم ${row.contactId}`} /> },
              { key: 'note', label: 'الملاحظة', cell: (row) => row.note || '—' },
              { key: 'who', label: 'نفّذه', cell: (row) => row.actor.name || row.actor.email },
              { key: 'result', label: 'النتيجة', cell: (row) => <Pill tone={row.result === 'ok' ? 'ok' : 'danger'}>{row.result === 'ok' ? 'تم' : `فشل${row.error ? ` · ${row.error}` : ''}`}</Pill> },
              { key: 'at', label: 'الوقت', cell: (row) => formatDateTime(row.at) },
            ]}
          />
        )}
      </Async>
    </>
  );
}
