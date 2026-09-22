import { useState } from 'react';

import { api } from '../api';
import { formatNumber, formatRelative } from '../format';
import type { NewsSourceRow } from '../types';
import { Async, Chips, Pill, SectionHead, messageOf, useLoad, useShell } from '../ui';

type LangFilter = 'ar' | 'en';
const LANGS: { value: LangFilter; label: string }[] = [
  { value: 'ar', label: 'المصادر العربية' },
  { value: 'en', label: 'المصادر الإنجليزية' },
];

const TIER_TONE: Record<NewsSourceRow['tier'], 'gold' | 'ok' | 'muted'> = { official: 'gold', saudi: 'ok', global: 'muted' };

function Health({ source }: { source: NewsSourceRow }) {
  const status = source.status;
  if (!source.enabled) return <span className="muted hint">مطفأ — لا يُقرأ في التحديثات.</span>;
  if (!status) return <span className="muted hint">لم يُقرأ بعد منذ تشغيل الخادم؛ ينضم في التحديث القادم.</span>;
  if (!status.ok) return <span className="error hint">فشل آخر تحديث{status.at ? ` (${formatRelative(status.at)})` : ''}: <bdi dir="ltr">{status.error}</bdi></span>;
  return (
    <span className="muted hint num">
      آخر تحديث {formatRelative(status.at)} · في الخلاصة {formatNumber(status.count)} · محفوظ {formatNumber(status.stored)}
      {status.failed > 0 ? ` · صفحات تعذّر فتحها ${formatNumber(status.failed)}` : ''}
    </span>
  );
}

function SourceRow({ source, busy, onToggle }: { source: NewsSourceRow; busy: boolean; onToggle: (next: boolean) => void }) {
  return (
    <li className="source-row">
      <div className="source-main">
        <div className="row">
          <strong>{source.name}</strong>
          <span className="pills">
            <Pill tone={TIER_TONE[source.tier]}>{source.tierLabel}</Pill>
            {source.saudiOnly ? <Pill>أخبار السعودية فقط</Pill> : null}
          </span>
        </div>
        {source.hint ? <span className="muted hint">{source.hint}</span> : null}
        <Health source={source} />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={source.enabled}
        aria-label={`${source.enabled ? 'إيقاف' : 'تشغيل'} مصدر ${source.name}${source.hint ? ` — ${source.hint}` : ''}`}
        className={source.enabled ? 'switch on' : 'switch'}
        disabled={busy}
        onClick={() => onToggle(!source.enabled)}
      >
        <i aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * M34 «مصادر الأخبار»: the owner turns sources on and off; the list shows each source's last-poll health.
 * Rule 7 untouched: a source only lets its own fetched pages in — nothing here writes a word of news.
 */
export function News() {
  const { notify } = useShell();
  const [lang, setLang] = useState<LangFilter>('ar');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const state = useLoad(() => api.newsSources(), []);

  const toggle = async (source: NewsSourceRow, next: boolean) => {
    setBusy(source.id);
    try {
      await api.toggleNewsSource(source.id, next);
      notify('ok', next ? `تم تشغيل «${source.name}». يظهر أثره في التحديث الجاري الآن.` : `تم إيقاف «${source.name}». ما سبق جمعه يبقى حتى تنتهي مدته.`);
      state.reload();
    } catch (failure) {
      notify('error', messageOf(failure));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshNews();
      notify('ok', 'بدأ تحديث الأخبار في الخلفية. يستغرق دقائق لأن كل خبر تُفتح صفحته الأصلية أولًا؛ حدّث القائمة بعد قليل.');
    } catch (failure) {
      notify('error', messageOf(failure));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <SectionHead title="مصادر الأخبار" hint="شغّل أو أوقف أي مصدر. القاعدة ثابتة: أخبار حقيقية فقط من صفحات فتحها الخادم بنفسه، ولا يكتب الذكاء الاصطناعي خبرًا أبدًا." onReload={state.reload} busy={state.loading}>
        <Chips label="اللغة" options={LANGS} value={lang} onChange={setLang} />
      </SectionHead>
      <Async state={state} rows={5}>
        {(data) => {
          const rows = data.sources.filter((source) => source.lang === lang);
          const on = rows.filter((source) => source.enabled).length;
          return (
            <div className="stack">
              <section className="card">
                <div className="row">
                  <dl className="strip three">
                    <div><dt>مصادر مشغّلة ({lang === 'ar' ? 'عربي' : 'إنجليزي'})</dt><dd className="num">{formatNumber(on)} من {formatNumber(rows.length)}</dd></div>
                    <div><dt>أخبار معروضة الآن</dt><dd className="num">{formatNumber(lang === 'ar' ? data.visibleByLang.ar : data.visibleByLang.en)}</dd></div>
                    <div><dt>آخر تحديث</dt><dd>{data.running ? 'يجري الآن…' : formatRelative(data.updatedAt)}</dd></div>
                  </dl>
                  <button type="button" className="pick" onClick={() => void refresh()} disabled={refreshing || data.running}>
                    تحديث الأخبار الآن
                  </button>
                </div>
                {data.lastError ? <p className="warn">آخر تحديث لم يكتمل: <bdi dir="ltr">{data.lastError}</bdi></p> : null}
              </section>
              <section className="card">
                <ul className="list sources">
                  {rows.map((source) => (
                    <SourceRow key={source.id} source={source} busy={busy === source.id} onToggle={(next) => void toggle(source, next)} />
                  ))}
                </ul>
              </section>
            </div>
          );
        }}
      </Async>
    </>
  );
}
