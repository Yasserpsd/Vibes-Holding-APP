import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GlobeInstance } from 'globe.gl';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

import { api } from '../api';
import { CODE_BY_NAME, CODE_BY_NUMERIC } from '../countryIso';
import { formatNumber } from '../format';
import { isEn } from '../i18n';
import type { CountriesResult, CountryCount } from '../types';
import { Async, Chips, SearchBox, SectionHead, useLoad } from '../ui';
import { MemberRow } from './Members';
import atlasUrl from 'world-atlas/countries-50m.json?url';

/** M284 «خريطة الأعضاء» (owner, 2026-11-27): a 3D globe of the accounts by the country of their phone, a ranked chart below. */
type Spot = { lat: number; lng: number };
type Shape = Feature<Polygon | MultiPolygon, { name: string }> & { code: string; center: Spot };
type Bar = Spot & { row: CountryCount; t: number };

const RIYADH: Spot = { lat: 24.71, lng: 46.68 };
const HOME_VIEW = { lat: 22, lng: 38, altitude: 2.3 };
const regionNames = (() => {
  try {
    return new Intl.DisplayNames([isEn ? 'en' : 'ar'], { type: 'region' });
  } catch {
    return null;
  }
})();

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nameOf = (row: CountryCount) => (isEn ? row.nameEn : row.name);
const share = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '—');

/** Centre of the largest outer ring (shoelace), good enough to stand a bar on and fly to. */
function centreOf(geometry: Polygon | MultiPolygon): Spot {
  const polygons: Position[][][] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = { area: -1, lat: 0, lng: 0 };
  for (const polygon of polygons) {
    const ring = polygon[0] ?? [];
    let area = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x0 = 0, y0 = 0] = ring[i] ?? [];
      const [x1 = 0, y1 = 0] = ring[i + 1] ?? [];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      x += (x0 + x1) * cross;
      y += (y0 + y1) * cross;
    }
    if (Math.abs(area) > best.area && area !== 0) best = { area: Math.abs(area), lng: x / (3 * area), lat: y / (3 * area) };
  }
  return { lat: best.lat, lng: best.lng };
}

async function loadWorld(): Promise<{ Globe: typeof import('globe.gl').default; shapes: Shape[] }> {
  const [{ default: Globe }, topo, atlas] = await Promise.all([
    import('globe.gl'),
    import('topojson-client'),
    fetch(atlasUrl).then((response) => response.json() as Promise<Parameters<typeof import('topojson-client').feature>[0]>),
  ]);
  const collection = topo.feature(atlas, atlas.objects.countries as never) as unknown as { features: Feature<Polygon | MultiPolygon, { name: string }>[] };
  const shapes = collection.features
    .filter((feature) => feature.properties.name !== 'Antarctica')
    .map((feature) => ({ ...feature, code: CODE_BY_NUMERIC.get(String(feature.id ?? '')) ?? CODE_BY_NAME[feature.properties.name] ?? '', center: centreOf(feature.geometry) }));
  return { Globe, shapes };
}

export function MembersMap() {
  const state = useLoad(() => api.countries(), []);
  return (
    <section className="section">
      <SectionHead title="خريطة الأعضاء" hint="كل الحسابات المسجّلة حسب دولة رقم الجوال. حرّك الكرة بالماوس، كبّر بالعجلة، وقف على أي دولة يظهر عددها." onReload={state.reload} busy={state.loading} />
      <Async state={state} rows={6}>
        {(data) => <MapBody data={data} />}
      </Async>
    </section>
  );
}

