import { useEffect, useState } from 'react';

import { wholeShares } from '../Chart';
import { formatNumber } from '../format';
import type { AnalyticsDay, AnalyticsResult } from '../types';

/**
 * M285: the infographic pieces of «الإحصائيات» — a headline band with counting numbers, trend arrows
 * and sparklines, the busiest weekdays, and the most visited screens with their share. Every number
 * here comes straight from the server's counters; nothing is estimated or rounded up.
 */

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Counts up to `value` once (0.9 s, eased); with reduced motion it just shows the number. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const still = reducedMotion();
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, still]);
  return <>{formatNumber(still ? value : shown)}</>;
}

/** Change against the window before: «▲ 12%». Nothing when there is no earlier number to compare with. */
export function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (before <= 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  const tone = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '●';
  return (
    <span className={`delta ${tone}`} title={`${label}: ${formatNumber(before)}`}>
      <span aria-hidden="true">{arrow}</span> <bdi className="num">{formatNumber(Math.abs(change))}%</bdi> <span className="delta-note">{label}</span>
    </span>
  );
}

/** A small line of the last days (oldest at the left edge, today at the right, like the bar charts). */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 120;
  const height = 34;
  const most = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 3 - (value / most) * (height - 6)).toFixed(1)}`);
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon className="spark-fill" points={`0,${height} ${points.join(' ')} ${width},${height}`} />
      <polyline className="spark-line" points={points.join(' ')} />
    </svg>
  );
}

type HeroItem = { key: string; label: string; value: number; note?: string; spark?: number[]; delta?: { before: number; label: string }; gold?: boolean };

/** The headline band: the numbers a guest should see first. */
export function StatsHero({ items }: { items: HeroItem[] }) {
  return (
    <section className="hero-band" aria-label="أهم الأرقام">
      {items.map((item) => (
        <div key={item.key} className={`hero-stat${item.gold ? ' gold' : ''}`}>
          <span className="hero-label">{item.label}</span>
          <strong className="hero-value num">
            <CountUp value={item.value} />
          </strong>
          {item.delta ? <Delta now={item.value} before={item.delta.before} label={item.delta.label} /> : null}
          {item.note ? <span className="hero-note">{item.note}</span> : null}
          {item.spark ? <Sparkline values={item.spark} /> : null}
        </div>
      ))}
    </section>
  );
}

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** Average daily visitors per weekday (Sunday first, the Saudi week); days before the first visit are left out. */
export function Weekdays({ days }: { days: AnalyticsDay[] }) {
  const first = days.findIndex((day) => day.visitors > 0);
  const counted = first < 0 ? [] : days.slice(first);
  const sums = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const day of counted) {
    const weekday = new Date(`${day.day}T00:00:00Z`).getUTCDay();
    const slot = sums[weekday]!;
    slot.total += day.visitors;
    slot.count += 1;
  }
  const averages = sums.map((slot) => (slot.count ? Math.round(slot.total / slot.count) : 0));
  const most = Math.max(1, ...averages);
  const top = averages.indexOf(Math.max(...averages));
  if (counted.length < 7) return null;
  return (
    <section className="card" aria-labelledby="weekdays-title">
      <div className="row">
        <h2 id="weekdays-title">أنشط أيام الأسبوع</h2>
        <span className="pill gold">الأنشط: {WEEKDAYS[top]}</span>
      </div>
      <p className="muted hint">متوسط من فتحوا التطبيق في كل يوم من أيام الأسبوع خلال الفترة.</p>
      <div className="weekdays" role="img" aria-label={WEEKDAYS.map((name, index) => `${name} ${formatNumber(averages[index])}`).join('، ')}>
        {averages.map((value, index) => (
          <div key={WEEKDAYS[index]} className={`weekday${index === top ? ' top' : ''}`}>
            <span className="num weekday-value">{formatNumber(value)}</span>
            <span className="weekday-bar"><i style={{ blockSize: `${Math.max(4, (value / most) * 100)}%` }} /></span>
            <span className="weekday-name">{WEEKDAYS[index]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The most visited screens, ranked, with each one's share of every view in the period. */
export function TopScreensBoard({ days, label }: { days: AnalyticsDay[]; label: (screen: string) => string | null }) {
  const totals = new Map<string, number>();
  for (const day of days) {
    for (const [screen, count] of Object.entries(day.screens)) {
      // Screens without an Arabic name (old or internal routes) are summed as «شاشات أخرى», never shown raw.
      const key = label(screen) ?? 'other';
      totals.set(key, (totals.get(key) ?? 0) + count);
    }
  }
  const named = [...totals.entries()].filter(([key]) => key !== 'other').sort((a, b) => b[1] - a[1]);
  const rows = named.slice(0, 10);
  const rest = named.slice(10).reduce((sum, [, count]) => sum + count, 0) + (totals.get('other') ?? 0);
  if (rest > 0) rows.push(['شاشات أخرى', rest]);
  const all = [...totals.values()].reduce((sum, count) => sum + count, 0);
  const shares = wholeShares(rows.map(([, count]) => count));
  const most = Math.max(1, ...rows.map(([, count]) => count));
  return (
    <section className="card" aria-labelledby="screens-title">
      <div className="row">
        <h2 id="screens-title">أكثر الشاشات زيارة</h2>
        <span className="muted num">كل المشاهدات: {formatNumber(all)}</span>
      </div>
      {rows.length === 0 ? <p className="muted">لا توجد مشاهدات في هذه الفترة.</p> : null}
      <ol className="rank-list">
        {rows.map(([name, count], index) => (
          <li key={name} className="rank-row">
            <span className={`rank${index < 3 && name !== 'شاشات أخرى' ? ' top' : ''}`}>{name === 'شاشات أخرى' ? '…' : formatNumber(index + 1)}</span>
            <div className="rank-body">
              <div className="row">
                <span>{name}</span>
                <span className="num">
                  {formatNumber(count)} <span className="muted">· {formatNumber(shares[index])}%</span>
                </span>
              </div>
              <span className="meter" aria-hidden="true"><i style={{ inlineSize: `${(count / most) * 100}%` }} /></span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The daily series of the last `n` days for a sparkline. */
export const lastDays = (data: AnalyticsResult, n: number, pick: (day: AnalyticsDay) => number): number[] => data.days.slice(-n).map(pick);
