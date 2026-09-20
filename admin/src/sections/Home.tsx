import { useState, type ReactNode } from 'react';

import { api } from '../api';
import { BarChart, type ChartPoint } from '../Chart';
import { daysText, formatCents, formatDateTime, formatDay, formatMoney, formatNumber } from '../format';
import type { AccountFilter, BridgeSide, Home as HomeData, HubStats, StatsDay } from '../types';
import { Async, Boundary, Chips, ErrorCard, Pill, SectionHead, useLoad, useShell } from '../ui';

type Range = '7' | '30' | '90';
const RANGES: { value: Range; label: string }[] = [
  { value: '7', label: '7 أيام' },
  { value: '30', label: '30 يومًا' },
  { value: '90', label: '90 يومًا' },
];

type MetricKey = 'signups' | 'activations' | 'renewals' | 'payments' | 'conversations';
type Metric = { value: MetricKey; label: string; noun: string; pick: (day: StatsDay) => number; details: (day: StatsDay) => ChartPoint['details']; format?: (value: number) => string };
const METRICS: Metric[] = [
  { value: 'signups', label: 'التسجيلات', noun: 'حساب جديد', pick: (day) => day.signups, details: (day) => [{ label: 'أكّدوا البريد', value: formatNumber(day.verified) }] },
  { value: 'activations', label: 'التفعيلات', noun: 'عضوية مفعّلة', pick: (day) => day.activations, details: () => [] },
  { value: 'renewals', label: 'التجديدات', noun: 'تجديد', pick: (day) => day.renewals, details: () => [] },
  { value: 'payments', label: 'المدفوعات', noun: 'مدفوعات ناجحة', pick: (day) => day.payments_cents / 100, details: (day) => [{ label: 'عدد العمليات', value: formatNumber(day.payments_count) }], format: (value) => formatMoney(value) },
  { value: 'conversations', label: 'المحادثات', noun: 'محادثة', pick: (day) => day.conversations, details: (day) => [{ label: 'الرسائل', value: formatNumber(day.messages) }] },
];

function Tile({ label, value, note, tone, onOpen }: { label: string; value: number; note?: string; tone?: 'gold' | 'alert'; onOpen?: () => void }) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <strong className="tile-value num">{formatNumber(value)}</strong>
      {note ? <span className="tile-note">{note}</span> : null}
    </>
  );
  const name = `tile${tone ? ` ${tone}` : ''}`;
  return onOpen ? <button type="button" className={name} onClick={onOpen}>{body}</button> : <div className={name}>{body}</div>;
}

function Tiles({ hub }: { hub: HubStats }) {
  const { openMembers } = useShell();
  const open = (state: AccountFilter) => () => openMembers(state);
  const { totals, expiring } = hub;
  return (
    <div className="tiles">
      <Tile label="المسجّلون" value={totals.accounts} note={`${formatNumber(hub.today.signups)} اليوم`} onOpen={open('all')} />
      <Tile label="الأعضاء المشتركون" value={totals.members_active} tone="gold" note={totals.members_no_expiry ? `منهم ${formatNumber(totals.members_no_expiry)} بلا تاريخ انتهاء` : undefined} onOpen={open('member')} />
      <Tile label="لم يدفعوا بعد" value={totals.unpaid} onOpen={open('unpaid')} />
      <Tile label="بانتظار تأكيد البريد" value={totals.pending_email} onOpen={open('pending')} />
      <Tile label="تنتهي خلال 7 أيام" value={expiring.d7} tone={expiring.d7 > 0 ? 'alert' : undefined} />
      <Tile label="تنتهي خلال 30 يومًا" value={expiring.d30} />
    </div>
  );
}

