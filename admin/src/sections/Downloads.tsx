import { useId, useState } from 'react';

import { api } from '../api';
import { formatDay, formatNumber } from '../format';
import type { Downloads as DownloadsData } from '../types';
import { ErrorCard, Skeleton, useLoad } from '../ui';

/**
 * M158 (owner, 2026-10-30): «أعرف كام عميل حمّل التطبيق… أول لما أفتح… جراف… بشكل ملكي خاص جدًا بلوجو Google وiOS…
 * كام هنا وكام هنا والإجمالي». The first card on the home: Google Play and App Store marks, a number under each,
 * the total, and the 30-day line. Honest by mode — signed-in devices until the store keys are set on Railway,
 * the stores' own installs afterwards (the devices then move to the small line).
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

function StoreColumn({ mark, name, value, caption }: { mark: React.ReactNode; name: string; value: number; caption: string }) {
  return (
    <div className="store-col">
      {mark}
      <span className="store-name">{name}</span>
      <strong className="store-value num">{formatNumber(value)}</strong>
      <span className="store-caption">{caption}</span>
    </div>
  );
}

/** The 30-day line: devices (or installs) per platform, gold = total, two thin lines for the stores. */
function Trend({ series }: { series: DownloadsData['series'] }) {
  const id = useId();
  const width = 560;
  const height = 120;
  const pad = { x: 6, top: 10, bottom: 22 };
  const totals = series.map((point) => point.android + point.ios);
  const max = Math.max(1, ...totals);
  const stepX = series.length > 1 ? (width - pad.x * 2) / (series.length - 1) : 0;
  const y = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - value / max);
  const line = (pick: (index: number) => number) => series.map((_, index) => `${index === 0 ? 'M' : 'L'}${(pad.x + index * stepX).toFixed(1)},${y(pick(index)).toFixed(1)}`).join(' ');
  const area = `${line((index) => totals[index]!)} L${(pad.x + (series.length - 1) * stepX).toFixed(1)},${height - pad.bottom} L${pad.x},${height - pad.bottom} Z`;
  const first = series[0];
  const last = series[series.length - 1];
  const endX = (pad.x + (series.length - 1) * stepX).toFixed(1);
  const endY = y(totals[totals.length - 1]!).toFixed(1);
  return (
    <figure className="store-trend">
      {/* The drawing stretches to the card's width at a fixed height (phones would otherwise get a 70px strip);
          strokes never scale, and the end dot is a round-capped zero-length stroke so it stays round. */}
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="اتجاه آخر 30 يومًا">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e7ad3f" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#e7ad3f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad.x} x2={width - pad.x} y1={height - pad.bottom} y2={height - pad.bottom} className="store-trend-base" vectorEffect="non-scaling-stroke" />
        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={line((index) => series[index]!.android)} className="store-trend-line android" vectorEffect="non-scaling-stroke" />
        <path d={line((index) => series[index]!.ios)} className="store-trend-line ios" vectorEffect="non-scaling-stroke" />
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
        <span><i className="swatch total" /> الإجمالي</span>
        <span><i className="swatch android" /> Google Play</span>
        <span><i className="swatch ios" /> App Store</span>
      </figcaption>
    </figure>
  );
}

export function DownloadsCard() {
  const state = useLoad(() => api.downloads(), []);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      await api.downloadsSnapshot();
      state.reload();
    } finally {
      setBusy(false);
    }
  };
  if (state.error && !state.loading) return <ErrorCard error={state.error} onRetry={state.reload} />;
  const data = state.data;
  if (!data) return <Skeleton rows={4} />;
  const stores = data.mode === 'stores';
  // In stores mode a store that has not answered yet still shows its device count — captioned as such.
  const caption = (installs: number | null) => (stores && installs !== null ? 'تحميل من المتجر' : 'جهاز مسجّل');
  const both = stores && data.stores.google.installs !== null && data.stores.apple.installs !== null;
  const pending = [!data.stores.google.configured ? 'Google Play' : null, !data.stores.apple.configured ? 'App Store' : null].filter(Boolean);
  return (
    <section className="card royal downloads" aria-labelledby="downloads-title">
      <header className="downloads-head">
        <div>
          <p className="royal-kicker">Investors Club</p>
          <h2 id="downloads-title">{stores ? 'تحميلات التطبيق من المتجرين' : 'الأجهزة المسجّلة في التطبيق'}</h2>
        </div>
        <button type="button" className="chip royal-chip" onClick={() => void refresh()} disabled={busy || state.loading}>
          {busy ? 'جارٍ التحديث…' : 'حدّث الآن'}
        </button>
      </header>
      <div className="store-grid">
        <StoreColumn mark={<PlayMark />} name="Google Play" value={data.android} caption={caption(data.stores.google.installs)} />
        <div className="store-total">
          <span className="store-name">الإجمالي</span>
          <strong className="store-value big num">{formatNumber(data.total)}</strong>
          <span className="store-caption">{both ? 'تحميل من المتجرين' : stores ? 'متجر + أجهزة' : 'جهاز مسجّل الآن'}</span>
        </div>
        <StoreColumn mark={<AppleMark />} name="App Store" value={data.ios} caption={caption(data.stores.apple.installs)} />
      </div>
      <Trend series={data.series} />
      <p className="store-foot">
        {stores ? (
          <>
            أجهزة مسجّلة الآن: <bdi className="num">{formatNumber(data.devices.android)}</bdi> Android · <bdi className="num">{formatNumber(data.devices.ios)}</bdi> iPhone · حسابات <bdi className="num">{formatNumber(data.devices.accounts.total)}</bdi>
            {data.stores.apple.since ? <> · App Store منذ {formatDay(data.stores.apple.since, 'short')}</> : null}
            {data.stores.google.installs === null ? <> · رقم Google Play لم يصل بعد{data.stores.google.configured ? ' (المتجر لم يكتب تقرير الشهر أو الصلاحية ناقصة)' : ' (مفاتيح Railway غير مضبوطة)'}</> : null}
            {data.stores.apple.installs === null ? <> · رقم App Store لم يصل بعد{data.stores.apple.configured ? ' (تقرير أمس لم يُكتب أو المفتاح بلا صلاحية Sales)' : ' (مفاتيح Railway غير مضبوطة)'}</> : null}
          </>
        ) : (
          <>
            أجهزة سجّلت دخولها في التطبيق (ليست أرقام المتاجر): حسابات <bdi className="num">{formatNumber(data.devices.accounts.android)}</bdi> من Android و <bdi className="num">{formatNumber(data.devices.accounts.ios)}</bdi> من iPhone
            {pending.length ? <> · أرقام المتاجر الحقيقية تظهر بعد ضبط مفاتيح {pending.join(' و')} على Railway</> : null}
          </>
        )}
      </p>
    </section>
  );
}
