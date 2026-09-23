import { useState } from 'react';

import { api, type AgendaEvent, type AgendaEventInput, type AgendaMode, type AgendaRegistration } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, Sheet, useLoad, useShell } from '../ui';

/** M41 «أجندة النادي»: events across the whole year, their registrations, and the members' push reminder. */

const MODE_LABEL: Record<AgendaMode, string> = { hq: 'حضوري', online: 'أونلاين', both: 'حضوري وأونلاين' };
const EMPTY: AgendaEventInput = { title: '', blurb: '', date: '', time: '', endTime: '', place: 'مقر النادي بالرياض', onlineUrl: '', mode: 'both', feeSar: 0, open: true };

export function Agenda() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.agenda(), []);
  const [editor, setEditor] = useState<{ row: AgendaEvent | null; input: AgendaEventInput } | null>(null);
  const [rows, setRows] = useState<{ event: AgendaEvent; registrations: AgendaRegistration[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const upcoming = state.data?.events.filter((event) => !pastOf(event)).length ?? 0;

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  function pastOf(event: AgendaEvent): boolean {
    return event.date < new Date().toISOString().slice(0, 10);
  }

  async function save() {
    if (!editor || busy) return;
    setBusy(true);
    try {
      if (editor.row) await api.updateAgendaEvent(editor.row.id, editor.input);
      else await api.createAgendaEvent(editor.input);
      notify('ok', 'حُفظت الفعالية.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AgendaEvent) {
    if (!window.confirm(`حذف فعالية «${row.title}» وكل تسجيلاتها نهائيًا؟`)) return;
    setBusy(true);
    try {
      await api.deleteAgendaEvent(row.id);
      notify('ok', 'حُذفت الفعالية.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function push(row: AgendaEvent) {
    if (!window.confirm(`إرسال إشعار عن «${row.title}» لكل الأجهزة المسجلة؟`)) return;
    setBusy(true);
    try {
      const outcome = await api.notifyAgendaEvent(row.id);
      notify('ok', `أُرسل الإشعار إلى ${formatNumber(outcome.sent)} جهازًا.`);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function openRegistrations(row: AgendaEvent) {
    try {
      const answer = await api.agendaRegistrations(row.id);
      setRows({ event: row, registrations: answer.registrations });
    } catch (failure) {
      fail(failure);
    }
  }

  const edit = (patch: Partial<AgendaEventInput>) => setEditor((current) => (current ? { ...current, input: { ...current.input, ...patch } } : current));

  return (
    <>
      <SectionHead title="أجندة النادي" hint={state.data ? `فعاليات قادمة: ${formatNumber(upcoming)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        أضف فعاليات السنة كلها من هنا: العضو يسجّل حضوره من التطبيق بدوسة واحدة (حضوري أو أونلاين) بدون رسوم، وغير العضو يدفع رسوم الفعالية داخل
        التطبيق إن وُجدت ولا يتأكد تسجيله إلا بعد نجاح الدفع. رابط الأونلاين لا يظهر إلا للمسجّلين المؤكدين. زر «إشعار» يذكّر كل الأجهزة بالفعالية.
      </p>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => setEditor({ row: null, input: { ...EMPTY } })}>+ فعالية جديدة</button>
      </div>
      <Async state={state} rows={5} empty={() => (state.data?.events.length ?? 0) === 0} emptyText="لا توجد فعاليات بعد — أضف أول فعالية.">
        {(data) => (
          <DataTable<AgendaEvent>
            caption="فعاليات أجندة النادي"
            rows={data.events}
            rowKey={(row) => row.id}
            columns={[
              { key: 'when', label: 'الموعد', cell: (row) => <bdi dir="ltr" className="num">{`${row.date}${row.time ? ` ${row.time}` : ''}`}</bdi> },
              { key: 'title', label: 'الفعالية', cell: (row) => row.title },
              { key: 'mode', label: 'الحضور', cell: (row) => MODE_LABEL[row.mode] },
              { key: 'fee', label: 'رسوم غير الأعضاء', cell: (row) => (row.feeSar > 0 ? `${formatNumber(row.feeSar)} ر.س` : 'بدون رسوم') },
              {
                key: 'counts',
                label: 'المسجّلون',
                cell: (row) => (
                  <button type="button" className="link" onClick={() => void openRegistrations(row)}>
                    {`${formatNumber(row.counts.confirmed)} مؤكد (${formatNumber(row.counts.hq)} حضوري · ${formatNumber(row.counts.online)} أونلاين)${row.counts.awaitingPayment ? ` · ${formatNumber(row.counts.awaitingPayment)} لم يدفع` : ''}`}
                  </button>
                ),
              },
              {
                key: 'state',
                label: 'الحالة',
                cell: (row) => (pastOf(row) ? <Pill tone="muted">انتهت</Pill> : row.open ? <Pill tone="ok">التسجيل مفتوح</Pill> : <Pill tone="muted">مغلقة</Pill>),
              },
              {
                key: 'actions',
                label: '',
                cell: (row) => (
                  <span className="row-actions">
                    <button type="button" onClick={() => setEditor({ row, input: { title: row.title, blurb: row.blurb, date: row.date, time: row.time, endTime: row.endTime, place: row.place, onlineUrl: row.onlineUrl, mode: row.mode, feeSar: row.feeSar, open: row.open } })}>تعديل</button>
                    <button type="button" disabled={busy} onClick={() => void push(row)}>إشعار</button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Async>

      {editor ? (
        <Sheet title={editor.row ? `تعديل «${editor.row.title}»` : 'فعالية جديدة'} onClose={() => setEditor(null)}>
          <form className="card editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>
              اسم الفعالية
              <input value={editor.input.title} maxLength={140} onChange={(event) => edit({ title: event.target.value })} required />
            </label>
            <label>
              وصف قصير
              <textarea rows={3} maxLength={1000} value={editor.input.blurb} onChange={(event) => edit({ blurb: event.target.value })} />
            </label>
            <label>
              اليوم
              <input type="date" value={editor.input.date} onChange={(event) => edit({ date: event.target.value })} required />
            </label>
            <label>
              من الساعة (اختياري)
              <input type="time" value={editor.input.time} onChange={(event) => edit({ time: event.target.value })} />
            </label>
            <label>
              إلى الساعة (اختياري)
              <input type="time" value={editor.input.endTime} onChange={(event) => edit({ endTime: event.target.value })} />
            </label>
            <label>
              طريقة الحضور
              <select value={editor.input.mode} onChange={(event) => edit({ mode: event.target.value as AgendaMode })}>
                <option value="both">حضوري وأونلاين</option>
                <option value="hq">حضوري فقط</option>
                <option value="online">أونلاين فقط</option>
              </select>
            </label>
            <label>
              المكان (للحضوري)
              <input value={editor.input.place} maxLength={200} onChange={(event) => edit({ place: event.target.value })} />
            </label>
            <label>
              رابط الأونلاين (يظهر للمسجّلين المؤكدين فقط)
              <input dir="ltr" value={editor.input.onlineUrl} maxLength={300} onChange={(event) => edit({ onlineUrl: event.target.value })} placeholder="https://…" />
            </label>
            <label>
              رسوم غير الأعضاء بالريال (0 = بدون رسوم للجميع؛ الأعضاء دائمًا بدون رسوم)
              <input type="number" min={0} max={100000} value={editor.input.feeSar} onChange={(event) => edit({ feeSar: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
              <input type="checkbox" checked={editor.input.open} onChange={(event) => edit({ open: event.target.checked })} /> التسجيل مفتوح
            </label>
            <div className="row-actions">
              <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
              {editor.row ? <button type="button" className="ghost" disabled={busy} onClick={() => void remove(editor.row as AgendaEvent)}>حذف</button> : null}
            </div>
          </form>
        </Sheet>
      ) : null}

      {rows ? (
        <Sheet title={`مسجّلو «${rows.event.title}»`} onClose={() => setRows(null)}>
          {rows.registrations.length === 0 ? (
            <p className="state-card empty">لا توجد تسجيلات بعد.</p>
          ) : (
            <DataTable<AgendaRegistration>
              caption="التسجيلات"
              rows={rows.registrations}
              rowKey={(row) => row.id}
              columns={[
                { key: 'who', label: 'الاسم', cell: (row) => <MemberLink id={row.contactId} name={row.name || row.email} /> },
                { key: 'attend', label: 'الحضور', cell: (row) => (row.attendance === 'hq' ? 'حضوري' : 'أونلاين') },
                {
                  key: 'paid',
                  label: 'الحالة',
                  cell: (row) =>
                    row.paid ? <Pill tone="ok">{row.member ? 'عضو — بدون رسوم' : 'مؤكد — دفع'}</Pill> : <Pill tone="muted">لم يكتمل الدفع</Pill>,
                },
                { key: 'phone', label: 'الجوال', cell: (row) => (row.phone ? <bdi dir="ltr" className="num">{row.phone}</bdi> : '—') },
                { key: 'at', label: 'سجّل', cell: (row) => formatDateTime(row.createdAt) },
              ]}
            />
          )}
        </Sheet>
      ) : null}
    </>
  );
}
