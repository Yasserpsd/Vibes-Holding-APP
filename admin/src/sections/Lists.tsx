import { useEffect, useState } from 'react';

import { api, type CardRequest, type InviteRecord, type InvitesConfig, type LedgerEntry, type PersonaChangeRequest, type RequestStatus, type WorkshopRegistration } from '../api';
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

/** M138: the status every member request moves through, as the member reads it. */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { pending: 'قيد المراجعة', in_progress: 'جارٍ التنفيذ', done: 'تم', rejected: 'مرفوض', cancelled: 'ملغي' };
const REQUEST_STATUS_TONE: Record<RequestStatus, Tone> = { pending: 'muted', in_progress: 'gold', done: 'ok', rejected: 'danger', cancelled: 'muted' };

/**
 * M138 (owner): «قيد التنفيذ / تم / مرفوض» on every member request. Each press mails the member
 * (in his language) and pushes his phones; a note travels with the decision.
 */
export function RequestStatusControl({ status, busy, onChange }: { status: RequestStatus; busy: boolean; onChange: (status: RequestStatus, note: string) => void }) {
  const choices: RequestStatus[] = ['in_progress', 'done', 'rejected'];
  function pick(next: RequestStatus) {
    const note = next === 'rejected' ? (window.prompt('سبب الرفض (يصل للعضو كما تكتبه):', '') ?? '') : '';
    if (next === 'rejected' && !window.confirm('رفض الطلب؟ سيصل العضو بريد وإشعار بالقرار.')) return;
    onChange(next, note);
  }
  return (
    <div className="status-control">
      <Pill tone={REQUEST_STATUS_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Pill>
      <div className="row-actions">
        {choices
          .filter((choice) => choice !== status)
          .map((choice) => (
            <button key={choice} type="button" className={choice === 'rejected' ? 'danger' : undefined} disabled={busy} onClick={() => pick(choice)}>
              {REQUEST_STATUS_LABEL[choice]}
            </button>
          ))}
      </div>
    </div>
  );
}

/** M30: members asking for the printed membership card, delivered to the door at no charge. */
export function CardRequests() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.cardRequests(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = state.data?.requests.filter((row) => row.status === 'pending' || row.status === 'in_progress').length ?? 0;

  async function setStatus(row: CardRequest, status: RequestStatus, note: string) {
    if (status === 'done' && !window.confirm(`تم تسليم الكارت المطبوع للعضو «${row.name}»؟`)) return;
    setBusyId(row.id);
    try {
      await api.cardRequestStatus(row.id, status, note);
      notify('ok', status === 'done' ? 'سُجّل التسليم وأُبلغ العضو.' : 'تحدّثت الحالة وأُبلغ العضو.');
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
      <p className="muted">كل طلب هنا اختاره العضو بنفسه من التطبيق: كارت عضويته مطبوعًا يستلمه من المقر بدون رسوم أو يصله إلى عنوانه بمصاريف شحن. اطبع الكارت، سلّمه، ثم علّم الطلب «تم» — أو يعلّمه العضو بنفسه من التطبيق («استلمت كارتي») فيظهر هنا «أكد العضو الاستلام». «نسخة بديلة» = كارت سبق تسليمه وطلب العضو غيره.</p>
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
              {
                key: 'to',
                label: 'التوصيل',
                cell: (row) => (
                  <>
                    {/* M163: a replacement copy is marked so the management knows the first card was already handed over. */}
                    {row.replacement ? <Pill tone="gold">نسخة بديلة</Pill> : null} {row.city} · {row.address}
                    {row.note ? ` · ${row.note}` : ''}
                  </>
                ),
              },
              { key: 'phone', label: 'الجوال', cell: (row) => <bdi dir="ltr" className="num">{row.phone || '—'}</bdi> },
              { key: 'at', label: 'طُلب', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'status',
                label: 'الحالة',
                cell: (row) =>
                  row.status === 'done' ? (
                    <>
                      <Pill tone="ok">سُلّم {row.doneAt ? formatDateTime(row.doneAt) : ''}</Pill>
                      {/* M163: the member closed it himself from the app («استلمت كارتي»). */}
                      {row.memberConfirmedAt ? <Pill tone="gold">أكد العضو الاستلام</Pill> : null}
                    </>
                  ) : (
                    <RequestStatusControl status={row.status} busy={busyId === row.id} onChange={(status, note) => void setStatus(row, status, note)} />
                  ),
              },
            ]}
          />
        )}
      </Async>
    </>
  );
}

