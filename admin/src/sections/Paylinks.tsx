import { useState } from 'react';

import { api, type PayLink, type PayLinkInput, type PayLinkKind } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, useLoad, useShell, type Tone } from '../ui';

/**
 * M44 «روابط الدفع»: the owner sells anything by a link made HERE — the paid mail names the sale,
 * and a membership sale activates the matched hub account by itself the moment Paymob confirms.
 */

const KIND_LABEL: Record<PayLinkKind, string> = { membership: 'عضوية سنوية', workshop: 'ورشة / فعالية', other: 'أخرى' };
const EMPTY: PayLinkInput = { kind: 'membership', label: '', amountSar: 1900, days: 365, customer: { name: '', phone: '', email: '' } };

function statusOf(row: PayLink): { label: string; tone: Tone } {
  if (row.status === 'paid') return { label: 'مدفوع ✅', tone: 'ok' };
  if (row.status === 'failed') return { label: 'محاولة فاشلة — الرابط صالح', tone: 'muted' };
  return { label: 'بانتظار الدفع', tone: 'gold' };
}

function activationOf(row: PayLink): string {
  if (row.kind !== 'membership') return '—';
  if (row.activation === 'done') return 'اتفعّلت تلقائيًا ✅';
  if (row.activation === 'failed') return `تحتاج تفعيلًا يدويًا ⚠️${row.activationNote ? ` (${row.activationNote})` : ''}`;
  return row.contactId ? `هتتفعّل تلقائيًا لحساب ${row.contactName || `#${row.contactId}`}` : 'لا يوجد حساب مطابق — يدوي بعد الدفع';
}