function MapBody({ data }: { data: CountriesResult }) {
  const [selected, setSelected] = useState<string | null>(null);
  const withPhone = data.items.reduce((sum, row) => sum + row.total, 0);
  const max = data.items[0]?.total ?? 0;
  const top = data.items[0];
  const selectedRow = data.items.find((row) => row.code === selected) ?? null;
  const rank = selectedRow ? data.items.indexOf(selectedRow) + 1 : 0;
  // M284b: the country whose accounts are listed under the globe (`none` = the accounts without a phone).
  const [listed, setListed] = useState<string | null>(null);
  const listBox = useRef<HTMLDivElement>(null);
  const toList = () => requestAnimationFrame(() => listBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const choose = (code: string | null) => {
    setSelected(code);
    setListed(code);
  };
  const listedRow = data.items.find((row) => row.code === listed) ?? null;

  return (
    <div className="map-page">
      <div className="tiles map-tiles">
        <Tile label="الحسابات المسجّلة" value={formatNumber(data.total)} />
        <Tile label="عدد الدول" value={formatNumber(data.items.length)} />
        <Tile label="الأكثر تسجيلًا" value={top ? nameOf(top) : '—'} note={top ? `${formatNumber(top.total)} · ${share(top.total, withPhone)}` : undefined} />
        <Tile label="بدون رقم جوال" value={formatNumber(data.noPhone + data.unknown)} />
      </div>

      <GlobeView data={data} selected={selected} onSelect={choose}>
        {selectedRow ? (
          <div className="map-card">
            <button type="button" className="map-card-close" onClick={() => choose(null)} aria-label="إغلاق">×</button>
            <span className="map-card-rank num">#{rank}</span>
            <strong className="map-card-name">{nameOf(selectedRow)}</strong>
            <bdi dir="ltr" className="map-dial num">+{selectedRow.dial}</bdi>
            <div className="map-card-stats">
              <span><b className="num">{formatNumber(selectedRow.total)}</b> حساب</span>
              <span><b className="num">{formatNumber(selectedRow.members)}</b> عضو</span>
              <span><b className="num">{share(selectedRow.total, withPhone)}</b> من الإجمالي</span>
            </div>
            <button type="button" className="map-card-list" onClick={toList}>
              عرض المسجّلين ↓
            </button>
          </div>
        ) : null}
      </GlobeView>

      {listed ? (
        <div ref={listBox} className="map-list-anchor">
          <CountryList key={listed} code={listed} title={listedRow ? nameOf(listedRow) : 'بدون رقم جوال'} onClose={() => choose(null)} />
        </div>
      ) : null}

      <div className="card map-chart">
        <div className="map-chart-head">
          <h2>الحسابات حسب الدولة</h2>
          <span className="muted">مرتّبة من الأكثر للأقل — اضغط على أي دولة لتذهب إليها على الكرة</span>
        </div>
        {data.items.length ? (
          <ol className="map-rows">
            {data.items.map((row, index) => (
              <li key={row.code}>
                <button type="button" className={row.code === selected ? 'map-row on' : 'map-row'} onClick={() => {
                    choose(row.code);
                    toList();
                  }}>
                  <span className="map-row-rank num">{index + 1}</span>
                  <span className="map-row-name">
                    {nameOf(row)} <bdi dir="ltr" className="map-dial num">+{row.dial}</bdi>
                  </span>
                  <span className="map-row-track">
                    <span className="map-row-fill" style={{ inlineSize: `${Math.max(2, (row.total / (max || 1)) * 100)}%`, animationDelay: `${Math.min(index, 20) * 40}ms` }} />
                  </span>
                  <span className="map-row-count num">{formatNumber(row.total)}</span>
                  <span className="map-row-share num muted">{share(row.total, withPhone)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="state-card empty">لا توجد حسابات بأرقام جوال بعد.</p>
        )}
        {data.noPhone + data.unknown ? (
          <p className="muted map-foot">
            {formatNumber(data.noPhone)} حساب بدون رقم جوال{data.unknown ? ` · ${formatNumber(data.unknown)} برقم لم نتعرّف على دولته` : ''} — لا تظهر على الخريطة.{' '}
            {data.noPhone ? (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  choose(null);
                  setListed('none');
                  toList();
                }}
              >
                عرض الحسابات بدون رقم
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Only = 'all' | 'member';
const ONLY: { value: Only; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'member', label: 'الأعضاء فقط' },
];

/** M284b (owner: «ادوس علي الدولة اشوف كل المسجلين فيها»): the country's accounts, newest first; a tap opens the member sheet. */
function CountryList({ code, title, onClose }: { code: string; title: string; onClose: () => void }) {
  const state = useLoad(() => api.countryAccounts(code), [code]);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<Only>('all');
  return (
    <div className="card map-list">
      <div className="map-list-head">
        <div>
          <span className="muted map-list-kicker">المسجّلون</span>
          <h2>{title}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق القائمة">×</button>
      </div>
      <div className="map-list-tools">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو الرقم" />
        <Chips label="عرض" options={ONLY} value={only} onChange={setOnly} />
      </div>
      <Async state={state} rows={4}>
        {(data) => {
          const needle = q.trim().toLowerCase();
          const rows = data.items.filter(
            (account) => (only === 'all' || account.state === 'member') && (!needle || `${account.name} ${account.phone} ${account.email}`.toLowerCase().includes(needle)),
          );
          return (
            <>
              <p className="muted map-list-count">
                <b className="num">{formatNumber(rows.length)}</b> من <b className="num">{formatNumber(data.items.length)}</b> حساب
              </p>
              {rows.length ? (
                <ul className="member-list">
                  {rows.map((account) => <MemberRow key={account.id} account={account} />)}
                </ul>
              ) : (
                <p className="state-card empty">لا توجد نتائج.</p>
              )}
            </>
          );
        }}
      </Async>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <strong className="tile-value num">{value}</strong>
      {note ? <span className="tile-note num">{note}</span> : null}
    </div>
  );
}

function GlobeView({ data, selected, onSelect, children }: { data: CountriesResult; selected: string | null; onSelect: (code: string | null) => void; children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeInstance | null>(null);
  const shapesRef = useRef<Shape[]>([]);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [spinning, setSpinning] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  const rows = useMemo(() => new Map(data.items.map((row) => [row.code, row])), [data]);
  const total = data.items.reduce((sum, row) => sum + row.total, 0);
  const max = data.items[0]?.total ?? 1;
  const level = (count: number) => Math.log1p(count) / Math.log1p(max || 1);
  /** Countries with accounts stand up from the globe, higher with more accounts. */
  const height = (t: number) => 0.02 + 0.11 * t;

  // Build the globe once per answer.
  useEffect(() => {
    let alive = true;
    let observer: ResizeObserver | null = null;
    loadWorld().then(
      ({ Globe, shapes }) => {
        const element = box.current;
        if (!alive || !element) return;
        shapesRef.current = shapes;
        const world = new Globe(element, { rendererConfig: { antialias: true, alpha: true } });
        globe.current = world;
        const centres = new Map(shapes.filter((shape) => shape.code).map((shape) => [shape.code, shape.center]));
        const bars: Bar[] = data.items.flatMap((row) => {
          const spot = centres.get(row.code);
          return spot ? [{ ...spot, row, t: level(row.total) }] : [];
        });
        const label = (code: string, fallback: string) => {
          const row = rows.get(code);
          const name = row ? nameOf(row) : (code && regionNames?.of(code.toUpperCase())) || fallback;
          const body = row
            ? `<div class="gl-count">${formatNumber(row.total)} <small>${isEn ? 'accounts' : 'حساب'}</small></div><div class="gl-sub">${formatNumber(row.members)} ${isEn ? 'members' : 'عضو'} · ${share(row.total, total)}</div>`
            : `<div class="gl-sub">${isEn ? 'No accounts yet' : 'لا توجد حسابات بعد'}</div>`;
          return `<div class="gl-tip" dir="${isEn ? 'ltr' : 'rtl'}"><div class="gl-name">${esc(name)}</div>${body}</div>`;
        };

        world
          .backgroundColor('rgba(0,0,0,0)')
          .showAtmosphere(true)
          .atmosphereColor('#d9b54a')
          .atmosphereAltitude(0.18)
          .polygonsData(shapes)
          .polygonSideColor(() => 'rgba(201, 162, 39, 0.28)')
          .polygonsTransitionDuration(350)
          .polygonLabel((shape) => label((shape as Shape).code, (shape as Shape).properties.name))
          .onPolygonHover((shape) => setHovered(shape ? (shape as Shape).code || `~${(shape as Shape).properties.name}` : null))
          .onPolygonClick((shape) => {
            const code = (shape as Shape).code;
            select.current(rows.has(code) ? code : null);
          })
          .arcsData(bars.filter((bar) => bar.row.code !== 'sa').map((bar) => ({ startLat: RIYADH.lat, startLng: RIYADH.lng, endLat: bar.lat, endLng: bar.lng, t: bar.t })))
          .arcColor(() => ['rgba(255, 224, 138, 0.95)', 'rgba(255, 224, 138, 0.12)'])
          .arcStroke((arc) => 0.25 + 0.45 * (arc as { t: number }).t)
          .arcDashLength(0.45)
          .arcDashGap(0.25)
          .arcDashInitialGap(() => Math.random())
          .arcDashAnimateTime(2600)
          .arcAltitudeAutoScale(0.42)
          .ringsData(bars.slice(0, 8))
          .ringLat('lat')
          .ringLng('lng')
          .ringColor(() => (t: number) => `rgba(255, 214, 102, ${Math.max(0, 1 - t)})`)
          .ringMaxRadius((bar) => 2.5 + 4 * (bar as Bar).t)
          .ringPropagationSpeed(2.2)
          .ringRepeatPeriod(1500)
          .labelsData(bars)
          .labelLat('lat')
          .labelLng('lng')
          .labelText((bar) => String((bar as Bar).row.total))
          .labelSize((bar) => 0.7 + 1.1 * (bar as Bar).t)
          .labelAltitude((bar) => height((bar as Bar).t) + 0.004)
          .labelColor(() => '#fff6d6')
          .labelDotRadius(0)
          .labelResolution(2);

        const material = world.globeMaterial() as unknown as { color?: { set: (c: string) => void }; emissive?: { set: (c: string) => void }; emissiveIntensity?: number; shininess?: number };
        material.color?.set('#0a1830');
        material.emissive?.set('#06101f');
        if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.6;
        if (material.shininess !== undefined) material.shininess = 12;

        const controls = world.controls();
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.45;
        controls.enableDamping = true;
        controls.minDistance = 130;
        controls.maxDistance = 600;
        world.pointOfView(HOME_VIEW, 0);

        const fit = () => world.width(element.clientWidth).height(element.clientHeight);
        fit();
        observer = new ResizeObserver(fit);
        observer.observe(element);
        setReady(true);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      observer?.disconnect();
      globe.current?._destructor();
      globe.current = null;
      if (box.current) box.current.innerHTML = '';
    };
    // The globe is rebuilt only when a new answer arrives; the accessors read the latest rows through closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Colours and heights follow the hover and the selection.
  useEffect(() => {
    const world = globe.current;
    if (!world || !ready) return;
    world
      .polygonCapColor((shape) => {
        const code = (shape as Shape).code;
        const row = rows.get(code);
        const lit = code === selected || (hovered !== null && (code || `~${(shape as Shape).properties.name}`) === hovered);
        if (!row) return lit ? 'rgba(120, 140, 170, 0.75)' : 'rgba(34, 48, 70, 0.92)';
        if (lit) return '#fff1b8';
        const t = level(row.total);
        return `rgba(${Math.round(150 + 105 * t)}, ${Math.round(110 + 90 * t)}, ${Math.round(30 + 40 * t)}, ${0.7 + 0.3 * t})`;
      })
      .polygonStrokeColor((shape) => (rows.has((shape as Shape).code) ? 'rgba(255, 224, 138, 0.9)' : 'rgba(110, 130, 160, 0.35)'))
      .polygonAltitude((shape) => {
        const code = (shape as Shape).code;
        const row = rows.get(code);
        const lit = code === selected || (hovered !== null && (code || `~${(shape as Shape).properties.name}`) === hovered);
        return (row ? height(level(row.total)) : 0.005) + (lit ? 0.02 : 0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hovered, selected, rows]);

  // Fly to the chosen country.
  useEffect(() => {
    const world = globe.current;
    if (!world || !ready || !selected) return;
    const spot = shapesRef.current.find((shape) => shape.code === selected)?.center;
    if (!spot) return;
    world.controls().autoRotate = false;
    setSpinning(false);
    world.pointOfView({ lat: spot.lat, lng: spot.lng, altitude: 1.15 }, 1400);
  }, [ready, selected]);

  const zoom = (factor: number) => {
    const world = globe.current;
    if (!world) return;
    const view = world.pointOfView();
    world.pointOfView({ ...view, altitude: Math.min(4.5, Math.max(0.35, view.altitude * factor)) }, 500);
  };
  const spin = () => {
    const world = globe.current;
    if (!world) return;
    world.controls().autoRotate = !spinning;
    setSpinning(!spinning);
  };
  const reset = () => {
    onSelect(null);
    globe.current?.pointOfView(HOME_VIEW, 1200);
  };

  return (
    <div className="map-stage">
      <div className="map-stars" aria-hidden="true" />
      <div ref={box} className="map-globe" />
      {!ready && !failed ? <div className="map-loading">جاري تجهيز الخريطة…</div> : null}
      {failed ? <div className="map-loading">تعذّر تحميل الخريطة. حدّث الصفحة.</div> : null}
      <div className="map-tools">
        <button type="button" className="map-tool" onClick={() => zoom(0.7)} aria-label="تكبير" title="تكبير">+</button>
        <button type="button" className="map-tool" onClick={() => zoom(1.4)} aria-label="تصغير" title="تصغير">−</button>
        <button type="button" className="map-tool" onClick={spin} aria-label={spinning ? 'إيقاف الدوران' : 'تشغيل الدوران'} title={spinning ? 'إيقاف الدوران' : 'تشغيل الدوران'}>{spinning ? '❚❚' : '▶'}</button>
        <button type="button" className="map-tool" onClick={reset} aria-label="عرض العالم" title="عرض العالم">⟳</button>
      </div>
      <div className="map-legend">
        <span className="muted">أقل</span>
        <span className="map-legend-bar" />
        <span className="muted">أكثر</span>
      </div>
      {children}
    </div>
  );
}