function Today({ data }: { data: HomeData }) {
  const today = data.hub?.today;
  const items: { label: string; value: string }[] = today
    ? [
        { label: 'تسجيلات', value: formatNumber(today.signups) },
        { label: 'تفعيلات', value: formatNumber(today.activations) },
        { label: 'تجديدات', value: formatNumber(today.renewals) },
        { label: 'محادثات', value: formatNumber(today.conversations) },
        { label: 'رسائل', value: formatNumber(today.messages) },
        { label: 'عملاء محتملون', value: formatNumber(today.leads) },
        { label: 'مدفوعات الهب', value: `${formatNumber(today.payments_count)} · ${formatCents(today.payments_cents)}` },
        { label: 'ردود المستشار', value: formatNumber(data.hub?.ai.replies_today) },
      ]
    : [];
  items.push({ label: 'خدمات التطبيق المدفوعة', value: `${formatNumber(data.app.payments.today.paid)} · ${formatCents(data.app.payments.today.cents)}` });
  if (data.pb.unlocksToday !== null) items.push({ label: 'مشاريع فُتحت من بنك المشاريع', value: formatNumber(data.pb.unlocksToday) });
  return (
    <section className="card" aria-labelledby="today-title">
      <h2 id="today-title">اليوم</h2>
      <dl className="strip">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd className="num">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Daily({ hub, days }: { hub: HubStats; days: string }) {
  const [metric, setMetric] = useState<MetricKey>('signups');
  const chosen = METRICS.find((entry) => entry.value === metric) ?? METRICS[0]!;
  const points = hub.series.map((day) => ({ day: day.day, value: chosen.pick(day), details: chosen.details(day) }));
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const format = chosen.format ?? formatNumber;
  return (
    <section className="card" aria-labelledby="daily-title">
      <div className="row">
        <h2 id="daily-title">الحركة اليومية</h2>
        <span className="muted num">الإجمالي: {format(total)}</span>
      </div>
      <Chips label="المؤشر" options={METRICS} value={metric} onChange={setMetric} />
      <BarChart title={`${chosen.label} يوميًا`} desc={`أعمدة يومية: ${chosen.noun} لكل يوم خلال آخر ${days} بتوقيت الرياض. الإجمالي ${format(total)}.`} valueLabel={chosen.label} points={points} format={format} />
    </section>
  );
}

function AppPayments({ data, days }: { data: HomeData; days: string }) {
  const { payments, store } = data.app;
  const points = payments.series.map((day) => ({
    day: day.day,
    value: day.cents / 100,
    details: [
      { label: 'مدفوعة', value: formatNumber(day.paid) },
      { label: 'بدأت', value: formatNumber(day.count) },
    ],
  }));
  const purchases = store.series.reduce((sum, day) => sum + day.purchases, 0);
  const renewals = store.series.reduce((sum, day) => sum + day.renewals, 0);
  return (
    <section className="card" aria-labelledby="app-pay-title">
      <div className="row">
        <h2 id="app-pay-title">مدفوعات خدمات التطبيق</h2>
        <span className="muted num">هذا الشهر: {formatCents(payments.month.cents)} · العمليات {formatNumber(payments.month.paid)}</span>
      </div>
      <BarChart title="مدفوعات خدمات التطبيق يوميًا" desc={`أعمدة يومية: المبلغ المدفوع داخل التطبيق لكل يوم خلال آخر ${days} بتوقيت الرياض.`} valueLabel="المبلغ المدفوع" points={points} format={(value) => formatMoney(value)} />
      <p className="muted num">عضويات المتجر خلال الفترة: شراء جديد {formatNumber(purchases)} · تجديد {formatNumber(renewals)}</p>
    </section>
  );
}

function Expiring({ hub }: { hub: HubStats }) {
  const { openMember } = useShell();
  return (
    <section className="card" aria-labelledby="expiring-title">
      <div className="row">
        <h2 id="expiring-title">عضويات تنتهي قريبًا</h2>
        <span className="muted num">{formatNumber(hub.expiring.d30)} خلال 30 يومًا</span>
      </div>
      {hub.expiring.items.length === 0 ? <p className="muted">لا توجد عضويات تنتهي خلال 30 يومًا.</p> : null}
      <ul className="list">
        {hub.expiring.items.map((item) => (
          <li key={item.id}>
            <button type="button" className="list-row" onClick={() => openMember(item.id)}>
              <span className="list-main">
                <strong>{item.name || item.email || `حساب رقم ${item.id}`}</strong>
                <span className="muted">ينتهي {formatDay(item.member_end)}</span>
              </span>
              <Pill tone={item.days_left <= 7 ? 'danger' : 'gold'}>باقي {daysText(item.days_left)}</Pill>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Sites({ hub, days }: { hub: HubStats; days: string }) {
  const most = Math.max(1, ...hub.per_site.map((site) => site.conversations));
  return (
    <section className="card" aria-labelledby="sites-title">
      <div className="row">
        <h2 id="sites-title">نشاط المواقع</h2>
        <span className="muted">آخر {days}</span>
      </div>
      {hub.per_site.length === 0 ? <p className="muted">لا توجد محادثات في هذه الفترة.</p> : null}
      <ul className="list">
        {hub.per_site.map((site) => (
          <li key={site.host} className="meter-row">
            <div className="row">
              <span>{site.name || site.host} <bdi dir="ltr" className="muted hint">{site.host}</bdi></span>
              <span className="num">المحادثات {formatNumber(site.conversations)} · الرسائل {formatNumber(site.messages)}</span>
            </div>
            <span className="meter" aria-hidden="true"><i style={{ inlineSize: `${(site.conversations / most) * 100}%` }} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MailQueue({ hub }: { hub: HubStats }) {
  const { openSection } = useShell();
  return (
    <section className="card" aria-labelledby="mailq-title">
      <div className="row">
        <h2 id="mailq-title">طابور البريد</h2>
        <button className="link" type="button" onClick={() => openSection('mail')}>عرض الرسائل</button>
      </div>
      <dl className="strip three">
        <div><dt>بانتظار الإرسال</dt><dd className="num">{formatNumber(hub.mail.pending)}</dd></div>
        <div><dt>أُرسلت</dt><dd className="num">{formatNumber(hub.mail.sent)}</dd></div>
        <div><dt>فشلت</dt><dd className={hub.mail.failed > 0 ? 'num error' : 'num'}>{formatNumber(hub.mail.failed)}</dd></div>
      </dl>
    </section>
  );
}

function BridgeRow({ name, side, wanted }: { name: string; side: BridgeSide; wanted: string }) {
  return (
    <li className="row">
      <span>{name} <bdi dir="ltr" className="muted num">{side.version ?? '—'}</bdi></span>
      {side.ok ? <Pill tone="ok">يعمل</Pill> : <Pill tone="danger">{side.version ? `يحتاج ${wanted}` : 'غير متصل'}</Pill>}
    </li>
  );
}

function Bridge({ data }: { data: HomeData }) {
  return (
    <section className="card" aria-labelledby="bridge-title">
      <h2 id="bridge-title">حالة الربط</h2>
      <ul className="list plain">
        <BridgeRow name="إضافة الهب" side={data.bridge.hub} wanted="2.7.0" />
        <BridgeRow name="إضافة بنك المشاريع" side={data.bridge.pb} wanted="39.0" />
        <li className="row">
          <span>أجهزة الإشعارات</span>
          <span className="num">{formatNumber(data.app.push.devices)}</span>
        </li>
      </ul>
      {data.errors.pb ? <p className="muted hint">بنك المشاريع: {data.errors.pb.message}</p> : null}
    </section>
  );
}

/** The owner's first look: where the club stands, what happened today, and what needs him. */
export function Home() {
  const [range, setRange] = useState<Range>('30');
  const state = useLoad(() => api.home(Number(range)), [range]);
  const days = RANGES.find((entry) => entry.value === range)?.label ?? '';
  const stamp = state.data?.hub ? `آخر تحديث ${formatDateTime(state.data.hub.generated_at)} · الأيام بتوقيت الرياض` : 'الأيام بتوقيت الرياض';
  return (
    <>
      <SectionHead title="الرئيسية" hint={stamp} onReload={state.reload} busy={state.loading}>
        <Chips label="الفترة" options={RANGES} value={range} onChange={setRange} />
      </SectionHead>
      <Async state={state} rows={6}>
        {(data) => {
          // Each block stands alone, as the answer itself does: one unexpected field costs its own card, and the next answer tries it again.
          const part = (block: ReactNode) => <Boundary watch={data}>{block}</Boundary>;
          return (
            <div className="stack">
              {data.hub ? part(<Tiles hub={data.hub} />) : data.errors.hub ? <ErrorCard error={data.errors.hub} onRetry={state.reload} /> : null}
              {part(<Today data={data} />)}
              {data.hub ? part(<Daily hub={data.hub} days={days} />) : null}
              {part(<AppPayments data={data} days={days} />)}
              {data.hub ? (
                <div className="columns">
                  {part(<Expiring hub={data.hub} />)}
                  {part(<Sites hub={data.hub} days={days} />)}
                </div>
              ) : null}
              <div className="columns">
                {data.hub ? part(<MailQueue hub={data.hub} />) : null}
                {part(<Bridge data={data} />)}
              </div>
            </div>
          );
        }}
      </Async>
    </>
  );
}
