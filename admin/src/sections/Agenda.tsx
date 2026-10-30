import { useRef, useState } from 'react';

import { api, uploadFile, type AgendaEvent, type AgendaEventInput, type AgendaMode, type AgendaRegistration } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, Sheet, useLoad, useShell } from '../ui';

/** M41 «أجندة النادي»: events across the whole year, their registrations, and the members' push reminder. */

const MODE_LABEL: Record<AgendaMode, string> = { hq: 'حضوري', online: 'أونلاين', both: 'حضوري وأونلاين' };
const EMPTY: AgendaEventInput = { title: '', blurb: '', date: '', time: '', endTime: '', place: 'مقر النادي بالرياض', onlineUrl: '', imageUrl: null, coverUrl: null, mode: 'both', feeSar: 0, memberFeeSar: 0, interests: [], open: true };

/** M107: the unified interests (mirrors server/src/interests/types.ts). */
const INTEREST_OPTIONS: { key: string; label: string }[] = [
  { key: 'startups', label: 'ريادة الأعمال والشركات الناشئة' },
  { key: 'tech', label: 'التقنية والذكاء الاصطناعي' },
  { key: 'invest', label: 'الاستثمار والتمويل والأسواق المالية' },
  { key: 'realestate', label: 'العقار والإنشاءات' },
  { key: 'trade', label: 'التجارة والتجزئة والتجارة الإلكترونية' },
  { key: 'industry', label: 'الصناعة واللوجستيات' },
  { key: 'tourism', label: 'السياحة والترفيه والرياضة' },
  { key: 'health_edu', label: 'الصحة والتعليم' },
  { key: 'energy', label: 'الطاقة والتعدين' },
];

