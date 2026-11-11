import { useId, useState, type ReactNode } from 'react';

import { api } from '../api';
import { formatDay, formatDays, formatNumber } from '../format';
import type { Downloads as DownloadsData, HubStats, StoreDownloads } from '../types';
import { Skeleton, useLoad, useShell } from '../ui';

/**
 * M158 (owner, 2026-10-30): «أعرف كام عميل حمّل التطبيق… أول لما أفتح… جراف… بشكل ملكي خاص جدًا بلوجو Google وiOS…
 * كام هنا وكام هنا والإجمالي». The first card on the home: Google Play and App Store marks, a number under each,
 * the total, and the trend line.
 * M228 (owner, 2026-11-11): two units that never mix — store downloads, and the accounts signed in on a phone.
 * M230 (owner, 2026-11-11: «المسجلون غير إجمالي التحميلات وأنا تايه… بفتحه قدّام الشركاء عايزه يبان بأفضل صورة»): the word
 * «المسجّلة» sat on two different numbers. Now each number has ONE name: التحميلات (the stores), الحسابات المسجّلة
 * (the hub's confirmed accounts), الأعضاء المشتركون — told as one story, then a line per store whose second number is
 * «حسابات فعّالة على الهاتف» (accounts signed in on a phone with notifications on, a part of the registered).
 * The total carries both store logos side by side, always in their original colours.
 * Owner, firm: only the real numbers that arrive from the stores and the app are ever shown — nothing can be typed or
 * edited from this card (a hand-typed Google figure was built and removed the same day). While Google has not issued its
 * installs report the card says so calmly and fills itself the day the report exists.
 * Every sentence on the card has to stay true in front of partners: a store's number says which days it covers, a day
 * a store has not published yet is never drawn as a zero, and the registered and subscribed numbers stand on their own
 * when the stores' request fails.
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

/**
 * Why a store shows no number, in calm plain Arabic (the store's own answer stays in the server log, never on this card).
 * `auto` is true only for a report the store has not issued yet (its folder is empty): that case alone is promised to
 * arrive by itself. A store that is not linked, refuses the read, cannot be read, or whose folder holds files under
 * another name is only «not included yet» elsewhere on the card, so the row, the note under the total and the trend
 * legend never tell three different stories about one state.
 */
function pending(name: string, store: StoreDownloads): { row: string; auto: boolean } {
  if (!store.configured) return { row: 'لم يُربط المتجر بعد', auto: false };
  const error = store.error ?? '';
  if (!error) return { row: `بانتظار رد ${name}`, auto: false };
  // «no installs report …; the installs folder holds N files»: 0 = nothing issued yet; more = files the server does not ask for, which no waiting cures.
  if (/no installs report/.test(error)) return /holds 0 files/.test(error) ? { row: `يظهر تلقائيًا فور صدور تقرير ${name}`, auto: true } : { row: `تعذّرت قراءة أرقام ${name}`, auto: false };
  // Every store client words a refusal as «… answered <status> …» (server/src/downloads).
  const status = Number(/answered (\d{3})\b/.exec(error)?.[1] ?? 0);
  if (status === 401 || status === 403) return { row: 'صلاحية القراءة غير مفعّلة بعد', auto: false };
  // Only a failure that can pass by itself is called temporary: the store's own side (5xx, 429) or the network.
  const passing = status >= 500 || status === 429 || (status === 0 && /fetch failed|timeout|aborted|network|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(error));
  return { row: passing ? `تعذّر الاتصال بـ ${name} مؤقتًا` : `تعذّرت قراءة أرقام ${name}`, auto: false };
}

/** What a store's number covers: from its first download (or the launch) to the last day the store has published. */
function covers(store: StoreDownloads): string {
  const from = store.since ? `من ${formatDay(store.since, 'short')}` : 'منذ الإطلاق';
  return store.latest ? `تحميل ${from} حتى ${formatDay(store.latest, 'short')}` : `تحميل ${from}`;
}

function Step({ label, value, extra, notes, tone, onOpen }: { label: string; value: string; extra?: ReactNode; notes: string[]; tone?: 'gold' | 'outline'; onOpen?: () => void }) {
  const body = (
    <>
      <span className="funnel-label">{label}</span>
      <strong className="funnel-value num">{value}</strong>
      {extra}
      {notes.map((note) => (
        <span key={note} className="funnel-note">{note}</span>
      ))}
    </>
  );
  const name = `funnel-step${tone ? ` ${tone}` : ''}`;
  return onOpen ? <button type="button" className={name} onClick={onOpen}>{body}</button> : <div className={name}>{body}</div>;
}