const PERSONA_WORD: Record<string, string> = { neutral: 'محايد', entrepreneur: 'رائد أعمال', investor: 'مستثمر' };

/** M109d «طلبات تغيير الصفة»: the yearly self-serve change is used up, so the member asks and the club decides. */
export function PersonaRequests() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.personaRequests(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = state.data?.requests ?? [];
  const pending = rows.filter((row) => row.status === 'pending').length;

  async function decide(row: PersonaChangeRequest, action: 'approve' | 'reject') {
    const to = PERSONA_WORD[row.to] ?? row.to;
    const confirmText =
      action === 'approve' ? `اعتماد تغيير صفة «${row.name}» إلى «${to}»؟ يُطبّق التغيير فورًا ويصل للعضو إشعار.` : `رفض طلب «${row.name}»؟ يصل للعضو إشعار بالرفض.`;
    if (!window.confirm(confirmText)) return;
    const note = action === 'reject' ? (window.prompt('ملاحظة للعضو (اختياري):') ?? '') : '';
    setBusyId(row.id);
    try {
      await api.decidePersonaRequest(row.id, action, note.trim());
      notify('ok', action === 'approve' ? 'اعتُمد التغيير ووصل العضو إشعار.' : 'رُفض الطلب ووصل العضو إشعار.');
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
      <SectionHead title="طلبات تغيير الصفة" hint={state.data ? `قيد المراجعة: ${formatNumber(pending)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        العضو يغيّر صفته بنفسه مرة واحدة خلال سنة العضوية. ما زاد عن ذلك يصل هنا كطلب: الاعتماد يطبّق الصفة الجديدة فورًا ويُشعر العضو، والرفض يُشعره
        بدون تغيير. إن فشل الاعتماد لانتهاء جلسة العضو يبقى الطلب قائمًا — اطلب منه فتح التطبيق ثم أعد المحاولة.
      </p>
      <Async state={state} rows={5} empty={() => rows.length === 0} emptyText="لا توجد طلبات تغيير بعد.">
        {() => (
          <DataTable<PersonaChangeRequest>
            caption="طلبات تغيير الصفة"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'العضو', cell: (row) => <MemberLink id={row.contactId} name={row.name || row.email} /> },
              { key: 'from', label: 'الصفة الحالية', cell: (row) => PERSONA_WORD[row.from] ?? row.from ?? '—' },
              { key: 'to', label: 'الصفة المطلوبة', cell: (row) => PERSONA_WORD[row.to] ?? row.to },
              { key: 'note', label: 'ملاحظة العضو', cell: (row) => row.note || '—' },
              { key: 'at', label: 'طُلب', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'status',
                label: 'الحالة',
                cell: (row) =>
                  row.status === 'pending' ? (
                    <span className="actions">
                      <button type="button" disabled={busyId === row.id} onClick={() => void decide(row, 'approve')}>اعتماد</button>
                      <button type="button" className="danger" disabled={busyId === row.id} onClick={() => void decide(row, 'reject')}>رفض</button>
                    </span>
                  ) : (
                    <Pill tone={row.status === 'approved' ? 'ok' : 'danger'}>
                      {row.status === 'approved' ? 'اعتُمد' : 'رُفض'} {row.decidedAt ? formatDateTime(row.decidedAt) : ''}
                    </Pill>
                  ),
              },
            ]}
          />
        )}
      </Async>
    </>
  );
}

/** M10: workshop interest registrations from «دليل المحايد» — the management sends the timing details itself. */
export function Workshops() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.workshopRegistrations(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = state.data?.registrations ?? [];

  // M138: the registration finally has a status; the member hears every change.
  async function setStatus(row: WorkshopRegistration, status: RequestStatus, note: string) {
    setBusyId(row.id);
    try {
      await api.workshopStatus(row.id, status, note);
      notify('ok', 'تحدّثت الحالة وأُبلغ المسجّل.');
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setBusyId(null);
    }
  }
  const byWorkshop = new Map<string, number>();
  for (const row of rows) byWorkshop.set(row.workshopTitle, (byWorkshop.get(row.workshopTitle) ?? 0) + 1);
  return (
    <>
      <SectionHead title="تسجيلات الورش" hint={state.data ? `عدد التسجيلات: ${formatNumber(rows.length)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        كل صف اهتمام سجّله مستخدم من صفحة «دليل المحايد» (لا يحتاج عضوية). الورش نفسها ومواعيدها تُعدَّل من «محتوى التطبيق» ← «دليل المحايد والورش»،
        وفتح التسجيل وإغلاقه من «القيم والأسعار». تفاصيل الموعد ترسلها الإدارة للمسجّلين بنفسها.
      </p>
      {byWorkshop.size > 0 ? (
        <p className="muted">{[...byWorkshop.entries()].map(([title, count]) => `${title}: ${formatNumber(count)}`).join(' · ')}</p>
      ) : null}
      <Async state={state} rows={5} empty={() => rows.length === 0} emptyText="لا توجد تسجيلات بعد.">
        {() => (
          <DataTable<WorkshopRegistration>
            caption="تسجيلات الورش"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'المسجّل', cell: (row) => <MemberLink id={row.contactId} name={row.name || row.email} /> },
              { key: 'workshop', label: 'الورشة', cell: (row) => row.workshopTitle },
              { key: 'persona', label: 'الفئة', cell: (row) => row.personaLabel || '—' },
              { key: 'phone', label: 'الجوال', cell: (row) => (row.phone ? <bdi dir="ltr" className="num">{row.phone}</bdi> : '—') },
              { key: 'mail', label: 'البريد', cell: (row) => (row.email ? <bdi dir="ltr" className="num">{row.email}</bdi> : '—') },
              { key: 'note', label: 'ملاحظته', cell: (row) => row.note || '—' },
              { key: 'at', label: 'سجّل', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'status',
                label: 'الحالة',
                cell: (row) => <RequestStatusControl status={row.status ?? 'pending'} busy={busyId === row.id} onChange={(status, note) => void setStatus(row, status, note)} />,
              },
            ]}
          />
        )}
      </Async>
    </>
  );
}

