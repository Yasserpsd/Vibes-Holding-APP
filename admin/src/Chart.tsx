import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { formatDay, formatNumber } from './format';

/** One bar: a Riyadh day, or (M33) a week or month bucket carrying its own `label`. */
export type ChartPoint = { day: string; value: number; label?: string; details?: { label: string; value: string }[] };
type Props = {
  title: string;
  /** One sentence for screen readers: what the bars count and over which period. */
  desc: string;
  /** Column name of the value in the table fallback. */
  valueLabel: string;
  /** Column name of the bucket in the table fallback («اليوم», «الأسبوع»…). */
  dayLabel?: string;
  points: ChartPoint[];
  format?: (value: number) => string;
};

const HEIGHT = 208;
const TOP = 12;
const BOTTOM = 24;
const RIGHT = 6;

/** Round steps (1, 2, 5 × 10ⁿ) that give at most four grid lines; whole numbers only, the series are counts and riyals. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power);
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}

/**
 * Daily bars, hand-drawn SVG: one series, one axis, time from left to right. Pointer, touch and the arrow keys move
 * the same marker; the value shows in a tooltip, in each bar's label for screen readers, and in a table below.
 */
export function BarChart({ title, desc, valueLabel, dayLabel = 'اليوم', points, format = formatNumber }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const bars = useRef<(SVGRectElement | null)[]>([]);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const count = points.length;
  const ticks = ticksFor(Math.max(0, ...points.map((point) => point.value)));
  const top = ticks[ticks.length - 1] ?? 1;
  // The axis carries bare numbers; the unit is in the tooltip, the table and the title.
  const left = Math.max(30, Math.max(...ticks.map((tick) => formatNumber(tick).length)) * 7 + 10);
  const plotWidth = Math.max(0, width - left - RIGHT);
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const slot = count > 0 ? plotWidth / count : 0;
  const barWidth = Math.max(1.5, Math.min(22, slot - (slot > 6 ? 2 : 0.6)));
  const y = (value: number) => TOP + plotHeight - (value / top) * plotHeight;
  // About one date label per 80px, the first and the last day always among them.
  const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotWidth / 80))));
  const labelled = (index: number) => index === count - 1 || (index % labelEvery === 0 && count - 1 - index >= labelEvery * 0.6);
  const current = active !== null ? points[active] : undefined;

  const indexAt = (event: PointerEvent<SVGSVGElement>): number | null => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left - left;
    if (slot <= 0 || x < 0 || x > plotWidth) return null;
    return Math.min(count - 1, Math.floor(x / slot));
  };

  const onKey = (event: KeyboardEvent<SVGRectElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -count : event.key === 'End' ? count : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.min(count - 1, Math.max(0, index + step));
    setActive(next);
    bars.current[next]?.focus();
  };

  return (
    <figure className="chart">
      <div className="chart-frame" ref={frame}>
        {width > 0 && count > 0 ? (
          <svg width={width} height={HEIGHT} role="group" aria-labelledby={`${titleId} ${descId}`} onPointerMove={(event) => setActive(indexAt(event))} onPointerDown={(event) => setActive(indexAt(event))} onPointerLeave={(event) => (event.pointerType === 'mouse' ? setActive(null) : undefined)}>
            <title id={titleId}>{title}</title>
            <desc id={descId}>{desc}</desc>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className={tick === 0 ? 'chart-base' : 'chart-grid'} x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} />
                <text className="chart-tick" x={left - 8} y={y(tick) + 4} textAnchor="end">{formatNumber(tick)}</text>
              </g>
            ))}
            {current && active !== null ? <rect className="chart-band" x={left + active * slot} y={TOP} width={slot} height={plotHeight} /> : null}
            {points.map((point, index) => {
              const height = point.value > 0 ? Math.max(2, TOP + plotHeight - y(point.value)) : 0;
              const x = left + index * slot + (slot - barWidth) / 2;
              const radius = Math.min(3, barWidth / 2, height);
              return (
                <g key={point.day}>
                  {/* An empty title keeps the browser from showing the chart's own title as a second tooltip over the bars. */}
                  <title />
                  {height > 0 ? (
                    <path className={index === active ? 'chart-bar on' : 'chart-bar'} d={`M${x} ${TOP + plotHeight}v${-(height - radius)}q0 ${-radius} ${radius} ${-radius}h${barWidth - 2 * radius}q${radius} 0 ${radius} ${radius}v${height - radius}z`} />
                  ) : null}
                  {/* The whole column is the target, so a zero day can be read too. One tab stop; the arrows walk the days. */}
                  <rect
                    ref={(node) => {
                      bars.current[index] = node;
                    }}
                    className="chart-hit"
                    x={left + index * slot}
                    y={TOP}
                    width={slot}
                    height={plotHeight}
                    tabIndex={index === (active ?? count - 1) ? 0 : -1}
                    role="img"
                    aria-label={`${point.label ?? formatDay(point.day, 'long')}: ${format(point.value)}${(point.details ?? []).map((detail) => `، ${detail.label} ${detail.value}`).join('')}`}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive((value) => (value === index ? null : value))}
                    onKeyDown={(event) => onKey(event, index)}
                  />
                  {/* Arabic day names run right to left: under that direction «start» pins the right edge. */}
                  {labelled(index) ? <text className="chart-tick" direction="rtl" x={index === count - 1 ? left + plotWidth : left + index * slot + slot / 2} y={HEIGHT - 6} textAnchor={index === count - 1 ? 'start' : 'middle'}>{point.label ?? formatDay(point.day, 'short')}</text> : null}
                </g>
              );
            })}
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}
        {current && active !== null ? (
          <div className="chart-tip" style={{ left: Math.min(Math.max(left + active * slot + slot / 2, 84), Math.max(84, width - 84)), top: Math.max(0, y(current.value) - 12) }} aria-hidden="true">
            <span className="muted">{current.label ?? formatDay(current.day, 'long')}</span>
            <strong className="num">{format(current.value)}</strong>
            {(current.details ?? []).map((detail) => (
              <span key={detail.label} className="chart-tip-row">
                {detail.label} <b className="num">{detail.value}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <details className="chart-table">
        <summary>عرض الأرقام في جدول</summary>
        <div className="table-wrap">
          <table className="table plain">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{dayLabel}</th>
                <th scope="col" className="num">{valueLabel}</th>
                {(points[0]?.details ?? []).map((detail) => <th key={detail.label} scope="col" className="num">{detail.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.day}>
                  <th scope="row">{point.label ?? formatDay(point.day)}</th>
                  <td className="num">{format(point.value)}</td>
                  {(point.details ?? []).map((detail) => <td key={detail.label} className="num">{detail.value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** One slice of the M33 donut. `tone` picks one of four fixed ring colors (gold shades then gray). */
export type DonutSlice = { label: string; value: number; tone: 'a' | 'b' | 'c' | 'd' };

const RADIUS = 15.915; // circumference 100: percentages are dash lengths.
const GAP = 1.2;

/**
 * A ring of the whole split into parts (members by category): hand-drawn SVG, the total in the middle,
 * a legend with counts and percentages beside it. Zero slices are left out of the ring but named in the legend.
 */
export function Donut({ title, slices, centerLabel }: { title: string; slices: DonutSlice[]; centerLabel: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const shown = slices.filter((slice) => slice.value > 0);
  let offset = 25; // Twelve o'clock.
  const parts = shown.map((slice) => {
    const length = (slice.value / Math.max(1, total)) * 100;
    const gap = shown.length > 1 ? Math.min(GAP, length / 3) : 0;
    const part = { ...slice, length: length - gap, offset: offset - gap / 2 };
    offset -= length;
    return part;
  });
  const percent = (value: number) => `${Math.round((value / Math.max(1, total)) * 100)}%`;
  return (
    <div className="donut" role="img" aria-label={`${title}: ${slices.map((slice) => `${slice.label} ${formatNumber(slice.value)}`).join('، ')}`}>
      <div className="donut-ring">
        <svg viewBox="0 0 42 42" aria-hidden="true">
          <circle className="donut-track" cx="21" cy="21" r={RADIUS} />
          {parts.map((part) => (
            <circle key={part.label} className={`donut-slice ${part.tone}`} cx="21" cy="21" r={RADIUS} strokeDasharray={`${Math.max(0, part.length)} ${100 - Math.max(0, part.length)}`} strokeDashoffset={part.offset} />
          ))}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <strong className="num">{formatNumber(total)}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {slices.map((slice) => (
          <li key={slice.label}>
            <i className={`donut-dot ${slice.tone}`} aria-hidden="true" />
            <span className="donut-name">{slice.label}</span>
            <b className="num">{formatNumber(slice.value)}</b>
            <span className="muted num">{total > 0 ? percent(slice.value) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
