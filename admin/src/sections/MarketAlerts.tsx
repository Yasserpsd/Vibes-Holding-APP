import { useState } from 'react';

import { api, type MarketAlertSettings, type MarketGroup } from '../api';
import { Async, Pill, messageOf, sessionOver, useLoad, useShell } from '../ui';

/**
 * M179 «تنبيهات الأسواق»: the advisor pushes when a quote moves sharply against the previous close. The owner sets
 * the on/off switch, the threshold per group, the daily cap per member and the quiet hours (Riyadh). The text uses
 * only the feed's numbers; the same member mute as the daily message applies; TASI always says it is 15 minutes late.
 */
const GROUP_LABEL: Record<MarketGroup, string> = { stocks: 'الأسهم (تاسي)', metals: 'المعادن', oil: 'النفط', fx: 'العملات', crypto: 'العملات الرقمية' };
const GROUPS: MarketGroup[] = ['stocks', 'metals', 'oil', 'fx', 'crypto'];

export function MarketAlerts() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.marketAlerts(), []);
  const [draft, setDraft] = useState<MarketAlertSettings | null>(null);
  const [busy, setBusy] = useState(false);

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await api.saveMarketAlerts(draft);
      notify('ok', 'حُفظت إعدادات تنبيهات الأسواق.');
      setDraft(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (busy) return;
    setBusy(true);
    try {
      const answer = await api.testMarketAlert();
      notify('ok', answer.sent ? 'أُرسل إشعار تجريبي لأجهزتك.' : 'لا يوجد جهاز مسجّل لحسابك لاستلام الإشعار.');
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>تنبيهات الأسواق من المستشار</h3>
      <Async state={state} rows={3} empty={() => !state.data} emptyText="تعذر تحميل الإعدادات.">
        {(data) => {
          const settings = draft ?? data.settings;
          const change = (patch: Partial<MarketAlertSettings>) => setDraft({ ...settings, ...patch });
          return (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {data.enabled ? <Pill tone="ok">الخدمة مفعّلة</Pill> : <Pill tone="muted">الخدمة موقوفة (MARKET_ALERTS=0)</Pill>}
                <Pill tone={data.sentToday.length ? 'gold' : 'muted'}>{`أُرسل اليوم: ${data.sentToday.length}`}</Pill>
              </div>
              <p className="muted">
                يرسل المستشار إشعارًا عند تجاوز التغيّر عن الإغلاق السابق الحدَّ أدناه. النص أرقام السوق الحقيقية فقط مع عبارة «للاطلاع فقط وليست توصية استثمارية»،
                ولكل سعر إشعار واحد في اليوم، ومن أوقف رسائل المستشار اليومية لا يصله شيء.
              </p>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={settings.enabled} onChange={(event) => change({ enabled: event.target.checked })} />
                تشغيل التنبيهات
              </label>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                {GROUPS.map((group) => (
                  <label key={group}>
                    {`${GROUP_LABEL[group]} (%)`}
                    <input
                      type="number"
                      min={0.5}
                      max={50}
                      step={0.5}
                      value={settings.thresholds[group]}
                      onChange={(event) => change({ thresholds: { ...settings.thresholds, [group]: Number(event.target.value) } })}
                    />
                  </label>
                ))}
              </div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <label>
                  أقصى عدد إشعارات في اليوم
                  <input type="number" min={1} max={10} value={settings.dailyCap} onChange={(event) => change({ dailyCap: Number(event.target.value) })} />
                </label>
                <label>
                  بداية ساعات الهدوء (الرياض)
                  <input type="number" min={0} max={23} value={settings.quietFrom} onChange={(event) => change({ quietFrom: Number(event.target.value) })} />
                </label>
                <label>
                  نهاية ساعات الهدوء
                  <input type="number" min={0} max={23} value={settings.quietTo} onChange={(event) => change({ quietTo: Number(event.target.value) })} />
                </label>
              </div>
              <div className="row-actions">
                <button type="button" className="primary" disabled={busy || !draft} onClick={() => void save()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
                <button type="button" className="ghost" disabled={busy || !draft} onClick={() => setDraft(null)}>تراجع</button>
                <button type="button" className="ghost" disabled={busy} onClick={() => void test()}>إرسال تجريبي لجهازي</button>
              </div>
              <h4>الأسعار الآن</h4>
              <ul className="list">
                {data.watching.map((row) => (
                  <li key={row.key} className="value-row">
                    <div className="value-main">
                      <strong>{row.label}</strong>
                      <span className="muted">{` — الحد ${row.threshold}%${row.delayedMin ? ` · متأخر ${row.delayedMin} دقيقة` : ''}`}</span>
                    </div>
                    <Pill tone={row.crossed ? 'gold' : 'muted'}>{`${row.changePct > 0 ? '+' : ''}${row.changePct}%`}</Pill>
                    {data.sentToday.includes(row.key) ? <Pill tone="ok">أُرسل اليوم</Pill> : null}
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </Async>
    </section>
  );
}