const LEDGER_KIND: Record<LedgerEntry['kind'], string> = { service: 'طلب خدمة', golden: 'اهتمام بفرصة شراكة' };

/** M138 «طلبات الخدمات»: service requests and golden interests, which had no list before; every status change reaches the member. */
export function MemberRequests() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.memberRequests(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kind, setKind] = useState<'' | LedgerEntry['kind']>('');
  const all = state.data?.requests ?? [];
  const rows = kind ? all.filter((row) => row.kind === kind) : all;
  const waiting = all.filter((row) => row.status === 'pending' || row.status === 'in_progress').length;

  async function setStatus(row: LedgerEntry, status: RequestStatus, note: string) {
    setBusyId(row.id);
    try {
      await api.memberRequestStatus(row.id, status, note);
      notify('ok', 'تحدّثت الحالة وأُبلغ العضو.');
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
      <SectionHead title="طلبات الخدمات" hint={state.data ? `قيد العمل: ${formatNumber(waiting)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        كل صف هنا طلب خدمة (قبل تحويل واتساب) أو تسجيل اهتمام بفرصة شراكة من عضو مسجّل. العضو استلم إيصالًا على بريده لحظة الطلب، ويتابع الحالة من
        التطبيق: حسابي ← «متابعة طلباتي». كل ضغطة هنا تصل إليه بريدًا وإشعارًا.
      </p>
      <div className="filters">
        <Chips<'' | LedgerEntry['kind']>
          label="النوع"
          options={[
            { value: '', label: 'الكل' },
            { value: 'service', label: LEDGER_KIND.service },
            { value: 'golden', label: LEDGER_KIND.golden },
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>
      <Async state={state} rows={5} empty={() => rows.length === 0} emptyText="لا توجد طلبات بعد.">
        {() => (
          <DataTable<LedgerEntry>
            caption="طلبات الخدمات والاهتمام بالشراكات"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'العضو', cell: (row) => <MemberLink id={row.contactId} name={row.name || row.email} /> },
              { key: 'kind', label: 'النوع', cell: (row) => LEDGER_KIND[row.kind] },
              { key: 'title', label: 'الطلب', cell: (row) => row.title },
              {
                key: 'rows',
                label: 'التفاصيل',
                cell: (row) =>
                  row.rows.length ? (
                    <details>
                      <summary>{formatNumber(row.rows.length)} بند</summary>
                      <ul className="answers">
                        {row.rows.map((item, index) => (
                          <li key={`${item.label}-${index}`}>
                            <strong>{item.label}:</strong> {item.value}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    '—'
                  ),
              },
              { key: 'phone', label: 'الجوال', cell: (row) => (row.phone ? <bdi dir="ltr" className="num">{row.phone}</bdi> : '—') },
              { key: 'at', label: 'طُلب', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'status',
                label: 'الحالة',
                cell: (row) => <RequestStatusControl status={row.status} busy={busyId === row.id} onChange={(status, note) => void setStatus(row, status, note)} />,
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