/** M230 (owner): the total carries both store logos side by side, Google on the right as in the first design, always in their own original colours (never greyed: the note under the number says which store is still pending). */
function TotalMarks() {
  return (
    <span className="funnel-marks" aria-hidden="true">
      <span className="funnel-logo"><PlayMark /></span>
      <span className="funnel-plus">+</span>
      <span className="funnel-logo"><AppleMark /></span>
    </span>
  );
}

/** The chevron between two steps: points left, the way an Arabic page reads on. */
function Arrow() {
  return (
    <span className="funnel-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function StoreRow({ mark, name, figure, caption, accounts }: { mark: ReactNode; name: string; figure: number | null; caption: string; accounts: number }) {
  return (
    <div className="store-row">
      <div className="store-id">
        {mark}
        <span className="store-name">{name}</span>
      </div>
      <div className="store-figure">
        <strong className={figure === null ? 'store-num off' : 'store-num num'}>{figure === null ? '—' : formatNumber(figure)}</strong>
        <span className="store-caption">{caption}</span>
      </div>
      <div className="store-figure">
        <strong className="store-num small num">{formatNumber(accounts)}</strong>
        <span className="store-caption">حسابات فعّالة على الهاتف</span>
      </div>
    </div>
  );
}

type TrendPoint = { day: string; android: number | null; ios: number | null; total: number | null };

/**
 * The days of the range as the trend draws them. A day a store has no number for is not a zero (both stores publish a
 * day or more late, a store that stopped answering keeps its last day, and nothing is known before its first stored
 * day): the server answers null for such a day, each store's line also ends at its last published day whatever an
 * older server sends, and the sum is drawn only for the days every store on the chart has a number for.
 */
function trendPoints(data: DownloadsData): TrendPoint[] {
  const { apple, google } = data.stores;
  const upTo = (value: number | null, day: string, latest: string | null): number | null => (value !== null && latest !== null && day <= latest ? value : null);
  const rows = data.series.map((point) => ({ day: point.day, android: upTo(point.android, point.day, google.latest), ios: upTo(point.ios, point.day, apple.latest) }));
  const hasAndroid = rows.some((row) => row.android !== null);
  const hasIos = rows.some((row) => row.ios !== null);
  return rows.map((row) => ({ ...row, total: hasAndroid && hasIos ? (row.android !== null && row.ios !== null ? row.android + row.ios : null) : hasAndroid ? row.android : row.ios }));
}

/** The trend of the answer's own range: store downloads per day. A store with no published day in the range has no line and says why; gold = the sum when both have one. */
function Trend({ data }: { data: DownloadsData }) {
  const id = useId();
  const { apple, google } = data.stores;
  const points = trendPoints(data);
  const hasAndroid = points.some((point) => point.android !== null);
  const hasIos = points.some((point) => point.ios !== null);
  if (!hasAndroid && !hasIos) return null;
  const both = hasAndroid && hasIos;
  const width = 560;
  const height = 120;
  const pad = { x: 6, top: 10, bottom: 22 };
  const base = height - pad.bottom;
  const max = Math.max(1, ...points.flatMap((point) => [point.total ?? 0, point.android ?? 0, point.ios ?? 0]));
  const stepX = points.length > 1 ? (width - pad.x * 2) / (points.length - 1) : 0;
  const x = (index: number) => (pad.x + index * stepX).toFixed(1);
  const y = (value: number) => (pad.top + (base - pad.top) * (1 - value / max)).toFixed(1);
  // One stretch per unbroken run of published days, as [index, value] pairs.
  const runs = (pick: (point: TrendPoint) => number | null): [number, number][][] => {
    const out: [number, number][][] = [];
    let run: [number, number][] = [];
    points.forEach((point, index) => {
      const value = pick(point);
      if (value !== null) return void run.push([index, value]);
      if (run.length) out.push(run);
      run = [];
    });
    if (run.length) out.push(run);
    return out;
  };
  // A lone day is a round-capped zero-length stroke, so it still shows as a dot.
  const trace = (run: [number, number][]) => (run.length === 1 ? `M${x(run[0]![0])},${y(run[0]![1])} h0.01` : run.map(([index, value], at) => `${at === 0 ? 'M' : 'L'}${x(index)},${y(value)}`).join(' '));
  const line = (pick: (point: TrendPoint) => number | null) => runs(pick).map(trace).join(' ');
  const totalRuns = runs((point) => point.total);
  const area = totalRuns.filter((run) => run.length > 1).map((run) => `${trace(run)} L${x(run[run.length - 1]![0])},${base} L${x(run[0]![0])},${base} Z`).join(' ');
  const lastRun = totalRuns[totalRuns.length - 1];
  const end = lastRun?.[lastRun.length - 1];
  const first = points[0];
  const last = points[points.length - 1];
  const period = formatDays(data.range);
  // Why a store has no line: it never answered (the same reading as its row), or its published days end before this range.
  const missing = (name: string, store: StoreDownloads, drawn: boolean): string | null => {
    if (drawn) return null;
    if (store.installs === null) return pending(name, store).auto ? `${name}: يظهر هنا عند صدور تقريره` : `${name}: غير مشمول بعد`;
    return `${name}: لا توجد أيام منشورة في هذه الفترة`;
  };
  const notes = [missing('Google Play', google, hasAndroid), missing('App Store', apple, hasIos)].filter((note): note is string => note !== null);
  return (
    <figure className="store-trend">
      <figcaption className="store-trend-title">التحميلات اليومية من المتاجر · آخر {period}</figcaption>
      {/* The drawing stretches to the card's width at a fixed height (phones would otherwise get a 70px strip);
          strokes never scale, and the end dot is a round-capped zero-length stroke so it stays round. */}
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`تحميلات المتاجر يوميًا خلال آخر ${period}`}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e7ad3f" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#e7ad3f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad.x} x2={width - pad.x} y1={base} y2={base} className="store-trend-base" vectorEffect="non-scaling-stroke" />
        {area ? <path d={area} fill={`url(#${id}-fill)`} /> : null}
        {both ? <path d={line((point) => point.android)} className="store-trend-line android" vectorEffect="non-scaling-stroke" /> : null}
        {both ? <path d={line((point) => point.ios)} className="store-trend-line ios" vectorEffect="non-scaling-stroke" /> : null}
        <path d={line((point) => point.total)} className="store-trend-line total" vectorEffect="non-scaling-stroke" />
        {end ? (
          <>
            <path d={`M${x(end[0])},${y(end[1])} h0.01`} className="store-trend-dot ring" vectorEffect="non-scaling-stroke" />
            <path d={`M${x(end[0])},${y(end[1])} h0.01`} className="store-trend-dot" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
      <div className="store-ticks" aria-hidden="true">
        <span>{first ? formatDay(first.day, 'short') : ''}</span>
        <span>{last ? formatDay(last.day, 'short') : ''}</span>
      </div>
      <div className="store-legend">
        {both ? (
          <>
            <span><i className="swatch total" /> إجمالي التحميلات</span>
            <span><i className="swatch android" /> Google Play</span>
            <span><i className="swatch ios" /> App Store</span>
          </>
        ) : (
          <span><i className="swatch total" /> تحميلات {hasIos ? 'App Store' : 'Google Play'} يوميًا</span>
        )}
        {notes.map((note) => (
          <span key={note} className="store-legend-wait">{note}</span>
        ))}
      </div>
    </figure>
  );
}

/** «منهم 2 بعضوية شرفية» — honorary members never expire, so «بلا تاريخ انتهاء» only adds the others. */
function memberNotes(hub: HubStats | null): string[] {
  if (!hub) return [];
  const { members_honorary: honorary = 0, members_no_expiry: noExpiry = 0 } = hub.totals;
  const parts = [honorary > 0 ? `${formatNumber(honorary)} بعضوية شرفية` : '', noExpiry > honorary ? `${formatNumber(noExpiry - honorary)} بلا تاريخ انتهاء` : ''].filter(Boolean);
  return parts.length ? [`منهم ${parts.join(' و')}`] : [];
}

/**
 * `hub` comes with the home's own answer; the stores' numbers are this card's request. `stamp` moves whenever the home
 * asks again and `onRefresh` makes it ask, so the card is never refreshed by halves: «حدّث الآن» also brings the
 * registered and subscribed numbers, and the home's refresh also re-reads the stores and the phone accounts.
 */
export function DownloadsCard({ days, hub, stamp, onRefresh }: { days: number; hub: HubStats | null; stamp: string; onRefresh: () => void }) {
  const { openMembers } = useShell();
  const state = useLoad(() => api.downloads(days), [days, stamp]);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      await api.downloadsSnapshot(days);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };
  // The registered and subscribed numbers never wait for the stores' request, and stay when it fails.
  const data = state.data;
  const failed = !data && state.error !== null && !state.loading;

  // Since launch, from the stores that have answered; `complete` only when both did.
  const downloadsNotes = (): string[] => {
    if (!data) return [failed ? 'أرقام المتاجر غير متاحة الآن' : 'جارٍ التحميل…'];
    if (data.installs.allTime === null) return ['بانتظار أرقام المتجرين'];
    if (data.installs.complete) return ['من المتجرين منذ الإطلاق'];
    const { apple, google } = data.stores;
    const [have, name, store] = apple.allTime !== null ? (['App Store', 'Google Play', google] as const) : (['Google Play', 'App Store', apple] as const);
    return [`من ${have} فقط حتى الآن`, pending(name, store).auto ? `يُضاف ${name} تلقائيًا فور صدور تقريره` : `لا يشمل ${name} بعد`];
  };

  return (
    <section className="card royal downloads" aria-labelledby="downloads-title">
      <header className="downloads-head">
        <div>
          <p className="royal-kicker">Investors Club</p>
          <h2 id="downloads-title">من التحميل إلى الاشتراك</h2>
          <p className="royal-sub">كم حمّل التطبيق، وكم أنشأ حسابًا، وكم اشترك</p>
        </div>
        <button type="button" className="chip royal-chip" onClick={() => void refresh()} disabled={busy || state.loading}>
          {busy ? 'جارٍ التحديث…' : 'حدّث الآن'}
        </button>
      </header>

      <div className="funnel">
        <Step label="التحميلات" value={formatNumber(data?.installs.allTime)} extra={<TotalMarks />} notes={downloadsNotes()} tone="gold" />
        <Arrow />
        {/* The hub counts an account once it is confirmed (or has paid): the ones still waiting for their code are the tile below, and «اليوم» counts today's confirmations, so it is a part of this number. */}
        <Step label="الحسابات المسجّلة" value={formatNumber(hub?.totals.accounts)} notes={hub ? ['حسابات اكتمل تسجيلها وتأكيدها', `منها اليوم: ${formatNumber(hub.today.verified)}`] : []} onOpen={() => openMembers('all')} />
        <Arrow />
        <Step label="الأعضاء المشتركون" value={formatNumber(hub?.totals.members_active)} notes={hub ? ['عضوية سارية في النادي', ...memberNotes(hub)] : []} tone="outline" onOpen={() => openMembers('member')} />
      </div>

      {data ? (
        <>
          <div className="store-rows">
            <StoreRow
              mark={<AppleMark />}
              name="App Store"
              figure={data.stores.apple.allTime}
              caption={data.stores.apple.allTime !== null ? covers(data.stores.apple) : pending('App Store', data.stores.apple).row}
              accounts={data.devices.accounts.ios}
            />
            <StoreRow
              mark={<PlayMark />}
              name="Google Play"
              figure={data.stores.google.allTime}
              caption={data.stores.google.allTime !== null ? covers(data.stores.google) : pending('Google Play', data.stores.google).row}
              accounts={data.devices.accounts.android}
            />
          </div>

          <Trend data={data} />

          <p className="store-foot">
            <span>المتاجر تنشر أرقامها بتأخير يوم أو أكثر</span>
            <span>الحسابات الفعّالة على الهاتف: حسابات سجّلت دخولها من التطبيق وفعّلت الإشعارات، وهي جزء من الحسابات المسجّلة</span>
          </p>
        </>
      ) : failed ? (
        <div className="store-wait" role="alert">
          <span>تعذّر تحميل أرقام المتاجر. حاول مرة أخرى بعد قليل.</span>
          <button type="button" className="chip royal-chip" onClick={state.reload}>إعادة المحاولة</button>
        </div>
      ) : (
        <Skeleton rows={3} />
      )}
    </section>
  );
}
