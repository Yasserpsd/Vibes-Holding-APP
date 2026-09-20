import { useEffect, useState } from 'react';

import { api } from '../api';
import { formatCents, formatDateTime, formatMoney, formatNumber } from '../format';
import type { AppPayment, HubPayment, StorePurchase } from '../types';
import { Async, AsyncPage, Chips, DataTable, MemberLink, Pager, Pill, SearchBox, SectionHead, useDebounced, useLoad, type Tone } from '../ui';

const PER_PAGE = 25;
type Source = 'hub' | 'app' | 'store';
const SOURCES: { value: Source; label: string }[] = [
  { value: 'hub', label: 'مدفوعات المواقع (بيموب)' },
  { value: 'app', label: 'خدمات التطبيق' },
  { value: 'store', label: 'عضويات المتجر' },
];

const HUB_ACTIONS: Record<string, string> = { membership: 'عضوية سنوية', workshop: 'ورشة', ticket: 'تذكرة', service: 'خدمة' };
const hubAction = (action: string) => HUB_ACTIONS[action] ?? (action || 'دفع');

type HubStatus = 'all' | 'ok' | 'failed';
const HUB_STATUSES: { value: HubStatus; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'ok', label: 'ناجحة' },
  { value: 'failed', label: 'فاشلة' },
];

/** The hub's Paymob log: what the websites collected, membership payments included. */
function HubPayments() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<HubStatus>('all');
  const [page, setPage] = useState(1);
  const q = useDebounced(text.trim());
  const state = useLoad(() => api.hubPayments({ q, status, page, perPage: PER_PAGE }), [q, status, page]);
  useEffect(() => setPage(1), [q, status]);
  return (
    <>
      <div className="filters">
        <SearchBox value={text} onChange={setText} placeholder="ابحث بالاسم أو الجوال أو رقم العملية" />
        <Chips label="حالة الدفع" options={HUB_STATUSES} value={status} onChange={setStatus} />
      </div>
      <AsyncPage state={state} onPage={setPage} rows={8} emptyText="لا توجد مدفوعات تطابق هذا العرض.">
        {(data) => (
          <>
            <p className="muted num">عدد العمليات: {formatNumber(data.total)} · مجموع الناجحة {formatCents(data.sum_cents_ok)}</p>
            <DataTable<HubPayment>
              caption="مدفوعات المواقع"
              rows={data.items}
              rowKey={(row) => row.id}
              columns={[
                { key: 'who', label: 'الدافع', cell: (row) => <MemberLink id={row.contact_id} name={row.name || row.email || row.phone} /> },
                { key: 'amount', label: 'المبلغ', num: true, cell: (row) => formatCents(row.amount_cents, row.currency) },
                { key: 'action', label: 'الغرض', cell: (row) => hubAction(row.action) },
                { key: 'status', label: 'الحالة', cell: (row) => <Pill tone={row.success ? 'ok' : 'danger'}>{row.success ? 'ناجحة' : 'فاشلة'}</Pill> },
                { key: 'txn', label: 'رقم العملية', cell: (row) => <bdi dir="ltr" className="num">{row.txn_id || '—'}</bdi> },
                { key: 'at', label: 'الوقت', cell: (row) => formatDateTime(row.created_at) },
              ]}
            />
          </>
        )}
      </AsyncPage>
    </>
  );
}

type AppStatus = 'all' | AppPayment['status'];
const APP_STATUSES: Record<AppPayment['status'], { label: string; tone: Tone }> = {
  paid: { label: 'مدفوعة', tone: 'ok' },
  created: { label: 'لم تكتمل', tone: 'muted' },
  failed: { label: 'فاشلة', tone: 'danger' },
};

