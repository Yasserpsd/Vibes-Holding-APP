import { useState, type ReactNode } from 'react';

import { api } from '../api';
import { BarChart, type ChartPoint } from '../Chart';
import { daysText, formatCents, formatDateTime, formatDay, formatMoney, formatNumber, formatRelative } from '../format';
import type { AccountFilter, BridgeSide, Home as HomeData, HubStats, StatsDay } from '../types';
import { Async, Boundary, Chips, ErrorCard, Pill, SectionHead, useLoad, useShell } from '../ui';
import { DownloadsCard } from './Downloads';
import { personaLabel } from './Members';

type Range = '7' | '30' | '90';
const RANGES: { value: Range; label: string }[] = [
  { value: '7', label: '7 أيام' },
  { value: '30', label: '30 يومًا' },
  { value: '90', label: '90 يومًا' },
];

// M231 (owner): no hub payments metric — the hub takes no payments; app payments have their own card below.
type MetricKey = 'signups' | 'activations' | 'renewals' | 'conversations';
type Metric = { value: MetricKey; label: string; noun: string; pick: (day: StatsDay) => number; details: (day: StatsDay) => ChartPoint['details']; format?: (value: number) => string };
const METRICS: Metric[] = [
  { value: 'signups', label: 'التسجيلات', noun: 'حساب جديد', pick: (day) => day.signups, details: (day) => [{ label: 'أكّدوا البريد', value: formatNumber(day.verified) }] },
  { value: 'activations', label: 'التفعيلات', noun: 'عضوية مفعّلة', pick: (day) => day.activations, details: () => [] },
  { value: 'renewals', label: 'التجديدات', noun: 'تجديد', pick: (day) => day.renewals, details: () => [] },
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
  const withoutCategory = Math.max(0, totals.accounts - (totals.persona_neutral ?? 0) - (totals.persona_entrepreneur ?? 0) - (totals.persona_investor ?? 0));
  return (
    <div className="tiles">
      {/* M230: «المسجّلون» and «الأعضاء المشتركون» moved up into the first card's story, so they are not counted twice on one screen. */}
      {/* M112 (owner): how the accounts split across the three personas — needs hub 2.19.0+. */}
      {/* M231 (owner, 2026-11-12): the categories come first, named without the article, in the standing order
          محايد ثم رائد أعمال ثم مستثمر ثم بدون فئة; «لم يدفعوا بعد» closes the row. */}
      {totals.persona_investor !== undefined ? (
        <>
          <Tile label="محايد" value={totals.persona_neutral ?? 0} onOpen={open('all')} />
          <Tile label="رائد أعمال" value={totals.persona_entrepreneur ?? 0} onOpen={open('all')} />
          <Tile label="مستثمر" value={totals.persona_investor ?? 0} tone="gold" onOpen={open('all')} />
          {/* M230: the three above add up to the accounts that chose a category; this is the rest, so the sum is the registered number. */}
          {withoutCategory > 0 ? <Tile label="بدون فئة" value={withoutCategory} onOpen={open('all')} /> : null}
        </>
      ) : null}
      <Tile label="بانتظار تأكيد البريد" value={totals.pending_email} onOpen={open('pending')} />
      <Tile label="تنتهي خلال 7 أيام" value={expiring.d7} tone={expiring.d7 > 0 ? 'alert' : undefined} />
      <Tile label="تنتهي خلال 30 يومًا" value={expiring.d30} />
      <Tile label="لم يدفعوا بعد" value={totals.unpaid} onOpen={open('unpaid')} />
    </div>
  );
}

