import { useState } from 'react';

import { api, type RefusalReport } from '../api';
import { formatNumber } from '../format';
import { Async, Chips, DataTable, SectionHead, useLoad } from '../ui';

type Period = '7' | '30' | '90';
type Reason = RefusalReport['steps'][number]['reasons'][number];

const share = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/**
 * M255 «أسباب تعثّر التسجيل» (owner, 2026-11-19: many people stop while signing up and nobody knows why): where
 * sign-ups, sign-ins and password resets stopped, the commonest cause first. Counts only — no member is named.
 */
export function SignupIssues() {
  const [period, setPeriod] = useState<Period>('7');
  const state = useLoad(() => api.authRefusals(Number(period)), [period]);

  return (
    <>
      <SectionHead title="أسباب تعثّر التسجيل" hint={state.data ? `من ${state.data.from} إلى ${state.data.to}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        كل محاولة توقفت عند إنشاء الحساب أو تسجيل الدخول أو استعادة كلمة المرور، مرتبة من السبب الأكثر تكرارًا. الأرقام أعداد فقط: لا يُحفظ اسم
        ولا بريد ولا رقم جوال.
      </p>
      <Chips<Period>
        label="الفترة"
        value={period}
        onChange={setPeriod}
        options={[
          { value: '7', label: 'آخر 7 أيام' },
          { value: '30', label: 'آخر 30 يومًا' },
          { value: '90', label: 'آخر 90 يومًا' },
        ]}
      />
      <Async state={state} rows={6} empty={(data) => data.steps.every((step) => step.passed + step.refused === 0)} emptyText="لا توجد محاولات مسجّلة في هذه الفترة بعد. العدّ يبدأ من تاريخ تفعيل هذه الصفحة.">
        {(data: RefusalReport) => (
          <>
            {data.steps.map((step) => {
              const attempts = step.passed + step.refused;
              return (
                <section key={step.step} style={{ marginTop: 24 }}>
                  <h3>{step.label}</h3>
                  <p className="muted">
                    {`المحاولات: ${formatNumber(attempts)} · نجحت: ${formatNumber(step.passed)} · توقفت: ${formatNumber(step.refused)} · نسبة التوقف: ${share(step.refused, attempts)}`}
                  </p>
                  {/* M257: how many opened the form against how many sent it — the ones who leave without pressing the button. */}
                  {step.opened > 0 ? (
                    <p className="muted">{`فتحوا الصفحة: ${formatNumber(step.opened)} · أرسلوا النموذج: ${formatNumber(attempts)} · غادروا دون إرسال: ${share(Math.max(step.opened - attempts, 0), step.opened)}`}</p>
                  ) : null}
                  {step.reasons.length === 0 ? (
                    <p className="state-card empty">لا توجد محاولات متوقفة في هذه الخطوة.</p>
                  ) : (
                    <DataTable<Reason>
                      caption={`أسباب التوقف في ${step.label}`}
                      rows={step.reasons}
                      rowKey={(row) => `${row.code}-${row.field}`}
                      columns={[
                        { key: 'label', label: 'السبب', cell: (row) => row.label },
                        { key: 'count', label: 'العدد', num: true, cell: (row) => formatNumber(row.count) },
                        { key: 'share', label: 'من المتوقفين', num: true, cell: (row) => share(row.count, step.refused) },
                        { key: 'ios', label: 'آيفون', num: true, cell: (row) => formatNumber(row.ios) },
                        { key: 'android', label: 'أندرويد', num: true, cell: (row) => formatNumber(row.android) },
                      ]}
                    />
                  )}
                </section>
              );
            })}
          </>
        )}
      </Async>
    </>
  );
}
