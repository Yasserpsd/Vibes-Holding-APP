import { useEffect, useState, type FormEvent } from 'react';

import { api, type FormSubmission, type NotifySettings } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, Chips, DataTable, MemberLink, Pill, SectionHead, messageOf, sessionOver, useLoad, useShell } from '../ui';

/**
 * M16 «نماذج التسجيل»: the in-app registration forms (شركاء النجاح, الورشة…) land here, and the
 * notification-recipients list is edited here — who receives the mail when someone registers or pays.
 */
export function Forms() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.formSubmissions(), []);
  const [formKey, setFormKey] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const all = state.data?.submissions ?? [];
  const rows = formKey ? all.filter((row) => row.formKey === formKey) : all;
  const waiting = all.filter((row) => !row.handled).length;
  const formChips = [{ value: '', label: 'الكل' }, ...(state.data?.forms ?? []).map((form) => ({ value: form.key, label: form.title }))];

  async function toggle(row: FormSubmission) {
    if (row.handled && !window.confirm(`إعادة التسجيل «${row.name || row.formTitle}» إلى قائمة الانتظار؟`)) return;
    setBusyId(row.id);
    try {
      await api.formHandled(row.id, !row.handled);
      notify('ok', row.handled ? 'رجع التسجيل إلى قائمة الانتظار.' : 'سُجّلت المعالجة.');
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
      <SectionHead title="نماذج التسجيل" hint={state.data ? `بانتظار المعالجة: ${formatNumber(waiting)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        كل صف هنا تسجيل أُرسل من نموذج داخل التطبيق (شركاء النجاح، ورشة العمل…). نصوص النماذج نفسها تُعدَّل من «محتوى التطبيق» ← «نماذج التسجيل».
        بعد التواصل مع صاحب التسجيل علّمه «تمت المعالجة».
      </p>
      <NotifyCard />
      <div className="filters">
        <Chips label="النموذج" options={formChips} value={formKey} onChange={setFormKey} />
      </div>
      <Async state={state} rows={5} empty={() => rows.length === 0} emptyText={formKey ? 'لا توجد تسجيلات في هذا النموذج بعد.' : 'لا توجد تسجيلات بعد.'}>
        {() => (
          <DataTable<FormSubmission>
            caption="نماذج التسجيل"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'who',
                label: 'المسجّل',
                cell: (row) => (row.contactId !== null ? <MemberLink id={row.contactId} name={row.name || row.email || '—'} /> : `${row.name || '—'} (زائر)`),
              },
              { key: 'form', label: 'النموذج', cell: (row) => row.formTitle },
              { key: 'phone', label: 'الجوال', cell: (row) => (row.phone ? <bdi dir="ltr" className="num">{row.phone}</bdi> : '—') },
              { key: 'mail', label: 'البريد', cell: (row) => (row.email ? <bdi dir="ltr" className="num">{row.email}</bdi> : '—') },
              {
                key: 'answers',
                label: 'الإجابات',
                cell: (row) => (
                  <details>
                    <summary>{formatNumber(row.answers.length)} إجابة</summary>
                    <ul className="answers">
                      {row.answers
                        .filter((answer) => answer.value)
                        .map((answer) => (
                          <li key={answer.key}>
                            <strong>{answer.label}:</strong> {answer.value}
                          </li>
                        ))}
                    </ul>
                  </details>
                ),
              },
              { key: 'at', label: 'سجّل', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'status',
                label: 'الحالة',
                cell: (row) =>
                  row.handled ? (
                    <button type="button" className="link" disabled={busyId === row.id} onClick={() => void toggle(row)} title="إعادة إلى قائمة الانتظار">
                      <Pill tone="ok">{`عولج${row.handledBy ? ` · ${row.handledBy}` : ''}`}</Pill>
                    </button>
                  ) : (
                    <button type="button" disabled={busyId === row.id} onClick={() => void toggle(row)}>تمت المعالجة</button>
                  ),
              },
            ]}
          />
        )}
      </Async>
    </>
  );
}

/** Who receives the notification mails (registrations, payments, visit bookings…). */
function NotifyCard() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.notifySettings(), []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft((state.data?.settings.recipients ?? []).join('\n')), [state.data]);

  async function run(work: () => Promise<{ settings: NotifySettings }>, done: string) {
    setBusy(true);
    try {
      await work();
      notify('ok', done);
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    const recipients = draft.split(/[\n,،;]+/u).map((value) => value.trim()).filter(Boolean);
    void run(() => api.saveNotifySettings(recipients), 'حُفظت القائمة. الإشعارات القادمة تصل إلى هذه العناوين.');
  };

  return (
    <Async state={state} rows={2}>
      {(data) => (
        <form className="card editor" onSubmit={save}>
          <div className="row">
            <strong>مستلمو إشعارات البريد</strong>
            <Pill tone={data.settings.source === 'dashboard' ? 'gold' : 'muted'}>
              {data.settings.source === 'dashboard' ? `قائمة اللوحة${data.settings.by ? ` · ${data.settings.by}` : ''}` : 'قيمة الخادم (NOTIFY_EMAIL)'}
            </Pill>
          </div>
          <p className="muted">
            كل بريد إشعار يرسله التطبيق (تسجيل في نموذج، دفعة، حجز زيارة، رسالة عضو…) يصل إلى هذه العناوين. عنوان في كل سطر، والحد 10 عناوين.
          </p>
          <label>
            العناوين
            <textarea rows={3} dir="ltr" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={'owner@vcmem.com\nteam@vcmem.com'} />
          </label>
          <div className="row start">
            <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ القائمة'}</button>
            {data.settings.source === 'dashboard' ? (
              <button type="button" className="link" disabled={busy} onClick={() => void run(() => api.resetNotifySettings(), 'رجعت القائمة إلى قيمة الخادم.')}>
                استرجاع قيمة الخادم ({data.settings.envRecipients.length ? data.settings.envRecipients.join('، ') : 'غير مضبوطة'})
              </button>
            ) : null}
          </div>
        </form>
      )}
    </Async>
  );
}