function Today({ data }: { data: HomeData }) {
  const today = data.hub?.today;
  const items: { label: string; value: string }[] = today
    ? [
        // M230: two names for two numbers. A sign-up counts as started when the form is sent and as completed once the
        // account is confirmed; the second one is the «منها اليوم» of the first card.
        { label: 'تسجيلات بدأت', value: formatNumber(today.signups) },
        { label: 'تسجيلات اكتملت', value: formatNumber(today.verified) },
        { label: 'تفعيلات', value: formatNumber(today.activations) },
        { label: 'تجديدات', value: formatNumber(today.renewals) },
        { label: 'محادثات', value: formatNumber(today.conversations) },
        { label: 'رسائل', value: formatNumber(today.messages) },
        { label: 'عملاء محتملون', value: formatNumber(today.leads) },
        { label: 'ردود المستشار', value: formatNumber(data.hub?.ai.replies_today) },
      ]
    : [];
  items.push({ label: 'خدمات التطبيق المدفوعة', value: `${formatNumber(data.app.payments.today.paid)} · ${formatCents(data.app.payments.today.cents)}` });
  if (data.pb.unlocksToday !== null) items.push({ label: 'مشاريع فُتحت من بنك المشاريع', value: formatNumber(data.pb.unlocksToday) });
  // M231 (owner, 2026-11-12: «ديما صفر»): the day turns at midnight Riyadh, so the first hours read zero everywhere.
  // The day before stands under it, from the same daily series the chart draws (its last row is today).
  const before = data.hub && data.hub.series.length > 1 ? data.hub.series[data.hub.series.length - 2] : undefined;
  const paidBefore = before ? data.app.payments.series.find((row) => row.day === before.day) : undefined;
  const yesterday: { label: string; value: string }[] = before
    ? [
        { label: 'تسجيلات بدأت', value: formatNumber(before.signups) },
        { label: 'تسجيلات اكتملت', value: formatNumber(before.verified) },
        { label: 'تفعيلات', value: formatNumber(before.activations) },
        { label: 'تجديدات', value: formatNumber(before.renewals) },
        { label: 'محادثات', value: formatNumber(before.conversations) },
        { label: 'رسائل', value: formatNumber(before.messages) },
        { label: 'عملاء محتملون', value: formatNumber(before.leads) },
        ...(paidBefore ? [{ label: 'خدمات التطبيق المدفوعة', value: `${formatNumber(paidBefore.paid)} · ${formatCents(paidBefore.cents)}` }] : []),
      ]
    : [];
  const strip = (rows: { label: string; value: string }[]) => (
    <dl className="strip">
      {rows.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className="num">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section className="card" aria-labelledby="today-title">
      <div className="row">
        <h2 id="today-title">اليوم</h2>
        <span className="muted">يبدأ اليوم عند منتصف الليل بتوقيت الرياض</span>
      </div>
      {strip(items)}
      {before ? (
        <>
          <h3 className="muted num">أمس · {formatDay(before.day)}</h3>
          {strip(yesterday)}
        </>
      ) : null}
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

/** Shown on the home; the server orders the whole list by sign-up time (`sort: 'newest'`, M229) because the hub orders it by activity. */
const LATEST_SHOWN = 8;

/**
 * M228 (owner, 2026-11-11: «نشاط المواقع ملوش داعي… نحط آخر الأعضاء المسجّلين»): the newest sign-ups in place of the
 * per-site chat activity, each row opening the member.
 * M230: `token` is the stamp of the hub numbers on the same screen, so the list is asked again whenever they are fresh
 * (the refresh button, a write from a member's sheet) and never contradicts the counts beside it.
 */
function LatestMembers({ token }: { token: string }) {
  const { openMember, openMembers } = useShell();
  const state = useLoad(() => api.accounts({ perPage: LATEST_SHOWN, sort: 'newest' }), [token]);
  const items = state.data?.items ?? [];
  return (
    <section className="card" aria-labelledby="latest-title">
      <div className="row">
        <h2 id="latest-title">آخر الأعضاء المسجّلين</h2>
        <button type="button" className="chip" onClick={() => openMembers('all')}>عرض الكل</button>
      </div>
      {state.error && !state.loading ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!state.data && !state.error ? <p className="muted">جارٍ التحميل…</p> : null}
      {state.data && items.length === 0 ? <p className="muted">لا توجد حسابات مسجّلة بعد.</p> : null}
      <ul className="list">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="list-row" onClick={() => openMember(item.id)}>
              <span className="list-main">
                <strong>{item.name || item.email || `حساب رقم ${item.id}`}</strong>
                <span className="muted">{[personaLabel(item.persona), item.city, formatRelative(item.created_at)].filter(Boolean).join(' · ')}</span>
              </span>
              {item.is_member ? <Pill tone="gold">عضو مشترك</Pill> : <Pill tone="muted">لم يشترك بعد</Pill>}
            </button>
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

/** The owner's first look: where the club stands, what happened today, and what needs him. `stamp` moves after a write from a member's sheet, so the numbers follow it. */
export function Home({ stamp: written }: { stamp: number }) {
  const [range, setRange] = useState<Range>('30');
  // One press asks for everything on the home again: its own answer and, through the same count, the downloads card's stores request.
  const [turn, setTurn] = useState(0);
  const reload = () => setTurn((value) => value + 1);
  const state = useLoad(() => api.home(Number(range)), [range, written, turn]);
  const days = RANGES.find((entry) => entry.value === range)?.label ?? '';
  const stamp = state.data?.hub ? `آخر تحديث ${formatDateTime(state.data.hub.generated_at)} · الأيام بتوقيت الرياض` : 'الأيام بتوقيت الرياض';
  return (
    <>
      <SectionHead title="الرئيسية" hint={stamp} onReload={reload} busy={state.loading}>
        <Chips label="الفترة" options={RANGES} value={range} onChange={setRange} />
      </SectionHead>
      <Async state={state} rows={6}>
        {(data) => {
          // Each block stands alone, as the answer itself does: one unexpected field costs its own card, and the next answer tries it again.
          const part = (block: ReactNode) => <Boundary watch={data}>{block}</Boundary>;
          return (
            <div className="stack">
              {/* M158 (owner): the downloads counter comes first, before anything else. */}
              {part(<DownloadsCard days={Number(range)} hub={data.hub} stamp={`${written}:${turn}`} onRefresh={reload} />)}
              {data.hub ? part(<Tiles hub={data.hub} />) : data.errors.hub ? <ErrorCard error={data.errors.hub} onRetry={reload} /> : null}
              {part(<Today data={data} />)}
              {data.hub ? part(<Daily hub={data.hub} days={days} />) : null}
              {part(<AppPayments data={data} days={days} />)}
              {data.hub ? (
                <div className="columns">
                  {part(<Expiring hub={data.hub} />)}
                  {part(<LatestMembers token={data.hub.generated_at} />)}
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
