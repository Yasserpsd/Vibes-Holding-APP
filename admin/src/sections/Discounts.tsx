import { useState } from 'react';

import { api, type DiscountCode, type DiscountCodeInput, type DiscountUse } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, Sheet, useLoad, useShell } from '../ui';

/**
 * M107 «أكواد الخصم»: the owner creates codes (percent, usage cap, validity window) and hands them
 * out. A 100% code is how anyone attends an activity بدون دفع — there is no free price anywhere.
 */

const EMPTY: DiscountCodeInput = { code: '', percent: 10, maxUses: 50, startsAt: '', endsAt: '', enabled: true, note: '' };

export function Discounts() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.discounts(), []);
  const [editor, setEditor] = useState<{ row: DiscountCode | null; input: DiscountCodeInput } | null>(null);
  const [uses, setUses] = useState<{ row: DiscountCode; uses: DiscountUse[] } | null>(null);
  const [busy, setBusy] = useState(false);

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  async function save() {
    if (!editor || busy) return;
    setBusy(true);
    try {
      if (editor.row) await api.updateDiscount(editor.row.code, editor.input);
      else await api.createDiscount({ ...editor.input, code: editor.input.code.trim().toUpperCase() });
      notify('ok', 'حُفظ الكود.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: DiscountCode) {
    if (!window.confirm(`حذف كود «${row.code}» نهائيًا؟ سجل استخداماته يبقى محفوظًا.`)) return;
    setBusy(true);
    try {
      await api.deleteDiscount(row.code);
      notify('ok', 'حُذف الكود.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function openUses(row: DiscountCode) {
    try {
      const answer = await api.discountUses(row.code);
      setUses({ row, uses: answer.uses });
    } catch (failure) {
      fail(failure);
    }
  }

  const edit = (patch: Partial<DiscountCodeInput>) => setEditor((current) => (current ? { ...current, input: { ...current.input, ...patch } } : current));
  const today = new Date().toISOString().slice(0, 10);
  const stateOf = (row: DiscountCode) => {
    if (!row.enabled) return <Pill tone="muted">موقوف</Pill>;
    if (row.startsAt && today < row.startsAt) return <Pill tone="muted">لم يبدأ</Pill>;
    if (row.endsAt && today > row.endsAt) return <Pill tone="muted">انتهى</Pill>;
    if (row.used >= row.maxUses) return <Pill tone="muted">استُنفد</Pill>;
    return <Pill tone="ok">فعّال</Pill>;
  };

  return (
    <>
      <SectionHead title="أكواد الخصم" hint={state.data ? `الأكواد: ${formatNumber(state.data.codes.length)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        كل نشاط له سعر معلن، ومن تريده أن يحضر بدون دفع أعطه كود خصم 100%. الكود يعمل في حجز الفعاليات ودفع الخدمات داخل التطبيق،
        ويُحتسب الاستخدام فقط عند تأكيد الحجز أو نجاح الدفع.
      </p>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => setEditor({ row: null, input: { ...EMPTY } })}>+ كود جديد</button>
      </div>
      <Async state={state} rows={5} empty={() => (state.data?.codes.length ?? 0) === 0} emptyText="لا توجد أكواد بعد — أنشئ أول كود.">
        {(data) => (
          <DataTable<DiscountCode>
            caption="أكواد الخصم"
            rows={data.codes}
            rowKey={(row) => row.code}
            columns={[
              { key: 'code', label: 'الكود', cell: (row) => <bdi dir="ltr" className="num">{row.code}</bdi> },
              { key: 'percent', label: 'الخصم', cell: (row) => `${formatNumber(row.percent)}%` },
              {
                key: 'used',
                label: 'الاستخدام',
                cell: (row) => (
                  <button type="button" className="link" onClick={() => void openUses(row)}>
                    {`${formatNumber(row.used)} من ${formatNumber(row.maxUses)}`}
                  </button>
                ),
              },
              {
                key: 'window',
                label: 'الصلاحية',
                cell: (row) =>
                  row.startsAt || row.endsAt ? (
                    <bdi dir="ltr" className="num">{`${row.startsAt || '…'} → ${row.endsAt || '…'}`}</bdi>
                  ) : (
                    'بلا حدود'
                  ),
              },
              { key: 'state', label: 'الحالة', cell: stateOf },
              { key: 'note', label: 'ملاحظة', cell: (row) => row.note || '—' },
              {
                key: 'actions',
                label: '',
                cell: (row) => (
                  <span className="row-actions">
                    <button type="button" onClick={() => setEditor({ row, input: { code: row.code, percent: row.percent, maxUses: row.maxUses, startsAt: row.startsAt, endsAt: row.endsAt, enabled: row.enabled, note: row.note } })}>تعديل</button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Async>

      {editor ? (
        <Sheet title={editor.row ? `تعديل «${editor.row.code}»` : 'كود جديد'} onClose={() => setEditor(null)}>
          <form className="card editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>
              الكود (حروف لاتينية وأرقام)
              <input dir="ltr" value={editor.input.code} maxLength={30} onChange={(event) => edit({ code: event.target.value.toUpperCase() })} disabled={Boolean(editor.row)} required placeholder="VIP100" />
            </label>
            <label>
              نسبة الخصم % (كود 100% = حضور بدون دفع)
              <input type="number" min={1} max={100} value={editor.input.percent} onChange={(event) => edit({ percent: Math.min(100, Math.max(1, Math.trunc(Number(event.target.value) || 0))) })} required />
            </label>
            <label>
              عدد مرات الاستخدام
              <input type="number" min={1} max={100000} value={editor.input.maxUses} onChange={(event) => edit({ maxUses: Math.max(1, Math.trunc(Number(event.target.value) || 0)) })} required />
            </label>
            <label>
              يبدأ من (اختياري)
              <input type="date" value={editor.input.startsAt} onChange={(event) => edit({ startsAt: event.target.value })} />
            </label>
            <label>
              ينتهي في (اختياري)
              <input type="date" value={editor.input.endsAt} onChange={(event) => edit({ endsAt: event.target.value })} />
            </label>
            <label>
              ملاحظة داخلية (لمن أُنشئ الكود؟)
              <input value={editor.input.note} maxLength={200} onChange={(event) => edit({ note: event.target.value })} />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
              <input type="checkbox" checked={editor.input.enabled} onChange={(event) => edit({ enabled: event.target.checked })} /> الكود فعّال
            </label>
            <div className="row-actions">
              <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
              {editor.row ? <button type="button" className="ghost" disabled={busy} onClick={() => void remove(editor.row as DiscountCode)}>حذف</button> : null}
            </div>
          </form>
        </Sheet>
      ) : null}

      {uses ? (
        <Sheet title={`استخدامات «${uses.row.code}»`} onClose={() => setUses(null)}>
          {uses.uses.length === 0 ? (
            <p className="state-card empty">لم يُستخدم هذا الكود بعد.</p>
          ) : (
            <DataTable<DiscountUse>
              caption="استخدامات الكود"
              rows={uses.uses}
              rowKey={(row) => `${row.paymentId ?? row.at}-${row.contactId}`}
              columns={[
                { key: 'who', label: 'الاسم', cell: (row) => <MemberLink id={row.contactId} name={row.name} /> },
                { key: 'what', label: 'على ماذا', cell: (row) => row.label },
                { key: 'amount', label: 'المبلغ', cell: (row) => `${formatNumber(row.amountBefore)} ← ${formatNumber(row.amountAfter)} ر.س` },
                { key: 'at', label: 'متى', cell: (row) => formatDateTime(row.at) },
              ]}
            />
          )}
        </Sheet>
      ) : null}
    </>
  );
}