export function Paylinks() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.paylinks(), []);
  const [input, setInput] = useState<PayLinkInput>({ ...EMPTY, customer: { ...EMPTY.customer } });
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<PayLink | null>(null);
  const waiting = state.data?.links.filter((row) => row.status !== 'paid').length ?? 0;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('ok', done);
    } catch {
      window.prompt('انسخ من هنا:', text);
    }
  }

  const shareText = (row: PayLink) =>
    `أهلًا${row.customer.name ? ` ${row.customer.name}` : ''} 🌟\n${row.label} — المبلغ: ${row.amountSar} ريال.\nادفع بأمان من الرابط:\n${row.checkoutUrl}`;

  async function create() {
    if (busy) return;
    setBusy(true);
    setMade(null);
    try {
      const answer = await api.createPaylink(input);
      setMade(answer.link);
      notify('ok', 'اتعمل الرابط — انسخه وابعته للعميل.');
      setInput({ ...EMPTY, customer: { ...EMPTY.customer } });
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const edit = (patch: Partial<PayLinkInput>) => setInput((current) => ({ ...current, ...patch }));
  const editCustomer = (patch: Partial<PayLinkInput['customer']>) => setInput((current) => ({ ...current, customer: { ...current.customer, ...patch } }));

  return (
    <>
      <SectionHead title="روابط الدفع" hint={state.data ? `بانتظار الدفع: ${formatNumber(waiting)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        اعمل رابط دفع من هنا وابعته للعميل على واتساب: أول ما يدفع يوصلك إيميل باسمه ونوع الدفعة بالظبط (عضوية / ورشة / أخرى) — ولو
        <strong> عضوية سنوية</strong> والجوال أو البريد مطابق لحساب مسجّل، <strong>العضوية بتتفعّل لوحدها فورًا</strong> من غير أي خطوة منك.
      </p>

      <form className="card editor" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <div className="chips" role="group" aria-label="نوع الدفعة">
          {(Object.keys(KIND_LABEL) as PayLinkKind[]).map((kind) => (
            <button key={kind} type="button" className={input.kind === kind ? 'chip on' : 'chip'} aria-pressed={input.kind === kind} onClick={() => edit({ kind })}>
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
        <label>
          الوصف {input.kind === 'membership' ? '(اختياري — يتكتب تلقائيًا)' : ''}
          <input value={input.label} maxLength={140} onChange={(event) => edit({ label: event.target.value })} placeholder={input.kind === 'workshop' ? 'مثال: ورشة مشروعك الريادي — 19 أكتوبر' : ''} />
        </label>
        <label>
          المبلغ بالريال
          <input type="number" min={1} max={1000000} value={input.amountSar} onChange={(event) => edit({ amountSar: Math.max(1, Math.trunc(Number(event.target.value) || 0)) })} required />
        </label>
        {input.kind === 'membership' ? (
          <label>
            مدة العضوية بالأيام
            <input type="number" min={1} max={3650} value={input.days} onChange={(event) => edit({ days: Math.max(1, Math.trunc(Number(event.target.value) || 365)) })} />
          </label>
        ) : null}
        <label>
          اسم العميل
          <input value={input.customer.name} maxLength={120} onChange={(event) => editCustomer({ name: event.target.value })} />
        </label>
        <label>
          جوال العميل {input.kind === 'membership' ? '(المطابقة والتفعيل التلقائي بيه)' : '(اختياري)'}
          <input dir="ltr" value={input.customer.phone} maxLength={30} onChange={(event) => editCustomer({ phone: event.target.value })} />
        </label>
        <label>
          بريد العميل (اختياري)
          <input dir="ltr" value={input.customer.email} maxLength={190} onChange={(event) => editCustomer({ email: event.target.value })} />
        </label>
        <div className="row-actions">
          <button type="submit" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : '+ إنشاء رابط الدفع'}</button>
        </div>
        {made ? (
          <div className="card" style={{ borderColor: made.contactId || made.kind !== 'membership' ? undefined : '#D9A21B' }}>
            <strong>{made.label} — {formatNumber(made.amountSar)} ريال</strong>
            <p className="muted">{activationOf(made)}</p>
            <div className="row-actions">
              <button type="button" onClick={() => void copy(made.checkoutUrl, 'اتنسخ رابط الدفع.')}>نسخ الرابط</button>
              <button type="button" className="ghost" onClick={() => void copy(shareText(made), 'اتنسخت رسالة واتساب جاهزة.')}>نسخ رسالة واتساب</button>
            </div>
          </div>
        ) : null}
      </form>

      <Async state={state} rows={5} empty={() => (state.data?.links.length ?? 0) === 0} emptyText="لسه معملتش أي رابط دفع.">
        {(data) => (
          <DataTable<PayLink>
            caption="روابط الدفع"
            rows={data.links}
            rowKey={(row) => row.id}
            columns={[
              { key: 'kind', label: 'النوع', cell: (row) => KIND_LABEL[row.kind] },
              { key: 'label', label: 'الوصف', cell: (row) => row.label },
              {
                key: 'who',
                label: 'العميل',
                cell: (row) => (
                  <>
                    {row.contactId ? <MemberLink id={row.contactId} name={row.customer.name || row.contactName} /> : row.customer.name || '—'}
                    {row.customer.phone ? <> <bdi dir="ltr" className="num">{row.customer.phone}</bdi></> : null}
                  </>
                ),
              },
              { key: 'amount', label: 'المبلغ', cell: (row) => `${formatNumber(row.amountSar)} ر.س` },
              { key: 'state', label: 'الحالة', cell: (row) => { const status = statusOf(row); return <Pill tone={status.tone}>{status.label}</Pill>; } },
              { key: 'act', label: 'التفعيل', cell: (row) => activationOf(row) },
              { key: 'at', label: 'اتعمل', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'actions',
                label: '',
                cell: (row) => (
                  <span className="row-actions">
                    <button type="button" onClick={() => void copy(row.checkoutUrl, 'اتنسخ رابط الدفع.')}>نسخ</button>
                    <button type="button" className="ghost" onClick={() => void copy(shareText(row), 'اتنسخت رسالة واتساب جاهزة.')}>واتساب</button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Async>
    </>
  );
}