/** Services paid inside the app. The status comes only from the server's verified Paymob callback. */
function AppPayments() {
  const [status, setStatus] = useState<AppStatus>('all');
  const [page, setPage] = useState(1);
  const state = useLoad(() => api.appPayments(), []);
  useEffect(() => setPage(1), [status]);
  const all = state.data?.payments ?? [];
  const count = (key: AppPayment['status']) => all.filter((row) => row.status === key).length;
  return (
    <>
      <div className="filters">
        <Chips
          label="حالة الدفع"
          options={[{ value: 'all' as AppStatus, label: 'الكل', count: all.length }, ...(['paid', 'created', 'failed'] as const).map((key) => ({ value: key as AppStatus, label: APP_STATUSES[key].label, count: count(key) }))]}
          value={status}
          onChange={setStatus}
        />
      </div>
      <Async state={state} rows={6} empty={(data) => data.payments.length === 0} emptyText="لم يدفع أحد خدمة من داخل التطبيق بعد.">
        {(data) => {
          const rows = data.payments.filter((row) => status === 'all' || row.status === status);
          const paid = rows.filter((row) => row.status === 'paid');
          return (
            <>
              <p className="muted num">عدد العمليات: {formatNumber(rows.length)} · مجموع المدفوعة {formatMoney(paid.reduce((sum, row) => sum + row.amount, 0))}</p>
              {rows.length === 0 ? <p className="state-card empty">لا توجد عمليات بهذه الحالة.</p> : null}
              <DataTable<AppPayment>
                caption="مدفوعات خدمات التطبيق"
                rows={rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'who', label: 'العضو', cell: (row) => <MemberLink id={row.contactId} name={row.name || row.email} /> },
                  { key: 'service', label: 'الخدمة', cell: (row) => `${row.serviceTitle}${row.memberPrice ? ' · سعر الأعضاء' : ''}` },
                  { key: 'amount', label: 'المبلغ', num: true, cell: (row) => formatMoney(row.amount, row.currency) },
                  { key: 'status', label: 'الحالة', cell: (row) => <Pill tone={APP_STATUSES[row.status].tone}>{APP_STATUSES[row.status].label}{row.provider === 'mock' ? ' · تجريبي' : ''}</Pill> },
                  { key: 'why', label: 'ملاحظة', cell: (row) => row.failureReason || '—' },
                  { key: 'at', label: 'الوقت', cell: (row) => formatDateTime(row.paidAt ?? row.failedAt ?? row.createdAt) },
                ]}
              />
              <Pager page={page} perPage={PER_PAGE} total={rows.length} onPage={setPage} />
            </>
          );
        }}
      </Async>
    </>
  );
}

const STORE_TYPES: Record<string, string> = { INITIAL_PURCHASE: 'شراء جديد', RENEWAL: 'تجديد', NON_RENEWING_PURCHASE: 'شراء لمرة واحدة', UNCANCELLATION: 'تراجع عن الإلغاء', PRODUCT_CHANGE: 'تغيير الباقة', CANCELLATION: 'إلغاء التجديد', EXPIRATION: 'انتهاء' };
const STORES: Record<string, string> = { APP_STORE: 'آب ستور', PLAY_STORE: 'جوجل بلاي' };
const ACTIVATIONS: Record<StorePurchase['activation'], { label: string; tone: Tone }> = {
  activated: { label: 'فُعّلت العضوية', tone: 'ok' },
  pending: { label: 'تحتاج تفعيلًا يدويًا', tone: 'danger' },
  ignored: { label: 'بلا أثر', tone: 'muted' },
  skipped: { label: 'تخطّاها الخادم', tone: 'muted' },
  duplicate: { label: 'مكررة', tone: 'muted' },
};

/** Annual memberships bought through Apple and Google, as the store reported them. They carry no amount. */
function StorePurchases() {
  const [page, setPage] = useState(1);
  const state = useLoad(() => api.storePurchases(), []);
  return (
    <Async state={state} rows={6} empty={(data) => data.events.length === 0} emptyText="لم تصل أي عملية من المتجر بعد.">
      {(data) => (
        <>
          <p className="muted num">أحداث المتجر: {formatNumber(data.events.length)}</p>
          <DataTable<StorePurchase>
            caption="عضويات المتجر"
            rows={data.events.slice((page - 1) * PER_PAGE, page * PER_PAGE)}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'العضو', cell: (row) => (row.contactId ? <MemberLink id={row.contactId} name={`حساب رقم ${row.contactId}`} /> : 'غير معروف') },
              { key: 'type', label: 'الحدث', cell: (row) => STORE_TYPES[row.type] ?? row.type },
              { key: 'store', label: 'المتجر', cell: (row) => `${STORES[row.store] ?? row.store}${row.environment === 'SANDBOX' ? ' · تجريبي' : ''}` },
              { key: 'days', label: 'الأيام', num: true, cell: (row) => formatNumber(row.days) },
              { key: 'result', label: 'النتيجة', cell: (row) => <Pill tone={ACTIVATIONS[row.activation]?.tone ?? 'muted'}>{ACTIVATIONS[row.activation]?.label ?? row.activation}</Pill> },
              { key: 'why', label: 'ملاحظة', cell: (row) => row.reason || '—' },
              { key: 'at', label: 'الوقت', cell: (row) => formatDateTime(row.receivedAt) },
            ]}
          />
          <Pager page={page} perPage={PER_PAGE} total={data.events.length} onPage={setPage} />
        </>
      )}
    </Async>
  );
}

/** Money from the three doors: the websites' Paymob, services paid inside the app, and the stores' memberships. */
export function Payments() {
  const [source, setSource] = useState<Source>('hub');
  return (
    <>
      <SectionHead title="المدفوعات" />
      <Chips label="مصدر المدفوعات" options={SOURCES} value={source} onChange={setSource} />
      {source === 'hub' ? <HubPayments /> : source === 'app' ? <AppPayments /> : <StorePurchases />}
    </>
  );
}
