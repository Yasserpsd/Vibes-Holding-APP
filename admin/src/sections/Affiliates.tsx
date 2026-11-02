import { useEffect, useState } from 'react';

import { api, type AffiliateConfig, type AffiliatePayoutRow, type AffiliateRow } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, useLoad, useShell, type Tone } from '../ui';

/** The applicant's road so far, at a glance. */
function affiliateState(row: AffiliateRow): { label: string; tone: Tone } {
  if (row.status === 'approved') return { label: 'ممثل معتمد', tone: 'ok' };
  if (row.status === 'pending') return { label: 'قيد المراجعة — وافق على الاتفاقية', tone: 'gold' };
  if (row.status === 'agreement') return { label: 'بانتظار موافقته على الاتفاقية', tone: 'muted' };
  return { label: 'مرفوض', tone: 'danger' };
}

const PAYOUT_STATES: Record<AffiliatePayoutRow['status'], { label: string; tone: Tone }> = {
  requested: { label: 'قيد المراجعة', tone: 'gold' },
  paid: { label: 'تم الدفع', tone: 'ok' },
  rejected: { label: 'مرفوض', tone: 'danger' },
};

/**
 * M184: «ممثلو النادي» — the applications with their full details (bank, address, the source),
 * the approval that alone activates an affiliate, the payout requests the administration transfers
 * by hand, and the program's editable content (agreement, commission, options, texts).
 */
