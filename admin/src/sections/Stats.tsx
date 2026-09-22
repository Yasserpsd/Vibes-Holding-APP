import { useMemo, useState, type ReactNode } from 'react';

import { api } from '../api';
import { BarChart, Donut, type ChartPoint, type DonutSlice } from '../Chart';
import { formatDay, formatMoney, formatNumber } from '../format';
import type { AnalyticsDay, AnalyticsResult, Home as HomeData, Personas } from '../types';
import { Async, Boundary, Chips, ErrorCard, SectionHead, useLoad } from '../ui';

type Range = '30' | '90' | '180';
const RANGES: { value: Range; label: string }[] = [
  { value: '30', label: '30 يومًا' },
  { value: '90', label: '90 يومًا' },
  { value: '180', label: '180 يومًا' },
];

type Grouping = 'day' | 'week' | 'month';
const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: 'day', label: 'باليوم' },
  { value: 'week', label: 'بالأسبوع' },
  { value: 'month', label: 'بالشهر' },
];
const GROUP_NOUN: Record<Grouping, string> = { day: 'اليوم', week: 'الأسبوع', month: 'الشهر' };

/** The app's route names as the owner reads them. An unknown route shows its raw name. */
const SCREEN_LABELS: Record<string, string> = {
  '(tabs)': 'الرئيسية',
  '(tabs)/news': 'الأخبار',
  '(tabs)/projects': 'بنك المشاريع',
  '(tabs)/advisor': 'المستشار',
  '(tabs)/account': 'حسابي',
  'project/[id]': 'صفحة مشروع',
  'news/[id]': 'قراءة خبر',
  'news/decisions': 'قرارات وأنظمة',
  'news/interests': 'اهتمامات الأخبار',
  'portal/entrepreneurs': 'بوابة رواد الأعمال',
  'services/index': 'الخدمات',
  'service/[key]': 'طلب خدمة',
  'videos/index': 'مكتبة الفيديو',
  'posts/index': 'رسائل الإدارة',
  'posts/[id]': 'رسالة من الإدارة',
  'posts/compose': 'إنشاء رسالة',
  card: 'كارت العضوية',
  invite: 'دعوة عضو',
  membership: 'العضوية',
  golden: 'المشاريع الذهبية',
  about: 'عن النادي',
  'hq/index': 'مقر النادي',
  'hq/book': 'حجز زيارة المقر',
  'hq/pass/[id]': 'تصريح المقر',
  'hq/admin': 'استقبال المقر',
  'payment/[id]': 'صفحة الدفع',
  'payments/index': 'مدفوعاتي',
  'profile-edit': 'تعديل الملف',
  welcome: 'شاشة الترحيب',
  'auth/login': 'تسجيل الدخول',
  'auth/register': 'إنشاء حساب',
  'auth/verify': 'تأكيد البريد',
  'auth/reset': 'استعادة كلمة المرور',
};
const screenLabel = (screen: string): string => SCREEN_LABELS[screen] ?? screen;

const monthFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Days folded into weeks (Sunday first, as the Saudi week) or months; `day` keeps the bucket's first day. */
function grouped(points: ChartPoint[], mode: Grouping): ChartPoint[] {
  if (mode === 'day') return points;
  const buckets = new Map<string, ChartPoint>();
  for (const point of points) {
    const at = Date.parse(`${point.day}T00:00:00Z`);
    if (Number.isNaN(at)) continue;
    let key: string;
    let label: string;
    if (mode === 'week') {
      const start = new Date(at - new Date(at).getUTCDay() * 86_400_000);
      key = start.toISOString().slice(0, 10);
      label = `أسبوع ${formatDay(key, 'short')}`;
    } else {
      key = `${point.day.slice(0, 7)}-01`;
      label = monthFormat.format(Date.parse(`${key}T00:00:00Z`));
    }
    const bucket = buckets.get(key);
    if (bucket) bucket.value += point.value;
    else buckets.set(key, { day: key, value: point.value, label });
  }
  return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
}

