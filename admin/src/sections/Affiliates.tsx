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
 * M184: «ممثلو نادي المستثمرين» — the applications with their full details (bank, address, the source),
 * the approval that alone activates an affiliate, the payout requests the administration transfers
 * by hand, and the program's editable content (agreement, commission, options, texts).
 * M186: the commission tiers, the performance-cycle counter per affiliate and «تجديد الدورة».
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
  const renewals = state.data?.affiliates.filter((row) => row.status === 'approved' && row.cycle?.state === 'renewal').length ?? 0;

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

  /** M186: renew the counter (or restart it early) — the defaults are the program's current terms. */
  function renewCycle(row: AffiliateRow) {
    const defaults = state.data?.config;
    const ask = (label: string, fallback: number, min: number) => {
      const answer = window.prompt(label, String(fallback));
      if (answer === null) return null;
      const value = Math.round(Number(answer.trim()));
      return Number.isFinite(value) && value >= min ? value : null;
    };
    const days = ask(`مدة الدورة الجديدة لـ «${row.name}» (بالأيام):`, defaults?.cycleDays ?? 30, 1);
    if (days === null) return;
    const target = ask('عدد الأعضاء الدافعين المطلوب خلال الدورة:', row.cycle?.target ?? defaults?.cycleTarget ?? 10, 1);
    if (target === null) return;
    const bonus = ask('بدل المواصلات والمصروفات النثرية عند بلوغ الهدف (بالريال؛ 0 = بدون بدل):', row.cycle?.bonus ?? defaults?.cycleBonus ?? 1500, 0);
    if (bonus === null) return;
    if (!window.confirm(`بدء دورة جديدة لـ «${row.name}»: ${formatNumber(days)} يومًا، الهدف ${formatNumber(target)} أعضاء دافعين، البدل ${formatNumber(bonus)} ريال؟`)) return;
    void act('بدأت الدورة الجديدة وأُبلغ الممثل.', () => api.affiliateCycle(row.contactId, { days, target, bonus }), `c:${row.contactId}`);
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
        title="ممثلو نادي المستثمرين"
        hint={state.data ? `طلبات بانتظار القرار: ${formatNumber(waiting)} · طلبات سحب مفتوحة: ${formatNumber(openPayouts)} · طلبات تجديد الدورة: ${formatNumber(renewals)}` : undefined}
        onReload={state.reload}
        busy={state.loading}
      />
      <p className="muted">
        برنامج ممثلي نادي المستثمرين: العضو يقدّم طلبًا ببياناته كاملة، تصله الاتفاقية بالبريد ويوافق عليها من التطبيق، ولا يتفعّل إلا باعتمادكم هنا. رمز الإحالة هو رقم
        عضويته، والعمولة تُستحق فقط عن عضو سجّل برمزه وسدّد العضوية فعلًا (من تأكيد السيرفر، لا من التطبيق). التحويل البنكي يدوي، ثم يُعلَّم طلب السحب «تم الدفع». العمولة 250 لغير المشترك و350 للمشترك في العضوية السنوية (حسب حالته وقت سداد العضو)، ولكل ممثل عدّاد دورة أداء: عند بلوغ الهدف داخل المدة يُضاف البدل إلى رصيده تلقائيًا، وعند انتهاء المدة يصلكم طلب تجديد بالبريد ويظهر هنا بزر «تجديد الدورة».
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
                        <br />
                        {`فئة العمولة: ${row.stats.member ? 'مشترك' : 'غير مشترك'} (${formatNumber(row.stats.commission)} ريال)${row.stats.bonuses ? ` · بدلات: ${formatNumber(row.stats.bonuses)} ريال` : ''}`}
                      </>
                    ),
                  },
                  {
                    key: 'cycle',
                    label: 'دورة الأداء',
                    cell: (row) =>
                      row.cycle ? (
                        <>
                          {row.cycle.state === 'renewal' ? <Pill tone="gold">انتهت — بانتظار التجديد</Pill> : <Pill tone="ok">{`متبقٍ ${formatNumber(row.cycle.daysLeft)} يومًا`}</Pill>}
                          <div className="muted">{`الدورة ${formatNumber(row.cycle.n)}: ${formatNumber(row.cycle.paid)} من ${formatNumber(row.cycle.target)} أعضاء دافعين · البدل ${formatNumber(row.cycle.bonus)} ريال${row.cycle.achieved ? ' (استُحق)' : ''}`}</div>
                          <div className="muted">{`تنتهي: ${formatDateTime(row.cycle.endAt)}`}</div>
                          {row.status === 'approved' ? (
                            <button type="button" className={row.cycle.state === 'renewal' ? undefined : 'ghost'} disabled={busyId === `c:${row.contactId}`} onClick={() => renewCycle(row)}>
                              {row.cycle.state === 'renewal' ? 'تجديد الدورة' : 'بدء دورة جديدة'}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        '—'
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
                  عمولة الممثل غير المشترك (بالريال عن كل عضو دافع)
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={config.commission}
                    onChange={(event) => setConfig({ ...config, commission: Number(event.target.value) || config.commission })}
                  />
                </label>
                <label>
                  عمولة الممثل المشترك في العضوية السنوية (بالريال عن كل عضو دافع)
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={config.commissionMember}
                    onChange={(event) => setConfig({ ...config, commissionMember: Number(event.target.value) || config.commissionMember })}
                  />
                </label>
                <label>
                  مدة دورة الأداء الافتراضية (بالأيام)
                  <input type="number" min={1} max={365} value={config.cycleDays} onChange={(event) => setConfig({ ...config, cycleDays: Number(event.target.value) || config.cycleDays })} />
                </label>
                <label>
                  هدف الدورة الافتراضي (عدد الأعضاء الدافعين خلال المدة)
                  <input type="number" min={1} max={1000} value={config.cycleTarget} onChange={(event) => setConfig({ ...config, cycleTarget: Number(event.target.value) || config.cycleTarget })} />
                </label>
                <label>
                  بدل المواصلات والمصروفات النثرية عند بلوغ الهدف (بالريال؛ 0 = بدون بدل)
                  <input type="number" min={0} max={1000000} value={config.cycleBonus} onChange={(event) => setConfig({ ...config, cycleBonus: Math.max(0, Number(event.target.value) || 0) })} />
                </label>
                <label>
                  الحد الأدنى لطلب السحب (عدد الأعضاء المسدّدين؛ 0 = بدون حد)
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={config.minPayoutPaid}
                    onChange={(event) => setConfig({ ...config, minPayoutPaid: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </label>
                <label>
                  تعريف البرنامج (أعلى شاشة الانضمام؛ {'{commission}'} عمولة غير المشترك، {'{commissionMember}'} عمولة المشترك، {'{bonus}'} البدل، {'{bonusTarget}'} هدف الدورة، {'{bonusDays}'} مدتها، {'{minPayout}'} الحد الأدنى للسحب)
                  <textarea rows={6} maxLength={2000} value={config.introText} onChange={(event) => setConfig({ ...config, introText: event.target.value })} />
                </label>
                <label>
                  تعريف البرنامج بالإنجليزية (للتطبيق بالوضع الإنجليزي؛ نفس الرموز)
                  <textarea rows={6} maxLength={2000} dir="ltr" value={config.introTextEn} onChange={(event) => setConfig({ ...config, introTextEn: event.target.value })} />
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
                  نص الاتفاقية الكامل ({'{commission}'} عمولة غير المشترك، {'{commissionMember}'} عمولة المشترك، {'{bonus}'} البدل، {'{bonusTarget}'} هدف الدورة، {'{bonusDays}'} مدتها، {'{minPayout}'} الحد الأدنى للسحب)
                  <textarea rows={18} maxLength={20000} value={config.agreementText} onChange={(event) => setConfig({ ...config, agreementText: event.target.value })} />
                </label>
                <label>
                  نص الاتفاقية بالإنجليزية (للتطبيق بالوضع الإنجليزي؛ النص العربي هو المرجع)
                  <textarea rows={18} maxLength={20000} dir="ltr" value={config.agreementTextEn} onChange={(event) => setConfig({ ...config, agreementTextEn: event.target.value })} />
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
