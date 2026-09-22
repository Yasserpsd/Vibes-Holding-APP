import { useMemo, useState, type FormEvent } from 'react';

import { api } from '../api';
import { formatNumber, formatRelative } from '../format';
import type { ContentValue } from '../types';
import { Async, Chips, Pill, SearchBox, SectionHead, messageOf, useDebounced, useLoad, useShell } from '../ui';

/** The last path segment as the owner reads it; anything unknown shows its raw path beside it. */
const SEGMENT_LABELS: Record<string, string> = {
  amount: 'السعر (ريال)',
  memberAmount: 'سعر الأعضاء (ريال)',
  order: 'ترتيب الظهور',
  phone: 'رقم واتساب',
  infoUrl: 'رابط التفاصيل',
  channelUrl: 'رابط القناة',
  onlineUrl: 'رابط الحضور عن بُعد',
  url: 'الرابط',
  website: 'الموقع',
  mapUrl: 'رابط الخريطة',
  videoUrl: 'رابط الفيديو',
  imageUrl: 'رابط الصورة',
  lat: 'خط العرض',
  lng: 'خط الطول',
  capacity: 'السعة',
  days: 'عدد الأيام',
  resultsVisible: 'إظهار النتائج',
  comingSoon: 'قريبًا (غير متاح بعد)',
  portfolioValueSarMillions: 'قيمة المحفظة (مليون ريال)',
  valuationSarMillions: 'التقييم (مليون ريال)',
  offerUrl: 'رابط العرض',
  logoUrl: 'رابط الشعار',
};

const label = (path: string): string => SEGMENT_LABELS[path.split('.').pop() ?? ''] ?? (path.split('.').pop() ?? path);
const contextOf = (path: string): string => path.split('.').slice(0, -1).join(' · ');

function ValueRow({ item, onSaved }: { item: ContentValue; onSaved: () => void }) {
  const { notify } = useShell();
  const [draft, setDraft] = useState(String(item.value));
  const [busy, setBusy] = useState(false);
  const changed = item.seedValue !== null && item.value !== item.seedValue;

  const save = async (value: number | string | boolean | null) => {
    setBusy(true);
    try {
      const saved = await api.saveContentValue({ block: item.block, path: item.path, value });
      notify('ok', 'تم الحفظ. تصل القيمة الجديدة للتطبيقات المفتوحة خلال ثوانٍ.');
      setDraft(String(saved.value));
      onSaved();
    } catch (failure) {
      notify('error', messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (item.kind === 'number') {
      const value = Number(draft);
      if (!Number.isFinite(value)) return notify('error', 'اكتب رقمًا صحيحًا');
      return void save(value);
    }
    return void save(draft.trim());
  };

  return (
    <li className="value-row">
      <div className="value-main">
        <div className="row">
          <strong>{label(item.path)}</strong>
          <span className="pills">
            {changed ? <Pill tone="gold">معدّلة</Pill> : null}
            {item.edit ? <span className="muted hint">عدّلها {item.edit.by} {formatRelative(item.edit.at)}</span> : null}
          </span>
        </div>
        <bdi dir="ltr" className="muted hint">{contextOf(item.path) || item.block}</bdi>
        {item.kind === 'switch' ? (
          <div className="row start">
            <button type="button" role="switch" aria-checked={item.value === true} aria-label={label(item.path)} className={item.value === true ? 'switch on' : 'switch'} disabled={busy} onClick={() => void save(item.value !== true)}>
              <i aria-hidden="true" />
            </button>
            <span className="muted hint">{item.value === true ? 'مفعّل' : 'موقوف'}</span>
          </div>
        ) : (
          <form className="value-form" onSubmit={submit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              inputMode={item.kind === 'number' ? 'decimal' : item.kind === 'phone' ? 'tel' : 'url'}
              dir="ltr"
              aria-label={label(item.path)}
            />
            <button type="submit" className="primary" disabled={busy || draft === String(item.value)}>حفظ</button>
          </form>
        )}
        {changed ? (
          <button type="button" className="link" disabled={busy} onClick={() => void save(null)}>
            رجوع للقيمة الأصلية ({typeof item.seedValue === 'boolean' ? (item.seedValue ? 'مفعّل' : 'موقوف') : typeof item.seedValue === 'number' ? formatNumber(item.seedValue) : String(item.seedValue)})
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * M33 «القيم والأسعار»: what the texts editor leaves out — أسعار الخدمات، أرقام الواتساب، الروابط،
 * ترتيب الظهور والمفاتيح — straight from the same blocks the app reads. Names, icons and adding or
 * removing rows stay code-side on purpose: they can break how the app draws or routes.
 */
export function Values() {
  const [block, setBlock] = useState('all');
  const [query, setQuery] = useState('');
  const settled = useDebounced(query);
  const state = useLoad(() => api.contentValues(), []);
  const filtered = useMemo(() => {
    const items = state.data?.items ?? [];
    const wanted = settled.trim().toLowerCase();
    return items
      .filter((item) => block === 'all' || item.block === block)
      .filter((item) => !wanted || item.path.toLowerCase().includes(wanted) || label(item.path).includes(wanted) || String(item.value).toLowerCase().includes(wanted));
  }, [state.data, block, settled]);
  const blocks = state.data?.blocks ?? [];
  return (
    <div className="stack">
      <SectionHead title="القيم والأسعار" hint="أسعار الخدمات وأرقام الواتساب والروابط وترتيب الظهور، من نفس الأقسام التي يقرأها التطبيق." onReload={state.reload} busy={state.loading} />
      <div className="filters">
        <Chips label="القسم" options={[{ value: 'all', label: 'كل الأقسام' }, ...blocks.map((entry) => ({ value: entry.key, label: entry.label, count: entry.count }))]} value={block} onChange={setBlock} />
        <SearchBox value={query} onChange={setQuery} placeholder="ابحث بالاسم أو القيمة أو المسار…" />
      </div>
      <Async state={state} rows={5} empty={() => filtered.length === 0} emptyText="لا توجد قيم مطابقة.">
        {() => (
          <section className="card">
            <p className="muted hint">أسعار وأرقام وروابط ومفاتيح تصل للتطبيق فورًا. النصوص نفسها تُعدَّل من تبويب «النصوص»، وإضافة خدمة أو صف جديد ما زالت من الكود.</p>
            <ul className="list values">
              {filtered.map((item) => (
                <ValueRow key={`${item.block}|${item.path}`} item={item} onSaved={state.reload} />
              ))}
            </ul>
          </section>
        )}
      </Async>
    </div>
  );
}
