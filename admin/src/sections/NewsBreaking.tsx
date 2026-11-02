import { useState } from 'react';

import { api, type NewsBreakingSettings } from '../api';
import { Async, Pill, messageOf, sessionOver, useLoad, useShell } from '../ui';

/**
 * M182c «إشعار الخبر العاجل»: a push when a fresh money story carries a hard-hitting headline
 * (big figures, records, crashes, deals). The owner sets the on/off switch, the daily cap, the quiet
 * hours (Riyadh) and the spark bar. The push is the source's own headline under «عاجل من {المصدر}» —
 * nothing is written by AI, and each member gets the pick of his own language.
 */
export function NewsBreaking() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.newsBreaking(), []);
  const [draft, setDraft] = useState<NewsBreakingSettings | null>(null);
  const [busy, setBusy] = useState(false);

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await api.saveNewsBreaking(draft);
      notify('ok', 'حُفظت إعدادات إشعار الخبر العاجل.');
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
      const answer = await api.testNewsBreaking();
      notify('ok', answer.sent ? 'أُرسل إشعار تجريبي لأجهزتك.' : 'لا يوجد جهاز مسجّل لحسابك لاستلام الإشعار.');
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>إشعار الخبر العاجل</h3>
      <Async state={state} rows={3} empty={() => !state.data} emptyText="تعذر تحميل الإعدادات.">
        {(data) => {
          const settings = draft ?? data.settings;
          const change = (patch: Partial<NewsBreakingSettings>) => setDraft({ ...settings, ...patch });
          return (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {data.enabled ? <Pill tone="ok">الخدمة مفعّلة</Pill> : <Pill tone="muted">الخدمة موقوفة (NEWS_BREAKING=0)</Pill>}
                <Pill tone={data.sentToday ? 'gold' : 'muted'}>{`أُرسل اليوم: ${data.sentToday}`}</Pill>
              </div>
              <p className="muted">
                عندما يصل خبر مال وأعمال جديد (أقل من ساعتين) بعنوان قوي — أرقام ضخمة، أرقام قياسية، استحواذات، انهيارات — يصل إشعار «عاجل من
                {' '}المصدر» بعنوان الخبر كما كتبه المصدر. كل عضو يستلم خبر لغته، وبحد أقصى يومي وساعات هدوء.
              </p>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={settings.enabled} onChange={(event) => change({ enabled: event.target.checked })} />
                تشغيل إشعار الخبر العاجل
              </label>
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
                <label>
                  قوة العنوان المطلوبة (10 لكل إشارة)
                  <input type="number" min={10} max={50} step={10} value={settings.minSpark} onChange={(event) => change({ minSpark: Number(event.target.value) })} />
                </label>
              </div>
              <div className="row-actions">
                <button type="button" className="primary" disabled={busy || !draft} onClick={() => void save()}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
                <button type="button" className="ghost" disabled={busy || !draft} onClick={() => setDraft(null)}>تراجع</button>
                <button type="button" className="ghost" disabled={busy} onClick={() => void test()}>إرسال تجريبي لجهازي</button>
              </div>
              <h4>المرشح الآن</h4>
              {data.candidates.length ? (
                <ul className="list">
                  {data.candidates.map((row) => (
                    <li key={row.id} className="value-row">
                      <div className="value-main">
                        <strong>{row.title}</strong>
                        <span className="muted">{` — ${row.sourceName}`}</span>
                      </div>
                      <Pill tone="muted">{row.lang === 'en' ? 'إنجليزي' : 'عربي'}</Pill>
                      {data.sentIds.includes(row.id) ? <Pill tone="ok">أُرسل اليوم</Pill> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">لا يوجد خبر يتجاوز الحد الآن — وهذا طبيعي أغلب الوقت.</p>
              )}
            </>
          );
        }}
      </Async>
    </section>
  );
}