export function Agenda() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.agenda(), []);
  const [editor, setEditor] = useState<{ row: AgendaEvent | null; input: AgendaEventInput; english: { title: string; blurb: string; place: string } } | null>(null);
  const [rows, setRows] = useState<{ event: AgendaEvent; registrations: AgendaRegistration[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'imageUrl' | 'coverUrl' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const upcoming = state.data?.events.filter((event) => !pastOf(event)).length ?? 0;

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  function pastOf(event: AgendaEvent): boolean {
    // M70: a multi-day workshop ends with its LAST day.
    return (event.dates?.at(-1) ?? event.date) < new Date().toISOString().slice(0, 10);
  }

  async function save() {
    if (!editor || busy) return;
    setBusy(true);
    try {
      // M43: the fields always travel when filled; the server keeps them auto while they match the stored English.
      const english = editor.english.title.trim() || editor.english.blurb.trim() || editor.english.place.trim() ? editor.english : null;
      // M70: in the editor `input.dates` holds the EXTRA days; the payload carries the full list
      // (first day included) — or [] so the server collapses the event back to a single day.
      const extra = (editor.input.dates ?? []).filter(Boolean);
      const payload = { ...editor.input, dates: extra.length ? [editor.input.date, ...extra] : [] };
      if (editor.row) await api.updateAgendaEvent(editor.row.id, { ...payload, english });
      else await api.createAgendaEvent({ ...payload, english });
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

  // M77: the big event image — uploaded like the partners' logos, shown on top of the event page in the app.
  // M167: a second, square one for the cards outside the page (`coverUrl`); the app falls back to the hero without it.
  async function pickImage(file: File | undefined, field: 'imageUrl' | 'coverUrl' = 'imageUrl') {
    if (!file || !editor || uploading) return;
    setUploading(field);
    try {
      const uploaded = await uploadFile(file);
      if (uploaded.kind !== 'image') throw new Error('اختر صورة للفعالية.');
      edit({ [field]: uploaded.url });
    } catch (failure) {
      fail(failure);
    } finally {
      setUploading(null);
      const input = field === 'coverUrl' ? coverRef.current : fileRef.current;
      if (input) input.value = '';
    }
  }

  return (
    <>
      <SectionHead title="أجندة النادي" hint={state.data ? `فعاليات قادمة: ${formatNumber(upcoming)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        أضف فعاليات السنة كلها من هنا: لكل فعالية سعر لغير الأعضاء وسعر للأعضاء (0 = ضمن العضوية)، والدفع داخل التطبيق ولا يتأكد
        التسجيل إلا بعد نجاح الدفع — ومن تريده أن يحضر بدون دفع أعطه كود خصم 100% من قسم «أكواد الخصم». بعد التأكيد يحصل العضو على
        تذكرة بباركود، ويصله تذكير قبل الفعالية بيوم. رابط الأونلاين لا يظهر إلا للمؤكدين، واختيار الاهتمامات يوجّه الإشعار لأصحابها.
      </p>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => setEditor({ row: null, input: { ...EMPTY }, english: { title: '', blurb: '', place: '' } })}>+ فعالية جديدة</button>
      </div>
      <Async state={state} rows={5} empty={() => (state.data?.events.length ?? 0) === 0} emptyText="لا توجد فعاليات بعد — أضف أول فعالية.">
        {(data) => (
          <DataTable<AgendaEvent>
            caption="فعاليات أجندة النادي"
            rows={data.events}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'when',
                label: 'الموعد',
                cell: (row) => (
                  <>
                    <bdi dir="ltr" className="num">{`${row.date}${row.time ? ` ${row.time}` : ''}`}</bdi>
                    {row.dates && row.dates.length > 1 ? <> <Pill tone="ok">{`${formatNumber(row.dates.length)} أيام`}</Pill></> : null}
                  </>
                ),
              },
              { key: 'title', label: 'الفعالية', cell: (row) => row.title },
              { key: 'mode', label: 'الحضور', cell: (row) => MODE_LABEL[row.mode] },
              {
                key: 'fee',
                label: 'الرسوم (غير العضو / العضو)',
                cell: (row) =>
                  `${row.feeSar > 0 ? `${formatNumber(row.feeSar)} ر.س` : 'بدون رسوم'} / ${(row.memberFeeSar ?? 0) > 0 ? `${formatNumber(row.memberFeeSar ?? 0)} ر.س` : 'ضمن العضوية'}`,
              },
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
                    <button type="button" onClick={() => setEditor({ row, input: { title: row.title, blurb: row.blurb, date: row.date, dates: row.dates?.slice(1) ?? [], time: row.time, endTime: row.endTime, place: row.place, onlineUrl: row.onlineUrl, imageUrl: row.imageUrl ?? null, coverUrl: row.coverUrl ?? null, mode: row.mode, feeSar: row.feeSar, memberFeeSar: row.memberFeeSar ?? 0, interests: row.interests ?? [], open: row.open }, english: { title: row.en?.title ?? '', blurb: row.en?.blurb ?? '', place: row.en?.place ?? '' } })}>تعديل</button>
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
              اليوم{(editor.input.dates ?? []).length ? ' الأول' : ''}
              <input type="date" value={editor.input.date} onChange={(event) => edit({ date: event.target.value })} required />
            </label>
            <fieldset>
              <legend>ورشة على عدة أيام؟ أضف باقي الأيام — اختر الأيام اللي تناسبك (نفس الوقت كل يوم)</legend>
              {(editor.input.dates ?? []).map((day, index) => (
                <label key={index} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="date" value={day} onChange={(event) => edit({ dates: (editor.input.dates ?? []).map((entry, at) => (at === index ? event.target.value : entry)) })} />
                  <button type="button" className="ghost" onClick={() => edit({ dates: (editor.input.dates ?? []).filter((_entry, at) => at !== index) })}>حذف اليوم</button>
                </label>
              ))}
              <div className="row-actions">
                <button type="button" onClick={() => edit({ dates: [...(editor.input.dates ?? []), ''] })} disabled={(editor.input.dates ?? []).length >= 13}>+ يوم إضافي</button>
              </div>
            </fieldset>
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
            <fieldset>
              <legend>صورة الكرت (مربعة 1:1) — تظهر برا: في الرئيسية وقائمة الأجندة والإشعارات</legend>
              {editor.input.coverUrl ? (
                <div className="row-actions" style={{ alignItems: 'center' }}>
                  <img src={editor.input.coverUrl} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} referrerPolicy="no-referrer" />
                  <button type="button" className="ghost" onClick={() => edit({ coverUrl: null })}>إزالة الصورة</button>
                </div>
              ) : (
                <p className="muted">بدون صورة مربعة، الكروت تعرض صورة الصفحة العرضية.</p>
              )}
              <input ref={coverRef} type="file" accept="image/*" disabled={uploading !== null} onChange={(event) => void pickImage(event.target.files?.[0], 'coverUrl')} />
              {uploading === 'coverUrl' ? <p className="muted">جارٍ رفع الصورة…</p> : null}
            </fieldset>
            <fieldset>
              <legend>صورة الصفحة (عرضية 16:9) — تظهر جوا: كبيرة أعلى صفحة الفعالية في التطبيق</legend>
              {editor.input.imageUrl ? (
                <div className="row-actions" style={{ alignItems: 'center' }}>
                  <img src={editor.input.imageUrl} alt="" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8 }} referrerPolicy="no-referrer" />
                  <button type="button" className="ghost" onClick={() => edit({ imageUrl: null })}>إزالة الصورة</button>
                </div>
              ) : null}
              <input ref={fileRef} type="file" accept="image/*" disabled={uploading !== null} onChange={(event) => void pickImage(event.target.files?.[0])} />
              {uploading === 'imageUrl' ? <p className="muted">جارٍ رفع الصورة…</p> : null}
            </fieldset>
            <label>
              سعر غير الأعضاء بالريال (0 = بدون رسوم للجميع)
              <input type="number" min={0} max={100000} value={editor.input.feeSar} onChange={(event) => edit({ feeSar: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} />
            </label>
            <label>
              سعر الأعضاء بالريال (0 = ضمن العضوية بدون رسوم إضافية)
              <input type="number" min={0} max={100000} value={editor.input.memberFeeSar ?? 0} onChange={(event) => edit({ memberFeeSar: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} />
            </label>
            <fieldset>
              <legend>الاهتمامات المناسبة — الإشعار يصل لمن اختاروها (ولمن لم يحدد اهتماماته)</legend>
              {INTEREST_OPTIONS.map((option) => (
                <label key={option.key} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={(editor.input.interests ?? []).includes(option.key)}
                    onChange={(event) =>
                      edit({
                        interests: event.target.checked
                          ? [...(editor.input.interests ?? []), option.key]
                          : (editor.input.interests ?? []).filter((key) => key !== option.key),
                      })
                    }
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
              <input type="checkbox" checked={editor.input.open} onChange={(event) => edit({ open: event.target.checked })} /> التسجيل مفتوح
            </label>
            <fieldset>
              <legend>الإنجليزية — تُكتب تلقائيًا عند الحفظ، وتعديلك لها يثبّتها</legend>
              <label>
                الاسم بالإنجليزية
                <input dir="ltr" value={editor.english.title} maxLength={140} onChange={(event) => setEditor({ ...editor, english: { ...editor.english, title: event.target.value } })} placeholder={editor.row?.en ? '' : 'تُترجم تلقائيًا عند الحفظ'} />
              </label>
              <label>
                الوصف بالإنجليزية
                <textarea dir="ltr" rows={3} maxLength={1000} value={editor.english.blurb} onChange={(event) => setEditor({ ...editor, english: { ...editor.english, blurb: event.target.value } })} placeholder={editor.row?.en ? '' : 'تُترجم تلقائيًا عند الحفظ'} />
              </label>
              <label>
                المكان بالإنجليزية
                <input dir="ltr" value={editor.english.place} maxLength={200} onChange={(event) => setEditor({ ...editor, english: { ...editor.english, place: event.target.value } })} />
              </label>
            </fieldset>
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
                    row.paid ? (
                      <Pill tone="ok">{(row.amountSar ?? 0) > 0 ? `مؤكد — دفع ${formatNumber(row.amountSar ?? 0)} ر.س` : row.discountCode ? 'مؤكد — كود خصم' : row.member ? 'عضو — ضمن العضوية' : 'مؤكد'}</Pill>
                    ) : (
                      <Pill tone="muted">لم يكتمل الدفع</Pill>
                    ),
                },
                { key: 'code', label: 'الكود', cell: (row) => (row.discountCode ? <bdi dir="ltr" className="num">{row.discountCode}</bdi> : '—') },
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
