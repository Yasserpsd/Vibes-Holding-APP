import { useId, useState } from 'react';

import { api } from '../api';
import { formatDay, formatNumber } from '../format';
import type { Downloads as DownloadsData, StoreDownloads } from '../types';
import { ErrorCard, Skeleton, useLoad } from '../ui';

/**
 * M158 (owner, 2026-10-30): «أعرف كام عميل حمّل التطبيق… أول لما أفتح… جراف… بشكل ملكي خاص جدًا بلوجو Google وiOS…
 * كام هنا وكام هنا والإجمالي». The first card on the home: Google Play and App Store marks, a number under each,
 * the total, and the trend line.
 * M228 (owner, 2026-11-11: «الأرقام غير صحيحة… عايز رقم لكل اللي حمّلوا حتى لو ما سجّلوش، ورقم للي سجّلوا»): two units
 * that never mix. The big number of each store is its own downloads for the chosen range, or «غير متاح» with the
 * reason when the store has not answered — never a device count in its place. The registered accounts sit under it
 * on their own line, and the total adds downloads only.
 */

/** The Apple mark, the same path the official App Store badge carries (server/src/legal/badges.ts). */
function AppleMark() {
  return (
    <svg viewBox="12 5 23 28" width="30" height="36" aria-hidden="true" className="store-mark">
      <path fill="currentColor" d="M30.128,19.784c-0.029-3.223,2.639-4.791,2.761-4.864c-1.511-2.203-3.853-2.504-4.676-2.528 c-1.967-0.207-3.875,1.177-4.877,1.177c-1.022,0-2.565-1.157-4.228-1.123c-2.14,0.033-4.142,1.272-5.24,3.196 c-2.266,3.923-0.576,9.688,1.595,12.859c1.086,1.553,2.355,3.287,4.016,3.226c1.625-0.067,2.232-1.036,4.193-1.036 c1.943,0,2.513,1.036,4.207,0.997c1.744-0.028,2.842-1.56,3.89-3.127c1.255-1.78,1.759-3.533,1.779-3.623 C33.507,24.924,30.161,23.647,30.128,19.784z" />
      <path fill="currentColor" d="M26.928,10.306c0.874-1.093,1.472-2.58,1.306-4.089c-1.265,0.056-2.847,0.875-3.758,1.944 c-0.806,0.942-1.526,2.486-1.34,3.938C24.557,12.205,26.016,11.382,26.928,10.306z" />
    </svg>
  );
}

/** The Google Play triangle in its four brand colours. */
function PlayMark() {
  return (
    <svg viewBox="0 0 100 100" width="34" height="36" aria-hidden="true" className="store-mark">
      <path fill="#00c3ff" d="M4 3.5 L52 50 L4 96.5 Q2 94 2 90 L2 10 Q2 6 4 3.5 Z" />
      <path fill="#00f076" d="M4 3.5 Q8 0.5 13 3 L68 34.5 L52 50 Z" />
      <path fill="#ff3a44" d="M4 96.5 L52 50 L68 65.5 L13 97 Q8 99.5 4 96.5 Z" />
      <path fill="#ffd500" d="M52 50 L68 34.5 L91 47 Q96 50 91 53 L68 65.5 Z" />
    </svg>
  );
}

/** Why a store shows no number, in plain Arabic (the store answer itself goes to the foot line). */
function reason(store: StoreDownloads): string {
  if (!store.configured) return 'مفاتيح المتجر غير مضبوطة على الخادم';
  const error = store.error ?? '';
  if (!error) return 'لم يصل رد المتجر بعد';
  if (/\b(401|403)\b/.test(error)) return 'المتجر رفض القراءة: صلاحية حساب الخدمة غير مفعّلة';
  if (/no installs report/.test(error)) return 'المتجر لم يُصدر ملف التحميلات بعد';
  return 'تعذّر الاتصال بالمتجر';
}

function StoreColumn({ mark, name, store, accounts, label }: { mark: React.ReactNode; name: string; store: StoreDownloads; accounts: number; label: string }) {
  return (
    <div className="store-col">
      {mark}
      <span className="store-name">{name}</span>
      {store.installs !== null ? <strong className="store-value num">{formatNumber(store.installs)}</strong> : <strong className="store-value off">غير متاح</strong>}
      <span className="store-caption">{store.installs !== null ? `تحميل من المتجر · آخر ${label}` : reason(store)}</span>
      <span className="store-sub">الحسابات المسجّلة <strong className="num">{formatNumber(accounts)}</strong></span>
    </div>
  );
}