export function Affiliates() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.affiliates(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [config, setConfig] = useState<AffiliateConfig | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setConfig(state.data?.config ?? null), [state.data]);

  const waiting = state.data?.affiliates.filter((row) => row.status === 'pending').length ?? 0;
  const openPayouts = state.data?.payouts.filter((row) => row.status === 'requested').length ?? 0;

  async function act(label: string, run: () => Promise<unknown>, key: string) {
    setBusyId(key);
    try {
      await run();
      notify('ok', label);
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setBusyId(null);
    }
  }

  function decide(row: AffiliateRow, status: 'approved' | 'rejected') {
    if (status === 'approved' && !window.confirm(`اعتماد «${row.name}» ممثلًا للنادي؟ سيصله بريد برابط الإحالة الخاص به.`)) return;
    const note = status === 'rejected' ? (window.prompt('سبب الرفض (يظهر لمقدّم الطلب):')?.trim() ?? '') : '';
    if (status === 'rejected' && note === '' && !window.confirm('رفض الطلب دون ذكر سبب؟')) return;
    void act(status === 'approved' ? 'اعتُمد الممثل وأُرسل إليه البريد.' : 'رُفض الطلب وأُبلغ مقدّمه.', () => api.affiliateDecision(row.contactId, status, note), `a:${row.contactId}`);
  }

  function decidePayout(row: AffiliatePayoutRow, status: 'paid' | 'rejected') {
    if (status === 'paid' && !window.confirm(`تأكيد أن مبلغ ${formatNumber(row.amount)} ريال حُوّل فعلًا إلى حساب «${row.name}»؟`)) return;
    const note = status === 'rejected' ? (window.prompt('سبب عدم اعتماد طلب السحب (يظهر للممثل):')?.trim() ?? '') : '';
    void act(status === 'paid' ? 'سُجّل التحويل وأُبلغ الممثل.' : 'رُفض طلب السحب وأُبلغ الممثل.', () => api.affiliatePayoutDecision(row.id, status, note), `p:${row.id}`);
  }

  async function saveConfig() {
    if (!config || saving) return;
    setSaving(true);
    try {
      await api.affiliateConfig({ ...config, heardOptions: config.heardOptions.map((option) => option.trim()).filter(Boolean) });
      notify('ok', 'حُفظ محتوى البرنامج.');
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionHead
        title="ممثلو النادي"
        hint={state.data ? `طلبات بانتظار القرار: ${formatNumber(waiting)} · طلبات سحب مفتوحة: ${formatNumber(openPayouts)}` : undefined}
        onReload={state.reload}
        busy={state.loading}
      />
      <p className="muted">
        برنامج ممثلي النادي: العضو يقدّم طلبًا ببياناته كاملة، تصله الاتفاقية بالبريد ويوافق عليها من التطبيق، ولا يتفعّل إلا باعتمادكم هنا. رمز الإحالة هو رقم
        عضويته، والعمولة تُستحق فقط عن عضو سجّل برمزه وسدّد العضوية فعلًا (من تأكيد السيرفر، لا من التطبيق). التحويل البنكي يدوي، ثم يُعلَّم طلب السحب «تم الدفع».
      </p>
      <Async state={state} rows={5}>
        {(data) => (
          <div className="stack">
            {data.payouts.length > 0 ? (
              <DataTable<AffiliatePayoutRow>
                caption="طلبات سحب الأرباح"
                rows={data.payouts}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'who', label: 'الممثل', cell: (row) => <MemberLink id={row.contactId} name={row.name} /> },
                  { key: 'amount', label: 'المبلغ', cell: (row) => `${formatNumber(row.amount)} ريال` },
                  {
                    key: 'bank',
                    label: 'الحساب البنكي',
                    cell: (row) => (
                      <>
                        {row.bankName} — {row.accountName}
                        <br />
                        <bdi dir="ltr" className="num">{row.iban}</bdi>
                      </>
                    ),
                  },
                  { key: 'at', label: 'طُلب', cell: (row) => formatDateTime(row.requestedAt) },
                  {
                    key: 'state',
                    label: 'الحالة',
                    cell: (row) => {
                      const progress = PAYOUT_STATES[row.status];
                      return (
                        <>
                          <Pill tone={progress.tone}>{progress.label}</Pill>
                          {row.adminNote ? <div className="muted">{row.adminNote}</div> : null}
                        </>
                      );
                    },
                  },
                  {
                    key: 'actions',
                    label: 'القرار',
                    cell: (row) =>
                      row.status === 'requested' ? (
                        <span>
                          <button type="button" disabled={busyId === `p:${row.id}`} onClick={() => decidePayout(row, 'paid')}>تم الدفع</button>{' '}
                          <button type="button" className="ghost" disabled={busyId === `p:${row.id}`} onClick={() => decidePayout(row, 'rejected')}>رفض</button>
                        </span>
                      ) : (
                        row.decidedBy ?? '—'
                      ),
                  },
                ]}
              />
            ) : null}

            {data.affiliates.length === 0 ? (
              <p className="state-card empty">لم يقدّم أحد طلب انضمام بعد.</p>
            ) : (
              <DataTable<AffiliateRow>
                caption="الممثلون والطلبات"
                rows={data.affiliates}
                rowKey={(row) => String(row.contactId)}
                columns={[
                  {
                    key: 'who',
                    label: 'مقدّم الطلب',
                    cell: (row) => (
                      <>
                        <MemberLink id={row.contactId} name={row.name || row.email} /> <bdi dir="ltr" className="num">{row.code}</bdi>
                      </>
                    ),
                  },
                  {
                    key: 'details',
                    label: 'البيانات',
                    cell: (row) => (
                      <details>
                        <summary>التفاصيل</summary>
                        <ul>
                          <li><strong>صفة مقدّم الطلب:</strong> {row.entityType === 'company' ? 'شركة' : 'فرد'}</li>
                          <li><strong>الجوال:</strong> <bdi dir="ltr" className="num">{row.phone || '—'}</bdi></li>
                          <li><strong>البريد:</strong> <bdi dir="ltr">{row.email || '—'}</bdi></li>
                          <li><strong>البنك:</strong> {row.bankName} — {row.accountName}</li>
                          <li><strong>الآيبان:</strong> <bdi dir="ltr" className="num">{row.iban}</bdi></li>
                          <li><strong>المدينة:</strong> {row.city}</li>
                          <li><strong>العنوان:</strong> {row.address}</li>
                          <li><strong>كيف تعرّف على النادي:</strong> {row.heardFrom}{row.heardFromNote ? ` — ${row.heardFromNote}` : ''}</li>
                          {row.adminNote ? <li><strong>ملاحظة الإدارة:</strong> {row.adminNote}</li> : null}
                        </ul>
                      </details>
                    ),
                  },
                  {
                    key: 'stats',
                    label: 'الإحالات والرصيد',
                    cell: (row) => (
                      <>
                        {`دافعون: ${formatNumber(row.stats.paid)} · غير دافعين: ${formatNumber(row.stats.unpaid)}`}
                        <br />
                        {`الرصيد المتاح: ${formatNumber(row.stats.available)} ريال`}
                      </>
                    ),
                  },
                  { key: 'at', label: 'قدّم', cell: (row) => formatDateTime(row.appliedAt) },
                  {
                    key: 'state',
                    label: 'الحالة',
                    cell: (row) => {
                      const progress = affiliateState(row);
                      return <Pill tone={progress.tone}>{progress.label}</Pill>;
                    },
                  },
                  {
                    key: 'actions',
                    label: 'القرار',
                    cell: (row) =>
                      row.status === 'pending' ? (
                        <span>
                          <button type="button" disabled={busyId === `a:${row.contactId}`} onClick={() => decide(row, 'approved')}>اعتماد</button>{' '}
                          <button type="button" className="ghost" disabled={busyId === `a:${row.contactId}`} onClick={() => decide(row, 'rejected')}>رفض</button>
                        </span>
                      ) : row.status === 'approved' ? (
                        <button type="button" className="ghost" disabled={busyId === `a:${row.contactId}`} onClick={() => decide(row, 'rejected')}>إيقاف الممثل</button>
                      ) : (
                        row.decidedBy ?? '—'
                      ),
                  },
                ]}
              />
            )}

            {config ? (
              <form className="card editor" onSubmit={(event) => { event.preventDefault(); void saveConfig(); }}>
                <h3>محتوى البرنامج (يظهر في التطبيق وفي بريد الاتفاقية)</h3>
                <label>
                  العمولة بالريال السعودي عن كل عضو دافع
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={config.commission}
                    onChange={(event) => setConfig({ ...config, commission: Number(event.target.value) || config.commission })}
                  />
                </label>
                <label>
                  تعريف البرنامج (أعلى شاشة الانضمام؛ {'{commission}'} تصير قيمة العمولة)
                  <textarea rows={3} maxLength={2000} value={config.introText} onChange={(event) => setConfig({ ...config, introText: event.target.value })} />
                </label>
                <label>
                  نص المشاركة الذي يرسله الممثل ({'{link}'} رابطه و{'{code}'} رمزه)
                  <textarea rows={3} maxLength={1000} value={config.shareText} onChange={(event) => setConfig({ ...config, shareText: event.target.value })} />
                </label>
                <label>
                  خيارات «كيف تعرّفت على نادي المستثمرين؟» (سطر لكل خيار)
                  <textarea
                    rows={6}
                    value={config.heardOptions.join('\n')}
                    onChange={(event) => setConfig({ ...config, heardOptions: event.target.value.split('\n') })}
                  />
                </label>
                <label>
                  نص الاتفاقية الكامل ({'{commission}'} تصير قيمة العمولة)
                  <textarea rows={18} maxLength={20000} value={config.agreementText} onChange={(event) => setConfig({ ...config, agreementText: event.target.value })} />
                </label>
                <div>
                  <button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المحتوى'}</button>
                </div>
              </form>
            ) : null}
          </div>
        )}
      </Async>
    </>
  );
}
