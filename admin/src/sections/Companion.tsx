import { useState } from 'react';

import { api, type CompanionPersona, type CompanionTemplate, type CompanionTemplates } from '../api';
import { formatNumber } from '../format';
import { Async, Pill, SectionHead, messageOf, sessionOver, useLoad, useShell } from '../ui';

/**
 * M87b «المستشار اليومي»: the owner edits the daily-push template pools per persona. A template may
 * carry placeholders ({golden}, {project}, {event}…) the server fills from live data at send time;
 * one whose data is missing that day is skipped for the next in the pool. Members who muted the
 * message are counted here and skipped by the wave.
 */
const PERSONA_LABEL: Record<CompanionPersona, string> = { neutral: 'المحايد', entrepreneur: 'رائد الأعمال', investor: 'المستثمر' };
const PERSONAS: CompanionPersona[] = ['neutral', 'entrepreneur', 'investor'];
const MAX_POOL = 6;

export function Companion() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.companion(), []);
  const [draft, setDraft] = useState<CompanionTemplates | null>(null);
  const [busy, setBusy] = useState(false);

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  const templates = draft ?? state.data?.templates ?? null;

  const edit = (persona: CompanionPersona, index: number, patch: Partial<CompanionTemplate>) => {
    if (!templates) return;
    setDraft({
      ...templates,
      [persona]: templates[persona].map((template, at) => (at === index ? { ...template, ...patch } : template)),
    });
  };

  const addRow = (persona: CompanionPersona) => {
    if (!templates || templates[persona].length >= MAX_POOL) return;
    setDraft({ ...templates, [persona]: [...templates[persona], { title: '', body: '' }] });
  };

  const removeRow = (persona: CompanionPersona, index: number) => {
    if (!templates || templates[persona].length <= 1) return;
    setDraft({ ...templates, [persona]: templates[persona].filter((_template, at) => at !== index) });
  };

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await api.saveCompanion(draft);
      notify('ok', 'حُفظت قوالب المستشار اليومي.');
      setDraft(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy || !window.confirm('استرجاع النصوص الأصلية لكل الفئات؟')) return;
    setBusy(true);
    try {
      await api.resetCompanion();
      notify('ok', 'رجعت النصوص الأصلية.');
      setDraft(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <SectionHead
        title="المستشار اليومي"
        hint="رسالة واحدة من المستشار لكل عضو كل يوم، حسب فئته — بدون أي تكلفة ذكاء اصطناعي."
        onReload={state.reload}
        busy={state.loading}
      />
      <Async state={state} rows={4} empty={() => !state.data} emptyText="تعذر تحميل القوالب.">
        {(data) => (
          <>
            <section className="card">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {data.enabled ? <Pill tone="ok">الإرسال اليومي مفعّل</Pill> : <Pill tone="muted">الإرسال موقوف (COMPANION_PUSH=0)</Pill>}
                <Pill tone="muted">{data.lastDay ? `آخر إرسال: ${data.lastDay}` : 'لم يُرسل بعد'}</Pill>
                <Pill tone={data.mutedCount ? 'gold' : 'muted'}>{`كاتمو الرسالة: ${formatNumber(data.mutedCount)}`}</Pill>
                {data.edited ? <Pill tone="gold">قوالب معدّلة</Pill> : <Pill tone="muted">النصوص الأصلية</Pill>}
              </div>
              <p className="muted">
                الرسالة تتبدل يوميًا بين قوالب الفئة بالترتيب. اكتب داخل النص وسوم تتبدل تلقائيًا من بيانات اليوم:
                {' '}
                {data.placeholders.map((item) => (
                  <span key={item.key}>
                    <bdi dir="ltr"><code>{`{${item.key}}`}</code></bdi> {item.label}؛{' '}
                  </span>
                ))}
                وإذا لم تتوفر بيانات وسمٍ ما في يومٍ ما، يتخطى المستشار هذا القالب إلى الذي يليه.
              </p>
            </section>

            <section className="card">
              <h3>معاينة رسائل اليوم</h3>
              <ul className="list">
                {PERSONAS.map((persona) => (
                  <li key={persona} className="value-row">
                    <div className="value-main">
                      <strong>{PERSONA_LABEL[persona]}</strong>
                      <p style={{ margin: '4px 0 0' }}>{data.preview[persona].title}</p>
                      <p className="muted" style={{ margin: 0 }}>{data.preview[persona].body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {templates
              ? PERSONAS.map((persona) => (
                  <section className="card" key={persona}>
                    <h3>{`قوالب ${PERSONA_LABEL[persona]}`}</h3>
                    {templates[persona].map((template, index) => (
                      <div className="card editor" key={index} style={{ marginBottom: 8 }}>
                        <label>
                          العنوان
                          <input value={template.title} maxLength={80} onChange={(event) => edit(persona, index, { title: event.target.value })} />
                        </label>
                        <label>
                          النص
                          <textarea rows={2} maxLength={400} value={template.body} onChange={(event) => edit(persona, index, { body: event.target.value })} />
                        </label>
                        {templates[persona].length > 1 ? (
                          <div className="row-actions">
                            <button type="button" className="ghost" onClick={() => removeRow(persona, index)}>حذف الرسالة</button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <div className="row-actions">
                      <button type="button" onClick={() => addRow(persona)} disabled={templates[persona].length >= MAX_POOL}>+ رسالة إضافية</button>
                    </div>
                  </section>
                ))
              : null}

            <div className="row-actions">
              <button type="button" className="primary" disabled={busy || !draft} onClick={() => void save()}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ القوالب'}
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void reset()}>استرجاع النصوص الأصلية</button>
            </div>
          </>
        )}
      </Async>
    </div>
  );
}