/** The trend of the range: store downloads per day. A store that has not answered has no line; gold = the sum when both answered. */
function Trend({ series, label }: { series: DownloadsData['series']; label: string }) {
  const id = useId();
  const width = 560;
  const height = 120;
  const pad = { x: 6, top: 10, bottom: 22 };
  const hasAndroid = series.some((point) => point.android !== null);
  const hasIos = series.some((point) => point.ios !== null);
  const totals = series.map((point) => (point.android ?? 0) + (point.ios ?? 0));
  const max = Math.max(1, ...totals);
  const stepX = series.length > 1 ? (width - pad.x * 2) / (series.length - 1) : 0;
  const y = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - value / max);
  const line = (pick: (index: number) => number) => series.map((_, index) => `${index === 0 ? 'M' : 'L'}${(pad.x + index * stepX).toFixed(1)},${y(pick(index)).toFixed(1)}`).join(' ');
  const area = `${line((index) => totals[index]!)} L${(pad.x + (series.length - 1) * stepX).toFixed(1)},${height - pad.bottom} L${pad.x},${height - pad.bottom} Z`;
  const first = series[0];
  const last = series[series.length - 1];
  const endX = (pad.x + (series.length - 1) * stepX).toFixed(1);
  const endY = y(totals[totals.length - 1]!).toFixed(1);
  const both = hasAndroid && hasIos;
  return (
    <figure className="store-trend">
      {/* The drawing stretches to the card's width at a fixed height (phones would otherwise get a 70px strip);
          strokes never scale, and the end dot is a round-capped zero-length stroke so it stays round. */}
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`تحميلات المتاجر يوميًا خلال آخر ${label}`}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e7ad3f" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#e7ad3f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad.x} x2={width - pad.x} y1={height - pad.bottom} y2={height - pad.bottom} className="store-trend-base" vectorEffect="non-scaling-stroke" />
        <path d={area} fill={`url(#${id}-fill)`} />
        {both ? <path d={line((index) => series[index]!.android ?? 0)} className="store-trend-line android" vectorEffect="non-scaling-stroke" /> : null}
        {both ? <path d={line((index) => series[index]!.ios ?? 0)} className="store-trend-line ios" vectorEffect="non-scaling-stroke" /> : null}
        <path d={line((index) => totals[index]!)} className="store-trend-line total" vectorEffect="non-scaling-stroke" />
        {last ? (
          <>
            <path d={`M${endX},${endY} h0.01`} className="store-trend-dot ring" vectorEffect="non-scaling-stroke" />
            <path d={`M${endX},${endY} h0.01`} className="store-trend-dot" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
      <div className="store-ticks" aria-hidden="true">
        <span>{first ? formatDay(first.day, 'short') : ''}</span>
        <span>{last ? formatDay(last.day, 'short') : ''}</span>
      </div>
      <figcaption className="store-legend">
        {both ? (
          <>
            <span><i className="swatch total" /> إجمالي التحميلات</span>
            <span><i className="swatch android" /> Google Play</span>
            <span><i className="swatch ios" /> App Store</span>
          </>
        ) : (
          <span><i className="swatch total" /> تحميلات {hasIos ? 'App Store' : 'Google Play'} يوميًا</span>
        )}
      </figcaption>
    </figure>
  );
}

/** One foot line per store: the all-time downloads when it answered, the reason (and the store answer) when not. */
function StoreFoot({ name, store }: { name: string; store: StoreDownloads }) {
  if (store.allTime === null) {
    return (
      <span>
        {name}: {reason(store)}
        {store.error ? <bdi dir="ltr" className="store-error">{store.error}</bdi> : null}
      </span>
    );
  }
  return (
    <span>
      {name}: <bdi className="num">{formatNumber(store.allTime)}</bdi> تحميلًا
      {store.since ? ` منذ أول تحميل في ${formatDay(store.since, 'short')}` : ''}
      {store.latest ? `، آخر يوم منشور ${formatDay(store.latest, 'short')}` : ''}
    </span>
  );
}

export function DownloadsCard({ days, label }: { days: number; label: string }) {
  const state = useLoad(() => api.downloads(days), [days]);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      await api.downloadsSnapshot(days);
      state.reload();
    } finally {
      setBusy(false);
    }
  };
  if (state.error && !state.loading) return <ErrorCard error={state.error} onRetry={state.reload} />;
  const data = state.data;
  if (!data) return <Skeleton rows={4} />;
  const { apple, google } = data.stores;
  const answered = [apple.installs !== null ? 'App Store' : null, google.installs !== null ? 'Google Play' : null].filter(Boolean);
  const totalCaption = data.installs.complete ? `من المتجرين · آخر ${label}` : answered.length ? `${answered[0]} فقط · آخر ${label}` : 'لا توجد أرقام من المتجرين بعد';
  return (
    <section className="card royal downloads" aria-labelledby="downloads-title">
      <header className="downloads-head">
        <div>
          <p className="royal-kicker">Investors Club</p>
          <h2 id="downloads-title">تحميلات التطبيق من المتجرين</h2>
        </div>
        <button type="button" className="chip royal-chip" onClick={() => void refresh()} disabled={busy || state.loading}>
          {busy ? 'جارٍ التحديث…' : 'حدّث الآن'}
        </button>
      </header>
      <div className="store-grid">
        <StoreColumn mark={<PlayMark />} name="Google Play" store={google} accounts={data.devices.accounts.android} label={label} />
        <div className="store-total">
          <span className="store-name">إجمالي التحميلات</span>
          {data.installs.total !== null ? <strong className="store-value big num">{formatNumber(data.installs.total)}</strong> : <strong className="store-value off">غير متاح</strong>}
          <span className="store-caption">{totalCaption}</span>
          <span className="store-sub">الحسابات المسجّلة <strong className="num">{formatNumber(data.devices.accounts.total)}</strong></span>
        </div>
        <StoreColumn mark={<AppleMark />} name="App Store" store={apple} accounts={data.devices.accounts.ios} label={label} />
      </div>
      {answered.length ? <Trend series={data.series} label={label} /> : null}
      {/* Under the card: the all-time number of each store (or why it is missing), then what the second unit means. */}
      <p className="store-foot">
        <StoreFoot name="App Store" store={apple} />
        <StoreFoot name="Google Play" store={google} />
        <span>أرقام المتاجر تُنشر بتأخير يوم تقريبًا</span>
        <span>الحسابات المسجّلة = حسابات سجّلت دخولها على جهاز من هذا النظام، وتُعرض منفصلة ولا تُجمع مع التحميلات</span>
      </p>
    </section>
  );
}