type UsageMetric = 'visitors' | 'views' | 'advisor' | 'news' | 'unlocks';
type ClubMetric = 'signups' | 'activations' | 'renewals' | 'hubPayments' | 'appPayments';

function PersonasCard({ personas, error, onRetry }: { personas: Personas | null; error?: { code: string; message: string }; onRetry: () => void }) {
  if (!personas) return error ? <ErrorCard error={error} onRetry={onRetry} /> : null;
  // The club's order: محايد ثم رائد الأعمال ثم المستثمر.
  const slices: DonutSlice[] = [
    { label: 'محايد', value: personas.neutral, tone: 'a' },
    { label: 'رائد الأعمال', value: personas.entrepreneur, tone: 'b' },
    { label: 'المستثمر', value: personas.investor, tone: 'c' },
    ...(personas.none > 0 ? [{ label: 'بدون فئة', value: personas.none, tone: 'd' as const }] : []),
  ];
  return (
    <section className="card" aria-labelledby="personas-title">
      <h2 id="personas-title">الأعضاء المشتركون حسب الفئة</h2>
      <Donut title="الأعضاء المشتركون حسب الفئة" slices={slices} centerLabel="عضو مشترك" />
    </section>
  );
}

function TopScreens({ days }: { days: AnalyticsDay[] }) {
  const totals = new Map<string, number>();
  for (const day of days) for (const [screen, count] of Object.entries(day.screens)) totals.set(screen, (totals.get(screen) ?? 0) + count);
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const most = Math.max(1, ...rows.map(([, count]) => count));
  const all = [...totals.values()].reduce((sum, count) => sum + count, 0);
  return (
    <section className="card" aria-labelledby="screens-title">
      <div className="row">
        <h2 id="screens-title">أكثر الشاشات زيارة</h2>
        <span className="muted num">كل المشاهدات: {formatNumber(all)}</span>
      </div>
      {rows.length === 0 ? <p className="muted">لا توجد مشاهدات بعد. تصل الأرقام من التطبيق بعد تحديث OTA القادم، أول ما يفتحه الأعضاء.</p> : null}
      <ul className="list">
        {rows.map(([screen, count]) => (
          <li key={screen} className="meter-row">
            <div className="row">
              <span>{SCREEN_LABELS[screen] ? screenLabel(screen) : <bdi dir="ltr">{screen}</bdi>}</span>
              <span className="num">{formatNumber(count)}</span>
            </div>
            <span className="meter" aria-hidden="true"><i style={{ inlineSize: `${(count / most) * 100}%` }} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UsageCharts({ data, grouping }: { data: AnalyticsResult; grouping: Grouping }) {
  const [metric, setMetric] = useState<UsageMetric>('visitors');
  const options = useMemo(() => {
    const sum = (pick: (day: AnalyticsDay) => number) => data.days.reduce((total, day) => total + pick(day), 0);
    const pbFromBridge = data.pbDays !== null;
    return [
      { value: 'visitors' as const, label: 'النشطون', noun: 'عضو أو زائر فتح التطبيق', pick: (day: AnalyticsDay) => day.visitors, count: sum((day) => day.visitors) },
      { value: 'views' as const, label: 'المشاهدات', noun: 'شاشة مفتوحة', pick: (day: AnalyticsDay) => day.views, count: sum((day) => day.views) },
      { value: 'advisor' as const, label: 'رسائل المستشار', noun: 'رسالة للمستشار', pick: (day: AnalyticsDay) => day.events.advisorMessages, count: sum((day) => day.events.advisorMessages) },
      { value: 'news' as const, label: 'قراءات الأخبار', noun: 'خبر فُتح', pick: (day: AnalyticsDay) => day.events.newsReads, count: sum((day) => day.events.newsReads) },
      {
        value: 'unlocks' as const,
        label: 'فتح المشاريع',
        noun: 'مشروع فُتح من بنك المشاريع',
        pick: (day: AnalyticsDay) => (pbFromBridge ? (data.pbDays?.[day.day] ?? 0) : day.events.pbUnlocks),
        count: pbFromBridge ? Object.values(data.pbDays ?? {}).reduce((total, count) => total + count, 0) : sum((day) => day.events.pbUnlocks),
      },
    ];
  }, [data]);
  const chosen = options.find((option) => option.value === metric) ?? options[0]!;
  // Visitors cannot be summed across days (the same member counts once a day): weeks and months show the daily peak instead.
  const distinct = metric === 'visitors' && grouping !== 'day';
  const daily = data.days.map((day) => ({ day: day.day, value: chosen.pick(day) }));
  const points = distinct ? peaks(daily, grouping) : grouped(daily, grouping);
  return (
    <section className="card" aria-labelledby="usage-title">
      <div className="row">
        <h2 id="usage-title">استخدام التطبيق</h2>
        <span className="muted num">الإجمالي: {formatNumber(chosen.count)}</span>
      </div>
      <Chips label="المؤشر" options={options} value={metric} onChange={setMetric} />
      {data.errors.pb && metric === 'unlocks' ? <p className="warn">{data.errors.pb.message} — الأرقام من عدّاد التطبيق فقط.</p> : null}
      <BarChart
        title={distinct ? `أعلى يوم في ${GROUP_NOUN[grouping]}: ${chosen.label}` : chosen.label}
        desc={`أعمدة ${GROUP_NOUN[grouping] === 'اليوم' ? 'يومية' : grouping === 'week' ? 'أسبوعية' : 'شهرية'}: ${chosen.noun} بتوقيت الرياض.${distinct ? ' العضو يُحسب مرة واحدة في اليوم، فالأسابيع والشهور تعرض أعلى يوم فيها.' : ''}`}
        valueLabel={chosen.label}
        dayLabel={GROUP_NOUN[grouping]}
        points={points}
      />
      {distinct ? <p className="muted hint">العضو يُحسب مرة واحدة في اليوم، فالتجميع الأسبوعي والشهري يعرض أعلى يوم داخل الفترة.</p> : null}
    </section>
  );
}

/** The highest daily value inside each bucket (for counts of distinct people). */
function peaks(points: ChartPoint[], mode: Grouping): ChartPoint[] {
  const summed = grouped(points.map((point) => ({ ...point, value: 0 })), mode);
  return summed.map((bucket) => {
    const next = new Date(Date.parse(`${bucket.day}T00:00:00Z`));
    if (mode === 'week') next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    const end = next.toISOString().slice(0, 10);
    const inside = points.filter((point) => point.day >= bucket.day && point.day < end);
    return { ...bucket, value: Math.max(0, ...inside.map((point) => point.value)) };
  });
}

function ClubCharts({ home, grouping, days }: { home: HomeData; grouping: Grouping; days: string }) {
  const [metric, setMetric] = useState<ClubMetric>('activations');
  const hub = home.hub;
  const money = (value: number) => formatMoney(value);
  const options = [
    { value: 'signups' as const, label: 'التسجيلات', noun: 'حساب جديد', money: false, points: hub?.series.map((day) => ({ day: day.day, value: day.signups })) ?? null },
    { value: 'activations' as const, label: 'التفعيلات', noun: 'عضوية مفعّلة', money: false, points: hub?.series.map((day) => ({ day: day.day, value: day.activations })) ?? null },
    { value: 'renewals' as const, label: 'التجديدات', noun: 'تجديد عضوية', money: false, points: hub?.series.map((day) => ({ day: day.day, value: day.renewals })) ?? null },
    { value: 'hubPayments' as const, label: 'مدفوعات الهب', noun: 'مدفوعات ناجحة عبر الموقع', money: true, points: hub?.series.map((day) => ({ day: day.day, value: day.payments_cents / 100 })) ?? null },
    { value: 'appPayments' as const, label: 'مدفوعات التطبيق', noun: 'مدفوعات خدمات التطبيق', money: true, points: home.app.payments.series.map((day) => ({ day: day.day, value: day.cents / 100 })) },
  ];
  const shown = options.filter((option) => option.points !== null);
  const chosen = shown.find((option) => option.value === metric) ?? shown[0];
  if (!chosen) return home.errors.hub ? <ErrorCard error={home.errors.hub} /> : null;
  const points = grouped(chosen.points ?? [], grouping);
  const total = (chosen.points ?? []).reduce((sum, point) => sum + point.value, 0);
  const format = chosen.money ? money : formatNumber;
  return (
    <section className="card" aria-labelledby="club-title">
      <div className="row">
        <h2 id="club-title">العضويات والمدفوعات</h2>
        <span className="muted num">إجمالي آخر {days}: {format(total)}</span>
      </div>
      <Chips label="المؤشر" options={shown} value={chosen.value} onChange={setMetric} />
      {home.errors.hub ? <p className="warn">{home.errors.hub.message}</p> : null}
      <BarChart title={chosen.label} desc={`أعمدة ${grouping === 'day' ? 'يومية' : grouping === 'week' ? 'أسبوعية' : 'شهرية'}: ${chosen.noun} بتوقيت الرياض.`} valueLabel={chosen.label} dayLabel={GROUP_NOUN[grouping]} points={points} format={format} />
    </section>
  );
}

/** M33: the live infographics — the club by category, and every daily number by day, week or month. */
export function Stats() {
  const [range, setRange] = useState<Range>('90');
  const [grouping, setGrouping] = useState<Grouping>('day');
  const state = useLoad(async () => {
    const [analytics, home] = await Promise.all([api.analytics(Number(range)), api.home(Number(range))]);
    return { analytics, home };
  }, [range]);
  const days = RANGES.find((entry) => entry.value === range)?.label ?? '';
  return (
    <>
      <SectionHead title="الإحصائيات" hint="أرقام حية بتوقيت الرياض: من فتح التطبيق وماذا فتح، والعضويات والمدفوعات، بتجميع يومي أو أسبوعي أو شهري." onReload={state.reload} busy={state.loading}>
        <Chips label="الفترة" options={RANGES} value={range} onChange={setRange} />
        <Chips label="التجميع" options={GROUPINGS} value={grouping} onChange={setGrouping} />
      </SectionHead>
      <Async state={state} rows={6}>
        {({ analytics, home }) => {
          const today = analytics.days.at(-1);
          const part = (block: ReactNode) => <Boundary watch={analytics}>{block}</Boundary>;
          return (
            <div className="stack">
              {today ? part(
                <div className="tiles">
                  <div className="tile gold">
                    <span className="tile-label">فتحوا التطبيق اليوم</span>
                    <strong className="tile-value num">{formatNumber(today.visitors)}</strong>
                  </div>
                  <div className="tile">
                    <span className="tile-label">مشاهدات اليوم</span>
                    <strong className="tile-value num">{formatNumber(today.views)}</strong>
                  </div>
                  <div className="tile">
                    <span className="tile-label">رسائل المستشار اليوم</span>
                    <strong className="tile-value num">{formatNumber(today.events.advisorMessages)}</strong>
                  </div>
                  <div className="tile">
                    <span className="tile-label">قراءات الأخبار اليوم</span>
                    <strong className="tile-value num">{formatNumber(today.events.newsReads)}</strong>
                  </div>
                </div>,
              ) : null}
              <div className="columns">
                {part(<PersonasCard personas={analytics.personas} error={analytics.errors.personas} onRetry={state.reload} />)}
                {part(<TopScreens days={analytics.days} />)}
              </div>
              {part(<UsageCharts data={analytics} grouping={grouping} />)}
              {part(<ClubCharts home={home} grouping={grouping} days={days} />)}
            </div>
          );
        }}
      </Async>
    </>
  );
}
